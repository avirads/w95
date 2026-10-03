// Dictation for the prompt box, for browsers whose built-in speech recognition
// is missing or does not work.
//
// The browser's own SpeechRecognition is the first choice: nothing to download.
// But it is absent from Firefox and from every browser on iOS other than
// Safari, and where present it depends on the vendor's online speech service,
// which fails ("network", "service-not-allowed") in Brave and wherever that
// service is unreachable. In all of those the Dictate button used to be
// disabled or just reported an error, so voice looked switched off.
//
// The fallback is Moonshine Tiny running locally in the page (about 42 MiB, no
// audio leaves the browser). It is the same engine the VM page uses, and by
// default it is loaded from that page's copy under /vm/ rather than duplicated
// here: set <meta name="moonshine-base" content="..."> to point elsewhere.

/** Where the Moonshine files live, relative to the page. */
export const DEFAULT_MOONSHINE_BASE = '../vm/vendor/moonshine/';

/** Speech errors that mean "the browser's service cannot be used", not "try again". */
const SERVICE_ERRORS = new Set(['network', 'service-not-allowed', 'language-not-supported']);

/**
 * Which engine should Dictate use?
 *   'native' - the browser's SpeechRecognition
 *   'local'  - Moonshine in the page (needs a microphone and a secure context)
 *   null     - neither is possible, so the button stays disabled
 */
export function voiceEngine({ hasNative, canCapture }) {
  if (hasNative) return 'native';
  if (canCapture) return 'local';
  return null;
}

/** Should a native-recognition error switch to the local engine? */
export function shouldFallBack(errorCode, canCapture) {
  return Boolean(canCapture) && SERVICE_ERRORS.has(errorCode);
}

/** A microphone refusal, in words that say what to do about it. */
export function microphoneMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'Microphone access was blocked. Allow it for this site in the browser settings, then press Dictate again.';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
    return 'No microphone was found.';
  }
  return error?.message || String(error);
}

/**
 * Local dictation. start() must be called straight from the click handler:
 * phones only start audio, and only show the microphone prompt, from inside the
 * tap, and the model takes long enough to download that doing audio afterwards
 * is too late. So the audio context and the microphone come first, and the
 * model second.
 */
export class LocalDictation {
  constructor({ baseUrl = DEFAULT_MOONSHINE_BASE, onStatus, onState, onText, env = {} }) {
    this.baseUrl = baseUrl;
    this.onStatus = onStatus || (() => {});
    this.onState = onState || (() => {});
    this.onText = onText || (() => {});
    this.AudioContext = env.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
    this.getUserMedia = env.getUserMedia || ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    this.importModule = env.importModule || ((url) => import(url));
    this.baseHref = env.baseHref || (typeof location === 'undefined' ? 'http://localhost/' : location.href);
    this.unlock = null;
    this.stream = null;
    this.transcriber = null;
    this.stopped = false;
  }

  async start() {
    try {
      this.unlock = new this.AudioContext();
      this.unlock.resume?.().catch?.(() => {});
      this.onStatus('Requesting microphone access…');
      // No sampleRate constraint: phones ignore it or reject it.
      this.stream = await this.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, autoGainControl: true, noiseSuppression: true,
      } });
      if (this.stopped) return this.stop();
      this.onStatus('Loading the local speech model (about 42 MiB the first time)…');
      const root = new URL(this.baseUrl, this.baseHref).href;
      const Moonshine = await this.importModule(root + 'moonshine.min.js');
      if (this.stopped) return this.stop();
      Moonshine.Settings.BASE_ASSET_PATH.MOONSHINE = root;
      Moonshine.Settings.BASE_ASSET_PATH.ONNX_RUNTIME = root + 'ort/';
      Moonshine.Settings.BASE_ASSET_PATH.SILERO_VAD = root + 'vad/';
      this.transcriber = new Moonshine.Transcriber('model/tiny', {
        onModelLoadStarted: () => this.onStatus('Downloading and loading the speech model…'),
        onModelLoaded: () => this.onStatus('Speech model ready. Starting…'),
        onTranscribeStarted: () => { this.onState('listening'); this.onStatus('Listening… speak your task.'); },
        onSpeechStart: () => this.onStatus('Hearing speech…'),
        onSpeechEnd: () => this.onStatus('Transcribing…'),
        onTranscriptionCommitted: (text) => {
          const spoken = String(text || '').trim();
          if (spoken) this.onText(spoken);
        },
        onError: (error) => { this.onStatus('Voice input stopped: ' + String(error)); this.stop(); },
      });
      // The transcriber makes its own audio context once the downloads are
      // done; wake it so it is not left suspended.
      this.transcriber.audioContext?.resume?.().catch?.(() => {});
      this.transcriber.attachStream(this.stream);
      await this.transcriber.start();
      this.transcriber.audioContext?.resume?.().catch?.(() => {});
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    this.stopped = true;
    try { this.transcriber?.stop?.(); } catch { /* it may already have stopped */ }
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.unlock?.close?.().catch?.(() => {});
    this.transcriber = null;
    this.stream = null;
    this.unlock = null;
    this.onState('stopped');
  }
}
