import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseConfidentAction } from './w95-agent-choice.mjs';

const actions = [
  { id: 'start_button', type: 'click', label: 'Click the Windows 95 Start button' },
  { id: 'key_win', type: 'key', key: 'win', label: 'Press win' },
  { id: 'wait', type: 'wait', label: 'Wait for Windows to update' },
];

test('a low-confidence click is withheld and Jev can choose another offered action', async () => {
  const calls = [];
  const logs = [];
  const selected = await chooseConfidentAction({
    goal: 'Open Notepad', observation: { text: 'desktop' }, actions, history: [],
    onLog: message => logs.push(message),
    select: async state => {
      calls.push(state.actions.map(action => action.id));
      return calls.length === 1
        ? { action: 'start_button', confidence: 0.41 }
        : { action: 'key_win', confidence: 0.78 };
    },
  });
  assert.equal(selected.id, 'key_win');
  assert.deepEqual(calls, [
    ['start_button', 'key_win', 'wait'],
    ['key_win', 'wait'],
  ]);
  assert.match(logs[0], /uncertain.*Start button/i);
});

test('low-confidence actions never execute when every reconsideration remains uncertain', async () => {
  let calls = 0;
  const guardedActions = [
    { id: 'click_a', type: 'click', label: 'Click A' },
    { id: 'click_b', type: 'click', label: 'Click B' },
    { id: 'key_a', type: 'key', label: 'Press A' },
    { id: 'key_b', type: 'key', label: 'Press B' },
  ];
  await assert.rejects(chooseConfidentAction({
    goal: 'Open Notepad', observation: { text: 'desktop' }, actions: guardedActions, history: [],
    select: async state => ({ action: state.actions[0].id, confidence: (calls++, 0.2) }),
  }), /remained uncertain after 3 choices; stopped safely/);
  assert.equal(calls, 3);
});

test('wait and blocked remain safe choices without a confidence score', async () => {
  for (const id of ['wait', 'blocked']) {
    const result = await chooseConfidentAction({
      goal: 'Open Notepad', observation: { text: '' },
      actions: [...actions, { id: 'blocked', type: 'blocked', label: 'Stop safely' }], history: [],
      select: async () => ({ action: id }),
    });
    assert.equal(result.id, id);
  }
});

test('a selector cannot introduce an action outside the remaining whitelist', async () => {
  await assert.rejects(chooseConfidentAction({
    goal: 'Open Notepad', observation: { text: '' }, actions, history: [],
    select: async () => ({ action: 'invented_click', confidence: 1 }),
  }), /unavailable action/);
});
