export interface Notifier {
  show(message: string, durationMs?: number): void;
  showOnce(key: string, message: string): void;
  /** Remove the notice from the page. */
  dispose(): void;
}

const HOST_ID = 'lingoflix-notice-host';

const STYLE = `
  .box {
    position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
    max-width: min(560px, calc(100vw - 32px)); padding: 10px 16px; border-radius: 8px;
    background: rgba(20, 20, 20, 0.92); color: #fff; font: 500 15px/1.4 system-ui, sans-serif;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); pointer-events: none;
    opacity: 0; transition: opacity 0.15s;
  }
  .box.visible { opacity: 1; }
`;

export function createNotifier(doc: Document): Notifier {
  const shownKeys = new Set<string>();
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const getBox = (): HTMLElement => {
    // Mount inside the fullscreen element when there is one, so the notice stays visible.
    const parent = doc.fullscreenElement ?? doc.body ?? doc.documentElement;
    let host = doc.getElementById(HOST_ID);
    if (!host) {
      host = doc.createElement('div');
      host.id = HOST_ID;
      const shadow = host.attachShadow({ mode: 'open' });
      const style = doc.createElement('style');
      style.textContent = STYLE;
      const box = doc.createElement('div');
      box.className = 'box';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      shadow.append(style, box);
    }
    if (host.parentElement !== parent) parent.append(host);
    return host.shadowRoot!.querySelector('.box') as HTMLElement;
  };

  const show = (message: string, durationMs = 5000) => {
    const box = getBox();
    box.textContent = message;
    box.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => box.classList.remove('visible'), durationMs);
  };

  return {
    show,
    showOnce(key, message) {
      if (shownKeys.has(key)) return;
      shownKeys.add(key);
      show(message);
    },
    dispose() {
      clearTimeout(hideTimer);
      doc.getElementById(HOST_ID)?.remove();
    },
  };
}
