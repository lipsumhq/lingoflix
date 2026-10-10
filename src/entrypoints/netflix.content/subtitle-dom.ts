import { SUBTITLE_LAYER_SELECTOR, SUBTITLE_TEXT_SELECTOR } from '@/lib/netflix/selectors';

export interface DisplayedSubtitle {
  /** Visible text, one container per line; "" when nothing is shown. */
  text: string;
  /** Viewport rects of the text containers (for hover hit-testing). */
  rects: DOMRect[];
}

export function readDisplayedSubtitle(doc: Document): DisplayedSubtitle {
  const containers = [...doc.querySelectorAll<HTMLElement>(SUBTITLE_TEXT_SELECTOR)];
  const text = containers
    .map((c) => (c.innerText || c.textContent || '').trim())
    .filter(Boolean)
    .join('\n');
  return { text, rects: text ? containers.map((c) => c.getBoundingClientRect()) : [] };
}

/**
 * Calls `onChange` when the displayed subtitle text changes. Watches Netflix's subtitle layer closely and
 * the page only for the layer being added, replaced, or removed.
 */
export function watchSubtitles(doc: Document, onChange: (subtitle: DisplayedSubtitle) => void): () => void {
  let layer: Element | null = null;
  let lastText = '';

  const emit = () => {
    const current = readDisplayedSubtitle(doc);
    if (current.text === lastText) return;
    lastText = current.text;
    onChange(current);
  };

  const layerObserver = new MutationObserver(emit);
  const bind = () => {
    const found = doc.querySelector(SUBTITLE_LAYER_SELECTOR);
    if (found !== layer) {
      layerObserver.disconnect();
      layer = found;
      if (layer) layerObserver.observe(layer, { childList: true, subtree: true, characterData: true });
    }
    emit();
  };

  const pageObserver = new MutationObserver(() => {
    if (!layer || !layer.isConnected) bind();
  });
  pageObserver.observe(doc.documentElement, { childList: true, subtree: true });
  bind();

  return () => {
    pageObserver.disconnect();
    layerObserver.disconnect();
  };
}
