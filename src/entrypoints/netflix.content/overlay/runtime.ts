import type { Settings } from '@/lib/settings';
import type { ExplainController } from './explain-controller';
import { pointInRects } from './hit-test';
import { createHoverTracker } from './hover';
import type { PauseGuard } from './pause';

export interface OverlayRuntimeDeps {
  explain: Pick<ExplainController, 'open' | 'close' | 'isOpen' | 'openedBy'>;
  pause: Pick<PauseGuard, 'pause' | 'forget'>;
  getSettings(): Settings | null;
  isWatchPage(): boolean;
  /** The overlay is mounted in the player, so a card would be seen. */
  overlayReady(): boolean;
  subtitleRects(): readonly Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[];
  cardElement(): HTMLElement | null;
  isInOverlay(target: EventTarget | null): boolean;
  /** Defaults to requestAnimationFrame (one hit-test per frame). */
  schedule?(fn: () => void): void;
}

/** What the Explain shortcut did. */
export type ExplainShortcutResult = 'opened' | 'closed' | 'no-line' | 'no-overlay';

export interface OverlayRuntime {
  onMouseMove(event: MouseEvent): void;
  /** Register on window in the capture phase: a click outside a shortcut card closes it and is consumed. */
  onPointerDown(event: Event): void;
  /** Escape closes an open card. True when it handled the key. */
  onKeyDown(event: KeyboardEvent): boolean;
  /**
   * Explain line shortcut: opens a card for the current line, or closes the open one. Does nothing while the
   * overlay isn't mounted (no pause, no request for a card nobody would see).
   */
  explainShortcut(): ExplainShortcutResult;
  /** The card's Close button: closes like Escape (hover waits until the pointer leaves the line). */
  closeCard(): void;
  /** Settings changed: if hover is now off (spec §5.2 hidden subtitles), a hover card closes at once. */
  onSettingsChanged(): void;
  /** Spec §8.5: a new video closes the card without resuming the old one. */
  onVideoChange(): void;
  teardown(): void;
}

/** How long the rest of a dismissing click is swallowed, so a press that never becomes a click can't eat a later one. */
const SWALLOW_CLICK_MS = 1000;
const CLICK_REST = ['mousedown', 'mouseup', 'click'] as const;

/** Spec §5.3: hover and shortcut behavior around the explanation card. */
export function createOverlayRuntime(deps: OverlayRuntimeDeps): OverlayRuntime {
  const schedule = deps.schedule ?? ((fn: () => void) => void requestAnimationFrame(() => fn()));
  let x = 0;
  let y = 0;
  let queued = false;
  /** After a card is closed with a key or a click, hover waits until the pointer has left the line. */
  let waitForLeave = false;
  let stopSwallowing: (() => void) | null = null;

  /**
   * The click that dismisses a shortcut card is consumed, like a modal's: otherwise it would also reach
   * Netflix, which toggles playback on a click over the video, undoing the resume (spec §5.3 step 5).
   */
  const swallowRestOfClick = () => {
    stopSwallowing?.();
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'click') stop();
    };
    const timer = setTimeout(() => stop(), SWALLOW_CLICK_MS);
    const stop = () => {
      clearTimeout(timer);
      for (const type of CLICK_REST) window.removeEventListener(type, swallow, { capture: true });
      if (stopSwallowing === stop) stopSwallowing = null;
    };
    for (const type of CLICK_REST) window.addEventListener(type, swallow, { capture: true });
    stopSwallowing = stop;
  };

  /** Hover can explain lines: LingoFlix is on, subtitles are shown, this is a watch page, and the overlay is mounted. */
  const hoverAllowed = () => {
    const s = deps.getSettings();
    return !!s?.enabled && !s.subtitlesHidden && deps.isWatchPage() && deps.overlayReady();
  };
  const hoverEnabled = () => hoverAllowed() && deps.explain.openedBy() !== 'shortcut';

  const hover = createHoverTracker({
    onEnter: () => {
      if (deps.getSettings()?.pauseOnHover) deps.pause.pause();
    },
    onDwell: () => {
      if (hoverEnabled()) deps.explain.open('hover');
      else stopHover();
    },
    onLeave: () => deps.explain.close(),
  });

  /**
   * Hover was turned off while in use (e.g. subtitles hidden): forget the hover and close its card, which
   * also resumes playback if the hover paused it. A shortcut card stays open.
   */
  const stopHover = () => {
    const hovering = hover.phase() !== 'idle';
    hover.reset();
    if (deps.explain.openedBy() === 'hover' || (hovering && !deps.explain.isOpen())) deps.explain.close();
  };

  const stopHoverIfOff = () => {
    if (deps.explain.openedBy() !== 'shortcut' && !hoverAllowed()) stopHover();
  };

  const check = () => {
    queued = false;
    if (!hoverEnabled()) return stopHoverIfOff();
    const onLine = pointInRects(x, y, deps.subtitleRects());
    const card = deps.cardElement();
    const onCard = !!card && pointInRects(x, y, [card.getBoundingClientRect()], 0);
    if (waitForLeave) {
      if (onLine || onCard) return;
      waitForLeave = false;
    }
    hover.update(onLine, onCard);
  };

  const closeByUser = () => {
    hover.reset();
    deps.explain.close();
    waitForLeave = true;
  };

  return {
    onMouseMove(event) {
      x = event.clientX;
      y = event.clientY;
      if (queued) return;
      queued = true;
      schedule(check);
    },
    onPointerDown(event) {
      if (deps.explain.openedBy() !== 'shortcut') return;
      if (deps.isInOverlay(event.composedPath()[0] ?? null)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeByUser();
      swallowRestOfClick();
    },
    onKeyDown(event) {
      if (event.code !== 'Escape' || !deps.explain.isOpen()) return false;
      if (event.isComposing || event.keyCode === 229) return false; // the IME cancels its conversion
      event.preventDefault();
      event.stopImmediatePropagation(); // Netflix would also leave fullscreen
      closeByUser();
      return true;
    },
    explainShortcut() {
      if (deps.explain.isOpen()) {
        closeByUser();
        return 'closed';
      }
      if (!deps.overlayReady()) return 'no-overlay';
      hover.reset();
      if (deps.getSettings()?.pauseOnHover) deps.pause.pause();
      if (deps.explain.open('shortcut')) return 'opened';
      deps.explain.close(); // resumes if we just paused
      return 'no-line';
    },
    closeCard: closeByUser,
    onSettingsChanged: stopHoverIfOff,
    onVideoChange() {
      hover.reset();
      waitForLeave = false;
      deps.pause.forget();
      deps.explain.close();
    },
    teardown() {
      hover.reset();
      stopSwallowing?.();
      deps.explain.close();
    },
  };
}
