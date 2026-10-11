import type { BridgeClient } from '@/lib/bridge/client';
import { parseTitleInfo } from '@/lib/bridge/protocol';
import type { TitleInfo } from '@/lib/netflix/title';
import { localDate } from '@/lib/reminders/schedule';
import type { Show } from '@/lib/reminders/store';

/** Reminders spec §5: how often the Netflix page checks whether the video is playing. */
export const WATCH_CHECK_MS = 60_000;

export interface WatchTrackerDeps {
  bridge: Pick<BridgeClient, 'callSync'>;
  isWatchPage(): boolean;
  /** LingoFlix's master switch. */
  isEnabled(): boolean;
  /** Tells the background (`activity:watched`); rejects when it can't be reached. */
  send(show: Show | null): Promise<void>;
  now(): number;
}

/** The show to pick up later: the series for an episode, the movie itself for a movie. */
export function showOf(title: TitleInfo | null): Show | null {
  if (!title) return null;
  if (title.kind === 'movie') return { id: title.videoId, title: title.seriesTitle };
  return title.seriesId ? { id: title.seriesId, title: title.seriesTitle } : null;
}

/** Reminders spec §5: tells the background the learner is watching, at most once per show per day. */
export function createWatchTracker(deps: WatchTrackerDeps): { check(): Promise<void> } {
  let sentOn: string | null = null;
  let sentShowId: string | null = null;
  let sending = false;

  return {
    async check() {
      if (sending || !deps.isWatchPage() || !deps.isEnabled()) return;
      const state = deps.bridge.callSync('getState');
      if (!state.ok || state.result.paused !== false) return;
      const title = deps.bridge.callSync('getTitle');
      const show = showOf(title.ok ? parseTitleInfo(title.result) : null);
      const today = localDate(deps.now());
      // Once a day, plus whenever a different show becomes known; an ad without a title adds nothing.
      if (today === sentOn && (show === null || show.id === sentShowId)) return;
      sending = true;
      try {
        await deps.send(show);
        if (today !== sentOn) sentShowId = null;
        sentOn = today;
        if (show) sentShowId = show.id;
      } catch {
        // The extension was reloaded or its worker is waking up: the next check tries again.
      } finally {
        sending = false;
      }
    },
  };
}
