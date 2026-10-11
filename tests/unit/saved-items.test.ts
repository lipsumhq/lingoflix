import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { cardRows } from '@/lib/claude/suggestions';
import {
  MIGRATION_KEY,
  deleteItems,
  getItem,
  itemFromSuggestion,
  itemIndexKey,
  listItems,
  migrateIfNeeded,
  migrateStudyLogV2,
  saveItem,
  savedKeysFor,
  suggestionKey,
  unsaveItem,
} from '@/lib/study-log/items';
import { listExplanations, resetStudyLog, saveExplanation, watchStudyLog } from '@/lib/study-log/store';
import { isSavedItem, type Explanation, type NewExplanation, type SaveSuggestion } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());

const IDIOM: SaveSuggestion = { type: 'idiom', text: 'call it a night', meaning: 'end the evening' };
const WORD: SaveSuggestion = { type: 'word', text: 'gonna', meaning: 'going to' };
const NOW = new Date('2026-10-10T21:41:00Z');

const fields = (over: Partial<NewExplanation> = {}): NewExplanation => ({
  phrase: "I'm gonna call it a night.",
  response: '## Meaning\nTime to sleep.',
  videoTimeMs: 1_834_200,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: ['Where are you going?'], after: ['Night.'] },
  explanationLanguage: 'ko',
  model: 'claude-sonnet-5-5',
  suggestions: [IDIOM, WORD],
  ...over,
});

/** An explanation as the background would have it (saving items doesn't read it from storage). */
const explanationOf = (over: Partial<NewExplanation> = {}, id = 'log-1'): Explanation => ({
  ...fields(over),
  id,
  followUps: [],
  savedAt: '2026-10-10T21:40:00.000Z',
  updatedAt: '2026-10-10T21:40:00.000Z',
});

const stored = async (key: string): Promise<unknown> => (await fakeBrowser.storage.local.get(key))[key];

describe('saved items (v2 spec §3.2)', () => {
  it('saves a suggestion as an item whose source fields come from the explanation', async () => {
    const explanation = explanationOf();
    const item = await saveItem(explanation, IDIOM, NOW, () => 'item-1');
    expect(item).toEqual({
      id: 'item-1',
      type: 'idiom',
      text: 'call it a night',
      meaning: 'end the evening',
      explanationId: 'log-1',
      line: "I'm gonna call it a night.",
      lineTimeMs: 1_834_200,
      context: { before: ['Where are you going?'], after: ['Night.'] },
      videoId: '80077211',
      kind: 'episode',
      seriesId: '80057281',
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      episodeTitle: 'Holly, Jolly',
      explanationLanguage: 'ko',
      savedAt: '2026-10-10T21:41:00.000Z',
      updatedAt: '2026-10-10T21:41:00.000Z',
    });
    expect(await getItem('item-1')).toEqual(item);
    expect(await stored(suggestionKey(explanation, IDIOM))).toBe('item-1');
    expect(itemFromSuggestion(explanation, IDIOM, NOW, 'item-1')).toEqual(item);
  });

  it('builds index keys that ignore case and spacing', () => {
    expect(itemIndexKey('1', "I'm  GONNA\ncall it", 'word', ' Gonna ')).toBe("itemkey:1|i'm gonna call it|word|gonna");
  });

  it('saving the same suggestion of the same line again returns the item already saved', async () => {
    const explanation = explanationOf();
    const first = await saveItem(explanation, IDIOM, NOW, () => 'item-1');
    const again = await saveItem(explanation, { type: 'idiom', text: 'Call It  a NIGHT', meaning: 'changed' }, NOW, () => 'item-2');
    // The same line explained in another language is still the same line.
    const otherLanguage = await saveItem(explanationOf({ explanationLanguage: 'en' }, 'log-2'), IDIOM, NOW, () => 'item-3');
    expect(again).toEqual(first);
    expect(otherLanguage).toEqual(first);
    expect((await listItems()).map((i) => i.id)).toEqual(['item-1']);
  });

  it('the same word from another line is a separate item', async () => {
    const a = explanationOf({}, 'log-a');
    const b = explanationOf({ phrase: "We're gonna be late.", videoTimeMs: 5000 }, 'log-b');
    await saveItem(a, WORD, NOW, () => 'item-a');
    const fromB = await saveItem(b, WORD, NOW, () => 'item-b');
    expect(fromB).toMatchObject({ id: 'item-b', text: 'gonna', line: "We're gonna be late.", lineTimeMs: 5000, explanationId: 'log-b' });
    expect((await listItems()).map((i) => i.line).sort()).toEqual(["I'm gonna call it a night.", "We're gonna be late."]);
  });

  it('a whole-line row is saved with the line itself as its text', async () => {
    const explanation = explanationOf();
    const item = await saveItem(explanation, { type: 'line', text: 'whatever Claude wrote', meaning: 'Time for bed.' }, NOW, () => 'item-1');
    expect(item).toMatchObject({ type: 'line', text: explanation.phrase, line: explanation.phrase, meaning: 'Time for bed.' });
    expect(suggestionKey(explanation, { type: 'line', text: 'anything' })).toBe(
      itemIndexKey('80077211', explanation.phrase, 'line', explanation.phrase),
    );
  });

  it('a lookup key left pointing at a missing item is replaced by a new item', async () => {
    const explanation = explanationOf();
    await fakeBrowser.storage.local.set({ [suggestionKey(explanation, WORD)]: 'gone' });
    const item = await saveItem(explanation, WORD, NOW, () => 'item-1');
    expect(item.id).toBe('item-1');
    expect(await stored(suggestionKey(explanation, WORD))).toBe('item-1');
  });

  it('unsave removes the item and its lookup key; unsaving something not saved does nothing', async () => {
    const explanation = explanationOf();
    await saveItem(explanation, IDIOM, NOW, () => 'item-1');
    await unsaveItem(explanation, { type: 'idiom', text: 'call it a night' });
    expect(await getItem('item-1')).toBeNull();
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
    await unsaveItem(explanation, WORD);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it("lists the saved rows' keys, including the Whole line row when Claude suggested no line", async () => {
    const explanation = explanationOf({ suggestions: [IDIOM, WORD] });
    expect(await savedKeysFor(explanation)).toEqual([]);
    await saveItem(explanation, WORD, NOW, () => 'w');
    await saveItem(explanation, { type: 'line', text: explanation.phrase, meaning: '' }, NOW, () => 'l');
    const rows = cardRows(explanation.suggestions, explanation.phrase);
    expect(rows.map((r) => r.type)).toEqual(['idiom', 'word', 'line']);
    expect(await savedKeysFor(explanation)).toEqual([suggestionKey(explanation, WORD), suggestionKey(explanation, rows[2]!)]);
  });

  it('lists items and skips corrupt records', async () => {
    await fakeBrowser.storage.local.set({ 'item:bad': { id: 'bad', type: 'sentence' }, 'item:worse': 'text' });
    await saveItem(explanationOf(), WORD, NOW, () => 'item-1');
    expect((await listItems()).map((i) => i.id)).toEqual(['item-1']);
    expect(await getItem('bad')).toBeNull();
  });

  it('deleteItems removes the items and only the lookup keys that still point at them', async () => {
    const explanation = explanationOf();
    await saveItem(explanation, IDIOM, NOW, () => 'a');
    const b = await saveItem(explanation, WORD, NOW, () => 'b');
    await deleteItems(['a']);
    expect(await getItem('a')).toBeNull();
    expect(await stored(suggestionKey(explanation, IDIOM))).toBeUndefined();
    expect(await getItem('b')).toEqual(b);
    await fakeBrowser.storage.local.set({ [suggestionKey(explanation, WORD)]: 'someone-else' });
    await deleteItems(['b']);
    expect(await getItem('b')).toBeNull();
    expect(await stored(suggestionKey(explanation, WORD))).toBe('someone-else');
    await deleteItems([]);
  });

  it('recognizes a saved item, including one from a movie or with no explanation', () => {
    const valid = itemFromSuggestion(explanationOf(), IDIOM, NOW, 'x');
    expect(isSavedItem(valid)).toBe(true);
    expect(
      isSavedItem({ ...valid, kind: 'movie', explanationId: null, seriesId: null, seasonNumber: null, episodeNumber: null, episodeTitle: null }),
    ).toBe(true);
    for (const bad of [
      { ...valid, type: 'sentence' },
      { ...valid, lineTimeMs: Number.NaN },
      { ...valid, context: { before: [1], after: [] } },
      { ...valid, explanationId: 5 },
      { ...valid, meaning: undefined },
      'item',
      null,
    ]) {
      expect(isSavedItem(bad)).toBe(false);
    }
  });

  it('watchStudyLog also reports saved-item changes', async () => {
    const changed = vi.fn();
    const stop = watchStudyLog(changed);
    await fakeBrowser.storage.local.set({ unrelated: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(changed).not.toHaveBeenCalled();
    await saveItem(explanationOf(), WORD, NOW, () => 'item-1');
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    stop();
  });

  it('Reset all removes explanations and saved items, and keeps the API key, other keys and the migration marker', async () => {
    await fakeBrowser.storage.local.set({ apiKey: 'sk-ant-secret', other: 1, [MIGRATION_KEY]: true });
    const explanation = await saveExplanation(fields(), NOW, () => 'log-1');
    await saveItem(explanation, IDIOM, NOW, () => 'item-1');
    await resetStudyLog();
    expect(await listItems()).toEqual([]);
    expect(await listExplanations()).toEqual([]);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ apiKey: 'sk-ant-secret', other: 1, [MIGRATION_KEY]: true });
  });
});

describe('migrateStudyLogV2 (v2 spec §3.3)', () => {
  /** An explanation as the Study Log stored it before v2: no `suggestions` field. */
  const preV2 = (id: string, over: Partial<NewExplanation> = {}) => {
    const { suggestions: _none, ...rest } = fields(over);
    return { ...rest, id, followUps: [], savedAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-02T09:00:00.000Z' };
  };
  const counter = (prefix: string) => {
    let n = 0;
    return () => `${prefix}-${++n}`;
  };

  it('turns every explanation saved before v2 into a saved whole-line item, once', async () => {
    await fakeBrowser.storage.local.set({
      'log:old-1': preV2('old-1'),
      'log:old-2': preV2('old-2', { phrase: 'Where are you going?', videoTimeMs: 1000 }),
    });
    expect(await migrateStudyLogV2(counter('item'))).toBe(2);
    const items = await listItems();
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.explanationId === 'old-1')).toMatchObject({
      type: 'line',
      text: "I'm gonna call it a night.",
      line: "I'm gonna call it a night.",
      meaning: '',
      lineTimeMs: 1_834_200,
      context: { before: ['Where are you going?'], after: ['Night.'] },
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      explanationLanguage: 'ko',
      savedAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
    });
    expect(await stored(MIGRATION_KEY)).toBe(true);
    expect(await migrateStudyLogV2(counter('again'))).toBe(0);
    expect(await listItems()).toHaveLength(2);
  });

  it('never converts explanations written by v2 (they are history only)', async () => {
    await saveExplanation(fields(), NOW, () => 'log-1');
    expect(await migrateStudyLogV2()).toBe(0);
    expect(await listItems()).toEqual([]);
    expect(await stored(MIGRATION_KEY)).toBe(true);
  });

  it('does nothing once it has run', async () => {
    await migrateStudyLogV2();
    await fakeBrowser.storage.local.set({ 'log:late': preV2('late') });
    expect(await migrateStudyLogV2()).toBe(0);
    expect(await listItems()).toEqual([]);
  });

  it('skips a line that already has a saved whole-line item (an interrupted run)', async () => {
    await fakeBrowser.storage.local.set({ 'log:old-1': preV2('old-1') });
    const [explanation] = await listExplanations();
    await saveItem(explanation!, { type: 'line', text: explanation!.phrase, meaning: '' }, NOW, () => 'kept');
    expect(await migrateStudyLogV2()).toBe(0);
    expect((await listItems()).map((i) => i.id)).toEqual(['kept']);
  });

  describe('migrateIfNeeded (the background worker starting, and onInstalled)', () => {
    it('converts when the marker is missing', async () => {
      await fakeBrowser.storage.local.set({ 'log:old-1': preV2('old-1') });
      expect(await migrateIfNeeded()).toBe(1);
      expect(await listItems()).toEqual([expect.objectContaining({ type: 'line', explanationId: 'old-1' })]);
      expect(await stored(MIGRATION_KEY)).toBe(true);
    });

    it('reads only the marker once it is set, and changes nothing', async () => {
      await fakeBrowser.storage.local.set({ [MIGRATION_KEY]: true, 'log:late': preV2('late') });
      const get = vi.spyOn(fakeBrowser.storage.local, 'get');
      const set = vi.spyOn(fakeBrowser.storage.local, 'set');
      expect(await migrateIfNeeded()).toBe(0);
      expect(get.mock.calls).toEqual([[MIGRATION_KEY]]);
      expect(set).not.toHaveBeenCalled();
      expect(await listItems()).toEqual([]);
    });

    it('runs one conversion at a time, so two calls together save each line once', async () => {
      await fakeBrowser.storage.local.set({ 'log:old-1': preV2('old-1') });
      expect(await Promise.all([migrateIfNeeded(), migrateIfNeeded()])).toEqual([1, 0]);
      expect(await listItems()).toHaveLength(1);
    });

    it('a failure resolves 0 with a console warning, and the next call converts', async () => {
      await fakeBrowser.storage.local.set({ 'log:old-1': preV2('old-1') });
      const failure = new Error('Storage is unavailable');
      vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(failure);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await migrateIfNeeded()).toBe(0);
      expect(warn.mock.calls).toEqual([['LingoFlix: Study Log v2 conversion failed', failure]]);
      expect(await listItems()).toEqual([]);
      expect(await migrateIfNeeded()).toBe(1);
      expect(await listItems()).toHaveLength(1);
    });
  });

  describe('migrateIfNeeded across contexts (the worker and a Study Log tab share a Web Lock)', () => {
    afterEach(() => vi.unstubAllGlobals());

    /** A stand-in for `navigator.locks`: records each requested name and runs the callbacks one at a time. */
    const fakeLocks = () => {
      const names: string[] = [];
      let held = false;
      let queue: Promise<unknown> = Promise.resolve();
      const request = (name: string, callback: (lock: unknown) => unknown) => {
        names.push(name);
        const run = queue.then(async () => {
          held = true;
          try {
            return await callback({ name, mode: 'exclusive' });
          } finally {
            held = false;
          }
        });
        queue = run.catch(() => {});
        return run;
      };
      return { locks: { request }, names, isHeld: () => held };
    };

    it("requests the 'lingoflix:study-log-v2' lock and checks the marker and converts inside it", async () => {
      const fake = fakeLocks();
      vi.stubGlobal('navigator', { locks: fake.locks });
      await fakeBrowser.storage.local.set({ 'log:old-1': preV2('old-1') });
      const heldOnGet: boolean[] = [];
      const heldOnSet: boolean[] = [];
      const get = fakeBrowser.storage.local.get.bind(fakeBrowser.storage.local);
      const set = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
      vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation(((keys: never) => {
        heldOnGet.push(fake.isHeld());
        return get(keys);
      }) as typeof fakeBrowser.storage.local.get);
      vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation((items) => {
        heldOnSet.push(fake.isHeld());
        return set(items);
      });
      expect(await migrateIfNeeded()).toBe(1);
      expect(fake.names).toEqual(['lingoflix:study-log-v2']);
      expect(heldOnGet).toEqual([true, true]); // the marker, then everything
      expect(heldOnSet).toEqual([true]);
      vi.restoreAllMocks();
      expect(await listItems()).toEqual([expect.objectContaining({ type: 'line', explanationId: 'old-1' })]);
    });

    it('two contexts (separate module queues) converting together save each line once', async () => {
      const fake = fakeLocks();
      vi.stubGlobal('navigator', { locks: fake.locks });
      await fakeBrowser.storage.local.set({ 'log:old-1': preV2('old-1'), 'log:old-2': preV2('old-2', { phrase: 'Night.' }) });
      vi.resetModules();
      const worker = await import('@/lib/study-log/items');
      vi.resetModules();
      const page = await import('@/lib/study-log/items');
      expect(page.migrateIfNeeded).not.toBe(worker.migrateIfNeeded);
      expect(await Promise.all([worker.migrateIfNeeded(), page.migrateIfNeeded()])).toEqual([2, 0]);
      expect(fake.names).toEqual(['lingoflix:study-log-v2', 'lingoflix:study-log-v2']);
      expect(await listItems()).toHaveLength(2);
    });

    it('without navigator.locks, converts as before: one at a time within the context', async () => {
      vi.stubGlobal('navigator', {});
      await fakeBrowser.storage.local.set({ 'log:old-1': preV2('old-1') });
      expect(await Promise.all([migrateIfNeeded(), migrateIfNeeded()])).toEqual([1, 0]);
      expect(await listItems()).toHaveLength(1);
      expect(await stored(MIGRATION_KEY)).toBe(true);
      const get = vi.spyOn(fakeBrowser.storage.local, 'get');
      expect(await migrateIfNeeded()).toBe(0);
      expect(get.mock.calls).toEqual([[MIGRATION_KEY]]);
    });
  });
});
