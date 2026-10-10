import type { TitleInfo } from '@/lib/netflix/title';

export const BRIDGE_REQUEST_EVENT = 'lingoflix:bridge-request';
export const BRIDGE_RESPONSE_EVENT = 'lingoflix:bridge-response';

/** The subtitle track Netflix is showing (from `getTimedTextTrack()`). */
export interface TextTrackInfo {
  trackId: string;
  /** BCP 47, e.g. "en". */
  language: string;
  isImageBased: boolean;
  /** True when subtitles are "Off". */
  isNone: boolean;
}

/** Times are ms from the start of the episode — the clock `seek` takes, so a saved time seeks back to it. */
export interface PlayerState {
  currentTimeMs: number;
  durationMs: number;
  paused: boolean;
  videoId: string | null;
  textTrack: TextTrackInfo | null;
}

/** Where to download the subtitle file being shown (captured from Netflix's manifest). */
export interface SubtitleSource {
  videoId: string;
  trackId: string;
  language: string;
  url: string;
}

export interface BridgeMethods {
  seekBy(deltaMs: number): void;
  seek(timeMs: number): void;
  play(): void;
  pause(): void;
  getState(): PlayerState;
  getSubtitleSource(): SubtitleSource | null;
  getTitle(): TitleInfo | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));
const isNullableString = (value: unknown) => value === null || typeof value === 'string';

/** Bridge answers come from the page; check their shape before trusting them. */
export function parseSubtitleSource(value: unknown): SubtitleSource | null {
  if (!isRecord(value)) return null;
  const { videoId, trackId, language, url } = value;
  if (typeof videoId !== 'string' || typeof trackId !== 'string' || typeof language !== 'string') return null;
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  return { videoId, trackId, language, url };
}

export function parseTitleInfo(value: unknown): TitleInfo | null {
  if (!isRecord(value)) return null;
  const v = value;
  if (typeof v.videoId !== 'string' || (v.kind !== 'episode' && v.kind !== 'movie')) return null;
  if (typeof v.seriesTitle !== 'string' || !v.seriesTitle) return null;
  if (!isNullableString(v.seriesId) || !isNullableString(v.episodeTitle)) return null;
  if (!isNullableNumber(v.seasonNumber) || !isNullableNumber(v.episodeNumber)) return null;
  return {
    videoId: v.videoId,
    kind: v.kind,
    seriesId: v.seriesId as string | null,
    seriesTitle: v.seriesTitle,
    seasonNumber: v.seasonNumber as number | null,
    episodeNumber: v.episodeNumber as number | null,
    episodeTitle: v.episodeTitle as string | null,
  };
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
