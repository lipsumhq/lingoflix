import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { episodeCode, episodeLabel, formatTimestamp, seasonLabel, whereLabel } from '@/lib/study-log/format';
import {
  appendFollowUp,
  findExplanation,
  getExplanation,
  listExplanations,
  resetStudyLog,
  saveExplanation,
} from '@/lib/study-log/store';
import { isSaveSuggestion, toExplanation, type NewExplanation } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());

const line = (over: Partial<NewExplanation> = {}): NewExplanation => ({
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
  suggestions: [],
  ...over,
});

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('explanation store', () => {
  it('saves an explanation and finds it again by video, language, and normalized line', async () => {
    const saved = await saveExplanation(line(), new Date('2026-10-10T10:00:00Z'), ids());
    expect(saved).toMatchObject({ id: 'id-1', followUps: [], savedAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z' });
    expect(await findExplanation('80077211', 'ko', "I'm gonna\ncall it   a night.")).toEqual(saved);
    expect(await findExplanation('80077211', 'en', "I'm gonna call it a night.")).toBeNull();
    expect(await findExplanation('11111111', 'ko', "I'm gonna call it a night.")).toBeNull();
    expect(await getExplanation('id-1')).toEqual(saved);
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
    expect(await listExplanations()).toHaveLength(1);
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

  it('Reset all removes the whole Study Log and nothing else', async () => {
    await fakeBrowser.storage.local.set({ apiKey: 'sk-ant-secret', other: 1 });
    const next = ids();
    await saveExplanation(line({ phrase: 'A' }), undefined, next);
    await saveExplanation(line({ phrase: 'B' }), undefined, next);
    await resetStudyLog();
    expect(await listExplanations()).toEqual([]);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ apiKey: 'sk-ant-secret', other: 1 });
  });

  it('skips corrupt stored explanations', async () => {
    await fakeBrowser.storage.local.set({ 'log:bad': { id: 'bad' }, 'log:worse': 'text' });
    await saveExplanation(line(), undefined, ids());
    expect((await listExplanations()).map((e) => e.id)).toEqual(['id-1']);
  });
});

describe('explanation records (v2 spec §3.1)', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    ...line(),
    id: 'old',
    followUps: [],
    savedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  });

  it('reads a record saved before v2 (no suggestions field) with suggestions: []', async () => {
    const { suggestions: _none, ...preV2 } = stored();
    await fakeBrowser.storage.local.set({ 'log:old': preV2 });
    expect(await getExplanation('old')).toEqual({ ...preV2, suggestions: [] });
    expect((await listExplanations()).map((e) => e.suggestions)).toEqual([[]]);
  });

  it('reads a suggestions field that is not an array as no suggestions', async () => {
    await fakeBrowser.storage.local.set({ 'log:old': stored({ suggestions: 'none' }) });
    expect((await getExplanation('old'))?.suggestions).toEqual([]);
  });

  it('keeps well-formed suggestions and drops only the malformed ones', async () => {
    await fakeBrowser.storage.local.set({
      'log:old': stored({
        suggestions: [
          { type: 'idiom', text: 'call it a night', meaning: 'stop for the night' },
          { type: 'slang', text: 'gonna', meaning: 'going to' },
          { type: 'word', text: 5, meaning: 'five' },
          { type: 'word', text: 'gonna' },
          'gonna',
          { type: 'word', text: 'gonna', meaning: 'going to' },
        ],
      }),
    });
    expect((await getExplanation('old'))?.suggestions).toEqual([
      { type: 'idiom', text: 'call it a night', meaning: 'stop for the night' },
      { type: 'word', text: 'gonna', meaning: 'going to' },
    ]);
  });

  it('rejects values that are not explanations', () => {
    expect(toExplanation({ id: 'x' })).toBeNull();
    expect(toExplanation('text')).toBeNull();
    expect(toExplanation(null)).toBeNull();
    expect(toExplanation([])).toBeNull();
  });

  it('recognizes a save suggestion of each type', () => {
    for (const type of ['word', 'phrase', 'idiom', 'line']) expect(isSaveSuggestion({ type, text: 't', meaning: '' })).toBe(true);
    expect(isSaveSuggestion({ type: 'sentence', text: 't', meaning: '' })).toBe(false);
    expect(isSaveSuggestion({ type: 'word', text: 't' })).toBe(false);
  });

  it('saves suggestions with the explanation, and Regenerate replaces them', async () => {
    const first = await saveExplanation(
      line({ suggestions: [{ type: 'word', text: 'gonna', meaning: 'going to' }] }),
      new Date('2026-10-10T10:00:00Z'),
      ids(),
    );
    expect(first.suggestions).toEqual([{ type: 'word', text: 'gonna', meaning: 'going to' }]);
    const again = await saveExplanation(
      line({ suggestions: [{ type: 'idiom', text: 'call it a night', meaning: 'go to bed' }] }),
      new Date('2026-10-11T10:00:00Z'),
      () => 'unused',
    );
    expect(again.suggestions).toEqual([{ type: 'idiom', text: 'call it a night', meaning: 'go to bed' }]);
    expect(await getExplanation(first.id)).toEqual(again);
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

describe('where an item is from (v2 spec §5.2, §6.1)', () => {
  it('codes episodes as S1 E3 and leaves movies blank', () => {
    expect(episodeCode({ kind: 'episode', seasonNumber: 1, episodeNumber: 3 })).toBe('S1 E3');
    expect(episodeCode({ kind: 'episode', seasonNumber: null, episodeNumber: 3 })).toBe('E3');
    expect(episodeCode({ kind: 'episode', seasonNumber: 2, episodeNumber: null })).toBe('S2');
    expect(episodeCode({ kind: 'episode', seasonNumber: null, episodeNumber: null })).toBe('');
    expect(episodeCode({ kind: 'movie', seasonNumber: null, episodeNumber: null })).toBe('');
  });

  it('labels the show with its code, or the movie by its title', () => {
    expect(whereLabel({ kind: 'episode', seriesTitle: 'Stranger Things', seasonNumber: 1, episodeNumber: 3 })).toBe('Stranger Things S1 E3');
    expect(whereLabel({ kind: 'episode', seriesTitle: 'Stranger Things', seasonNumber: null, episodeNumber: null })).toBe('Stranger Things');
    expect(whereLabel({ kind: 'movie', seriesTitle: 'Roma', seasonNumber: null, episodeNumber: null })).toBe('Roma');
  });
});
