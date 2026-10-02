import test from 'node:test';
import assert from 'node:assert/strict';
import { WINDOWS95_PROMPTS, nextWindowsPrompt } from './agent-prompts.mjs';
import { windowsActions } from './w95-actions.mjs';

test('Windows 95 suggestions are unique, immutable, and concise', () => {
  assert.ok(Object.isFrozen(WINDOWS95_PROMPTS));
  assert.ok(WINDOWS95_PROMPTS.length >= 8 && WINDOWS95_PROMPTS.length <= 10);
  assert.equal(new Set(WINDOWS95_PROMPTS).size, WINDOWS95_PROMPTS.length);
  for (const prompt of WINDOWS95_PROMPTS) {
    assert.equal(typeof prompt, 'string');
    assert.equal(prompt.trim(), prompt);
    assert.ok(prompt.length > 20 && prompt.length <= 160);
    assert.doesNotMatch(prompt, /https?:|download|install|registry|delete|format\b/i);
  }
  assert.throws(() => WINDOWS95_PROMPTS.push('another task'), TypeError);
});

test('suggestions cover built-in apps and read-only Windows navigation', () => {
  const catalog = WINDOWS95_PROMPTS.join('\n');
  for (const capability of ['Notepad', 'Calculator', 'Paint', 'My Computer',
    'Windows Explorer', 'Control Panel', 'Programs', 'Help']) {
    assert.ok(catalog.includes(capability), `Missing ${capability}`);
  }
  assert.match(WINDOWS95_PROMPTS.find(prompt => prompt.includes('Control Panel')),
    /without changing any settings/);
  assert.match(WINDOWS95_PROMPTS.find(prompt => prompt.includes('Windows Explorer')),
    /without changing any files/);
});

test('every typing suggestion supplies a quoted literal the agent can inject', () => {
  const observation = { width: 640, height: 480, targets: [] };
  const typingPrompts = WINDOWS95_PROMPTS.filter(prompt => /\btype\b/i.test(prompt));
  assert.ok(typingPrompts.length >= 2);
  for (const prompt of typingPrompts) {
    const literal = prompt.match(/"([^"]+)"/);
    assert.ok(literal, `Missing quoted text in ${prompt}`);
    const actions = windowsActions(prompt, observation);
    assert.ok(actions.some(action => action.type === 'type' && action.text === literal[1]));
  }
});

test('shuffle never immediately repeats any previous catalog entry', () => {
  for (const previous of WINDOWS95_PROMPTS) {
    for (const sample of [0, 0.125, 0.5, 0.875, 0.999999]) {
      const prompt = nextWindowsPrompt(previous, () => sample);
      assert.ok(WINDOWS95_PROMPTS.includes(prompt));
      assert.notEqual(prompt, previous);
    }
  }
});

test('random selection can reach every eligible prompt', () => {
  for (const previous of ['', 'A custom user prompt', ...WINDOWS95_PROMPTS]) {
    const eligible = WINDOWS95_PROMPTS.filter(prompt => prompt !== previous);
    const results = eligible.map((_, index) =>
      nextWindowsPrompt(previous, () => (index + 0.5) / eligible.length));
    assert.deepEqual(results, eligible);
  }
});

test('out-of-range random inputs still return an eligible suggestion', () => {
  const previous = WINDOWS95_PROMPTS[0];
  for (const sample of [-1, 1, 2, NaN, Infinity]) {
    const prompt = nextWindowsPrompt(previous, () => sample);
    assert.ok(WINDOWS95_PROMPTS.includes(prompt));
    assert.notEqual(prompt, previous);
  }
  assert.ok(WINDOWS95_PROMPTS.includes(nextWindowsPrompt()));
});
