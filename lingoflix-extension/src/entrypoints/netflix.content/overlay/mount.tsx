import { createShadowRootUi, type ContentScriptContext } from '#imports';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PLAYER_CONTAINER_SELECTOR } from '@/lib/netflix/selectors';
import { isolateEvents } from './isolate';
import './overlay.css';

export interface OverlayHandle {
  /** True when the event target is LingoFlix's overlay host or a node inside its shadow root. */
  contains(target: EventTarget | null): boolean;
  /** The player container's viewport rect (the card stays inside it). */
  playerRect(): DOMRect | null;
  remove(): void;
}

/**
 * Mounts the React overlay in a shadow root inside Netflix's player container (spec §5.3: visible in
 * fullscreen), and follows the container as Netflix adds, replaces, or removes it (spec §8.5).
 */
export async function mountOverlay(ctx: ContentScriptContext, app: ReactNode): Promise<OverlayHandle> {
  let host: HTMLElement | null = null;
  let anchor: Element | null = null;
  const ui = await createShadowRootUi<{ root: Root; release: () => void }>(ctx, {
    name: 'lingoflix-overlay',
    position: 'inline',
    anchor: PLAYER_CONTAINER_SELECTOR,
    append: 'last',
    onMount(container, _shadow, shadowHost) {
      host = shadowHost;
      anchor = shadowHost.parentElement;
      const release = isolateEvents(shadowHost);
      const root = createRoot(container);
      root.render(app);
      return { root, release };
    },
    onRemove(mounted) {
      mounted?.release();
      mounted?.root.unmount();
      host = null;
      anchor = null;
    },
  });
  /**
   * Netflix swaps its player container for a new one while the player loads. WXT's autoMount mounts
   * again only once the selector stops matching, which a swap never does, so the overlay would leave
   * with the old container: follow the container itself.
   */
  const follow = () => {
    const player = document.querySelector(PLAYER_CONTAINER_SELECTOR);
    // Not a bare parent check: a host and a container both gone in one tick would compare null to null.
    if (host?.isConnected && host.parentElement === player) return;
    if (host) ui.remove();
    if (player) ui.mount();
  };
  const observer = new MutationObserver(follow);
  observer.observe(document, { childList: true, subtree: true });
  ctx.onInvalidated(() => observer.disconnect());
  follow();
  return {
    contains: (target) =>
      !!host && target instanceof Node && (target === host || host.contains(target) || !!host.shadowRoot?.contains(target)),
    playerRect: () => (anchor?.isConnected ? anchor.getBoundingClientRect() : null),
    remove: () => {
      observer.disconnect();
      ui.remove();
    },
  };
}
