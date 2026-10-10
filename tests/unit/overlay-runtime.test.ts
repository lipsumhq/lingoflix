// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOverlayRuntime } from '@/entrypoints/netflix.content/overlay/runtime';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

afterEach(() => vi.useRealTimers());

const LINE = { left: 100, top: 500, right: 400, bottom: 560 } as DOMRect;
const INSIDE = {} as EventTarget;
const OUTSIDE = {} as EventTarget;

function setup(over: Partial<Settings> = {}) {
  vi.useFakeTimers();
  let open: 'hover' | 'shortcut' | null = null;
  const order: string[] = [];
  const explain = {
    open: vi.fn((by: 'hover' | 'shortcut') => {
      open = by;
      return true;
    }),
    close: vi.fn(() => {
      order.push('close');
      open = null;
    }),
    isOpen: () => open !== null,
    openedBy: () => open,
  };
  const pause = { pause: vi.fn(), forget: vi.fn(() => order.push('forget')) };
  const settings: Settings = { ...DEFAULT_SETTINGS, ...over };
  const runtime = createOverlayRuntime({
    explain,
    pause,
    getSettings: () => settings,
    isWatchPage: () => true,
    subtitleRects: () => [LINE],
    cardElement: () => null,
    isInOverlay: (t) => t === INSIDE,
    schedule: (fn) => fn(),
  });
  const move = (x: number, y: number) => runtime.onMouseMove({ clientX: x, clientY: y } as MouseEvent);
  return { runtime, explain, pause, move, order };
}

describe('overlay runtime', () => {
  it('hovering a line pauses, explains after 400 ms, and closes 300 ms after leaving', () => {
    const { explain, pause, move } = setup();
    move(200, 530);
    expect(pause.pause).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(explain.open).toHaveBeenCalledWith('hover');
    move(10, 10);
    vi.advanceTimersByTime(300);
    expect(explain.close).toHaveBeenCalledTimes(1);
  });

  it('with Pause on hover off, explains without pausing', () => {
    const { explain, pause, move } = setup({ pauseOnHover: false });
    move(200, 530);
    vi.advanceTimersByTime(400);
    expect(pause.pause).not.toHaveBeenCalled();
    expect(explain.open).toHaveBeenCalledWith('hover');
  });

  it('hover does nothing while subtitles are hidden or LingoFlix is off', () => {
    for (const over of [{ subtitlesHidden: true }, { enabled: false }]) {
      const { explain, pause, move } = setup(over);
      move(200, 530);
      vi.advanceTimersByTime(1000);
      expect(pause.pause).not.toHaveBeenCalled();
      expect(explain.open).not.toHaveBeenCalled();
    }
  });

  it('the Explain shortcut opens for the current line; pressing it again closes', () => {
    const { runtime, explain, pause } = setup();
    expect(runtime.explainShortcut()).toBe(true);
    expect(pause.pause).toHaveBeenCalled();
    expect(explain.open).toHaveBeenCalledWith('shortcut');
    runtime.explainShortcut();
    expect(explain.close).toHaveBeenCalledTimes(1);
  });

  it('Escape closes an open card and keeps the key from Netflix', () => {
    const { runtime, explain } = setup();
    const idle = new KeyboardEvent('keydown', { code: 'Escape', cancelable: true });
    expect(runtime.onKeyDown(idle)).toBe(false);
    runtime.explainShortcut();
    const esc = new KeyboardEvent('keydown', { code: 'Escape', cancelable: true });
    expect(runtime.onKeyDown(esc)).toBe(true);
    expect(esc.defaultPrevented).toBe(true);
    expect(explain.close).toHaveBeenCalled();
  });

  it('a click outside closes a shortcut card; a click inside does not', () => {
    const { runtime, explain } = setup();
    runtime.explainShortcut();
    runtime.onPointerDown({ composedPath: () => [INSIDE] } as unknown as Event);
    expect(explain.close).not.toHaveBeenCalled();
    runtime.onPointerDown({ composedPath: () => [OUTSIDE] } as unknown as Event);
    expect(explain.close).toHaveBeenCalledTimes(1);
  });

  it('after closing with a key, hover waits until the pointer leaves the line', () => {
    const { runtime, explain, move } = setup();
    move(200, 530);
    vi.advanceTimersByTime(400);
    runtime.explainShortcut(); // closes the hover card
    move(210, 530);
    vi.advanceTimersByTime(1000);
    expect(explain.open).toHaveBeenCalledTimes(1);
    move(10, 10);
    move(200, 530);
    vi.advanceTimersByTime(400);
    expect(explain.open).toHaveBeenCalledTimes(2);
  });

  it('a new video forgets the pause before closing, so the old video is not resumed', () => {
    const { runtime, order } = setup();
    runtime.onVideoChange();
    expect(order).toEqual(['forget', 'close']);
  });
});
