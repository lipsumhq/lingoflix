import { browser } from '#imports';
import type { Explanation, SaveSuggestion } from '@/lib/study-log/types';

export type KeyTestResult = 'valid' | 'rejected' | 'network' | 'error';

/** Requests answered by the background worker (spec §6.3, v2 spec §4.2), with their responses. */
export interface BackgroundRequests {
  'api-key:status': { request: object; response: { set: boolean; masked: string | null } };
  'api-key:set': { request: { key: string }; response: { ok: boolean } };
  'api-key:remove': { request: object; response: { ok: true } };
  'api-key:test': { request: { key?: string }; response: { result: KeyTestResult; message: string } };
  /** The stored explanation of a line, and the index keys of its card rows that are saved. */
  'explanation:find': {
    request: { videoId: string; language: string; phrase: string };
    response: { explanation: Explanation | null; savedKeys: string[] };
  };
  /** Saves one of the explanation's card rows; answers with its index key. */
  'item:save': { request: { explanationId: string; suggestion: SaveSuggestion }; response: { key: string } };
  /** Removes the saved item of one of the explanation's card rows (no-op when not saved). */
  'item:remove': { request: { explanationId: string; suggestion: SaveSuggestion }; response: { key: string } };
  'pending-seek:take': { request: { videoId: string }; response: { timeMs: number | null } };
  'open-options': { request: { hash?: string }; response: { ok: true } };
}

export type BackgroundRequestType = keyof BackgroundRequests;
export type BackgroundRequest<T extends BackgroundRequestType> = { type: T } & BackgroundRequests[T]['request'];
export type BackgroundResponse<T extends BackgroundRequestType> = BackgroundRequests[T]['response'];

export async function sendToBackground<T extends BackgroundRequestType>(message: BackgroundRequest<T>): Promise<BackgroundResponse<T>> {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (typeof response === 'object' && response !== null && 'error' in response) {
    throw new Error(String((response as { error: unknown }).error));
  }
  return response as BackgroundResponse<T>;
}
