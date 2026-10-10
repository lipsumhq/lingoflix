// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pointInRects } from '@/entrypoints/netflix.content/overlay/hit-test';
import { createHoverTracker } from '@/entrypoints/netflix.content/overlay/hover';
import { isolateEvents } from '@/entrypoints/netflix.content/overlay/isolate';
import { mountOverlay } from '@/entrypoints/netflix.content/overlay/mount';
import { createPauseGuard } from '@/entrypoints/netflix.content/overlay/pause';

interface FakeUiOptions {
  onMount(container: HTMLElement, shadow: ShadowRoot, host: HTMLElement): unknown;
  onRemove?(mounted: unknown): void;
}

// A stand-in for WXT's shadow-root UI: an open shadow root on a host appended to <body>. WXT's Vitest
// plugin rewrites `#imports` to this module, so this is the path to mock.
vi.mock('wxt/utils/content-script-ui/shadow-root', () => ({
  createShadowRootUi: async (_ctx: unknown, options: FakeUiOptions) => {
    const host = document.createElement('lingoflix-overlay');
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.append(container);
    let mounted: unknown;
    return {
      autoMount() {
        document.body.append(host);
        mounted = options.onMount(container, shadow, host);
      },
      remove() {
        options.onRemove?.(mounted);
        host.remove();
      },
    };
  },
}));

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('pointInRects', () => {
  const rect = { left: 100, top: 500, right: 400, bottom: 560 } as DOMRect;
  it('hits inside the subtitle text, padded by 8 px', () => {
    expect(pointInRects(200, 530, [rect])).toBe(true);
    expect(pointInRects(93, 530, [rect])).toBe(true);
    expect(pointInRects(91, 530, [rect])).toBe(false);
    expect(pointInRects(200, 569, [rect])).toBe(false);
    expect(pointInRects(200, 530, [])).toBe(false);
  });
});

describe('hover tracker (spec §5.3 steps 2–4)', () => {
  function setup() {
    vi.useFakeTimers();
    const calls: string[] = [];
    const tracker = createHoverTracker({
      onEnter: () => calls.push('enter'),
      onDwell: () => calls.push('dwell'),
      onLeave: () => calls.push('leave'),
    });
    return { tracker, calls };
  }

  it('pauses on entering, explains after 400 ms on the line', () => {
    const { tracker, calls } = setup();
    tracker.update(true, false);
    expect(calls).toEqual(['enter']);
    vi.advanceTimersByTime(399);
    expect(calls).toEqual(['enter']);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['enter', 'dwell']);
    expect(tracker.phase()).toBe('open');
  });

  it('keeps the card while the pointer travels from line to card within 300 ms', () => {
    const { tracker, calls } = setup();
    tracker.update(true, false);
    vi.advanceTimersByTime(400);
    tracker.update(false, false); // in the gap between line and card
    vi.advanceTimersByTime(250);
    tracker.update(false, true); // on the card
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(['enter', 'dwell']);
  });

  it('closes 300 ms after leaving both line and card', () => {
    const { tracker, calls } = setup();
    tracker.update(true, false);
    vi.advanceTimersByTime(400);
    tracker.update(false, false);
    vi.advanceTimersByTime(299);
    expect(calls).toEqual(['enter', 'dwell']);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['enter', 'dwell', 'leave']);
    expect(tracker.phase()).toBe('idle');
  });

  it('leaving before the dwell never explains, but still resumes', () => {
    const { tracker, calls } = setup();
    tracker.update(true, false);
    vi.advanceTimersByTime(200);
    tracker.update(false, false);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(['enter', 'leave']);
  });

  it('reset forgets the hover without calling back', () => {
    const { tracker, calls } = setup();
    tracker.update(true, false);
    tracker.reset();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(['enter']);
    expect(tracker.phase()).toBe('idle');
  });
});

describe('pause guard (spec §5.3 steps 2 and 5)', () => {
  function bridgeWith(paused: boolean) {
    const calls: string[] = [];
    const bridge = {
      callSync: vi.fn((method: string) => {
        calls.push(method);
        return method === 'getState' ? { ok: true, result: { paused } } : { ok: true, result: null };
      }),
    };
    return { bridge: bridge as never, calls };
  }

  it('pauses a playing video and resumes it afterwards', () => {
    const { bridge, calls } = bridgeWith(false);
    const guard = createPauseGuard(bridge);
    guard.pause();
    guard.pause(); // no double pause
    guard.resume();
    guard.resume(); // no double play
    expect(calls).toEqual(['getState', 'pause', 'play']);
  });

  it('never resumes a video the user had paused', () => {
    const { bridge, calls } = bridgeWith(true);
    const guard = createPauseGuard(bridge);
    guard.pause();
    guard.resume();
    expect(calls).toEqual(['getState']);
  });

  it('forget() drops the promise to resume', () => {
    const { bridge, calls } = bridgeWith(false);
    const guard = createPauseGuard(bridge);
    guard.pause();
    guard.forget();
    guard.resume();
    expect(calls).toEqual(['getState', 'pause']);
  });
});

describe('isolateEvents', () => {
  it('keys and clicks inside the overlay never reach Netflix, but LingoFlix still sees keys first', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('textarea');
    const button = document.createElement('button');
    shadow.append(input, button);
    isolateEvents(host);

    const netflix = vi.fn();
    const lingoflixCapture = vi.fn();
    for (const type of ['keydown', 'keyup', 'click', 'pointerdown', 'dblclick']) document.addEventListener(type, netflix);
    window.addEventListener('keydown', lingoflixCapture, { capture: true });

    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, composed: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, composed: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));

    expect(netflix).not.toHaveBeenCalled();
    expect(lingoflixCapture).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', lingoflixCapture, { capture: true });
  });
});

describe('mountOverlay', () => {
  it('contains() sees the host and the nodes inside its shadow root', async () => {
    const handle = await mountOverlay({} as never, null);
    const host = document.querySelector('lingoflix-overlay')!;
    const button = document.createElement('button');
    host.shadowRoot!.append(button);
    expect(handle.contains(host)).toBe(true);
    expect(handle.contains(button)).toBe(true);
    expect(handle.contains(document.body)).toBe(false);
    expect(handle.contains(null)).toBe(false);

    // What the runtime's window capture listener sees for a press on the card.
    let target: EventTarget | null = null;
    const listener = (event: Event) => (target = event.composedPath()[0] ?? null);
    window.addEventListener('pointerdown', listener, { capture: true });
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    window.removeEventListener('pointerdown', listener, { capture: true });
    expect(target).toBe(button);
    expect(handle.contains(target)).toBe(true);

    handle.remove();
    expect(handle.contains(button)).toBe(false);
  });
});
