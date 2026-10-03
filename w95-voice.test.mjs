import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DEFAULT_MOONSHINE_BASE, LocalDictation, microphoneMessage, shouldFallBack, voiceEngine,
} from './w95-voice.mjs';

test('the built-in recognition is preferred, the local model is the fallback', () => {
  assert.equal(voiceEngine({ hasNative: true, canCapture: true }), 'native');
  assert.equal(voiceEngine({ hasNative: true, canCapture: false }), 'native');
  // Firefox, iOS Chrome: no SpeechRecognition, but a microphone.
  assert.equal(voiceEngine({ hasNative: false, canCapture: true }), 'local');
  // No microphone or an insecure page: nothing can work.
  assert.equal(voiceEngine({ hasNative: false, canCapture: false }), null);
});

test('only service failures fall back to local recognition', () => {
  for (const code of ['network', 'service-not-allowed', 'language-not-supported']) {
    assert.equal(shouldFallBack(code, true), true, code);
    assert.equal(shouldFallBack(code, false), false, `${code} without a microphone`);
  }
  // These are the user's to fix; a different engine would hit the same thing.
  for (const code of ['not-allowed', 'no-speech', 'audio-capture', 'aborted']) {
    assert.equal(shouldFallBack(code, true), false, code);
  }
});

test('a refused microphone says how to allow it', () => {
  assert.match(microphoneMessage({ name: 'NotAllowedError' }), /Allow it for this site/);
  assert.match(microphoneMessage({ name: 'NotFoundError' }), /No microphone/);
  assert.equal(microphoneMessage(new Error('boom')), 'boom');
});

/** A fake environment that records the order things happen in. */
function fakeEnv(log, { micFails = false } = {}) {
  class FakeAudioContext {
    constructor() { log.push('audio-context'); }
    resume() { log.push('audio-resume'); return Promise.resolve(); }
    close() { log.push('audio-close'); return Promise.resolve(); }
  }
  const track = { stop: () => log.push('track-stop') };
  const callbacks = {};
  class FakeTranscriber {
    constructor(model, cb) { log.push('transcriber:' + model); Object.assign(callbacks, cb); this.audioContext = new FakeAudioContext(); }
    attachStream() { log.push('attach'); }
    async start() { log.push('start'); callbacks.onTranscribeStarted?.(); }
    stop() { log.push('transcriber-stop'); }
  }
  const settings = { BASE_ASSET_PATH: {} };
  return {
    callbacks, settings,
    env: {
      AudioContext: FakeAudioContext,
      baseHref: 'https://fastium.live/w95/',
      getUserMedia: async () => { log.push('mic'); if (micFails) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); return { getTracks: () => [track] }; },
      importModule: async (url) => { log.push('import:' + url); return { Settings: settings, Transcriber: FakeTranscriber }; },
    },
  };
}

test('audio and the microphone are claimed before the model is downloaded', async () => {
  // Phones start audio and show the microphone prompt only from inside the
  // tap; the model download is slow, so anything audio-related after it is
  // too late. This order is the point of the module.
  const log = [], texts = [], states = [];
  const { env, settings } = fakeEnv(log);
  const dictation = new LocalDictation({ env, onText: (t) => texts.push(t), onState: (s) => states.push(s) });
  await dictation.start();
  assert.ok(log.indexOf('audio-context') < log.indexOf('mic'), 'audio context before microphone');
  assert.ok(log.indexOf('mic') < log.findIndex((e) => e.startsWith('import:')), 'microphone before the model');
  // Loaded from the VM page's copy, resolved against the page address.
  assert.ok(log.includes('import:https://fastium.live/vm/vendor/moonshine/moonshine.min.js'));
  assert.equal(settings.BASE_ASSET_PATH.ONNX_RUNTIME, 'https://fastium.live/vm/vendor/moonshine/ort/');
  assert.equal(settings.BASE_ASSET_PATH.SILERO_VAD, 'https://fastium.live/vm/vendor/moonshine/vad/');
  assert.ok(log.includes('transcriber:model/tiny'));
  assert.deepEqual(states, ['listening']);
});

test('committed speech reaches the prompt, and stop releases everything', async () => {
  const log = [], texts = [];
  const { env, callbacks } = fakeEnv(log);
  const dictation = new LocalDictation({ env, onText: (t) => texts.push(t) });
  await dictation.start();
  callbacks.onTranscriptionCommitted('  open notepad  ');
  callbacks.onTranscriptionCommitted('   ');
  assert.deepEqual(texts, ['open notepad']);
  dictation.stop();
  for (const released of ['transcriber-stop', 'track-stop', 'audio-close']) assert.ok(log.includes(released), released);
});

test('a refused microphone aborts before any download and cleans up', async () => {
  const log = [];
  const { env } = fakeEnv(log, { micFails: true });
  const dictation = new LocalDictation({ env });
  await assert.rejects(dictation.start(), /denied/);
  assert.ok(!log.some((e) => e.startsWith('import:')), 'nothing downloaded after a refusal');
  assert.ok(log.includes('audio-close'));
});

test('the page wires the local engine in and keeps the built-in one first', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /import \{[^}]*LocalDictation[^}]*\} from "\.\/w95-voice\.mjs"/);
  assert.match(html, /voiceMode = voiceEngine\(/);
  assert.match(html, /shouldFallBack\(event\.error, canCapture\)/);
  // agentBusyState() reads voiceAvailable, so it must be declared before it.
  assert.ok(html.indexOf('const voiceAvailable') < html.indexOf('function agentBusyState'));
  assert.match(html, /\$\("agent_voice"\)\.disabled = busy \|\| !voiceAvailable/);
  assert.equal(DEFAULT_MOONSHINE_BASE, '../vm/vendor/moonshine/');
});
