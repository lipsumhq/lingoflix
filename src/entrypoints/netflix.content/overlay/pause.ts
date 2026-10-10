import type { BridgeClient } from '@/lib/bridge/client';

/** Spec §5.3: pause for the card, and resume afterwards only if LingoFlix was the one who paused. */
export function createPauseGuard(bridge: Pick<BridgeClient, 'callSync'>) {
  let pausedByUs = false;
  return {
    pause() {
      if (pausedByUs) return;
      const state = bridge.callSync('getState');
      if (state.ok && !state.result.paused && bridge.callSync('pause').ok) pausedByUs = true;
    },
    resume() {
      if (!pausedByUs) return;
      pausedByUs = false;
      bridge.callSync('play');
    },
    /** The video changed or the user took over: don't resume later. */
    forget() {
      pausedByUs = false;
    },
  };
}

export type PauseGuard = ReturnType<typeof createPauseGuard>;
