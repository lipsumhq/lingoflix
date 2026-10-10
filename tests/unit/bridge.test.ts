import { afterEach, describe, expect, it } from 'vitest';
import { createBridgeClient, type BridgeClient } from '@/lib/bridge/client';
import { END_GUARD_MS, clampTime, createPlayerMethods, findPlayer, type NetflixPlayer } from '@/lib/bridge/player';
import { BRIDGE_REQUEST_EVENT, BRIDGE_RESPONSE_EVENT, BridgeError, decode, encode } from '@/lib/bridge/protocol';
import { serveBridge } from '@/lib/bridge/server';

class FakePlayer implements NetflixPlayer {
  constructor(
    public time = 60_000,
    public duration = 1_200_000,
    public paused = false,
    public movieId?: number,
  ) {}
  seek(t: number) {
    this.time = t;
  }
  play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  getCurrentTime() {
    return this.time;
  }
  getDuration() {
    return this.duration;
  }
  isPaused() {
    return this.paused;
  }
  getMovieId() {
    return this.movieId;
  }
}

function expectUnavailable(fn: () => unknown) {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(BridgeError);
  expect((error as BridgeError).code).toBe('player-unavailable');
}

function fakeNetflix(players: Record<string, NetflixPlayer>) {
  return {
    appContext: {
      state: {
        playerApp: {
          getAPI: () => ({
            videoPlayer: {
              getAllPlayerSessionIds: () => Object.keys(players),
              getVideoPlayerBySessionId: (id: string) => players[id],
            },
          }),
        },
      },
    },
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function connect(netflixRef: { current: unknown }, videoId: string | null = '81091396'): BridgeClient {
  const target = new EventTarget();
  const stop = serveBridge(
    target,
    createPlayerMethods(
      () => findPlayer(netflixRef.current, videoId),
      () => videoId,
    ),
  );
  const client = createBridgeClient(target, 50);
  cleanups.push(stop, () => client.dispose());
  return client;
}

describe('protocol encoding', () => {
  it('round-trips through a JSON string and rejects junk', () => {
    expect(decode(encode({ a: 1 }))).toEqual({ a: 1 });
    expect(decode('{not json')).toBeNull();
    expect(decode({ a: 1 })).toBeNull();
  });
});

describe('findPlayer', () => {
  it('prefers the session whose id starts with "watch"', () => {
    const preview = new FakePlayer(1);
    const main = new FakePlayer(2);
    expect(findPlayer(fakeNetflix({ 'motion-billboard-1': preview, 'watch-abc': main }))).toBe(main);
  });

  it('throws player-unavailable when Netflix internals are missing', () => {
    for (const netflix of [undefined, {}, { appContext: { state: {} } }, fakeNetflix({})]) {
      expect(() => findPlayer(netflix)).toThrowError(BridgeError);
      try {
        findPlayer(netflix);
      } catch (e) {
        expect((e as BridgeError).code).toBe('player-unavailable');
      }
    }
  });

  it('throws player-unavailable when getAPI itself throws', () => {
    const broken = { appContext: { state: { playerApp: { getAPI: () => { throw new Error('boom'); } } } } };
    expect(() => findPlayer(broken)).toThrowError(/player/i);
  });

  it('never falls back to a non-watch session (e.g. a billboard preview)', () => {
    expectUnavailable(() => findPlayer(fakeNetflix({ 'motion-billboard-1': new FakePlayer() })));
  });

  it('prefers the watch session playing the video in the URL', () => {
    const stale = new FakePlayer(1, 1_000_000, false, 111);
    const current = new FakePlayer(2, 1_000_000, false, 222);
    expect(findPlayer(fakeNetflix({ 'watch-a': stale, 'watch-b': current }), '222')).toBe(current);
    expect(findPlayer(fakeNetflix({ 'watch-b': current, 'watch-a': stale }), '222')).toBe(current);
  });

  it('falls back to the newest watch session when none matches the URL', () => {
    const older = new FakePlayer(1);
    const newer = new FakePlayer(2);
    expect(findPlayer(fakeNetflix({ 'watch-a': older, 'watch-b': newer }), '999')).toBe(newer);
  });

  it('throws player-unavailable when the player lacks a required method (Netflix renamed it)', () => {
    for (const method of ['seek', 'play', 'pause', 'getCurrentTime', 'getDuration', 'isPaused']) {
      const player = new FakePlayer();
      (player as unknown as Record<string, unknown>)[method] = undefined;
      expectUnavailable(() => findPlayer(fakeNetflix({ 'watch-1': player })));
    }
  });

  it('throws player-unavailable when the session API changed shape', () => {
    const renamed = {
      appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: { getSessionIds: () => ['watch-1'] } }) } } },
    };
    expectUnavailable(() => findPlayer(renamed));
  });
});

describe('clampTime', () => {
  it('clamps seeks to [0, duration - END_GUARD_MS]', () => {
    expect(clampTime(-5_000, 100_000)).toBe(0);
    expect(clampTime(50_000.4, 100_000)).toBe(50_000);
    expect(clampTime(200_000, 100_000)).toBe(100_000 - END_GUARD_MS);
    expect(clampTime(500, 800)).toBe(0); // duration shorter than the guard
  });
});

describe('bridge round trip', () => {
  it('returns player state', async () => {
    const player = new FakePlayer(90_000, 1_000_000, true);
    const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
    expect(await client.call('getState')).toEqual({
      currentTimeMs: 90_000,
      durationMs: 1_000_000,
      paused: true,
      videoId: '81091396',
    });
  });

  it('seekBy moves relative to the current time', async () => {
    const player = new FakePlayer(60_000);
    const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
    await client.call('seekBy', -5_000);
    expect(player.time).toBe(55_000);
    await client.call('seekBy', 10_000);
    expect(player.time).toBe(65_000);
  });

  it('clamps seeks near the start and the end', async () => {
    const player = new FakePlayer(2_000, 100_000);
    const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
    await client.call('seekBy', -5_000);
    expect(player.time).toBe(0);
    await client.call('seek', 99_900);
    expect(player.time).toBe(100_000 - END_GUARD_MS);
  });

  it('play and pause reach the player', async () => {
    const player = new FakePlayer(0, 100_000, false);
    const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
    await client.call('pause');
    expect(player.paused).toBe(true);
    await client.call('play');
    expect(player.paused).toBe(false);
  });

  it('re-resolves the player on every call (episode change without reload)', async () => {
    const first = new FakePlayer(10_000);
    const second = new FakePlayer(20_000);
    const ref: { current: unknown } = { current: fakeNetflix({ 'watch-1': first }) };
    const client = connect(ref);
    expect((await client.call('getState')).currentTimeMs).toBe(10_000);
    ref.current = fakeNetflix({ 'watch-2': second });
    expect((await client.call('getState')).currentTimeMs).toBe(20_000);
  });

  it('refuses to seek before the player knows its position and duration', async () => {
    for (const [time, duration] of [
      [60_000, 0],
      [Number.NaN, 1_000_000],
      [60_000, Number.NaN],
    ] as const) {
      const player = new FakePlayer(time, duration);
      const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
      await expect(client.call('seekBy', 5_000)).rejects.toMatchObject({ code: 'player-unavailable' });
      await expect(client.call('seek', 5_000)).rejects.toMatchObject({ code: 'player-unavailable' });
      expect(player.time).toBe(time);
    }
  });

  it('rejects non-finite seek arguments', async () => {
    const player = new FakePlayer(60_000);
    const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
    await expect(client.call('seekBy', Number.NaN)).rejects.toMatchObject({ code: 'bad-request' });
    await expect(client.call('seek', Number.POSITIVE_INFINITY)).rejects.toMatchObject({ code: 'bad-request' });
    expect(player.time).toBe(60_000);
  });

  it('rejects with player-unavailable when Netflix has no player', async () => {
    const client = connect({ current: undefined });
    await expect(client.call('seekBy', 1000)).rejects.toMatchObject({ code: 'player-unavailable' });
  });

  it('rejects with timeout when no bridge answers', async () => {
    const client = createBridgeClient(new EventTarget(), 20);
    cleanups.push(() => client.dispose());
    await expect(client.call('getState')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('answers unknown or inherited method names with bad-request', async () => {
    const target = new EventTarget();
    cleanups.push(serveBridge(target, createPlayerMethods(() => new FakePlayer(), () => null)));
    const responses: unknown[] = [];
    target.addEventListener(BRIDGE_RESPONSE_EVENT, (e) => responses.push(decode((e as CustomEvent).detail)));
    for (const method of ['explode', 'toString']) {
      target.dispatchEvent(
        new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: encode({ id: method, method, args: [] }) }),
      );
    }
    expect(responses).toEqual([
      { id: 'explode', ok: false, code: 'bad-request', message: 'Unknown method explode' },
      { id: 'toString', ok: false, code: 'bad-request', message: 'Unknown method toString' },
    ]);
  });
});

describe('callSync', () => {
  it('returns the result within the same call, because DOM event dispatch is synchronous', () => {
    const player = new FakePlayer(60_000);
    const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
    expect(client.callSync('seekBy', -5_000)).toEqual({ ok: true, result: null });
    expect(player.time).toBe(55_000);
    const state = client.callSync('getState');
    expect(state.ok && state.result.currentTimeMs).toBe(55_000);
  });

  it('reports the bridge error code', () => {
    const client = connect({ current: undefined });
    const res = client.callSync('seekBy', 1_000);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toBeInstanceOf(BridgeError);
    expect(!res.ok && res.error.code).toBe('player-unavailable');
  });

  it('reports timeout immediately when no bridge is listening', () => {
    const client = createBridgeClient(new EventTarget(), 20);
    cleanups.push(() => client.dispose());
    const res = client.callSync('getState');
    expect(!res.ok && res.error.code).toBe('timeout');
  });
});
