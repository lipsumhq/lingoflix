import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { episodeLabel, formatTimestamp, seasonLabel } from '@/lib/study-log/format';
import { groupStudyLog } from '@/lib/study-log/group';
import {
  appendFollowUp,
  deleteEntries,
  findEntry,
  getEntry,
  listEntries,
  resetStudyLog,
  saveExplanation,
} from '@/lib/study-log/store';
import type { NewStudyLogEntry, StudyLogEntry } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());

const line = (over: Partial<NewStudyLogEntry> = {}): NewStudyLogEntry => ({
  phrase: "I'm gonna call it a night.",
  response: '## Meaning\nTime to sleep.',
  videoTimeMs: 1_834_200,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: ['Where are you going?'], after: [] },
  explanationLanguage: 'ko',
  model: 'claude-sonnet-5-5',
  ...over,
});

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('Study Log store', () => {
  it('saves an explanation and finds it again by video, language, and normalized line', async () => {
    const saved = await saveExplanation(line(), new Date('2026-10-10T10:00:00Z'), ids());
    expect(saved).toMatchObject({ id: 'id-1', followUps: [], savedAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z' });
    expect(await findEntry('80077211', 'ko', "I'm gonna\ncall it   a night.")).toEqual(saved);
    expect(await findEntry('80077211', 'en', "I'm gonna call it a night.")).toBeNull();
    expect(await findEntry('11111111', 'ko', "I'm gonna call it a night.")).toBeNull();
    expect(await getEntry('id-1')).toEqual(saved);
  });

  it('saving the same line again replaces the response, keeps id and savedAt, clears follow-ups (Regenerate)', async () => {
    const first = await saveExplanation(line(), new Date('2026-10-10T10:00:00Z'), ids());
    await appendFollowUp(first.id, { question: 'Formal?', answer: 'No.' });
    const again = await saveExplanation(line({ response: 'New answer' }), new Date('2026-10-11T10:00:00Z'), () => 'unused');
    expect(again).toMatchObject({
      id: 'id-1',
      response: 'New answer',
      followUps: [],
      savedAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-11T10:00:00.000Z',
    });
    expect(await listEntries()).toHaveLength(1);
  });

  it('appends follow-ups in order', async () => {
    const saved = await saveExplanation(line(), new Date('2026-10-10T10:00:00Z'), ids());
    await appendFollowUp(saved.id, { question: 'Q1', answer: 'A1' });
    const after = await appendFollowUp(saved.id, { question: 'Q2', answer: 'A2' }, new Date('2026-10-12T00:00:00Z'));
    expect(after?.followUps).toEqual([
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ]);
    expect(after?.updatedAt).toBe('2026-10-12T00:00:00.000Z');
    expect(await appendFollowUp('missing', { question: 'Q', answer: 'A' })).toBeNull();
  });

  it('deletes entries and their lookup keys only', async () => {
    const next = ids();
    const a = await saveExplanation(line({ phrase: 'A' }), undefined, next);
    const b = await saveExplanation(line({ phrase: 'B' }), undefined, next);
    await deleteEntries([a.id]);
    expect(await findEntry(a.videoId, 'ko', 'A')).toBeNull();
    expect(await getEntry(a.id)).toBeNull();
    expect(await findEntry(b.videoId, 'ko', 'B')).toEqual(b);
  });

  it('Reset all removes the whole Study Log and nothing else', async () => {
    await fakeBrowser.storage.local.set({ apiKey: 'sk-ant-secret', other: 1 });
    const next = ids();
    await saveExplanation(line({ phrase: 'A' }), undefined, next);
    await saveExplanation(line({ phrase: 'B' }), undefined, next);
    await resetStudyLog();
    expect(await listEntries()).toEqual([]);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ apiKey: 'sk-ant-secret', other: 1 });
  });

  it('skips corrupt stored entries', async () => {
    await fakeBrowser.storage.local.set({ 'log:bad': { id: 'bad' }, 'log:worse': 'text' });
    await saveExplanation(line(), undefined, ids());
    expect((await listEntries()).map((e) => e.id)).toEqual(['id-1']);
  });
});

const entry = (over: Partial<StudyLogEntry>): StudyLogEntry => ({
  id: 'x',
  phrase: 'p',
  response: 'r',
  followUps: [],
  videoTimeMs: 0,
  savedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  videoId: 'v',
  kind: 'episode',
  seriesId: 's',
  seriesTitle: 'S',
  seasonNumber: 1,
  episodeNumber: 1,
  episodeTitle: null,
  context: { before: [], after: [] },
  explanationLanguage: 'en',
  model: 'claude-sonnet-5-5',
  ...over,
});

describe('groupStudyLog', () => {
  const st = { seriesId: 'st', seriesTitle: 'Stranger Things' };
  const entries = [
    entry({ id: 'st-e3-late', ...st, videoId: 'e3', episodeNumber: 3, videoTimeMs: 2000, updatedAt: '2026-10-05T00:00:00Z' }),
    entry({ id: 'st-e3-early', ...st, videoId: 'e3', episodeNumber: 3, videoTimeMs: 1000, updatedAt: '2026-10-03T00:00:00Z' }),
    entry({ id: 'st-e1', ...st, videoId: 'e1', episodeNumber: 1, updatedAt: '2026-10-02T00:00:00Z' }),
    entry({ id: 'st-s2', ...st, videoId: 's2e1', seasonNumber: 2, episodeNumber: 1, updatedAt: '2026-10-01T00:00:00Z' }),
    entry({ id: 'dark', seriesId: 'dark', seriesTitle: 'Dark', videoId: 'd1', updatedAt: '2026-10-06T00:00:00Z' }),
    entry({ id: 'roma', kind: 'movie', seriesId: null, seriesTitle: 'Roma', videoId: 'm1', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-04T00:00:00Z' }),
    entry({ id: 'okja', kind: 'movie', seriesId: null, seriesTitle: 'Okja', videoId: 'm2', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-07T00:00:00Z' }),
  ];

  it('builds series → season → episode with counts, plus Movies, in the spec order', () => {
    const tree = groupStudyLog(entries);
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
    expect(stranger.seasons[0]!.episodes[1]!.entries.map((e) => e.id)).toEqual(['st-e3-early', 'st-e3-late']);
    expect(tree.movies.map((m) => m.title)).toEqual(['Okja', 'Roma']);
  });

  it('puts unnumbered seasons and episodes last', () => {
    const tree = groupStudyLog([
      entry({ id: 'a', seasonNumber: null, episodeNumber: null, videoId: 'x' }),
      entry({ id: 'b', seasonNumber: 1, episodeNumber: 2, videoId: 'y' }),
    ]);
    expect(tree.series[0]!.seasons.map((s) => s.seasonNumber)).toEqual([1, null]);
  });
});

describe('labels', () => {
  it('formats timestamps like the player', () => {
    expect(formatTimestamp(1_834_200)).toBe('30:34');
    expect(formatTimestamp(5000)).toBe('0:05');
    expect(formatTimestamp(3_723_000)).toBe('1:02:03');
    expect(formatTimestamp(-10)).toBe('0:00');
  });

  it('names seasons and episodes', () => {
    expect(seasonLabel(2)).toBe('Season 2');
    expect(seasonLabel(null)).toBe('Episodes');
    expect(episodeLabel({ episodeNumber: 3, episodeTitle: 'Holly, Jolly' })).toBe('E3 · Holly, Jolly');
    expect(episodeLabel({ episodeNumber: null, episodeTitle: null })).toBe('Episode');
  });
});
