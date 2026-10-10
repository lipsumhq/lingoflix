import { describe, expect, it, vi } from 'vitest';
import { createSubtitleSession } from '@/entrypoints/netflix.content/subtitle-session';

// Cue i: 1000 + 3000·i … 3000 + 3000·i (tick rate 10 000 000 → 10 000 ticks per ms).
const dfxp = (texts: string[]) =>
  `<tt xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000"><body><div>${texts
    .map((t, i) => `<p begin="${(1000 + i * 3000) * 10_000}t" end="${(3000 + i * 3000) * 10_000}t">${t}</p>`)
    .join('')}</div></body></tt>`;
const EN = Array.from({ length: 15 }, (_, i) => `Line ${i}`);
const FR = Array.from({ length: 15 }, (_, i) => `Ligne ${i}`);
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(files: Record<string, string> = { 'https://cdn.example/en': dfxp(EN) }) {
  const state = {
    timeMs: 0,
    videoId: '81091396',
    track: { trackId: 'T:en', language: 'en', url: 'https://cdn.example/en' } as { trackId: string; language: string; url: string } | null,
  };
  const bridge = {
    callSync: vi.fn((method: string) => {
      if (method === 'getState') {
        return {
          ok: true,
          result: {
            currentTimeMs: state.timeMs,
            durationMs: 1_000_000,
            paused: false,
            videoId: state.videoId,
            textTrack: state.track && { trackId: state.track.trackId, language: state.track.language, isImageBased: false, isNone: false },
          },
        };
      }
      if (method === 'getSubtitleSource') {
        return {
          ok: true,
          result: state.track && { videoId: state.videoId, trackId: state.track.trackId, language: state.track.language, url: state.track.url },
        };
      }
      return { ok: true, result: null };
    }),
  };
  const fetchText = vi.fn(async (url: string) => {
    const body = files[url];
    if (body === undefined) throw new Error('404');
    return body;
  });
  const session = createSubtitleSession({ bridge: bridge as never, fetchText, getVideoId: () => state.videoId });
  const show = (text: string, atMs: number) => {
    state.timeMs = atMs;
    session.onDisplayed({ text, rects: [] });
  };
  return { state, fetchText, session, show };
}

describe('subtitle session', () => {
  it('records displayed lines with the player time', () => {
    const { session, show } = setup();
    show('Line 7', 22_100);
    expect(session.currentLine()).toMatchObject({ text: 'Line 7', shownAtMs: 22_100 });
    expect(session.displayed().text).toBe('Line 7');
  });

  it('loads the subtitle file once and uses it once it matches what Netflix shows', async () => {
    const { session, show, fetchText } = setup();
    show('Line 6', 19_100);
    show('Line 7', 22_100);
    await settle();
    const details = session.describe(session.currentLine()!);
    expect(details.fromTrack).toBe(true);
    expect(details.context.before).toEqual(['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6']);
    expect(details.context.after[0]).toBe('Line 8');
    expect(session.trackLanguage()).toBe('en');
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('ignores a subtitle file that does not match the screen', async () => {
    const { session, show } = setup({ 'https://cdn.example/en': dfxp(EN.map((l) => `Other ${l}`)) });
    show('Line 7', 22_100);
    await settle();
    expect(session.describe(session.currentLine()!).fromTrack).toBe(false);
    expect(session.trackLanguage()).toBeNull();
  });

  it('falls back to what was seen when the file cannot be fetched', async () => {
    const { session, show } = setup({});
    show('Seen 1', 1000);
    show('Seen 2', 4000);
    await settle();
    expect(session.describe(session.currentLine()!)).toMatchObject({
      fromTrack: false,
      context: { before: ['Seen 1'], after: [] },
    });
  });

  it('reloads the subtitle file when the text track changes', async () => {
    const { session, show, state, fetchText } = setup({
      'https://cdn.example/en': dfxp(EN),
      'https://cdn.example/fr': dfxp(FR),
    });
    show('Line 7', 22_100);
    await settle();
    expect(session.describe(session.currentLine()!).fromTrack).toBe(true);
    state.track = { trackId: 'T:fr', language: 'fr', url: 'https://cdn.example/fr' };
    show('Ligne 8', 25_100);
    await settle();
    expect(fetchText).toHaveBeenLastCalledWith('https://cdn.example/fr');
    const details = session.describe(session.currentLine()!);
    expect(details.fromTrack).toBe(true);
    expect(details.context.before.at(-1)).toBe('Ligne 7');
    expect(session.trackLanguage()).toBe('fr');
  });

  it('line targets come from the file, else from the lines already seen', async () => {
    const seen = setup({});
    seen.show('A', 10_000);
    seen.show('', 11_000);
    seen.show('B', 12_000);
    seen.state.timeMs = 12_500;
    expect(seen.session.lineTarget('previous')).toBe(9700);
    expect(seen.session.lineTarget('next')).toBeNull();

    const file = setup();
    file.show('Line 7', 22_100);
    await settle();
    file.state.timeMs = 22_500;
    expect(file.session.lineTarget('previous')).toBe(19_000);
    expect(file.session.lineTarget('next')).toBe(25_000);
  });

  it('starts over on a new video', async () => {
    const { session, show, state, fetchText } = setup();
    show('Line 7', 22_100);
    state.videoId = '99999999';
    show('Hello', 1000);
    expect(session.currentLine()?.text).toBe('Hello');
    expect(session.describe(session.currentLine()!).context.before).toEqual([]);
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(2));
  });
});
