import { BridgeError, type BridgeMethods, type PlayerState } from './protocol';

/** The part of Netflix's internal player LingoFlix uses (docs/netflix-internals.md, row 2). Times are ms. */
export interface NetflixPlayer {
  seek(timeMs: number): void;
  play(): void;
  pause(): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
  getMovieId?(): number | string | undefined;
}

const REQUIRED_PLAYER_METHODS = ['seek', 'play', 'pause', 'getCurrentTime', 'getDuration', 'isPaused'] as const;

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

/** Current position and duration, or player-unavailable while Netflix is still loading. */
function readyTimes(p: NetflixPlayer): { currentMs: number; durationMs: number } {
  const currentMs = p.getCurrentTime();
  const durationMs = p.getDuration();
  if (!Number.isFinite(currentMs) || !Number.isFinite(durationMs) || durationMs <= END_GUARD_MS) {
    unavailable('Netflix player is not ready');
  }
  return { currentMs, durationMs };
}

export function createPlayerMethods(getPlayer: () => NetflixPlayer, getVideoId: () => string | null): BridgeMethods {
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
      return {
        currentTimeMs: p.getCurrentTime(),
        durationMs: p.getDuration(),
        paused: p.isPaused(),
        videoId: getVideoId(),
      };
    },
  };
}
