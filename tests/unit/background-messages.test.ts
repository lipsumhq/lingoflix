import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getApiKey, maskApiKey, removeApiKey, setApiKey } from '@/lib/api-key';
import { createMessageHandler, type MessageHandlerDeps } from '@/lib/background/message-handler';
import type { ClaudeClient } from '@/lib/claude/client';
import { PENDING_SEEK_MAX_AGE_MS, setPendingSeek, takePendingSeek } from '@/lib/pending-seek';
import { listItems, saveItem, savedKeysFor, suggestionKey, unsaveItem } from '@/lib/study-log/items';
import { findExplanation, getExplanation, saveExplanation } from '@/lib/study-log/store';
import type { NewExplanation } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());

const KEY = 'sk-ant-api03-abcdefghijklmnop-wxyz';
const FROM_PAGE = { fromExtensionPage: true };
const FROM_NETFLIX = { fromExtensionPage: false };

const LINE: NewExplanation = {
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
  suggestions: [
    { type: 'idiom', text: 'call it a night', meaning: '그만 자러 가다' },
    { type: 'word', text: 'gonna', meaning: 'going to' },
  ],
};

function handlerWith(checkKey: ClaudeClient['checkKey'] = async () => {}, over: Partial<MessageHandlerDeps> = {}) {
  const createClient = vi.fn((_key: string): ClaudeClient => ({ stream: async () => ({ text: '', toolCalls: [] }), checkKey }));
  const openOptions = vi.fn(async (_hash?: string) => {});
  const serve = createMessageHandler({
    getApiKey,
    setApiKey,
    removeApiKey,
    createClient,
    findExplanation,
    getExplanation,
    saveItem: (explanation, suggestion) => saveItem(explanation, suggestion),
    unsaveItem: (explanation, suggestion) => unsaveItem(explanation, suggestion),
    savedKeysFor,
    takePendingSeek: (videoId) => takePendingSeek(videoId),
    openOptions,
    ...over,
  });
  const handle = (message: unknown, context = FROM_PAGE) => serve(message, context);
  return { handle, createClient, openOptions };
}

describe('API key requests', () => {
  it('stores, reports (masked), and removes the key, never echoing it back', async () => {
    const { handle } = handlerWith();
    const replies: unknown[] = [];
    replies.push(await handle({ type: 'api-key:status' }));
    replies.push(await handle({ type: 'api-key:set', key: `  ${KEY}  ` }));
    replies.push(await handle({ type: 'api-key:status' }));
    expect(replies).toEqual([
      { set: false, masked: null },
      { ok: true },
      { set: true, masked: maskApiKey(KEY) },
    ]);
    expect(maskApiKey(KEY)).toBe('sk-ant-…wxyz');
    expect(await getApiKey()).toBe(KEY);
    expect(JSON.stringify(replies)).not.toContain('abcdefghijklmnop');
    expect(await handle({ type: 'api-key:remove' })).toEqual({ ok: true });
    expect(await handle({ type: 'api-key:status' })).toEqual({ set: false, masked: null });
  });

  it('refuses keys that are empty or contain spaces, invisible, or non-ASCII characters', async () => {
    const { handle } = handlerWith();
    expect(await handle({ type: 'api-key:set', key: '   ' })).toEqual({ ok: false });
    expect(await handle({ type: 'api-key:set', key: 'two words' })).toEqual({ ok: false });
    expect(await handle({ type: 'api-key:set', key: 'sk-ant-\u200babc' })).toEqual({ ok: false });
    expect(await handle({ type: 'api-key:set', key: 'sk-ant-\u00e9abc' })).toEqual({ ok: false });
    expect(await getApiKey()).toBeNull();
  });

  it('Test key refuses a typed key that does not look like one, without calling Anthropic', async () => {
    const { handle, createClient } = handlerWith();
    expect(await handle({ type: 'api-key:test', key: 'two words' })).toEqual({
      result: 'rejected',
      message: "That doesn't look like an API key.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('only LingoFlix pages may set, remove, or test the key; anyone may read its status', async () => {
    const { handle, createClient } = handlerWith();
    await expect(handle({ type: 'api-key:set', key: KEY }, FROM_NETFLIX)).rejects.toThrow(/Not allowed/);
    expect(await getApiKey()).toBeNull();
    await setApiKey(KEY);
    await expect(handle({ type: 'api-key:remove' }, FROM_NETFLIX)).rejects.toThrow(/Not allowed/);
    await expect(handle({ type: 'api-key:test' }, FROM_NETFLIX)).rejects.toThrow(/Not allowed/);
    expect(createClient).not.toHaveBeenCalled();
    expect(await getApiKey()).toBe(KEY);
    expect(await handle({ type: 'api-key:status' }, FROM_NETFLIX)).toEqual({ set: true, masked: maskApiKey(KEY) });
  });

  it('Test key: valid, rejected, or network, using the typed key, else the saved one', async () => {
    await setApiKey(KEY);
    const ok = handlerWith();
    expect(await ok.handle({ type: 'api-key:test' })).toEqual({ result: 'valid', message: 'Your key works.' });
    expect(ok.createClient).toHaveBeenCalledWith(KEY);
    await ok.handle({ type: 'api-key:test', key: ' sk-ant-typed ' });
    expect(ok.createClient).toHaveBeenLastCalledWith('sk-ant-typed');

    const rejected = handlerWith(async () => {
      throw APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid' } }, 'x', new Headers());
    });
    expect(await rejected.handle({ type: 'api-key:test' })).toEqual({ result: 'rejected', message: 'Anthropic rejected this key.' });

    const offline = handlerWith(async () => {
      throw new APIConnectionError({ message: 'fetch failed' });
    });
    expect(await offline.handle({ type: 'api-key:test' })).toEqual({
      result: 'network',
      message: "Couldn't reach Anthropic. Check your connection.",
    });
  });

  it('Test key without any key says so', async () => {
    const { handle } = handlerWith();
    expect(await handle({ type: 'api-key:test' })).toEqual({ result: 'rejected', message: 'No API key to test.' });
  });
});

describe('explanations and saved items', () => {
  it('explanation:find returns the stored explanation of a line with the keys of its saved rows', async () => {
    const stored = await saveExplanation(LINE);
    await saveItem(stored, stored.suggestions[0]!);
    const { handle } = handlerWith();
    expect(await handle({ type: 'explanation:find', videoId: '80077211', language: 'ko', phrase: "I'm gonna  call it a night." }, FROM_NETFLIX)).toEqual({
      explanation: stored,
      savedKeys: [suggestionKey(stored, stored.suggestions[0]!)],
    });
    expect(await handle({ type: 'explanation:find', videoId: '80077211', language: 'en', phrase: LINE.phrase })).toEqual({
      explanation: null,
      savedKeys: [],
    });
    expect(await handle({ type: 'explanation:find', videoId: 7 })).toEqual({ explanation: null, savedKeys: [] });
  });

  it('item:save stores a row the card offers, with every field from storage, once', async () => {
    const stored = await saveExplanation(LINE);
    const { handle } = handlerWith();
    // Case and spacing don't matter; the meaning the page sends is ignored.
    const reply = await handle(
      { type: 'item:save', explanationId: stored.id, suggestion: { type: 'idiom', text: 'Call it  a night', meaning: 'tampered' } },
      FROM_NETFLIX,
    );
    expect(reply).toEqual({ key: suggestionKey(stored, stored.suggestions[0]!) });
    await handle({ type: 'item:save', explanationId: stored.id, suggestion: stored.suggestions[0] }, FROM_NETFLIX);
    const items = await listItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'idiom',
      text: 'call it a night',
      meaning: '그만 자러 가다',
      explanationId: stored.id,
      line: LINE.phrase,
      lineTimeMs: 1_834_200,
      context: LINE.context,
      videoId: '80077211',
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      explanationLanguage: 'ko',
    });
  });

  it('the whole line can always be saved, even without a line suggestion', async () => {
    const stored = await saveExplanation(LINE);
    const { handle } = handlerWith();
    const wholeLine = { type: 'line', text: LINE.phrase, meaning: '' };
    expect(await handle({ type: 'item:save', explanationId: stored.id, suggestion: wholeLine }, FROM_NETFLIX)).toEqual({
      key: suggestionKey(stored, { type: 'line', text: LINE.phrase }),
    });
    expect(await listItems()).toEqual([expect.objectContaining({ type: 'line', text: LINE.phrase, meaning: '', explanationId: stored.id })]);
  });

  it('refuses rows the explanation does not offer, unknown explanations, and malformed requests', async () => {
    const stored = await saveExplanation(LINE);
    const { handle } = handlerWith();
    const save = (explanationId: unknown, suggestion: unknown) => handle({ type: 'item:save', explanationId, suggestion }, FROM_NETFLIX);
    await expect(save(stored.id, { type: 'word', text: 'night', meaning: 'x' })).rejects.toThrow('Not a suggestion of this explanation');
    await expect(save(stored.id, { type: 'phrase', text: 'call it a night', meaning: '' })).rejects.toThrow('Not a suggestion of this explanation');
    await expect(save('gone', stored.suggestions[0])).rejects.toThrow('Explanation not found');
    await expect(save(stored.id, { type: 'word', text: 'gonna' })).rejects.toThrow('Bad request');
    await expect(save(42, stored.suggestions[0])).rejects.toThrow('Bad request');
    await expect(handle({ type: 'item:remove', explanationId: stored.id, suggestion: 'gonna' }, FROM_NETFLIX)).rejects.toThrow('Bad request');
    expect(await listItems()).toEqual([]);
  });

  it('item:remove removes the saved row, and does nothing when it is not saved', async () => {
    const stored = await saveExplanation(LINE);
    const { handle } = handlerWith();
    const word = stored.suggestions[1]!;
    await handle({ type: 'item:save', explanationId: stored.id, suggestion: word }, FROM_NETFLIX);
    expect(await listItems()).toHaveLength(1);
    const reply = { key: suggestionKey(stored, word) };
    expect(await handle({ type: 'item:remove', explanationId: stored.id, suggestion: word }, FROM_NETFLIX)).toEqual(reply);
    expect(await listItems()).toEqual([]);
    expect(await handle({ type: 'item:remove', explanationId: stored.id, suggestion: word }, FROM_NETFLIX)).toEqual(reply);
  });

  it('two saves of the same row sent together create one item (item:save and item:remove run one at a time)', async () => {
    const stored = await saveExplanation(LINE);
    const { handle } = handlerWith();
    const save = () => handle({ type: 'item:save', explanationId: stored.id, suggestion: stored.suggestions[0] }, FROM_NETFLIX);
    const key = suggestionKey(stored, stored.suggestions[0]!);
    expect(await Promise.all([save(), save()])).toEqual([{ key }, { key }]);
    expect(await listItems()).toHaveLength(1);
  });

  it('a save or remove that fails does not hold up the ones sent after it', async () => {
    const stored = await saveExplanation(LINE);
    const failOnce = vi.fn<MessageHandlerDeps['saveItem']>((explanation, suggestion) => saveItem(explanation, suggestion));
    failOnce.mockRejectedValueOnce(new Error('Storage is full'));
    const { handle } = handlerWith(undefined, { saveItem: failOnce });
    const [idiom, word] = [stored.suggestions[0]!, stored.suggestions[1]!];
    const first = handle({ type: 'item:save', explanationId: stored.id, suggestion: idiom }, FROM_NETFLIX);
    const second = handle({ type: 'item:save', explanationId: stored.id, suggestion: word }, FROM_NETFLIX);
    const third = handle({ type: 'item:remove', explanationId: stored.id, suggestion: idiom }, FROM_NETFLIX);
    await expect(first).rejects.toThrow('Storage is full');
    await expect(second).resolves.toEqual({ key: suggestionKey(stored, word) });
    await expect(third).resolves.toEqual({ key: suggestionKey(stored, idiom) });
    expect(await listItems()).toEqual([expect.objectContaining({ type: 'word', text: 'gonna' })]);
  });
});

describe('pending seek', () => {
  it('a pending seek is taken once, by its own video, within 2 minutes', async () => {
    const now = Date.now();
    await setPendingSeek('42', 30_000, now);
    expect(await takePendingSeek('7', now + 1000)).toBeNull(); // another video doesn't consume it
    expect(await takePendingSeek('42', now + 1000)).toBe(30_000);
    expect(await takePendingSeek('42', now + 2000)).toBeNull(); // already taken
    await setPendingSeek('42', 30_000, now);
    expect(await takePendingSeek('42', now + PENDING_SEEK_MAX_AGE_MS + 1)).toBeNull(); // stale
    const { handle } = handlerWith();
    await setPendingSeek('42', 5000);
    expect(await handle({ type: 'pending-seek:take', videoId: '42' })).toEqual({ timeMs: 5000 });
  });
});

describe('other requests', () => {
  it('opens the options page, only at known routes', async () => {
    const { handle, openOptions } = handlerWith();
    await handle({ type: 'open-options', hash: '#/study-log' });
    await handle({ type: 'open-options', hash: 'javascript:alert(1)' });
    expect(openOptions.mock.calls).toEqual([['#/study-log'], ['']]);
  });

  it('rejects unknown requests, including the old log:find', async () => {
    const { handle } = handlerWith();
    await expect(handle({ type: 'nope' })).rejects.toThrow(/Unknown request/);
    await expect(handle('nope')).rejects.toThrow(/Unknown request/);
    await expect(handle({ type: 'log:find', videoId: '1', language: 'en', phrase: 'x' })).rejects.toThrow(/Unknown request log:find/);
  });
});
