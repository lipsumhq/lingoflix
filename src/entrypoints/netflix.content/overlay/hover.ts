export type HoverPhase = 'idle' | 'hovering' | 'open';

export interface HoverTrackerDeps {
  /** Pointer entered a subtitle line (spec §5.3 step 2: pause). */
  onEnter(): void;
  /** Pointer stayed on the line long enough (step 3: explain). */
  onDwell(): void;
  /** Pointer left line and card for the grace period (steps 4–5: close and resume). */
  onLeave(): void;
  dwellMs?: number;
  graceMs?: number;
  setTimer?(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer?(handle: ReturnType<typeof setTimeout>): void;
}

export interface HoverTracker {
  /** Report where the pointer is: on the subtitle line and/or on the card. */
  update(onLine: boolean, onCard: boolean): void;
  /** Forget the current hover without calling back (e.g. the card was closed another way). */
  reset(): void;
  phase(): HoverPhase;
}

export const HOVER_DWELL_MS = 400;
export const HOVER_GRACE_MS = 300;

export function createHoverTracker(deps: HoverTrackerDeps): HoverTracker {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
  let phase: HoverPhase = 'idle';
  let dwell: ReturnType<typeof setTimeout> | null = null;
  let grace: ReturnType<typeof setTimeout> | null = null;

  const stop = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer !== null) clearTimer(timer);
    return null;
  };

  return {
    update(onLine, onCard) {
      if (onLine || onCard) {
        grace = stop(grace);
        if (phase === 'idle' && onLine) {
          phase = 'hovering';
          deps.onEnter();
        }
        if (phase === 'hovering' && onLine && dwell === null) {
          dwell = setTimer(() => {
            dwell = null;
            phase = 'open';
            deps.onDwell();
          }, deps.dwellMs ?? HOVER_DWELL_MS);
        }
        return;
      }
      dwell = stop(dwell); // the dwell counts only while the pointer stays on the line
      if (phase !== 'idle' && grace === null) {
        grace = setTimer(() => {
          grace = null;
          dwell = stop(dwell);
          phase = 'idle';
          deps.onLeave();
        }, deps.graceMs ?? HOVER_GRACE_MS);
      }
    },
    reset() {
      dwell = stop(dwell);
      grace = stop(grace);
      phase = 'idle';
    },
    phase: () => phase,
  };
}
