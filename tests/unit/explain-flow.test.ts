import { describe, expect, it, vi } from 'vitest';
import type { CardState } from '@/entrypoints/netflix.content/overlay/card-state';
import { createExplainController } from '@/entrypoints/netflix.content/overlay/explain-controller';
import { streamExplanation, type Connect } from '@/entrypoints/netflix.content/overlay/explain-port';
import { placeCard } from '@/entrypoints/netflix.content/overlay/positioning';
import { createStore } from '@/entrypoints/netflix.content/overlay/store';
import type { TitleInfo } from '@/lib/netflix/title';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import type { Explanation } from '@/lib/study-log/types';
import type { ObservedLine } from '@/lib/subtitles/history';

function fakePort() {
  const posted: unknown[] = [];
  let onMessage: (m: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const port = {
    postMessage: (m: unknown) => posted.push(m),
    disconnect: vi.fn(),
    onMessage: { addListener: (l: (m: unknown) => void) => (onMessage = l) },
    onDisconnect: { addListener: (l: () => void) => (onDisconnect = l) },
  };
  return { port, posted, receive: (m: unknown) => onMessage(m), drop: () => onDisconnect() };
}

describe('placeCard (spec §5.3: above the line, inside the player, scrolls if tall)', () => {
  it('sits above the line, centered on it', () => {
    const player = { left: 0, top: 0, width: 1920, height: 1080 };
    const line = { left: 700, top: 900, width: 520, height: 60 };
    expect(placeCard(line, player, 300)).toEqual({ left: 700, top: 588, width: 520, maxHeight: 876 });
  });

  it('keeps the card inside a small player', () => {
    const player = { left: 0, top: 0, width: 360, height: 240 };
    const line = { left: 100, top: 200, width: 160, height: 30 };
    const p = placeCard(line, player, 900);
    expect(p).toEqual({ left: 12, top: 12, width: 336, maxHeight: 176 });
    expect(p.left + p.width).toBeLessThanOrEqual(player.width);
    expect(p.top).toBeGreaterThanOrEqual(player.top);
  });

  it('without a line, sits above the player controls', () => {
    const p = placeCard(null, { left: 0, top: 0, width: 1000, height: 600 }, 200);
    expect(p.left).toBe(240);
    expect(p.top + 200).toBe(600 - 72);
  });
});

describe('streamExplanation', () => {
  it('posts the request, streams deltas, finishes with the entry, then disconnects', () => {
    const fake = fakePort();
    const onDelta = vi.fn();
    const onDone = vi.fn();
    streamExplanation(() => fake.port, { type: 'follow-up', entryId: 'e', question: 'q', sections: DEFAULT_SETTINGS.cardSections }, {
      onDelta,
      onDone,
      onError: vi.fn(),
    });
    expect(fake.posted).toHaveLength(1);
    fake.receive({ type: 'delta', text: 'Hi' });
    fake.receive({ type: 'done', entry: { id: 'e' } });
    expect(onDelta).toHaveBeenCalledWith('Hi');
    expect(onDone).toHaveBeenCalledWith({ id: 'e' });
    expect(fake.port.disconnect).toHaveBeenCalled();
  });

  it("a dropped port shows Couldn't reach Claude", () => {
    const fake = fakePort();
    const onError = vi.fn();
    streamExplanation(() => fake.port, { type: 'start', request: {} as never }, { onDelta: vi.fn(), onDone: vi.fn(), onError });
    fake.drop();
    expect(onError).toHaveBeenCalledWith('network', "Couldn't reach Claude");
  });

  it('cancel disconnects and silences anything that arrives later', () => {
    const fake = fakePort();
    const onDelta = vi.fn();
    const cancel = streamExplanation(() => fake.port, { type: 'start', request: {} as never }, { onDelta, onDone: vi.fn(), onError: vi.fn() });
    cancel();
    fake.receive({ type: 'delta', text: 'late' });
    expect(fake.port.disconnect).toHaveBeenCalled();
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('a reloaded extension (connect throws) is a network error', () => {
    const onError = vi.fn();
    const connect: Connect = () => {
      throw new Error('Extension context invalidated.');
    };
    streamExplanation(connect, { type: 'start', request: {} as never }, { onDelta: vi.fn(), onDone: vi.fn(), onError });
    expect(onError).toHaveBeenCalledWith('network', "Couldn't reach Claude");
  });
});

const TITLE: TitleInfo = {
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
};
const LINE: ObservedLine = { text: "I'm gonna call it\na night.", normalized: "I'm gonna call it a night.", shownAtMs: 22_100, hiddenAtMs: null };
const SAVED = {
  id: 'e1',
  phrase: LINE.text,
  response: '## 의미\n잘 시간.',
  followUps: [{ question: 'Formal?', answer: 'No.' }],
} as Explanation;

function setupExplain(over: { entry?: Explanation | null; imageBased?: boolean; line?: ObservedLine | null } = {}) {
  const store = createStore<CardState | null>(null);
  const ports: ReturnType<typeof fakePort>[] = [];
  const connect: Connect = () => {
    const p = fakePort();
    ports.push(p);
    return p.port;
  };
  const line = over.line === undefined ? LINE : over.line;
  const session = {
    currentLine: () => line,
    describe: () => ({
      context: { before: ['Where are you going?'], after: ['Night.'] },
      timing: { startMs: 22_000, endMs: 24_000 },
      fromTrack: true,
    }),
  };
  const bridge = {
    callSync: vi.fn((method: string) => {
      if (method === 'getState') {
        return {
          ok: true,
          result: {
            currentTimeMs: 22_500,
            durationMs: 1_000_000,
            paused: true,
            videoId: '80077211',
            textTrack: { trackId: 't', language: 'en', isImageBased: !!over.imageBased, isNone: false },
          },
        };
      }
      if (method === 'getTitle') return { ok: true, result: TITLE };
      return { ok: true, result: null };
    }),
  };
  const pause = { resume: vi.fn() };
  const findEntry = vi.fn(async () => over.entry ?? null);
  const settings = { ...DEFAULT_SETTINGS, explanationLanguage: 'ko' };
  const explain = createExplainController({
    store,
    session: session as never,
    bridge: bridge as never,
    pause,
    connect,
    findEntry,
    getSettings: () => settings,
    getVideoId: () => '80077211',
    subtitleRects: () => [{ left: 100, top: 500, right: 400, bottom: 560, width: 300, height: 60 } as DOMRect],
  });
  return { store, ports, explain, findEntry, pause, settings };
}

describe('explain controller', () => {
  it('shows a saved explanation instantly, without asking Claude', async () => {
    const { store, ports, explain, findEntry } = setupExplain({ entry: SAVED });
    expect(explain.open('hover')).toBe(true);
    await vi.waitFor(() => expect(store.get()?.status).toBe('done'));
    expect(store.get()).toMatchObject({
      line: LINE.text,
      response: SAVED.response,
      fromStudyLog: true,
      followUps: [{ question: 'Formal?', answer: 'No.', status: 'done', error: null }],
    });
    expect(findEntry).toHaveBeenCalledWith('80077211', 'ko', LINE.text);
    expect(ports).toHaveLength(0);
  });

  it('streams a new explanation with the line, its context, the title, and the line start', async () => {
    const { store, ports, explain, settings } = setupExplain();
    explain.open('hover');
    expect(store.get()).toMatchObject({ status: 'loading', anchor: { left: 100, top: 500, width: 300, height: 60 } });
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    expect(ports[0]!.posted[0]).toEqual({
      type: 'start',
      request: {
        phrase: LINE.text,
        context: { before: ['Where are you going?'], after: ['Night.'] },
        title: TITLE,
        videoId: '80077211',
        videoTimeMs: 22_000,
        language: 'ko',
        sections: settings.cardSections,
      },
    });
    ports[0]!.receive({ type: 'delta', text: 'Hel' });
    ports[0]!.receive({ type: 'delta', text: 'lo' });
    expect(store.get()).toMatchObject({ status: 'streaming', response: 'Hello' });
    ports[0]!.receive({ type: 'done', entry: { ...SAVED, response: 'Hello', followUps: [] } });
    expect(store.get()).toMatchObject({ status: 'done', response: 'Hello', entry: { id: 'e1' } });
  });

  it('Regenerate streams again and clears follow-ups', async () => {
    const { store, ports, explain } = setupExplain({ entry: SAVED });
    explain.open('hover');
    await vi.waitFor(() => expect(store.get()?.status).toBe('done'));
    explain.regenerate();
    expect(store.get()).toMatchObject({ status: 'loading', response: '', followUps: [], fromStudyLog: false });
    expect(ports[0]!.posted[0]).toMatchObject({ type: 'start' });
  });

  it('a follow-up streams under its question and keeps the updated entry', async () => {
    const { store, ports, explain, settings } = setupExplain({ entry: { ...SAVED, followUps: [] } });
    explain.open('hover');
    await vi.waitFor(() => expect(store.get()?.status).toBe('done'));
    explain.askFollowUp('  Is it formal?  ');
    explain.askFollowUp('ignored while busy');
    expect(store.get()?.followUps).toEqual([{ question: 'Is it formal?', answer: '', status: 'streaming', error: null }]);
    expect(ports).toHaveLength(1);
    expect(ports[0]!.posted[0]).toEqual({ type: 'follow-up', entryId: 'e1', question: 'Is it formal?', sections: settings.cardSections });
    ports[0]!.receive({ type: 'delta', text: 'No' });
    expect(store.get()?.followUps[0]?.answer).toBe('No');
    ports[0]!.receive({ type: 'done', entry: { ...SAVED, followUps: [{ question: 'Is it formal?', answer: 'No.' }] } });
    expect(store.get()).toMatchObject({ followUpBusy: false, followUps: [{ answer: 'No.', status: 'done' }] });
  });

  it('closing aborts the request and resumes through the pause guard', async () => {
    const { store, ports, explain, pause } = setupExplain();
    explain.open('shortcut');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    explain.close();
    expect(ports[0]!.port.disconnect).toHaveBeenCalled();
    expect(store.get()).toBeNull();
    expect(pause.resume).toHaveBeenCalledTimes(1);
  });

  it("a dropped port shows Couldn't reach Claude", async () => {
    const { store, ports, explain } = setupExplain();
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    ports[0]!.drop();
    expect(store.get()).toMatchObject({ status: 'error', error: { code: 'network', message: "Couldn't reach Claude" } });
  });

  it("image-based subtitles get the can't-be-read card; no line means no card", () => {
    const image = setupExplain({ imageBased: true, line: null });
    expect(image.explain.open('shortcut')).toBe(true);
    expect(image.store.get()).toMatchObject({ status: 'error', error: { code: 'image-subs', message: "This title's subtitles can't be read as text" } });
    const none = setupExplain({ line: null });
    expect(none.explain.open('shortcut')).toBe(false);
    expect(none.store.get()).toBeNull();
  });
});
