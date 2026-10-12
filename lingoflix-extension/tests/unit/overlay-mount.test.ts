// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { mountOverlay, type OverlayHandle } from '@/entrypoints/netflix.content/overlay/mount';

// WXT's real shadow-root UI, not a stand-in: the overlay has to follow Netflix's own player container.

function netflixPlayer(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'watch-video';
  div.dataset.uia = 'watch-video';
  return div;
}

/** Lets the mutation observers (and WXT's own awaits) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const overlayIn = (root: ParentNode) => root.querySelector('lingoflix-overlay');

let ctx: ContentScriptContext;
let handle: OverlayHandle | null = null;

async function mount(): Promise<OverlayHandle> {
  ctx = new ContentScriptContext('netflix');
  handle = await mountOverlay(ctx, null);
  await settle();
  return handle;
}

afterEach(() => {
  handle?.remove();
  handle = null;
  ctx?.notifyInvalidated();
  document.body.innerHTML = '';
});

describe('mountOverlay', () => {
  it("mounts inside Netflix's player container", async () => {
    const player = netflixPlayer();
    document.body.append(player);
    const overlay = await mount();
    expect(overlayIn(player)).not.toBeNull();
    expect(overlay.playerRect()).not.toBeNull();
  });

  it('follows the player when Netflix swaps its container for a new one', async () => {
    const first = netflixPlayer();
    document.body.append(first);
    const overlay = await mount();

    const second = netflixPlayer();
    first.replaceWith(second); // one change: a player container matches throughout
    await settle();

    expect(overlayIn(second)).not.toBeNull();
    expect(overlayIn(first)).toBeNull();
    expect(overlay.playerRect()).not.toBeNull();
  });

  it('puts the overlay back when Netflix drops it from a container it keeps', async () => {
    const player = netflixPlayer();
    document.body.append(player);
    await mount();

    overlayIn(player)!.remove();
    await settle();

    expect(overlayIn(player)).not.toBeNull();
  });

  it('waits for a player, and leaves with it', async () => {
    const overlay = await mount();
    expect(overlayIn(document)).toBeNull();
    expect(overlay.playerRect()).toBeNull();

    const player = netflixPlayer();
    document.body.append(player);
    await settle();
    expect(overlayIn(player)).not.toBeNull();

    player.remove();
    await settle();
    expect(overlayIn(player)).toBeNull();
    expect(overlay.playerRect()).toBeNull();
  });

  it('stops following the player once removed, or once the extension is reloaded', async () => {
    document.body.append(netflixPlayer());
    const removed = await mount();
    removed.remove();
    document.body.replaceChildren(netflixPlayer());
    await settle();
    expect(overlayIn(document)).toBeNull();

    await mount();
    ctx.notifyInvalidated();
    document.body.replaceChildren(netflixPlayer());
    await settle();
    expect(overlayIn(document)).toBeNull();
  });

  it('contains() sees the host and the nodes inside its shadow root', async () => {
    document.body.append(netflixPlayer());
    const overlay = await mount();
    const host = overlayIn(document)!;
    const button = document.createElement('button');
    host.shadowRoot!.append(button);
    expect(overlay.contains(host)).toBe(true);
    expect(overlay.contains(button)).toBe(true);
    expect(overlay.contains(document.body)).toBe(false);
    expect(overlay.contains(null)).toBe(false);

    // What the runtime's window capture listener sees for a press on the card.
    let target: EventTarget | null = null;
    const listener = (event: Event) => (target = event.composedPath()[0] ?? null);
    window.addEventListener('pointerdown', listener, { capture: true });
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    window.removeEventListener('pointerdown', listener, { capture: true });
    expect(target).toBe(button);
    expect(overlay.contains(target)).toBe(true);

    overlay.remove();
    expect(overlay.contains(button)).toBe(false);
  });
});
