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
  subtitleRects(): readonly Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[];
  cardElement(): HTMLElement | null;
  isInOverlay(target: EventTarget | null): boolean;
  /** Defaults to requestAnimationFrame (one hit-test per frame). */
  schedule?(fn: () => void): void;
}

export interface OverlayRuntime {
  onMouseMove(event: MouseEvent): void;
  onPointerDown(event: Event): void;
  /** Escape closes an open card. True when it handled the key. */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Explain line shortcut: opens a card for the current line, or closes the open one. False when there is no line. */
  explainShortcut(): boolean;
  /** Spec §8.5: a new video closes the card without resuming the old one. */
  onVideoChange(): void;
  teardown(): void;
}

/** Spec §5.3: hover and shortcut behavior around the explanation card. */
export function createOverlayRuntime(deps: OverlayRuntimeDeps): OverlayRuntime {
  const schedule = deps.schedule ?? ((fn: () => void) => void requestAnimationFrame(() => fn()));
  let x = 0;
  let y = 0;
  let queued = false;
  /** After a card is closed with a key or a click, hover waits until the pointer has left the line. */
  let waitForLeave = false;

  const hover = createHoverTracker({
    onEnter: () => {
      if (deps.getSettings()?.pauseOnHover) deps.pause.pause();
    },
    onDwell: () => {
      deps.explain.open('hover');
    },
    onLeave: () => deps.explain.close(),
  });

  const hoverEnabled = () => {
    const s = deps.getSettings();
    return !!s?.enabled && !s.subtitlesHidden && deps.isWatchPage() && deps.explain.openedBy() !== 'shortcut';
  };

  const check = () => {
    queued = false;
    if (!hoverEnabled()) return;
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
      if (!deps.isInOverlay(event.composedPath()[0] ?? null)) closeByUser();
    },
    onKeyDown(event) {
      if (event.code !== 'Escape' || !deps.explain.isOpen()) return false;
      event.preventDefault();
      event.stopImmediatePropagation(); // Netflix would also leave fullscreen
      closeByUser();
      return true;
    },
    explainShortcut() {
      if (deps.explain.isOpen()) {
        closeByUser();
        return true;
      }
      hover.reset();
      if (deps.getSettings()?.pauseOnHover) deps.pause.pause();
      const opened = deps.explain.open('shortcut');
      if (!opened) deps.explain.close(); // resumes if we just paused
      return opened;
    },
    onVideoChange() {
      hover.reset();
      waitForLeave = false;
      deps.pause.forget();
      deps.explain.close();
    },
    teardown() {
      hover.reset();
      deps.explain.close();
    },
  };
}
