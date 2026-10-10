import { describe, expect, it } from 'vitest';
import { filterItems, newestFirst } from '@/lib/study-log/filter';
import { savedItemsLabel } from '@/lib/study-log/format';
import { groupStudyLog } from '@/lib/study-log/group';
import type { SavedItem } from '@/lib/study-log/types';

const item = (over: Partial<SavedItem>): SavedItem => ({
  id: 'x',
  type: 'word',
  text: 'gonna',
  meaning: 'going to',
  explanationId: null,
  line: "I'm gonna call it a night.",
  lineTimeMs: 0,
  context: { before: [], after: [] },
  videoId: 'v',
  kind: 'episode',
  seriesId: 's',
  seriesTitle: 'S',
  seasonNumber: 1,
  episodeNumber: 1,
  episodeTitle: null,
  explanationLanguage: 'en',
  savedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('groupStudyLog (saved items)', () => {
  const st = { seriesId: 'st', seriesTitle: 'Stranger Things' };
  const items = [
    item({ id: 'st-e3-late', ...st, videoId: 'e3', episodeNumber: 3, lineTimeMs: 2000, updatedAt: '2026-10-05T00:00:00Z' }),
    item({ id: 'st-e3-early', ...st, videoId: 'e3', episodeNumber: 3, lineTimeMs: 1000, updatedAt: '2026-10-03T00:00:00Z' }),
    item({ id: 'st-e1', ...st, videoId: 'e1', episodeNumber: 1, updatedAt: '2026-10-02T00:00:00Z' }),
    item({ id: 'st-s2', ...st, videoId: 's2e1', seasonNumber: 2, episodeNumber: 1, updatedAt: '2026-10-01T00:00:00Z' }),
    item({ id: 'dark', seriesId: 'dark', seriesTitle: 'Dark', videoId: 'd1', updatedAt: '2026-10-06T00:00:00Z' }),
    item({ id: 'roma', kind: 'movie', seriesId: null, seriesTitle: 'Roma', videoId: 'm1', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-04T00:00:00Z' }),
    item({ id: 'okja', kind: 'movie', seriesId: null, seriesTitle: 'Okja', videoId: 'm2', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-07T00:00:00Z' }),
  ];

  it('builds series → season → episode with saved-item counts, plus Movies, in the spec order', () => {
    const tree = groupStudyLog(items);
    expect(tree.total).toBe(7);
    expect(tree.series.map((s) => [s.title, s.count])).toEqual([
      ['Dark', 1],
      ['Stranger Things', 4],
    ]);
    const stranger = tree.series[1]!;
    expect(stranger.seasons.map((s) => [s.seasonNumber, s.count])).toEqual([
      [1, 3],
      [2, 1],
    ]);
    expect(stranger.seasons[0]!.episodes.map((e) => e.episodeNumber)).toEqual([1, 3]);
    expect(stranger.seasons[0]!.episodes[1]!.items.map((i) => i.id)).toEqual(['st-e3-early', 'st-e3-late']);
    expect(tree.movies.map((m) => [m.title, m.items.map((i) => i.id)])).toEqual([
      ['Okja', ['okja']],
      ['Roma', ['roma']],
    ]);
  });

  it('orders items from the same line by when they were saved', () => {
    const tree = groupStudyLog([
      item({ id: 'later', lineTimeMs: 500, savedAt: '2026-10-02T00:00:00Z' }),
      item({ id: 'earlier', lineTimeMs: 500, savedAt: '2026-10-01T00:00:00Z' }),
      item({ id: 'first-line', lineTimeMs: 100, savedAt: '2026-10-09T00:00:00Z' }),
    ]);
    expect(tree.series[0]!.seasons[0]!.episodes[0]!.items.map((i) => i.id)).toEqual(['first-line', 'earlier', 'later']);
  });

  it('puts unnumbered seasons and episodes last', () => {
    const tree = groupStudyLog([
      item({ id: 'a', seasonNumber: null, episodeNumber: null, videoId: 'x' }),
      item({ id: 'b', seasonNumber: 1, episodeNumber: 2, videoId: 'y' }),
    ]);
    expect(tree.series[0]!.seasons.map((s) => s.seasonNumber)).toEqual([1, null]);
  });
});

describe('filterItems and newestFirst', () => {
  const items = [
    item({ id: '1', type: 'idiom', text: 'call it a night', meaning: 'stop for the evening' }),
    item({ id: '2', type: 'word', text: 'Gonna', meaning: 'going to (casual)' }),
    item({ id: '3', type: 'line', text: 'Where are you going?', meaning: '' }),
  ];
  const ids = (list: SavedItem[]) => list.map((i) => i.id);

  it('filters by type', () => {
    expect(ids(filterItems(items, { type: 'all', query: '' }))).toEqual(['1', '2', '3']);
    expect(ids(filterItems(items, { type: 'idiom', query: '' }))).toEqual(['1']);
    expect(ids(filterItems(items, { type: 'phrase', query: '' }))).toEqual([]);
  });

  it('searches text and meaning, ignoring case and surrounding spaces', () => {
    expect(ids(filterItems(items, { type: 'all', query: '  GONNA ' }))).toEqual(['2']);
    expect(ids(filterItems(items, { type: 'all', query: 'evening' }))).toEqual(['1']);
    expect(ids(filterItems(items, { type: 'all', query: 'go' }))).toEqual(['2', '3']);
    expect(ids(filterItems(items, { type: 'line', query: 'go' }))).toEqual(['3']);
  });

  it('newestFirst sorts by savedAt without changing the input', () => {
    const list = [
      item({ id: 'old', savedAt: '2026-10-01T00:00:00Z' }),
      item({ id: 'new', savedAt: '2026-10-03T00:00:00Z' }),
      item({ id: 'mid', savedAt: '2026-10-02T00:00:00Z' }),
    ];
    expect(ids(newestFirst(list))).toEqual(['new', 'mid', 'old']);
    expect(ids(list)).toEqual(['old', 'new', 'mid']);
  });

  it('names counts of saved items', () => {
    expect(savedItemsLabel(1)).toBe('1 saved item');
    expect(savedItemsLabel(3)).toBe('3 saved items');
    expect(savedItemsLabel(0)).toBe('0 saved items');
  });
});
