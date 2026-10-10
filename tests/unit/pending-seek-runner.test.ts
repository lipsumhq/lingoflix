import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPendingSeek } from '@/entrypoints/netflix.content/pending-seek-runner';

afterEach(() => vi.useRealTimers());

function player(videoId = '80077211') {
  const state = { ready: false, timeMs: 0, videoId, seeks: [] as number[] };
  const bridge = {
    callSync: vi.fn((method: string, ...args: unknown[]) => {
      if (method === 'getState') {
        return state.ready
          ? { ok: true, result: { currentTimeMs: state.timeMs, durationMs: 1_000_000, paused: false, videoId: state.videoId, textTrack: null } }
          : { ok: false, error: { code: 'player-unavailable' } };
      }
      if (method === 'seek') {
        if (!state.ready) return { ok: false, error: { code: 'player-unavailable' } };
        state.timeMs = args[0] as number;
        state.seeks.push(args[0] as number);
        return { ok: true, result: null };
      }
      return { ok: true, result: null };
    }),
  };
  return { state, bridge: bridge as never };
}

describe('runPendingSeek (Open at this moment)', () => {
  it('seeks to the saved moment once the player for that video is ready', async () => {
    vi.useFakeTimers();
    const { state, bridge } = player();
    runPendingSeek('80077211', { take: async () => 1_834_200, bridge });
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.seeks).toEqual([]);
    state.ready = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(state.seeks).toEqual([1_834_200]);
  });

  it('seeks again once if Netflix jumps to its own resume point', async () => {
    vi.useFakeTimers();
    const { state, bridge } = player();
    state.ready = true;
    runPendingSeek('80077211', { take: async () => 1_834_200, bridge });
    await vi.advanceTimersByTimeAsync(0);
    state.timeMs = 600_000; // Netflix's bookmark
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.seeks).toEqual([1_834_200, 1_834_200]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.seeks).toHaveLength(2);
  });

  it('does nothing when nothing is pending for this video', async () => {
    vi.useFakeTimers();
    const { state, bridge } = player();
    state.ready = true;
    runPendingSeek('80077211', { take: async () => null, bridge });
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.seeks).toEqual([]);
  });

  it('keeps trying through a slow load (the pending seek lives 2 minutes)', async () => {
    vi.useFakeTimers();
    const slow = player();
    runPendingSeek('80077211', { take: async () => 5000, bridge: slow.bridge });
    await vi.advanceTimersByTimeAsync(31_000);
    slow.state.ready = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(slow.state.seeks).toEqual([5000]);
  });

  it('gives up after 2 minutes, and cancelling stops it', async () => {
    vi.useFakeTimers();
    const slow = player();
    runPendingSeek('80077211', { take: async () => 5000, bridge: slow.bridge });
    await vi.advanceTimersByTimeAsync(121_000);
    slow.state.ready = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(slow.state.seeks).toEqual([]);

    const cancelled = player();
    const cancel = runPendingSeek('80077211', { take: async () => 5000, bridge: cancelled.bridge });
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    cancelled.state.ready = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(cancelled.state.seeks).toEqual([]);
  });
});
