import { browser } from '#imports';
import {
  EXPLAIN_PORT,
  errorCopy,
  type ExplainClientMessage,
  type ExplainErrorCode,
  type ExplainServerMessage,
} from '@/lib/ai/protocol';
import type { Provider } from '@/lib/ai/provider';
import type { Explanation } from '@/lib/study-log/types';

export interface PortLike {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export type Connect = () => PortLike;

export const connectExplainPort: Connect = () => browser.runtime.connect({ name: EXPLAIN_PORT }) as unknown as PortLike;

export interface StreamHandlers {
  onDelta(text: string): void;
  /** The stored explanation, and the index keys of its Save rows that are saved (v2 spec §4.2). */
  onDone(explanation: Explanation, savedKeys: string[]): void;
  /** `provider` is the key's, as the background named it; null when the Port dropped first. */
  onError(code: ExplainErrorCode, message: string, provider: Provider | null): void;
}

/**
 * Runs one request over its own Port (spec §6.3). Returns a cancel function; cancelling disconnects, and the
 * background still finishes and saves the answer (finish-answers spec §3.2). If the Port drops without an
 * answer (the worker restarted or the extension was reloaded), the card says it couldn't reach LingoFlix's
 * background: only the background knows the key's provider.
 */
export function streamExplanation(connect: Connect, message: ExplainClientMessage, handlers: StreamHandlers): () => void {
  let finished = false;
  let port: PortLike;
  try {
    port = connect();
  } catch {
    handlers.onError('network', errorCopy('network', null), null);
    return () => {};
  }
  port.onMessage.addListener((raw) => {
    if (finished) return;
    const m = raw as ExplainServerMessage;
    if (m.type === 'delta') {
      handlers.onDelta(m.text);
    } else if (m.type === 'done') {
      finished = true;
      handlers.onDone(m.explanation, m.savedKeys);
      port.disconnect();
    } else if (m.type === 'error') {
      finished = true;
      handlers.onError(m.code, m.message, m.provider);
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    if (finished) return;
    finished = true;
    handlers.onError('network', errorCopy('network', null), null);
  });
  port.postMessage(message);
  return () => {
    if (finished) return;
    finished = true;
    port.disconnect();
  };
}
