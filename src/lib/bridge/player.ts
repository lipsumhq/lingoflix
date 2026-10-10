import { BridgeError, type BridgeMethods, type PlayerState } from './protocol';

/** The part of Netflix's internal player LingoFlix uses (docs/netflix-internals.md, row 2). Times are ms. */
export interface NetflixPlayer {
  seek(timeMs: number): void;
  play(): void;
  pause(): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
}

interface NetflixVideoPlayerApi {
  getAllPlayerSessionIds(): string[];
  getVideoPlayerBySessionId(id: string): NetflixPlayer | undefined;
}

interface NetflixGlobal {
  appContext?: { state?: { playerApp?: { getAPI?(): { videoPlayer?: NetflixVideoPlayerApi } | undefined } } };
}

export function findPlayer(netflix: unknown): NetflixPlayer {
  let api: NetflixVideoPlayerApi | undefined;
  try {
    api = (netflix as NetflixGlobal | undefined)?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  } catch {
    api = undefined;
  }
  if (!api) throw new BridgeError('player-unavailable', 'Netflix player API not found');
  const ids = api.getAllPlayerSessionIds();
  const id = ids.find((s) => s.startsWith('watch')) ?? ids[0];
  const player = id ? api.getVideoPlayerBySessionId(id) : undefined;
  if (!player) throw new BridgeError('player-unavailable', 'No active Netflix player session');
  return player;
}

/** Seeks stay this far from the end so Netflix doesn't roll over to the next episode. */
export const END_GUARD_MS = 1000;

export function clampTime(timeMs: number, durationMs: number): number {
  const max = Math.max(0, durationMs - END_GUARD_MS);
  return Math.min(max, Math.max(0, Math.round(timeMs)));
}

export function createPlayerMethods(getPlayer: () => NetflixPlayer, getVideoId: () => string | null): BridgeMethods {
  return {
    seekBy(deltaMs) {
      const p = getPlayer();
      p.seek(clampTime(p.getCurrentTime() + deltaMs, p.getDuration()));
    },
    seek(timeMs) {
      const p = getPlayer();
      p.seek(clampTime(timeMs, p.getDuration()));
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
