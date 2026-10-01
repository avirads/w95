// Candidate actions are grounded in OCR targets, Windows 95's fixed Start
// position, or literal text explicitly supplied in the user's goal.
export const WINDOWS_KEYS = [
  'enter', 'esc', 'tab', 'up', 'down', 'left', 'right', 'space',
  'backspace', 'delete', 'win', 'alt+f4', 'alt+tab',
  'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+o', 'ctrl+s', 'f5',
];

export function windowsActions(goal, observation, history = []) {
  const actions = [];
  const targets = (observation.targets || []).filter(target =>
    Number.isInteger(target.x) && Number.isInteger(target.y) &&
    target.x >= 0 && target.x < observation.width &&
    target.y >= 0 && target.y < observation.height &&
    typeof target.label === 'string' && target.label.trim()
  ).slice(0, 60);
  for (const [index, target] of targets.entries()) {
    const label = target.label.slice(0, 80);
    actions.push({ id: `click_${index}`, type: 'click', x: target.x, y: target.y,
      label: `Single-click visible ${label} at ${target.x},${target.y} (menu/button/taskbar)` });
    actions.push({ id: `double_${index}`, type: 'double_click', x: target.x, y: target.y,
      label: `Double-click visible ${label} at ${target.x},${target.y} (desktop icon/file)` });
  }
  if (observation.height >= 300 && observation.width >= 320) {
    actions.push({ id: 'start_button', type: 'click', x: 35, y: observation.height - 17,
      label: 'Click the Windows 95 Start button in the lower-left taskbar' });
  }
  for (const key of WINDOWS_KEYS) {
    actions.push({ id: `key_${key.replaceAll('+', '_')}`, type: 'key', key,
      label: `Press ${key}` });
  }
  const literals = [...goal.matchAll(/["'“‘]([^"'”’]{1,500})["'”’]|\bhttps?:\/\/[^\s"'<>]+/g)]
    .map(match => match[1] || match[0]).slice(0, 5);
  for (const [index, literal] of literals.entries()) {
    if (history.some(entry => entry.action === `Type ${JSON.stringify(literal)}`)) continue;
    actions.push({ id: `type_${index}`, type: 'type', text: literal,
      label: `Type ${JSON.stringify(literal)} into the currently focused field` });
  }
  actions.push(
    { id: 'wait', type: 'wait', label: 'Wait for Windows 95 to update the screen' },
    { id: 'done', type: 'done', label: 'Finish only if the current screen proves the goal is complete' },
    { id: 'blocked', type: 'blocked', label: 'Stop because no safe offered action advances the goal' },
  );
  return actions;
}
