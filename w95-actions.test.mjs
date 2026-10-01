import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsActions } from './w95-actions.mjs';

test('Windows actions include grounded single and double clicks', () => {
  const actions = windowsActions('Open My Computer', {
    width: 640, height: 480, targets: [{ label: 'Computer', x: 74, y: 53 }],
  });
  assert.deepEqual(actions.find(action => action.id === 'double_0'), {
    id: 'double_0', type: 'double_click', x: 74, y: 53,
    label: 'Double-click visible Computer at 74,53 (desktop icon/file)',
  });
  assert.equal(actions.find(action => action.id === 'start_button').y, 463);
  assert.ok(actions.some(action => action.key === 'alt+f4'));
});

test('typing candidates come only from goal literals and are offered once', () => {
  const observation = { width: 640, height: 480, targets: [] };
  const goal = "Open Notepad and type 'Hello from Jev'";
  const first = windowsActions(goal, observation);
  assert.equal(first.find(action => action.type === 'type').text, 'Hello from Jev');
  const next = windowsActions(goal, observation, [{ action: 'Type "Hello from Jev"' }]);
  assert.ok(!next.some(action => action.type === 'type'));
  assert.ok(!windowsActions('Open Notepad', observation).some(action => action.type === 'type'));
});

test('out-of-screen OCR targets are never offered', () => {
  const actions = windowsActions('Open app', { width: 640, height: 480,
    targets: [{ label: 'bad', x: 1000, y: 10 }] });
  assert.ok(!actions.some(action => action.id === 'click_0'));
  assert.equal(new Set(actions.map(action => action.id)).size, actions.length);
  assert.ok(actions.length <= 200);
});
