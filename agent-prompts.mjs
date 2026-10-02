// Suggestions use built-in Windows 95 apps and the agent's supported inputs.
// Text to type is quoted so windowsActions can offer it as a literal action.
export const WINDOWS95_PROMPTS = Object.freeze([
  'Open Notepad and type "Hello from Windows 95". Leave the document visible without saving it.',
  'Open Notepad and type "My first agent-assisted note". Leave the document visible without saving it.',
  'Open Calculator, type "12+7=", and leave the result visible.',
  'Open Paint and leave its blank drawing canvas visible without saving anything.',
  'Open My Computer and leave its drives visible.',
  'Open Windows Explorer and show drive C: without changing any files.',
  'Open Control Panel and show its icons without changing any settings.',
  'Open the Start menu, then Programs, and leave the program list visible.',
  'Open Help from the Start menu and leave its contents visible.',
]);

export function nextWindowsPrompt(previous = '', random = Math.random) {
  const candidates = WINDOWS95_PROMPTS.filter(prompt => prompt !== previous);
  const sample = random();
  const index = Number.isFinite(sample)
    ? Math.max(0, Math.min(candidates.length - 1, Math.floor(sample * candidates.length)))
    : 0;
  return candidates[index];
}
