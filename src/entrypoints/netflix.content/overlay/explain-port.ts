import { browser } from '#imports';
import {
  ERROR_COPY,
  EXPLAIN_PORT,
  type ExplainClientMessage,
  type ExplainErrorCode,
  type ExplainServerMessage,
} from '@/lib/claude/protocol';
import type { StudyLogEntry } from '@/lib/study-log/types';

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
  onDone(entry: StudyLogEntry): void;
  onError(code: ExplainErrorCode, message: string): void;
}

/**
 * Runs one request over its own Port (spec §6.3). Returns a cancel function; cancelling disconnects,
 * which aborts the request in the background. If the Port drops without an answer (the worker restarted
 * or the extension was reloaded), the card shows "Couldn't reach Claude".
 */
export function streamExplanation(connect: Connect, message: ExplainClientMessage, handlers: StreamHandlers): () => void {
  let finished = false;
  let port: PortLike;
  try {
    port = connect();
  } catch {
    handlers.onError('network', ERROR_COPY.network);
    return () => {};
  }
  port.onMessage.addListener((raw) => {
    if (finished) return;
    const m = raw as ExplainServerMessage;
    if (m.type === 'delta') {
      handlers.onDelta(m.text);
    } else if (m.type === 'done') {
      finished = true;
      handlers.onDone(m.entry);
      port.disconnect();
    } else if (m.type === 'error') {
      finished = true;
      handlers.onError(m.code, m.message);
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    if (finished) return;
    finished = true;
    handlers.onError('network', ERROR_COPY.network);
  });
  port.postMessage(message);
  return () => {
    if (finished) return;
    finished = true;
    port.disconnect();
  };
}
