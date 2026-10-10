// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeyboardHandlers, type KeyboardDeps } from '@/entrypoints/netflix.content/keyboard';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

const teardowns: (() => void)[] = [];
afterEach(() => {
  while (teardowns.length) teardowns.pop()!();
  document.body.innerHTML = '';
});

function setup(overrides: Partial<KeyboardDeps> = {}) {
  const handlers = { rewind: vi.fn(), forward: vi.fn(), toggleSubtitles: vi.fn() };
  const state: { settings: Settings | null; watch: boolean } = { settings: DEFAULT_SETTINGS, watch: true };
  const { onKeyDown, onKeyUp } = createKeyboardHandlers({
    getSettings: () => state.settings,
    isWatchPage: () => state.watch,
    handlers,
    ...overrides,
  });
  // LingoFlix listens on window, capture phase — exactly as index.ts registers it.
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  // Stand-in for Netflix's own key handling.
  const netflix = vi.fn();
  document.addEventListener('keydown', netflix);
  document.addEventListener('keyup', netflix);
  teardowns.push(() => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keyup', onKeyUp, { capture: true });
    document.removeEventListener('keydown', netflix);
    document.removeEventListener('keyup', netflix);
  });

  const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
    target.dispatchEvent(down);
    target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, composed: true, ...init }));
    return down;
  };
  return { handlers, netflix, state, press };
}

describe('keyboard shortcuts', () => {
  it('runs the bound action and hides the key from Netflix', () => {
    const { handlers, netflix, press } = setup();
    const down = press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).toHaveBeenCalledTimes(1);
    expect(down.defaultPrevented).toBe(true);
    expect(netflix).not.toHaveBeenCalled(); // neither keydown nor keyup reached Netflix
  });

  it('passes unbound keys through to Netflix', () => {
    const { handlers, netflix, press } = setup();
    const down = press({ code: 'KeyJ', key: 'j' });
    expect(Object.values(handlers).every((h) => h.mock.calls.length === 0)).toBe(true);
    expect(down.defaultPrevented).toBe(false);
    expect(netflix).toHaveBeenCalledTimes(2);
  });

  it('lets modified combos through (e.g. ⌘← for browser back)', () => {
    const { handlers, netflix, press } = setup();
    press({ code: 'ArrowLeft', key: 'ArrowLeft', metaKey: true });
    press({ code: 'KeyC', key: 'c', ctrlKey: true });
    expect(handlers.rewind).not.toHaveBeenCalled();
    expect(handlers.toggleSubtitles).not.toHaveBeenCalled();
    expect(netflix).toHaveBeenCalledTimes(4);
  });

  it('fires with an IME active (key is "Process", code is physical)', () => {
    const { handlers, press } = setup();
    press({ code: 'KeyC', key: 'Process' });
    expect(handlers.toggleSubtitles).toHaveBeenCalledTimes(1);
  });

  it('ignores keys typed into inputs, including inside an open shadow root', () => {
    const { handlers, netflix, press } = setup();
    const host = document.createElement('div');
    document.body.append(host);
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(input);
    press({ code: 'ArrowLeft', key: 'ArrowLeft' }, input);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    press({ code: 'KeyC', key: 'c' }, textarea);
    expect(handlers.rewind).not.toHaveBeenCalled();
    expect(handlers.toggleSubtitles).not.toHaveBeenCalled();
    expect(netflix).toHaveBeenCalledTimes(4);
  });

  it('re-checks the watch page on every key (browse → watch without reload)', () => {
    const { handlers, netflix, state, press } = setup();
    state.watch = false;
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).not.toHaveBeenCalled();
    expect(netflix).toHaveBeenCalledTimes(2);
    state.watch = true;
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled or before settings load', () => {
    const { handlers, state, press } = setup();
    state.settings = { ...DEFAULT_SETTINGS, enabled: false };
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    state.settings = null;
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).not.toHaveBeenCalled();
  });

  it('auto-repeat: seeking repeats, the subtitle toggle does not', () => {
    const { handlers, press } = setup();
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    press({ code: 'ArrowLeft', key: 'ArrowLeft', repeat: true });
    expect(handlers.rewind).toHaveBeenCalledTimes(2);
    press({ code: 'KeyC', key: 'c' });
    const repeated = press({ code: 'KeyC', key: 'c', repeat: true });
    expect(handlers.toggleSubtitles).toHaveBeenCalledTimes(1);
    expect(repeated.defaultPrevented).toBe(true); // still swallowed, so Netflix doesn't see it either
  });

  it('falls through to Netflix when an action is unavailable', () => {
    const { handlers, netflix, press } = setup({ isActionAvailable: (a) => a !== 'rewind' });
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).not.toHaveBeenCalled();
    expect(netflix).toHaveBeenCalledTimes(2);
  });

  it('falls through when a bound action has no handler', () => {
    const netflixHandlers = { rewind: vi.fn() };
    const { netflix, press } = setup({ handlers: netflixHandlers });
    press({ code: 'KeyC', key: 'c' });
    expect(netflix).toHaveBeenCalledTimes(2);
  });

  it('a handler returning false lets that press through to Netflix (keydown and keyup)', () => {
    const { netflix, press } = setup({ handlers: { rewind: () => false } });
    const down = press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(down.defaultPrevented).toBe(false);
    expect(netflix).toHaveBeenCalledTimes(2);
  });

  it('swallows again as soon as the handler succeeds (no lock-out after a failure)', () => {
    let succeeds = false;
    const rewind = vi.fn(() => succeeds);
    const { netflix, press } = setup({ handlers: { rewind } });
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    succeeds = true;
    const down = press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(rewind).toHaveBeenCalledTimes(2);
    expect(down.defaultPrevented).toBe(true);
    expect(netflix).toHaveBeenCalledTimes(2); // only the failed press reached Netflix
  });

  it('uses remapped keys', () => {
    const { handlers, netflix, state, press } = setup();
    state.settings = {
      ...DEFAULT_SETTINGS,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, rewind: { code: 'KeyJ', ctrl: false, alt: false, shift: false, meta: false } },
    };
    press({ code: 'KeyJ', key: 'j' });
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).toHaveBeenCalledTimes(1);
    expect(netflix).toHaveBeenCalledTimes(2); // ArrowLeft is no longer ours
  });
});
