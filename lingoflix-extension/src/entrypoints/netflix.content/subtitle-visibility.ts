import { SUBTITLE_LAYER_SELECTOR } from '@/lib/netflix/selectors';

/** An attribute (not a class) so Netflix rewriting <html class> can't drop it. */
export const SUBTITLES_HIDDEN_ATTR = 'data-lingoflix-subtitles';
const STYLE_ID = 'lingoflix-subtitle-visibility';

export function applySubtitlesHidden(doc: Document, hidden: boolean): void {
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `html[${SUBTITLES_HIDDEN_ATTR}="hidden"] ${SUBTITLE_LAYER_SELECTOR} { opacity: 0 !important; }`;
    (doc.head ?? doc.documentElement).append(style);
  }
  if (hidden) doc.documentElement.setAttribute(SUBTITLES_HIDDEN_ATTR, 'hidden');
  else doc.documentElement.removeAttribute(SUBTITLES_HIDDEN_ATTR);
}
