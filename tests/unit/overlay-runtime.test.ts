// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOverlayRuntime } from '@/entrypoints/netflix.content/overlay/runtime';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
});

const LINE = { left: 100, top: 500, right: 400, bottom: 560 } as DOMRect;
const INSIDE = {} as EventTarget;
const OUTSIDE = {} as EventTarget;

function setup(over: Partial<Settings> = {}, isInOverlay: (target: EventTarget | null) => boolean = (t) => t === INSIDE) {
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
    isInOverlay,
    schedule: (fn) => fn(),
  });
  cleanups.push(() => runtime.teardown());
  const move = (x: number, y: number) => runtime.onMouseMove({ clientX: x, clientY: y } as MouseEvent);
  return { runtime, explain, pause, move, order };
}

const CLICK_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click'] as const;
const EVENT_INIT = { bubbles: true, cancelable: true, composed: true };

/** Wires the runtime like index.ts does (window, capture) and stands in for Netflix's listeners on document. */
function wireClicks(runtime: { onPointerDown(event: Event): void }) {
  const netflix = vi.fn((event: Event) => event.type);
  window.addEventListener('pointerdown', runtime.onPointerDown, { capture: true });
  for (const type of CLICK_EVENTS) document.addEventListener(type, netflix);
  cleanups.push(() => {
    window.removeEventListener('pointerdown', runtime.onPointerDown, { capture: true });
    for (const type of CLICK_EVENTS) document.removeEventListener(type, netflix);
  });
  const click = () => {
    const down = new PointerEvent('pointerdown', EVENT_INIT);
    document.body.dispatchEvent(down);
    document.body.dispatchEvent(new MouseEvent('mousedown', EVENT_INIT));
    document.body.dispatchEvent(new MouseEvent('mouseup', EVENT_INIT));
    document.body.dispatchEvent(new MouseEvent('click', EVENT_INIT));
    return down;
  };
  return { netflix, click };
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
    const pointerDown = (target: EventTarget) => ({
      composedPath: () => [target],
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    const inside = pointerDown(INSIDE);
    runtime.onPointerDown(inside as unknown as Event);
    expect(explain.close).not.toHaveBeenCalled();
    expect(inside.preventDefault).not.toHaveBeenCalled();
    const outside = pointerDown(OUTSIDE);
    runtime.onPointerDown(outside as unknown as Event);
    expect(explain.close).toHaveBeenCalledTimes(1);
    expect(outside.preventDefault).toHaveBeenCalled();
  });

  it('a click outside a shortcut card closes it and never reaches Netflix', () => {
    const { runtime, explain } = setup();
    const { netflix, click } = wireClicks(runtime);
    runtime.explainShortcut();
    const down = click();
    expect(explain.close).toHaveBeenCalledTimes(1);
    expect(down.defaultPrevented).toBe(true);
    expect(netflix).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent('click', EVENT_INIT));
    expect(netflix).toHaveBeenCalledTimes(1); // the swallow is one-shot
  });

  it('a press that never becomes a click stops being swallowed after 1 s', () => {
    const { runtime, explain } = setup();
    const { netflix } = wireClicks(runtime);
    runtime.explainShortcut();
    document.body.dispatchEvent(new PointerEvent('pointerdown', EVENT_INIT));
    document.body.dispatchEvent(new MouseEvent('mousedown', EVENT_INIT));
    document.body.dispatchEvent(new MouseEvent('mouseup', EVENT_INIT)); // a drag: no click follows
    expect(explain.close).toHaveBeenCalledTimes(1);
    expect(netflix).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    document.body.dispatchEvent(new MouseEvent('click', EVENT_INIT));
    expect(netflix.mock.results.map((r) => r.value)).toEqual(['click']);
  });

  it('a click inside the card, or with no shortcut card open, is left alone', () => {
    const inCard = setup({}, (target) => target === document.body);
    const card = wireClicks(inCard.runtime);
    inCard.runtime.explainShortcut();
    const insideDown = card.click();
    expect(inCard.explain.close).not.toHaveBeenCalled();
    expect(insideDown.defaultPrevented).toBe(false);
    expect(card.netflix.mock.results.map((r) => r.value)).toEqual([...CLICK_EVENTS]);

    for (const openHoverCard of [false, true]) {
      while (cleanups.length) cleanups.pop()!(); // unwire the previous scenario
      const other = setup();
      const wired = wireClicks(other.runtime);
      if (openHoverCard) {
        other.move(200, 530);
        vi.advanceTimersByTime(400);
        expect(other.explain.open).toHaveBeenCalledWith('hover');
      }
      const down = wired.click();
      expect(other.explain.close).not.toHaveBeenCalled();
      expect(down.defaultPrevented).toBe(false);
      expect(wired.netflix.mock.results.map((r) => r.value)).toEqual([...CLICK_EVENTS]);
    }
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
