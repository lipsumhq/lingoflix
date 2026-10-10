import type { CapturedManifest } from '@/lib/netflix/manifest';
import { titleFromDom, titleFromMetadata } from '@/lib/netflix/title';
import { BridgeError, type BridgeMethods, type PlayerState, type TextTrackInfo } from './protocol';

/**
 * The part of Netflix's internal player LingoFlix uses (docs/netflix-internals.md, row 2). Times are ms.
 * `seek()` and `getSegmentTime()` count from the start of the episode; `getCurrentTime()` and `getDuration()`
 * also count any lead-in Netflix plays before it (7007 ms when an episode starts from the beginning).
 */
export interface NetflixPlayer {
  seek(timeMs: number): void;
  play(): void;
  pause(): void;
  getCurrentTime(): number;
  getSegmentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
  getMovieId?(): number | string | undefined;
  getTimedTextTrack?(): unknown;
}

const REQUIRED_PLAYER_METHODS = [
  'seek',
  'play',
  'pause',
  'getCurrentTime',
  'getSegmentTime',
  'getDuration',
  'isPaused',
] as const;

interface NetflixVideoPlayerApi {
  getAllPlayerSessionIds(): string[];
  getVideoPlayerBySessionId(id: string): NetflixPlayer | undefined;
}

interface NetflixGlobal {
  appContext?: { state?: { playerApp?: { getAPI?(): { videoPlayer?: NetflixVideoPlayerApi } | undefined } } };
}

function unavailable(message: string): never {
  throw new BridgeError('player-unavailable', message);
}

/**
 * Finds the player for the video being watched. Only `watch-*` sessions count (others are previews);
 * among them, the one playing `videoId` wins, else the newest. Anything missing or renamed by Netflix
 * is reported as player-unavailable so callers can fall back to Netflix's own keys.
 */
export function findPlayer(netflix: unknown, videoId: string | null = null): NetflixPlayer {
  let api: NetflixVideoPlayerApi | undefined;
  let players: NetflixPlayer[];
  try {
    api = (netflix as NetflixGlobal | undefined)?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    if (!api) return unavailable('Netflix player API not found');
    players = api
      .getAllPlayerSessionIds()
      .filter((id) => id.startsWith('watch'))
      .map((id) => api!.getVideoPlayerBySessionId(id))
      .filter((p): p is NetflixPlayer => !!p);
  } catch (err) {
    if (err instanceof BridgeError) throw err;
    return unavailable(`Netflix player API changed: ${String(err)}`);
  }
  const player = players.find((p) => videoId !== null && String(p.getMovieId?.()) === videoId) ?? players.at(-1);
  if (!player) return unavailable('No active Netflix watch session');
  for (const method of REQUIRED_PLAYER_METHODS) {
    if (typeof player[method] !== 'function') unavailable(`Netflix player has no ${method}()`);
  }
  return player;
}

/** Seeks stay this far from the end so Netflix doesn't roll over to the next episode. */
export const END_GUARD_MS = 1000;

export function clampTime(timeMs: number, durationMs: number): number {
  const max = Math.max(0, durationMs - END_GUARD_MS);
  return Math.min(max, Math.max(0, Math.round(timeMs)));
}

function requireFinite(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BridgeError('bad-request', `${name} must be a finite number`);
  }
  return value;
}

/** Position and duration of the episode itself, in the clock `seek()` takes (the lead-in left out). */
function episodeTimes(p: NetflixPlayer): { currentMs: number; durationMs: number } {
  const currentMs = p.getSegmentTime();
  const leadInMs = Math.max(0, p.getCurrentTime() - currentMs);
  return { currentMs, durationMs: p.getDuration() - leadInMs };
}

/** Episode position and duration, or player-unavailable while Netflix is still loading. */
function readyTimes(p: NetflixPlayer): { currentMs: number; durationMs: number } {
  const { currentMs, durationMs } = episodeTimes(p);
  if (!Number.isFinite(currentMs) || !Number.isFinite(durationMs) || durationMs <= END_GUARD_MS) {
    unavailable('Netflix player is not ready');
  }
  return { currentMs, durationMs };
}

/** Where the bridge reads subtitle files and titles (wired to Netflix in netflix-bridge.content.ts). */
export interface PlayerSources {
  /** `player` is the one the bridge found, so the manifest can be read from its memory. */
  getManifest(movieId: string, player: NetflixPlayer): CapturedManifest | undefined;
  getMetadataVideo(videoId: string): unknown;
  getDocument(): Document | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface MetadataGlobal {
  appContext?: {
    state?: {
      playerApp?: {
        getState?(): { videoPlayer?: { videoMetadata?: Record<string, { _metadataObject?: { video?: unknown } } | undefined> } };
      };
    };
  };
}

/** `playerApp.getState().videoPlayer.videoMetadata[videoId]._metadataObject.video` (docs/netflix-internals.md row 4). */
export function metadataVideoFrom(netflix: unknown, videoId: string): unknown {
  try {
    return (netflix as MetadataGlobal | undefined)?.appContext?.state?.playerApp?.getState?.()?.videoPlayer?.videoMetadata?.[videoId]
      ?._metadataObject?.video;
  } catch {
    return undefined;
  }
}

function readTextTrack(p: NetflixPlayer): TextTrackInfo | null {
  try {
    const t = p.getTimedTextTrack?.();
    if (!isRecord(t) || (typeof t.trackId !== 'string' && typeof t.trackId !== 'number')) return null;
    return {
      trackId: String(t.trackId),
      language: typeof t.bcp47 === 'string' ? t.bcp47 : '',
      isImageBased: t.isImageBased === true,
      isNone: t.isNoneTrack === true,
    };
  } catch {
    return null;
  }
}

export function createPlayerMethods(
  getPlayer: () => NetflixPlayer,
  getVideoId: () => string | null,
  sources?: PlayerSources,
): BridgeMethods {
  return {
    seekBy(deltaMs) {
      requireFinite(deltaMs, 'deltaMs');
      const p = getPlayer();
      const { currentMs, durationMs } = readyTimes(p);
      p.seek(clampTime(currentMs + deltaMs, durationMs));
    },
    seek(timeMs) {
      requireFinite(timeMs, 'timeMs');
      const p = getPlayer();
      const { durationMs } = readyTimes(p);
      p.seek(clampTime(timeMs, durationMs));
    },
    play() {
      getPlayer().play();
    },
    pause() {
      getPlayer().pause();
    },
    getState(): PlayerState {
      const p = getPlayer();
      const { currentMs, durationMs } = episodeTimes(p);
      return {
        currentTimeMs: currentMs,
        durationMs,
        paused: p.isPaused(),
        videoId: getVideoId(),
        textTrack: readTextTrack(p),
      };
    },
    getSubtitleSource() {
      const videoId = getVideoId();
      const player = getPlayer();
      const track = readTextTrack(player);
      if (!videoId || !track || track.isNone || track.isImageBased || !sources) return null;
      const captured = sources.getManifest(videoId, player)?.tracks.find((t) => t.ids.includes(track.trackId));
      const url = captured?.urls[0];
      if (!captured || !url) return null;
      return { videoId, trackId: track.trackId, language: track.language || captured.language, url };
    },
    getTitle() {
      const videoId = getVideoId();
      if (!videoId || !sources) return null;
      const doc = sources.getDocument();
      return titleFromMetadata(sources.getMetadataVideo(videoId), videoId) ?? (doc ? titleFromDom(doc, videoId) : null);
    },
  };
}
