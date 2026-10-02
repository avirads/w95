// Ask Jev to reconsider without repeating low-confidence clicks/keystrokes.
// Only actions already offered by the local, screen-grounded whitelist can pass.
export async function chooseConfidentAction({
  goal, observation, actions, history, select, signal, onLog,
  minConfidence = 0.6, maxAttempts = 3,
}) {
  const rejected = new Set();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal?.throwIfAborted();
    const remaining = actions.filter(action => !rejected.has(action.id));
    const result = await select({ goal, observation, actions: remaining, history }, signal);
    signal?.throwIfAborted();
    const action = remaining.find(candidate => candidate.id === result?.action);
    if (!action) throw new Error('Jev selected an unavailable action');

    if (!['wait', 'blocked'].includes(action.type) &&
        (!Number.isFinite(result.confidence) || result.confidence < minConfidence)) {
      rejected.add(action.id);
      if (attempt === maxAttempts) {
        throw new Error(`Jev remained uncertain after ${maxAttempts} choices; stopped safely`);
      }
      onLog?.(`Jev was uncertain about ${action.label}; checking another safe action…`);
      continue;
    }
    return action;
  }
  throw new Error('Jev could not choose a sufficiently confident safe action');
}
