import { describe, expect, it, vi } from 'vitest';
import type { CardState } from '@/entrypoints/netflix.content/overlay/card-state';
import { createExplainController } from '@/entrypoints/netflix.content/overlay/explain-controller';
import { streamExplanation, type Connect } from '@/entrypoints/netflix.content/overlay/explain-port';
import { placeCard } from '@/entrypoints/netflix.content/overlay/positioning';
import { createStore } from '@/entrypoints/netflix.content/overlay/store';
import { fitStory, parseClientMessage } from '@/lib/ai/protocol';
import type { TitleInfo } from '@/lib/netflix/title';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { suggestionKey } from '@/lib/study-log/items';
import type { Explanation, SaveSuggestion } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';
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
  it('posts the request, streams deltas, finishes with the explanation and saved keys, then disconnects', () => {
    const fake = fakePort();
    const onDelta = vi.fn();
    const onDone = vi.fn();
    streamExplanation(
      () => fake.port,
      { type: 'follow-up', explanationId: 'e', question: 'q', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] },
      { onDelta, onDone, onError: vi.fn() },
    );
    expect(fake.posted).toHaveLength(1);
    fake.receive({ type: 'delta', text: 'Hi' });
    fake.receive({ type: 'done', explanation: { id: 'e' }, savedKeys: ['k1'] });
    expect(onDelta).toHaveBeenCalledWith('Hi');
    expect(onDone).toHaveBeenCalledWith({ id: 'e' }, ['k1']);
    expect(fake.port.disconnect).toHaveBeenCalled();
  });

  it("a dropped port says it couldn't reach LingoFlix's background (no provider is known)", () => {
    const fake = fakePort();
    const onError = vi.fn();
    streamExplanation(() => fake.port, { type: 'start', request: {} as never }, { onDelta: vi.fn(), onDone: vi.fn(), onError });
    fake.drop();
    expect(onError).toHaveBeenCalledWith('network', "Couldn't reach LingoFlix's background", null);
  });

  it("passes on the background's error with the provider it names", () => {
    const fake = fakePort();
    const onError = vi.fn();
    streamExplanation(() => fake.port, { type: 'start', request: {} as never }, { onDelta: vi.fn(), onDone: vi.fn(), onError });
    fake.receive({ type: 'error', code: 'no-credit', message: 'Your OpenAI account is out of credit', provider: 'openai' });
    expect(onError).toHaveBeenCalledWith('no-credit', 'Your OpenAI account is out of credit', 'openai');
    expect(fake.port.disconnect).toHaveBeenCalled();
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
    expect(onError).toHaveBeenCalledWith('network', "Couldn't reach LingoFlix's background", null);
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
const STORY: StoryLine[] = [{ startMs: 1000, text: 'Earlier line' }];
const IDIOM: SaveSuggestion = { type: 'idiom', text: 'call it a night', meaning: '그만 자다' };
const WORD: SaveSuggestion = { type: 'word', text: 'gonna', meaning: 'going to' };
const LINE_ROW: SaveSuggestion = { type: 'line', text: LINE.text, meaning: '' };
const SAVED = {
  id: 'e1',
  videoId: '80077211',
  phrase: LINE.text,
  response: '## 의미\n잘 시간.',
  followUps: [{ question: 'Formal?', answer: 'No.' }],
  suggestions: [IDIOM],
} as unknown as Explanation;
const IDIOM_KEY = suggestionKey(SAVED, IDIOM);
const LINE_KEY = suggestionKey(SAVED, LINE_ROW);

interface SetupOptions {
  found?: { explanation: Explanation | null; savedKeys: string[] };
  imageBased?: boolean;
  line?: ObservedLine | null;
  sendStorySoFar?: boolean;
}

function setupExplain(over: SetupOptions = {}) {
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
    storySoFar: vi.fn((_line: ObservedLine) => STORY),
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
  const findExplanation = vi.fn(async () => over.found ?? { explanation: null, savedKeys: [] });
  const saveItem = vi.fn(async (_explanationId: string, row: SaveSuggestion) => suggestionKey(SAVED, row));
  const unsaveItem = vi.fn(async (_explanationId: string, row: SaveSuggestion) => suggestionKey(SAVED, row));
  const settings = { ...DEFAULT_SETTINGS, explanationLanguage: 'ko', sendStorySoFar: over.sendStorySoFar ?? true };
  const explain = createExplainController({
    store,
    session: session as never,
    bridge: bridge as never,
    pause,
    connect,
    findExplanation,
    saveItem,
    unsaveItem,
    getSettings: () => settings,
    getVideoId: () => '80077211',
    subtitleRects: () => [{ left: 100, top: 500, right: 400, bottom: 560, width: 300, height: 60 } as DOMRect],
  });
  return { store, ports, explain, findExplanation, saveItem, unsaveItem, pause, settings, session };
}

async function openStored(found: SetupOptions['found'] = { explanation: SAVED, savedKeys: [] }) {
  const setup = setupExplain({ found });
  setup.explain.open('hover');
  await vi.waitFor(() => expect(setup.store.get()?.status).toBe('done'));
  return setup;
}

describe('explain controller', () => {
  it('shows a stored explanation instantly, marked Explained before, with its saved rows', async () => {
    const { store, ports, findExplanation } = await openStored({ explanation: SAVED, savedKeys: [IDIOM_KEY] });
    expect(store.get()).toMatchObject({
      line: LINE.text,
      response: SAVED.response,
      explanation: { id: 'e1' },
      explainedBefore: true,
      savedKeys: [IDIOM_KEY],
      saveStatus: {},
      followUps: [{ question: 'Formal?', answer: 'No.', status: 'done', error: null }],
    });
    expect(findExplanation).toHaveBeenCalledWith('80077211', 'ko', LINE.text);
    expect(ports).toHaveLength(0);
  });

  it('streams a new explanation with the line, its context, the title, the line start, and the story so far', async () => {
    const { store, ports, explain, settings, session } = setupExplain();
    explain.open('hover');
    expect(store.get()).toMatchObject({
      status: 'loading',
      anchor: { left: 100, top: 500, width: 300, height: 60 },
      explanation: null,
      explainedBefore: false,
      savedKeys: [],
      saveStatus: {},
    });
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    expect(session.storySoFar).toHaveBeenCalledWith(LINE);
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
        storySoFar: STORY,
      },
    });
    ports[0]!.receive({ type: 'delta', text: 'Hel' });
    ports[0]!.receive({ type: 'delta', text: 'lo' });
    expect(store.get()).toMatchObject({ status: 'streaming', response: 'Hello' });
    ports[0]!.receive({ type: 'done', explanation: { ...SAVED, response: 'Hello', followUps: [] }, savedKeys: [IDIOM_KEY] });
    expect(store.get()).toMatchObject({ status: 'done', response: 'Hello', explanation: { id: 'e1' }, savedKeys: [IDIOM_KEY], explainedBefore: false });
  });

  it('sends no story when Send the story so far is off', async () => {
    const { ports, explain, session } = setupExplain({ sendStorySoFar: false });
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    expect(ports[0]!.posted[0]).toMatchObject({ type: 'start', request: { storySoFar: [] } });
    expect(session.storySoFar).not.toHaveBeenCalled();
  });

  it('Regenerate streams again and clears follow-ups and the Explained before mark', async () => {
    const { store, ports, explain } = await openStored();
    explain.regenerate();
    expect(store.get()).toMatchObject({ status: 'loading', response: '', followUps: [], explanation: null, explainedBefore: false });
    expect(ports[0]!.posted[0]).toMatchObject({ type: 'start', request: { storySoFar: STORY } });
  });

  it('saved state survives Regenerate', async () => {
    const { store, ports, explain, unsaveItem } = await openStored({ explanation: SAVED, savedKeys: [IDIOM_KEY] });
    explain.regenerate();
    const fresh = { ...SAVED, response: 'New', followUps: [], suggestions: [WORD, IDIOM] } as Explanation;
    ports[0]!.receive({ type: 'done', explanation: fresh, savedKeys: [IDIOM_KEY] });
    expect(store.get()).toMatchObject({
      status: 'done',
      explainedBefore: false,
      savedKeys: [IDIOM_KEY],
      explanation: { suggestions: [WORD, IDIOM] },
    });
    expect(unsaveItem).not.toHaveBeenCalled();
  });

  it('a follow-up carries the explanation id and the same story so far, and keeps the updated explanation', async () => {
    const { store, ports, explain, settings } = await openStored({ explanation: { ...SAVED, followUps: [] } as Explanation, savedKeys: [] });
    explain.askFollowUp('  Is it formal?  ');
    explain.askFollowUp('ignored while busy');
    expect(store.get()?.followUps).toEqual([{ question: 'Is it formal?', answer: '', status: 'streaming', error: null }]);
    expect(ports).toHaveLength(1);
    expect(ports[0]!.posted[0]).toEqual({
      type: 'follow-up',
      explanationId: 'e1',
      question: 'Is it formal?',
      sections: settings.cardSections,
      storySoFar: STORY,
    });
    ports[0]!.receive({ type: 'delta', text: 'No' });
    expect(store.get()?.followUps[0]?.answer).toBe('No');
    ports[0]!.receive({ type: 'done', explanation: { ...SAVED, followUps: [{ question: 'Is it formal?', answer: 'No.' }] }, savedKeys: [] });
    expect(store.get()).toMatchObject({ followUpBusy: false, followUps: [{ answer: 'No.', status: 'done' }] });
  });

  it('a follow-up keeps its own answer when the explanation stored another one first (asked on a card since closed)', async () => {
    const { store, ports, explain } = await openStored({ explanation: { ...SAVED, followUps: [] } as Explanation, savedKeys: [] });
    explain.askFollowUp('Is it slang?');
    ports[0]!.receive({ type: 'delta', text: 'Yes' });
    // A follow-up asked before the line was reopened finished in the background and was stored before this one.
    const followUps = [
      { question: 'Formal?', answer: 'No.' },
      { question: 'Is it slang?', answer: 'Yes, casual.' },
    ];
    ports[0]!.receive({ type: 'done', explanation: { ...SAVED, followUps }, savedKeys: [] });
    expect(store.get()).toMatchObject({
      followUpBusy: false,
      explanation: { followUps },
      followUps: [{ question: 'Is it slang?', answer: 'Yes, casual.', status: 'done', error: null }],
    });
  });

  it("fits a story too big for the background's parser, for the explanation and its follow-ups", async () => {
    // 1000 lines of 300 characters (300 000 in all), the newest 5000 characters long.
    const huge: StoryLine[] = Array.from({ length: 1000 }, (_, i) => ({ startMs: i * 1000, text: 'x'.repeat(i === 999 ? 5000 : 300) }));
    const { ports, explain, session } = setupExplain();
    session.storySoFar.mockReturnValue(huge);
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    const start = ports[0]!.posted[0];
    expect(parseClientMessage(start)).not.toBeNull();
    expect(start).toMatchObject({ type: 'start', request: { storySoFar: fitStory(huge) } });
    ports[0]!.receive({ type: 'done', explanation: { ...SAVED, followUps: [] }, savedKeys: [] });
    explain.askFollowUp('Why?');
    const followUp = ports[1]!.posted[0];
    expect(parseClientMessage(followUp)).not.toBeNull();
    expect(followUp).toMatchObject({ type: 'follow-up', storySoFar: fitStory(huge) });
  });

  it('Save: saving, then Saved; tapping a saved row removes it', async () => {
    const { store, explain, saveItem, unsaveItem } = await openStored();
    explain.toggleSave(IDIOM);
    expect(store.get()?.saveStatus).toEqual({ [IDIOM_KEY]: 'saving' });
    explain.toggleSave(IDIOM); // ignored while saving
    expect(saveItem).toHaveBeenCalledTimes(1);
    expect(saveItem).toHaveBeenCalledWith('e1', IDIOM);
    await vi.waitFor(() => expect(store.get()?.savedKeys).toEqual([IDIOM_KEY]));
    expect(store.get()?.saveStatus).toEqual({});
    explain.toggleSave(IDIOM);
    expect(unsaveItem).toHaveBeenCalledWith('e1', IDIOM);
    await vi.waitFor(() => expect(store.get()?.savedKeys).toEqual([]));
    expect(store.get()?.saveStatus).toEqual({});
  });

  it("a failed save says Couldn't save and tapping again retries; a failed removal stays Saved", async () => {
    const { store, explain, saveItem, unsaveItem } = await openStored();
    saveItem.mockRejectedValueOnce(new Error('offline'));
    explain.toggleSave(LINE_ROW);
    await vi.waitFor(() => expect(store.get()?.saveStatus).toEqual({ [LINE_KEY]: 'error' }));
    expect(store.get()?.savedKeys).toEqual([]);
    explain.toggleSave(LINE_ROW);
    await vi.waitFor(() => expect(store.get()?.savedKeys).toEqual([LINE_KEY]));
    expect(store.get()?.saveStatus).toEqual({});

    unsaveItem.mockRejectedValueOnce(new Error('offline'));
    explain.toggleSave(LINE_ROW);
    await vi.waitFor(() => expect(unsaveItem).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.get()?.saveStatus).toEqual({}));
    expect(store.get()?.savedKeys).toEqual([LINE_KEY]);
  });

  it('nothing can be saved before the explanation is done', async () => {
    const { ports, explain, saveItem } = setupExplain();
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    explain.toggleSave(IDIOM);
    expect(saveItem).not.toHaveBeenCalled();
  });

  it('late answers for an earlier card are dropped', async () => {
    // A stored explanation found after the card closed.
    const closed = setupExplain({ found: { explanation: SAVED, savedKeys: [IDIOM_KEY] } });
    let finishFind: (found: { explanation: Explanation | null; savedKeys: string[] }) => void = () => {};
    closed.findExplanation.mockImplementationOnce(() => new Promise((resolve) => (finishFind = resolve)));
    closed.explain.open('hover');
    closed.explain.close();
    finishFind({ explanation: SAVED, savedKeys: [IDIOM_KEY] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed.store.get()).toBeNull();
    expect(closed.ports).toHaveLength(0);

    // A save that finishes after a new card opened.
    const { store, explain, saveItem } = await openStored();
    let finishSave: (key: string) => void = () => {};
    saveItem.mockImplementationOnce(() => new Promise((resolve) => (finishSave = resolve)));
    explain.toggleSave(IDIOM);
    const firstKey = store.get()!.key;
    explain.open('hover');
    await vi.waitFor(() => expect(store.get()?.status).toBe('done'));
    expect(store.get()!.key).not.toBe(firstKey);
    expect(store.get()?.saveStatus).toEqual({});
    finishSave(IDIOM_KEY);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.get()?.savedKeys).toEqual([]);
    expect(store.get()?.saveStatus).toEqual({});
  });

  it('closing disconnects the Port (the background still finishes the answer) and resumes through the pause guard', async () => {
    const { store, ports, explain, pause } = setupExplain();
    explain.open('shortcut');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    explain.close();
    expect(ports[0]!.port.disconnect).toHaveBeenCalled();
    expect(store.get()).toBeNull();
    expect(pause.resume).toHaveBeenCalledTimes(1);
  });

  it("a dropped port says it couldn't reach LingoFlix's background", async () => {
    const { store, ports, explain } = setupExplain();
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    ports[0]!.drop();
    expect(store.get()).toMatchObject({
      status: 'error',
      error: { code: 'network', message: "Couldn't reach LingoFlix's background", provider: null },
    });
  });

  it("an error from the background keeps its provider, for the card's billing link", async () => {
    const { store, ports, explain } = setupExplain();
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    ports[0]!.receive({ type: 'error', code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' });
    expect(store.get()).toMatchObject({
      status: 'error',
      error: { code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' },
    });
  });

  it("image-based subtitles get the can't-be-read card; no line means no card", () => {
    const image = setupExplain({ imageBased: true, line: null });
    expect(image.explain.open('shortcut')).toBe(true);
    expect(image.store.get()).toMatchObject({
      status: 'error',
      error: { code: 'image-subs', message: "This title's subtitles can't be read as text", provider: null },
    });
    const none = setupExplain({ line: null });
    expect(none.explain.open('shortcut')).toBe(false);
    expect(none.store.get()).toBeNull();
  });
});
