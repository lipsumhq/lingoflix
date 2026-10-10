import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getApiKey, maskApiKey, removeApiKey, setApiKey } from '@/lib/api-key';
import { createMessageHandler, type MessageHandlerDeps } from '@/lib/background/message-handler';
import type { ClaudeClient } from '@/lib/claude/client';
import { PENDING_SEEK_MAX_AGE_MS, setPendingSeek, takePendingSeek } from '@/lib/pending-seek';
import { findExplanation, saveExplanation } from '@/lib/study-log/store';

beforeEach(() => fakeBrowser.reset());

const KEY = 'sk-ant-api03-abcdefghijklmnop-wxyz';
const FROM_PAGE = { fromExtensionPage: true };
const FROM_NETFLIX = { fromExtensionPage: false };

function handlerWith(checkKey: ClaudeClient['checkKey'] = async () => {}, over: Partial<MessageHandlerDeps> = {}) {
  const createClient = vi.fn((_key: string): ClaudeClient => ({ stream: async () => ({ text: '', toolCalls: [] }), checkKey }));
  const openOptions = vi.fn(async (_hash?: string) => {});
  const serve = createMessageHandler({
    getApiKey,
    setApiKey,
    removeApiKey,
    createClient,
    findExplanation,
    takePendingSeek: (videoId) => takePendingSeek(videoId),
    openOptions,
    ...over,
  });
  const handle = (message: unknown, context = FROM_PAGE) => serve(message, context);
  return { handle, createClient, openOptions };
}

describe('API key requests', () => {
  it('stores, reports (masked), and removes the key — never echoing it back', async () => {
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

  it('Test key: valid, rejected, or network — using the typed key, else the saved one', async () => {
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

describe('Study Log lookup and pending seek', () => {
  it('finds a saved explanation for a line', async () => {
    const saved = await saveExplanation({
      phrase: 'Hi there.',
      response: 'r',
      videoTimeMs: 1,
      videoId: '1',
      kind: 'movie',
      seriesId: null,
      seriesTitle: 'M',
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null,
      context: { before: [], after: [] },
      explanationLanguage: 'en',
      model: 'm',
      suggestions: [],
    });
    const { handle } = handlerWith();
    expect(await handle({ type: 'log:find', videoId: '1', language: 'en', phrase: 'Hi  there.' })).toEqual({ entry: saved });
    expect(await handle({ type: 'log:find', videoId: '1', language: 'ko', phrase: 'Hi there.' })).toEqual({ entry: null });
  });

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

  it('rejects unknown requests', async () => {
    const { handle } = handlerWith();
    await expect(handle({ type: 'nope' })).rejects.toThrow(/Unknown request/);
    await expect(handle('nope')).rejects.toThrow(/Unknown request/);
  });
});
