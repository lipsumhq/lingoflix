// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { titleFromDom, titleFromMetadata } from '@/lib/netflix/title';

afterEach(() => {
  document.body.innerHTML = '';
});

const SHOW = {
  title: 'Stranger Things',
  type: 'show',
  id: 80057281,
  currentEpisode: 80077211,
  seasons: [
    { seq: 1, episodes: [{ id: 80077209, seq: 1, title: 'The Vanishing of Will Byers' }, { id: 80077211, seq: 3, title: 'Holly, Jolly' }] },
  ],
};

describe('titleFromMetadata', () => {
  it('finds the series, season, and episode of the video being watched', () => {
    expect(titleFromMetadata(SHOW, '80077211')).toEqual({
      videoId: '80077211',
      kind: 'episode',
      seriesId: '80057281',
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      episodeTitle: 'Holly, Jolly',
    });
  });

  it('a movie is its own title', () => {
    expect(titleFromMetadata({ title: 'Roma', type: 'movie', id: 80240715 }, '80240715')).toEqual({
      videoId: '80240715',
      kind: 'movie',
      seriesId: null,
      seriesTitle: 'Roma',
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null,
    });
  });

  it('a show whose episode list lacks the video still names the series', () => {
    expect(titleFromMetadata(SHOW, '999')).toMatchObject({ kind: 'episode', seriesTitle: 'Stranger Things', seasonNumber: null });
  });

  it('returns null for missing or unexpected metadata', () => {
    expect(titleFromMetadata(undefined, '1')).toBeNull();
    expect(titleFromMetadata({ type: 'show' }, '1')).toBeNull();
  });
});

describe('titleFromDom', () => {
  it("reads the player's title block: series, S:E label, episode title", () => {
    document.body.innerHTML =
      '<div data-uia="video-title"><h4>Stranger Things</h4><span>S1:E3</span><span>Holly, Jolly</span></div>';
    expect(titleFromDom(document, '80077211')).toEqual({
      videoId: '80077211',
      kind: 'episode',
      seriesId: null,
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      episodeTitle: 'Holly, Jolly',
    });
  });

  it('a single-season show shows only "E1"', () => {
    document.body.innerHTML = '<div data-uia="video-title"><h4>A Different World</h4><span>E1</span><span>Pilot</span></div>';
    expect(titleFromDom(document, '1')).toMatchObject({ seasonNumber: null, episodeNumber: 1, episodeTitle: 'Pilot' });
  });

  it('a movie title has no heading', () => {
    document.body.innerHTML = '<div data-uia="video-title">Roma</div>';
    expect(titleFromDom(document, '2')).toMatchObject({ kind: 'movie', seriesTitle: 'Roma' });
  });

  it('returns null when the title block is not on the page', () => {
    expect(titleFromDom(document, '1')).toBeNull();
  });
});
