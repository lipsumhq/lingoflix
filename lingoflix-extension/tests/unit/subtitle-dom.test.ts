// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDisplayedSubtitle, watchSubtitles } from '@/entrypoints/netflix.content/subtitle-dom';

afterEach(() => {
  document.body.innerHTML = '';
});

const layer = (...lines: string[]) =>
  `<div class="player-timedtext">${lines
    .map((l) => `<div class="player-timedtext-text-container"><span>${l}</span></div>`)
    .join('')}</div>`;

describe('subtitle DOM', () => {
  it('reads the text of every text container, one per line, with their rects', () => {
    document.body.innerHTML = layer('Hello.', 'Who is it?');
    const shown = readDisplayedSubtitle(document);
    expect(shown.text).toBe('Hello.\nWho is it?');
    expect(shown.rects).toHaveLength(2);
    document.body.innerHTML = '<div class="player-timedtext"></div>';
    expect(readDisplayedSubtitle(document)).toEqual({ text: '', rects: [] });
  });

  it('reports text changes (not identical re-renders) and follows a replaced or removed layer', async () => {
    const seen: string[] = [];
    const stop = watchSubtitles(document, (s) => seen.push(s.text));
    document.body.innerHTML = layer('One');
    await vi.waitFor(() => expect(seen).toEqual(['One']));
    document.querySelector('span')!.textContent = 'One';
    document.querySelector('.player-timedtext')!.innerHTML =
      '<div class="player-timedtext-text-container"><span>Two</span></div>';
    await vi.waitFor(() => expect(seen).toEqual(['One', 'Two']));
    document.body.innerHTML = layer('Three');
    await vi.waitFor(() => expect(seen).toEqual(['One', 'Two', 'Three']));
    document.body.innerHTML = '';
    await vi.waitFor(() => expect(seen).toEqual(['One', 'Two', 'Three', '']));
    stop();
  });
});
