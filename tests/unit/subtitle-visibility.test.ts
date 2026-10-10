// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { SUBTITLES_HIDDEN_ATTR, applySubtitlesHidden } from '@/entrypoints/netflix.content/subtitle-visibility';
import { SUBTITLE_LAYER_SELECTOR } from '@/lib/netflix/selectors';

afterEach(() => {
  document.documentElement.removeAttribute(SUBTITLES_HIDDEN_ATTR);
  document.getElementById('lingoflix-subtitle-visibility')?.remove();
});

describe('applySubtitlesHidden', () => {
  it('marks <html> and installs one hiding rule for the subtitle layer', () => {
    applySubtitlesHidden(document, true);
    applySubtitlesHidden(document, true);
    expect(document.documentElement.getAttribute(SUBTITLES_HIDDEN_ATTR)).toBe('hidden');
    const styles = document.querySelectorAll('#lingoflix-subtitle-visibility');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(
      `html[${SUBTITLES_HIDDEN_ATTR}="hidden"] ${SUBTITLE_LAYER_SELECTOR} { opacity: 0 !important; }`,
    );
  });

  it('removes the mark when shown again', () => {
    applySubtitlesHidden(document, true);
    applySubtitlesHidden(document, false);
    expect(document.documentElement.hasAttribute(SUBTITLES_HIDDEN_ATTR)).toBe(false);
  });
});
