import { maskApiKey } from '@/lib/api-key';
import type { ClaudeClient } from '@/lib/claude/client';
import { toExplainError } from '@/lib/claude/errors';
import type { BackgroundResponse } from '@/lib/messages';
import type { Explanation } from '@/lib/study-log/types';

export interface MessageHandlerDeps {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  removeApiKey(): Promise<void>;
  createClient(apiKey: string): ClaudeClient;
  findExplanation(videoId: string, language: string, phrase: string): Promise<Explanation | null>;
  takePendingSeek(videoId: string): Promise<number | null>;
  openOptions(hash: string): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A pasted key: printable ASCII only (no spaces, no invisible or non-ASCII characters), a sane length.
 * Anthropic's own check happens in Test key.
 */
const looksLikeKey = (key: string) => /^[\x21-\x7e]{1,300}$/.test(key);
const NOT_A_KEY = "That doesn't look like an API key.";
const OPTIONS_ROUTE = /^#\/[a-z-]*$/;
/** Requests that change or use the key: only LingoFlix's own pages (options, popup) may send them. */
const PAGE_ONLY = new Set(['api-key:set', 'api-key:remove', 'api-key:test']);

export interface MessageContext {
  /** The sender is one of LingoFlix's own pages, not a content script on Netflix. */
  fromExtensionPage: boolean;
}

export function createMessageHandler(deps: MessageHandlerDeps): (message: unknown, context: MessageContext) => Promise<unknown> {
  async function testKey(key: string | null): Promise<BackgroundResponse<'api-key:test'>> {
    if (!key) return { result: 'rejected', message: 'No API key to test.' };
    try {
      await deps.createClient(key).checkKey();
      return { result: 'valid', message: 'Your key works.' };
    } catch (err) {
      const { code, message } = toExplainError(err);
      if (code === 'bad-key') return { result: 'rejected', message: 'Anthropic rejected this key.' };
      if (code === 'network') return { result: 'network', message: "Couldn't reach Anthropic. Check your connection." };
      return { result: 'error', message };
    }
  }

  return async (message, context) => {
    const type = isRecord(message) ? message.type : undefined;
    const m = isRecord(message) ? message : {};
    if (typeof type === 'string' && PAGE_ONLY.has(type) && !context.fromExtensionPage) throw new Error('Not allowed');
    switch (type) {
      case 'api-key:status': {
        const key = await deps.getApiKey();
        return { set: key !== null, masked: key ? maskApiKey(key) : null } satisfies BackgroundResponse<'api-key:status'>;
      }
      case 'api-key:set': {
        const key = typeof m.key === 'string' ? m.key.trim() : '';
        if (!looksLikeKey(key)) return { ok: false } satisfies BackgroundResponse<'api-key:set'>;
        await deps.setApiKey(key);
        return { ok: true } satisfies BackgroundResponse<'api-key:set'>;
      }
      case 'api-key:remove':
        await deps.removeApiKey();
        return { ok: true } satisfies BackgroundResponse<'api-key:remove'>;
      case 'api-key:test': {
        const typed = typeof m.key === 'string' ? m.key.trim() : '';
        if (typed && !looksLikeKey(typed)) return { result: 'rejected', message: NOT_A_KEY } satisfies BackgroundResponse<'api-key:test'>;
        return testKey(typed || (await deps.getApiKey()));
      }
      case 'log:find': {
        const { videoId, language, phrase } = m;
        if (typeof videoId !== 'string' || typeof language !== 'string' || typeof phrase !== 'string') return { entry: null };
        return { entry: await deps.findExplanation(videoId, language, phrase) } satisfies BackgroundResponse<'log:find'>;
      }
      case 'pending-seek:take':
        return {
          timeMs: typeof m.videoId === 'string' ? await deps.takePendingSeek(m.videoId) : null,
        } satisfies BackgroundResponse<'pending-seek:take'>;
      case 'open-options': {
        const hash = typeof m.hash === 'string' && OPTIONS_ROUTE.test(m.hash) ? m.hash : '';
        await deps.openOptions(hash);
        return { ok: true } satisfies BackgroundResponse<'open-options'>;
      }
      default:
        throw new Error(`Unknown request ${String(type)}`);
    }
  };
}
