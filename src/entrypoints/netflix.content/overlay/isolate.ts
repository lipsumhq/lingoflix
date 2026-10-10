/**
 * Events stopped at the overlay's shadow host on their way out, so Netflix never sees typing in the
 * follow-up box (spec §5.4) or clicks on the card (Netflix toggles playback on click, fullscreen on
 * double-click). LingoFlix's own window capture listener still runs first. `mousemove` is not stopped:
 * the hover engine needs it.
 */
export const ISOLATED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'wheel',
  'contextmenu',
] as const;

export function isolateEvents(host: HTMLElement): () => void {
  const stop = (event: Event) => event.stopPropagation();
  for (const type of ISOLATED_EVENTS) host.addEventListener(type, stop);
  return () => {
    for (const type of ISOLATED_EVENTS) host.removeEventListener(type, stop);
  };
}
