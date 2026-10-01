import { GuestInput } from '/v86-pc/input.js';
import { ScreenObserver } from '/v86-pc/observation.js';
import { windowsActions } from './w95-actions.mjs';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function choose(state, signal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    const response = await fetch('/20260918/api/jev/pc-step', {
      method: 'POST', credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, platform: 'windows95' }),
    });
    if (response.ok) return response.json();
    if (attempt === 0 && [429, 502].includes(response.status)) {
      await pause(1000);
      continue;
    }
    throw new Error(`Jev request failed (${response.status})`);
  }
}

export class WindowsAgent {
  constructor(emulator, screenSize, onLog, canResume = () => true,
    observer = new ScreenObserver(), select = choose) {
    this.vm = emulator;
    this.input = new GuestInput(emulator, screenSize);
    this.observer = observer;
    this.select = select;
    this.onLog = onLog;
    this.canResume = canResume;
    this.running = false;
  }

  stop() { this.controller?.abort(); }

  async run(goal, maxSteps = 40) {
    if (this.running) throw new Error('An agent task is already running');
    if (!goal?.trim() || goal.length > 2000) throw new Error('Enter a goal under 2,000 characters');
    this.running = true;
    const controller = this.controller = new AbortController();
    const { signal } = controller;
    this.input.signal = signal;
    const history = [];
    let emptyScreens = 0;
    let pendingChange = null;
    try {
      for (let step = 1; step <= maxSteps; step++) {
        signal.throwIfAborted();
        await this.vm.stop();
        this.onLog(`Step ${step}: reading the Windows 95 screen…`);
        const frame = await this.input.grab();
        const observation = await this.observer.read(frame);
        signal.throwIfAborted();
        if (!observation.text.trim() && !observation.targets.length) {
          if (++emptyScreens >= 12) throw new Error('The screen is not readable; stopped safely');
          this.vm.run();
          await this.input.wait(2);
          continue;
        }
        emptyScreens = 0;
        const screenSignature = observation.text.toLowerCase().replace(/\s+/g, ' ').trim();
        if (pendingChange && screenSignature === pendingChange.signature && pendingChange.waits < 4) {
          pendingChange.waits++;
          this.onLog('Waiting for Windows 95 to redraw after the last click…');
          this.vm.run();
          await this.input.wait(2);
          continue;
        }
        pendingChange = null;
        const actions = windowsActions(goal, observation, history);
        const result = await this.select({ goal, observation, actions, history: history.slice(-12) }, signal);
        signal.throwIfAborted();
        const action = actions.find(candidate => candidate.id === result?.action);
        if (!action) throw new Error('Jev selected an unavailable action');
        if (!['wait', 'blocked'].includes(action.type) &&
            (!Number.isFinite(result.confidence) || result.confidence < 0.6)) {
          throw new Error(`Jev was uncertain about ${action.label}; stopped safely`);
        }
        this.onLog(`Step ${step}: ${action.label}`);
        if (action.type === 'done') return { success: true, summary: 'Jev reports the goal complete; verify the screen.' };
        if (action.type === 'blocked') return { success: false, summary: 'Jev could not find a safe next action.' };
        this.vm.run();
        await this.act(action);
        if (['click', 'double_click'].includes(action.type)) {
          pendingChange = { signature: screenSignature, waits: 0 };
        }
        history.push({ action: action.type === 'type' ? `Type ${JSON.stringify(action.text)}` : action.label,
          screen: observation.text.slice(0, 1200) });
        await this.input.wait(action.type === 'wait' ? 2 : action.type === 'double_click' ? 4 : 3);
      }
      return { success: false, summary: `Stopped at the ${maxSteps}-step limit.` };
    } catch (error) {
      if (signal.aborted) return { success: false, summary: 'Agent cancelled.' };
      throw error;
    } finally {
      try { await this.observer.dispose(); }
      finally {
        this.running = false;
        if (this.canResume()) this.vm.run();
      }
    }
  }

  async act(action) {
    switch (action.type) {
      case 'click': return this.input.clickAt(action.x, action.y);
      case 'double_click': return this.input.doubleClickAt(action.x, action.y);
      case 'key': return this.input.key(action.key);
      case 'type': return this.input.type(action.text);
      case 'wait': return;
      default: throw new Error('Unsupported action');
    }
  }
}
