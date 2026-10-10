// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createController } from '@/entrypoints/netflix.content/controller';
import { SUBTITLES_HIDDEN_ATTR } from '@/entrypoints/netflix.content/subtitle-visibility';
import type { BridgeResult } from '@/lib/bridge/client';
import { BridgeError } from '@/lib/bridge/protocol';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

const teardowns: (() => void)[] = [];
afterEach(() => {
  while (teardowns.length) teardowns.pop()!();
  document.documentElement.removeAttribute(SUBTITLES_HIDDEN_ATTR);
});

function setup(initial: Settings = DEFAULT_SETTINGS) {
  const state = {
    seekResult: { ok: true, result: undefined } as BridgeResult<void>,
    valid: true,
    stored: initial,
  };
  const bridge = { callSync: vi.fn((..._args: unknown[]) => state.seekResult) };
  const notifier = { show: vi.fn(), showOnce: vi.fn(), dispose: vi.fn() };
  const updateSettings = vi.fn(async (fn: (s: Settings) => Settings) => (state.stored = fn(state.stored)));
  const controller = createController({
    doc: document,
    bridge: bridge as never,
    notifier,
    updateSettings,
    isWatchPage: () => true,
    getVideoId: () => '82028220',
    isValid: () => state.valid,
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
  return { controller, bridge, notifier, updateSettings, netflix, state, press };
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
});
