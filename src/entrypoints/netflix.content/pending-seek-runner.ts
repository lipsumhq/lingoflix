import type { BridgeClient } from '@/lib/bridge/client';

export interface PendingSeekDeps {
  /** Takes this video's pending seek from the background (null if none or stale). */
  take(videoId: string): Promise<number | null>;
  bridge: Pick<BridgeClient, 'callSync'>;
}

const RETRY_MS = 500;
/** As long as the pending seek itself stays fresh: it is taken at start, so a slow load must not lose it. */
const GIVE_UP_MS = 120_000;
const VERIFY_AFTER_MS = 1500;
const VERIFY_SLACK_MS = 3000;

/**
 * Spec §5.5 Open at this moment: once the player for `videoId` is ready, seek to the saved moment. Netflix
 * may apply its own resume point right after loading, so check once and seek again if it moved.
 */
export function runPendingSeek(videoId: string, deps: PendingSeekDeps): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUpAt = Date.now() + GIVE_UP_MS;

  const later = (fn: () => void, ms: number) => {
    timer = setTimeout(fn, ms);
  };

  // A reloaded extension can't answer; that just means there is nothing to seek to.
  void deps.take(videoId).catch(() => null).then((timeMs) => {
    if (cancelled || timeMs === null) return;

    const verify = () => {
      if (cancelled) return;
      const state = deps.bridge.callSync('getState');
      if (state.ok && Math.abs(state.result.currentTimeMs - timeMs) > VERIFY_SLACK_MS) deps.bridge.callSync('seek', timeMs);
    };

    const attempt = () => {
      if (cancelled) return;
      const state = deps.bridge.callSync('getState');
      const ready = state.ok && state.result.videoId === videoId;
      if (ready && deps.bridge.callSync('seek', timeMs).ok) {
        later(verify, VERIFY_AFTER_MS);
        return;
      }
      if (Date.now() < giveUpAt) later(attempt, RETRY_MS);
    };

    attempt();
  });

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
