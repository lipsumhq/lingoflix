// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createController } from '@/entrypoints/netflix.content/controller';
import type { ExplainShortcutResult } from '@/entrypoints/netflix.content/overlay/runtime';
import { SUBTITLES_HIDDEN_ATTR } from '@/entrypoints/netflix.content/subtitle-visibility';
import type { BridgeResult } from '@/lib/bridge/client';
import { BridgeError } from '@/lib/bridge/protocol';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';
import type { ObservedLine } from '@/lib/subtitles/history';

const teardowns: (() => void)[] = [];
afterEach(() => {
  while (teardowns.length) teardowns.pop()!();
  document.documentElement.removeAttribute(SUBTITLES_HIDDEN_ATTR);
});

function setup(
  initial: Settings = DEFAULT_SETTINGS,
  overlay?: { explainShortcut(): ExplainShortcutResult; onKeyDown(e: KeyboardEvent): boolean },
) {
  const state = {
    seekResult: { ok: true, result: undefined } as BridgeResult<void>,
    valid: true,
    stored: initial,
  };
  const bridge = { callSync: vi.fn((..._args: unknown[]) => state.seekResult) };
  const notifier = { show: vi.fn(), showOnce: vi.fn(), dispose: vi.fn() };
  const updateSettings = vi.fn(async (fn: (s: Settings) => Settings) => (state.stored = fn(state.stored)));
  const session = {
    currentLine: vi.fn((): ObservedLine | null => null),
    describe: vi.fn((line: ObservedLine) => ({
      context: { before: [], after: [] },
      timing: line.shownAtMs === null ? null : { startMs: line.shownAtMs - 300, endMs: null },
      fromTrack: false,
    })),
    lineTarget: vi.fn((_direction: 'previous' | 'next'): number | null => null),
  };
  const controller = createController({
    doc: document,
    bridge: bridge as never,
    notifier,
    session,
    updateSettings,
    isWatchPage: () => true,
    getVideoId: () => '82028220',
    isValid: () => state.valid,
    overlay,
  });
  controller.applySettings(initial);

  window.addEventListener('keydown', controller.onKeyDown, { capture: true });
  window.addEventListener('keyup', controller.onKeyUp, { capture: true });
  const netflix = vi.fn();
  document.addEventListener('keydown', netflix);
  document.addEventListener('keyup', netflix);
  teardowns.push(() => {
    window.removeEventListener('keydown', controller.onKeyDown, { capture: true });
    window.removeEventListener('keyup', controller.onKeyUp, { capture: true });
    document.removeEventListener('keydown', netflix);
    document.removeEventListener('keyup', netflix);
  });

  const press = (code: string, key = code) => {
    const init = { code, key, bubbles: true, cancelable: true, composed: true };
    const down = new KeyboardEvent('keydown', init);
    document.body.dispatchEvent(down);
    document.body.dispatchEvent(new KeyboardEvent('keyup', init));
    return down;
  };
  return { controller, bridge, notifier, session, updateSettings, netflix, state, press };
}

const unavailable: BridgeResult<void> = {
  ok: false,
  error: new BridgeError('player-unavailable', 'Netflix player API not found'),
};

describe('content controller', () => {
  it('seeks by the configured seconds through the bridge and hides the key from Netflix', () => {
    const { bridge, netflix, press } = setup({ ...DEFAULT_SETTINGS, rewindSeconds: 3, forwardSeconds: 7 });
    press('ArrowLeft');
    press('ArrowRight');
    expect(bridge.callSync.mock.calls).toEqual([
      ['seekBy', -3_000],
      ['seekBy', 7_000],
    ]);
    expect(netflix).not.toHaveBeenCalled();
  });

  it("gives the key to Netflix and explains once per video when the player can't be reached", () => {
    const { netflix, notifier, state, press } = setup();
    state.seekResult = unavailable;
    const down = press('ArrowLeft');
    press('ArrowRight');
    expect(down.defaultPrevented).toBe(false);
    expect(netflix).toHaveBeenCalledTimes(4);
    expect(notifier.showOnce).toHaveBeenCalledWith('player-unavailable:82028220', expect.stringContaining('LingoFlix'));
  });

  it('takes the key back on the very next press once the player is reachable (no lock-out)', () => {
    const { netflix, state, press } = setup();
    state.seekResult = unavailable;
    press('ArrowLeft');
    state.seekResult = { ok: true, result: undefined };
    const down = press('ArrowLeft');
    expect(down.defaultPrevented).toBe(true);
    expect(netflix).toHaveBeenCalledTimes(2);
  });

  it('C persists the toggle, hides the subtitle layer, and says so', async () => {
    const { updateSettings, notifier, state, press } = setup();
    press('KeyC', 'c');
    expect(updateSettings).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(document.documentElement.getAttribute(SUBTITLES_HIDDEN_ATTR)).toBe('hidden'),
    );
    expect(state.stored.subtitlesHidden).toBe(true);
    expect(notifier.show).toHaveBeenCalledWith('Subtitles hidden', 1200);
  });

  it('shows subtitles while LingoFlix is disabled, even if they were toggled hidden', () => {
    const { controller } = setup({ ...DEFAULT_SETTINGS, subtitlesHidden: true });
    expect(document.documentElement.getAttribute(SUBTITLES_HIDDEN_ATTR)).toBe('hidden');
    controller.applySettings({ ...DEFAULT_SETTINGS, subtitlesHidden: true, enabled: false });
    expect(document.documentElement.hasAttribute(SUBTITLES_HIDDEN_ATTR)).toBe(false);
  });

  it('after the extension is reloaded or disabled, keys go to Netflix and hidden subtitles come back', () => {
    const { bridge, netflix, notifier, state, press } = setup({ ...DEFAULT_SETTINGS, subtitlesHidden: true });
    state.valid = false;
    const down = press('ArrowLeft');
    expect(down.defaultPrevented).toBe(false);
    expect(bridge.callSync).not.toHaveBeenCalled();
    expect(netflix).toHaveBeenCalledTimes(2);
    expect(document.documentElement.hasAttribute(SUBTITLES_HIDDEN_ATTR)).toBe(false);
    expect(notifier.dispose).toHaveBeenCalled();
  });

  it('teardown restores the page and ignores later settings', () => {
    const { controller, notifier } = setup({ ...DEFAULT_SETTINGS, subtitlesHidden: true });
    controller.teardown();
    controller.teardown();
    expect(document.documentElement.hasAttribute(SUBTITLES_HIDDEN_ATTR)).toBe(false);
    expect(notifier.dispose).toHaveBeenCalledTimes(1);
    controller.applySettings({ ...DEFAULT_SETTINGS, subtitlesHidden: true });
    expect(document.documentElement.hasAttribute(SUBTITLES_HIDDEN_ATTR)).toBe(false);
  });

  it('Previous/Next line (A/D) seek to the start of that line', () => {
    const { bridge, session, press } = setup();
    session.lineTarget.mockImplementation((direction) => (direction === 'previous' ? 19_000 : 25_000));
    press('KeyA', 'a');
    press('KeyD', 'd');
    expect(bridge.callSync.mock.calls).toEqual([
      ['seek', 19_000],
      ['seek', 25_000],
    ]);
  });

  it('in One line mode, ← and → jump by line', () => {
    const { bridge, session, press } = setup({ ...DEFAULT_SETTINGS, rewindMode: 'line', forwardMode: 'line' });
    session.lineTarget.mockReturnValue(30_000);
    press('ArrowLeft');
    press('ArrowRight');
    expect(session.lineTarget.mock.calls).toEqual([['previous'], ['next']]);
    expect(bridge.callSync.mock.calls).toEqual([
      ['seek', 30_000],
      ['seek', 30_000],
    ]);
  });

  it('with no line to jump to, falls back to the Rewind/Forward seconds', () => {
    const { bridge, press } = setup({ ...DEFAULT_SETTINGS, rewindSeconds: 3, forwardSeconds: 7 });
    press('KeyA', 'a');
    press('KeyD', 'd');
    expect(bridge.callSync.mock.calls).toEqual([
      ['seekBy', -3_000],
      ['seekBy', 7_000],
    ]);
  });

  it('Replay line (R) seeks to the start of the current line and plays', () => {
    const { bridge, session, press } = setup();
    session.currentLine.mockReturnValue({ text: 'Hi', normalized: 'Hi', shownAtMs: 19_300, hiddenAtMs: null });
    press('KeyR', 'r');
    expect(bridge.callSync.mock.calls).toEqual([['seek', 19_000], ['play']]);
  });

  it('Replay with no line yet says so, does not seek, and keeps R from Netflix', () => {
    const { bridge, notifier, netflix, press } = setup();
    const down = press('KeyR', 'r');
    expect(bridge.callSync).not.toHaveBeenCalled();
    expect(notifier.show).toHaveBeenCalledWith('No subtitle line yet.', 2000);
    expect(down.defaultPrevented).toBe(true);
    expect(netflix).not.toHaveBeenCalled();
  });

  it('a line jump hands the key to Netflix when the player cannot be reached', () => {
    const { netflix, session, state, press } = setup();
    session.lineTarget.mockReturnValue(19_000);
    state.seekResult = unavailable;
    const down = press('KeyA', 'a');
    expect(down.defaultPrevented).toBe(false);
    expect(netflix).toHaveBeenCalledTimes(2);
  });

  it('Explain line (E) goes to the overlay; with no line it says so', () => {
    const overlay = { explainShortcut: vi.fn((): ExplainShortcutResult => 'no-line'), onKeyDown: vi.fn(() => false) };
    const { notifier, netflix, press } = setup(DEFAULT_SETTINGS, overlay);
    const down = press('KeyE', 'e');
    expect(overlay.explainShortcut).toHaveBeenCalledTimes(1);
    expect(notifier.show).toHaveBeenCalledWith('No subtitle line to explain yet.', 2000);
    expect(down.defaultPrevented).toBe(true);
    expect(netflix).not.toHaveBeenCalled();
  });

  it('Explain line (E) without a mounted overlay suggests reloading; opening or closing says nothing', () => {
    const overlay = { explainShortcut: vi.fn((): ExplainShortcutResult => 'no-overlay'), onKeyDown: vi.fn(() => false) };
    const { notifier, netflix, press } = setup(DEFAULT_SETTINGS, overlay);
    const down = press('KeyE', 'e');
    expect(notifier.show).toHaveBeenCalledWith("LingoFlix can't show its card on this page yet. Try reloading.", 3000);
    expect(down.defaultPrevented).toBe(true);
    expect(netflix).not.toHaveBeenCalled();
    for (const result of ['opened', 'closed'] as const) {
      overlay.explainShortcut.mockReturnValueOnce(result);
      press('KeyE', 'e');
    }
    expect(notifier.show).toHaveBeenCalledTimes(1);
  });

  it('the overlay sees every keydown first (Escape closes the card)', () => {
    const overlay = {
      explainShortcut: vi.fn((): ExplainShortcutResult => 'opened'),
      onKeyDown: vi.fn((e: KeyboardEvent) => e.code === 'Escape'),
    };
    const { bridge, press } = setup(DEFAULT_SETTINGS, overlay);
    press('Escape');
    press('ArrowLeft');
    expect(overlay.onKeyDown).toHaveBeenCalledTimes(2);
    expect(bridge.callSync.mock.calls).toEqual([['seekBy', -5_000]]);
  });
});
