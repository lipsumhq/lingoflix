export const BRIDGE_REQUEST_EVENT = 'lingoflix:bridge-request';
export const BRIDGE_RESPONSE_EVENT = 'lingoflix:bridge-response';

/** Times are ms from the start of the episode — the clock `seek` takes, so a saved time seeks back to it. */
export interface PlayerState {
  currentTimeMs: number;
  durationMs: number;
  paused: boolean;
  videoId: string | null;
}

export interface BridgeMethods {
  seekBy(deltaMs: number): void;
  seek(timeMs: number): void;
  play(): void;
  pause(): void;
  getState(): PlayerState;
}

export type BridgeMethod = keyof BridgeMethods;

export type BridgeErrorCode = 'player-unavailable' | 'timeout' | 'bad-request' | 'internal';

export interface BridgeRequest {
  id: string;
  method: string;
  args: unknown[];
}

export type BridgeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; code: BridgeErrorCode; message: string };

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

/** Event details cross the isolated/main world boundary as JSON strings. */
export function encode(value: unknown): string {
  return JSON.stringify(value);
}

export function decode<T>(detail: unknown): T | null {
  if (typeof detail !== 'string') return null;
  try {
    return JSON.parse(detail) as T;
  } catch {
    return null;
  }
}
