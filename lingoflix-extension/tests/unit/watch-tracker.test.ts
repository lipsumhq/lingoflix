import { describe, expect, it, vi } from 'vitest';
import { WATCH_CHECK_MS, createWatchTracker, showOf } from '@/entrypoints/netflix.content/watch-tracker';
import type { TitleInfo } from '@/lib/netflix/title';

const EPISODE: TitleInfo = {
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
};
const MOVIE: TitleInfo = {
  videoId: '81234567',
  kind: 'movie',
  seriesId: null,
  seriesTitle: 'Glass Onion',
  seasonNumber: null,
  episodeNumber: null,
  episodeTitle: null,
};
const STRANGER_THINGS = { id: '80057281', title: 'Stranger Things' };
const GLASS_ONION = { id: '81234567', title: 'Glass Onion' };
/** Local time in October 2026. */
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();

function setup() {
  const page = {
    watching: true,
    enabled: true,
    playing: true,
    playerReady: true,
    title: EPISODE as unknown,
    now: at(14, 21),
    failSend: false,
  };
  const sent: unknown[] = [];
  const bridge = {
    callSync: vi.fn((method: string) => {
      if (method === 'getState') {
        return page.playerReady
          ? { ok: true, result: { currentTimeMs: 60_000, durationMs: 3_000_000, paused: !page.playing, videoId: '80077211', textTrack: null } }
          : { ok: false, error: { code: 'player-unavailable' } };
      }
      if (method === 'getTitle') return { ok: true, result: page.title };
      return { ok: true, result: null };
    }),
  };
  const tracker = createWatchTracker({
    bridge: bridge as never,
    isWatchPage: () => page.watching,
    isEnabled: () => page.enabled,
    send: async (show) => {
      if (page.failSend) throw new Error('Extension context invalidated.');
      sent.push(show);
    },
    now: () => page.now,
  });
  return { page, sent, tracker };
}

describe('showOf', () => {
  it('is the series for an episode and the movie itself for a movie', () => {
    expect(showOf(EPISODE)).toEqual(STRANGER_THINGS);
    expect(showOf(MOVIE)).toEqual(GLASS_ONION);
    expect(showOf({ ...EPISODE, seriesId: null })).toBeNull();
    expect(showOf(null)).toBeNull();
  });
});

describe('createWatchTracker', () => {
  it('is checked once a minute', () => {
    expect(WATCH_CHECK_MS).toBe(60_000);
  });

  it('tells the background once per show per day while a video plays', async () => {
    const { sent, tracker } = setup();
    await tracker.check();
    await tracker.check();
    expect(sent).toEqual([STRANGER_THINGS]);
  });

  it('says nothing while paused, off a watch page, with LingoFlix off, or before the player is ready', async () => {
    const { page, sent, tracker } = setup();
    page.playing = false;
    await tracker.check();
    page.playing = true;
    page.watching = false;
    await tracker.check();
    page.watching = true;
    page.enabled = false;
    await tracker.check();
    page.enabled = true;
    page.playerReady = false;
    await tracker.check();
    expect(sent).toEqual([]);
  });

  it('sends again when the title becomes known or the show changes, but not for an ad without a title', async () => {
    const { page, sent, tracker } = setup();
    page.title = null;
    await tracker.check();
    page.title = EPISODE;
    await tracker.check();
    page.title = null; // an ad
    await tracker.check();
    page.title = EPISODE;
    await tracker.check();
    page.title = MOVIE;
    await tracker.check();
    expect(sent).toEqual([null, STRANGER_THINGS, GLASS_ONION]);
  });

  it('a send that fails is tried again on the next check', async () => {
    const { page, sent, tracker } = setup();
    page.failSend = true;
    await tracker.check();
    page.failSend = false;
    await tracker.check();
    expect(sent).toEqual([STRANGER_THINGS]);
  });

  it('watching across midnight records the new day', async () => {
    const { page, sent, tracker } = setup();
    page.now = at(14, 23, 59);
    await tracker.check();
    page.now = at(15, 0, 1);
    await tracker.check();
    expect(sent).toEqual([STRANGER_THINGS, STRANGER_THINGS]);
  });

  it('ignores a title the page made up', async () => {
    const { page, sent, tracker } = setup();
    page.title = { kind: 'episode', seriesTitle: 'No ids here' };
    await tracker.check();
    expect(sent).toEqual([null]);
  });
});
