import { maskApiKey } from '@/lib/api-key';
import type { AiClient } from '@/lib/ai/client';
import { toExplainError } from '@/lib/ai/errors';
import { cardRows } from '@/lib/ai/suggestions';
import type { BackgroundResponse } from '@/lib/messages';
import { suggestionKey } from '@/lib/study-log/items';
import { isSaveSuggestion, type Explanation, type SavedItem, type SaveSuggestion } from '@/lib/study-log/types';
import { normalizeLine } from '@/lib/subtitles/cue';

export interface MessageHandlerDeps {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  removeApiKey(): Promise<void>;
  createClient(apiKey: string): AiClient;
  findExplanation(videoId: string, language: string, phrase: string): Promise<Explanation | null>;
  getExplanation(id: string): Promise<Explanation | null>;
  saveItem(explanation: Explanation, suggestion: SaveSuggestion): Promise<SavedItem>;
  unsaveItem(explanation: Explanation, suggestion: SaveSuggestion): Promise<void>;
  savedKeysFor(explanation: Explanation): Promise<string[]>;
  takePendingSeek(videoId: string): Promise<number | null>;
  openOptions(hash: string): Promise<void>;
  /** Reminders spec §5: the Netflix page says a video is playing (checked and stored by the reminders store). */
  recordWatched(show: unknown): Promise<void>;
  /** Reminders spec §3: Send a test. */
  testReminder(): Promise<boolean>;
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
/** Requests only LingoFlix's own pages (options, popup) may send: the API key ones, and Send a test. */
const PAGE_ONLY = new Set(['api-key:set', 'api-key:remove', 'api-key:test', 'reminder:test']);

const sameText = (a: string, b: string) => normalizeLine(a).toLowerCase() === normalizeLine(b).toLowerCase();

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

  /**
   * v2 spec §4.2: the row must be one the card shows for this explanation. The stored row is used, never
   * the page's copy, and the item's source fields come from the stored explanation.
   */
  async function rowOf(m: Record<string, unknown>): Promise<{ explanation: Explanation; row: SaveSuggestion }> {
    const { explanationId, suggestion } = m;
    if (typeof explanationId !== 'string' || !isSaveSuggestion(suggestion)) throw new Error('Bad request');
    const explanation = await deps.getExplanation(explanationId);
    if (!explanation) throw new Error('Explanation not found');
    const row = cardRows(explanation.suggestions, explanation.phrase).find(
      (r) => r.type === suggestion.type && sameText(r.text, suggestion.text),
    );
    if (!row) throw new Error('Not a suggestion of this explanation');
    return { explanation, row };
  }

  /**
   * item:save and item:remove run one at a time, so two overlapping saves of one row can't both find it unsaved
   * and each create an item. A call that fails doesn't hold up the ones queued after it.
   */
  let itemWrites: Promise<unknown> = Promise.resolve();
  function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
    const run = itemWrites.then(work);
    itemWrites = run.catch(() => undefined);
    return run;
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
      case 'explanation:find': {
        const { videoId, language, phrase } = m;
        if (typeof videoId !== 'string' || typeof language !== 'string' || typeof phrase !== 'string') {
          return { explanation: null, savedKeys: [] } satisfies BackgroundResponse<'explanation:find'>;
        }
        const explanation = await deps.findExplanation(videoId, language, phrase);
        return {
          explanation,
          savedKeys: explanation ? await deps.savedKeysFor(explanation) : [],
        } satisfies BackgroundResponse<'explanation:find'>;
      }
      case 'item:save':
        return oneAtATime(async () => {
          const { explanation, row } = await rowOf(m);
          await deps.saveItem(explanation, row);
          return { key: suggestionKey(explanation, row) } satisfies BackgroundResponse<'item:save'>;
        });
      case 'item:remove':
        return oneAtATime(async () => {
          const { explanation, row } = await rowOf(m);
          await deps.unsaveItem(explanation, row);
          return { key: suggestionKey(explanation, row) } satisfies BackgroundResponse<'item:remove'>;
        });
      case 'pending-seek:take':
        return {
          timeMs: typeof m.videoId === 'string' ? await deps.takePendingSeek(m.videoId) : null,
        } satisfies BackgroundResponse<'pending-seek:take'>;
      case 'open-options': {
        const hash = typeof m.hash === 'string' && OPTIONS_ROUTE.test(m.hash) ? m.hash : '';
        await deps.openOptions(hash);
        return { ok: true } satisfies BackgroundResponse<'open-options'>;
      }
      case 'activity:watched':
        await deps.recordWatched(m.show);
        return { ok: true } satisfies BackgroundResponse<'activity:watched'>;
      case 'reminder:test':
        return { ok: await deps.testReminder() } satisfies BackgroundResponse<'reminder:test'>;
      default:
        throw new Error(`Unknown request ${String(type)}`);
    }
  };
}
