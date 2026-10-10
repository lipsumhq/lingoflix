import { describe, expect, it } from 'vitest';
import {
  HISTORY_ITEMS,
  HISTORY_LINES,
  STORY_CACHED_MAX_CHARS,
  STORY_CACHED_MAX_LINES,
  STORY_CHUNK_MS,
  STORY_RECENT_MAX_LINES,
  learningHistoryBlock,
  recentStoryText,
  splitStory,
  storyBlock,
} from '@/lib/claude/context-blocks';
import type { Explanation, SavedItem } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';

/** One line per second: line i starts at i·1000 ms. */
const story = (count: number, text: (i: number) => string = (i) => `Line ${i}`): StoryLine[] =>
  Array.from({ length: count }, (_, i) => ({ startMs: i * 1000, text: text(i) }));

/** What the content script sends for a target at `targetStartMs`: lines before the context window, last 1000. */
const sent = (all: readonly StoryLine[], targetStartMs: number) => all.filter((l) => l.startMs < targetStartMs - 6000).slice(-1000);

describe('splitStory', () => {
  it('splits at the last 5-minute boundary before the target and drops anything at or after the target', () => {
    const { cached, recent } = splitStory(
      [
        { startMs: 0, text: 'Opening' },
        { startMs: 299_999, text: 'Last before the boundary' },
        { startMs: 300_000, text: 'First after the boundary' },
        { startMs: 310_000, text: 'Just before' },
        { startMs: 320_000, text: 'The target itself' },
        { startMs: 400_000, text: 'Later' },
      ],
      320_000,
    );
    expect(STORY_CHUNK_MS).toBe(300_000);
    expect(cached.map((l) => l.text)).toEqual(['Opening', 'Last before the boundary']);
    expect(recent.map((l) => l.text)).toEqual(['First after the boundary', 'Just before']);
  });

  it('puts every line in chunk B during the first 5 minutes, normalizes text, and skips empty lines', () => {
    const { cached, recent } = splitStory(
      [
        { startMs: 1000, text: '  Two\nlines  ' },
        { startMs: 2000, text: '   ' },
      ],
      120_000,
    );
    expect(cached).toEqual([]);
    expect(recent).toEqual([{ startMs: 1000, text: 'Two lines' }]);
  });

  it('chunk A is identical within a window and capped', () => {
    // A long episode: 2000 lines, one per second.
    const all = story(2000, (i) => `Line ${i}: ${'words '.repeat(3)}`);
    const early = splitStory(sent(all, 1_210_000), 1_210_000);
    const late = splitStory(sent(all, 1_495_000), 1_495_000);
    // Both targets are in the window that starts at 1 200 000 ms: chunk A is the same text, chunk B differs.
    expect(storyBlock(early.cached)).toBe(storyBlock(late.cached));
    expect(early.recent).not.toEqual(late.recent);
    expect(early.cached).toHaveLength(STORY_CACHED_MAX_LINES);
    expect(early.cached.at(-1)!.startMs).toBe(1_199_000);
    expect(late.recent).toHaveLength(STORY_RECENT_MAX_LINES);
    expect(late.recent.at(-1)!.startMs).toBe(1_488_000);

    // Long lines: the character cap binds before the line cap.
    const wordy = story(2000, (i) => `${i} ${'x'.repeat(150)}`);
    const { cached } = splitStory(sent(wordy, 1_210_000), 1_210_000);
    const chars = cached.reduce((sum, l) => sum + l.text.length + 1, 0);
    expect(chars).toBeLessThanOrEqual(STORY_CACHED_MAX_CHARS);
    expect(cached.length).toBeLessThan(STORY_CACHED_MAX_LINES);
    expect(cached.at(-1)!.startMs).toBe(1_199_000);
    expect(storyBlock(splitStory(sent(wordy, 1_299_000), 1_299_000).cached)).toBe(storyBlock(cached));
  });
});

describe('story text', () => {
  it('chunk A is a system block with a header and one line each; empty is null', () => {
    expect(storyBlock([{ startMs: 0, text: 'Hello.' }, { startMs: 1000, text: 'Hi.' }])).toBe(
      'Story so far in this episode (subtitle lines before the dialogue below, oldest first):\nHello.\nHi.',
    );
    expect(storyBlock([])).toBeNull();
  });

  it('chunk B goes on top of the user message under "Just before:"; empty is null', () => {
    expect(recentStoryText([{ startMs: 0, text: 'Hello.' }, { startMs: 1000, text: 'Hi.' }])).toBe('Just before:\n  Hello.\n  Hi.');
    expect(recentStoryText([])).toBeNull();
  });
});

const item = (over: Partial<SavedItem> = {}): SavedItem => ({
  id: 'i1',
  type: 'idiom',
  text: 'call it a night',
  meaning: "end the evening's activities",
  explanationId: 'e1',
  line: "I'm gonna call it a night.",
  lineTimeMs: 1_834_200,
  context: { before: [], after: [] },
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  explanationLanguage: 'en',
  savedAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  ...over,
});

const explanation = (over: Partial<Explanation> = {}): Explanation => ({
  id: 'e1',
  phrase: "Where's Will?",
  response: '## Meaning\nA question.',
  followUps: [],
  videoTimeMs: 1000,
  savedAt: '2026-10-10T09:00:00.000Z',
  updatedAt: '2026-10-10T09:00:00.000Z',
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: [], after: [] },
  explanationLanguage: 'en',
  model: 'claude-sonnet-5-5',
  suggestions: [],
  ...over,
});

const HEADER =
  "What this learner has studied (most recent first). Connect to it when useful, don't re-explain basics they already saved, and don't suggest items they already saved.";

describe('learningHistoryBlock', () => {
  it('lists saved items and explained lines with where they are from (v2 spec §5.2)', () => {
    expect(
      learningHistoryBlock(
        {
          items: [
            item(),
            item({ id: 'i2', type: 'line', text: 'Mouth breather.', meaning: '', kind: 'movie', seriesTitle: 'Roma', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-09T00:00:00.000Z' }),
          ],
          explanations: [explanation()],
        },
        'Something else entirely.',
      ),
    ).toBe(
      [
        HEADER,
        'Saved:',
        "- call it a night (idiom): end the evening's activities [Stranger Things S1 E3]",
        '- Mouth breather. (line) [Roma]',
        'Recently explained lines:',
        `- "Where's Will?" [Stranger Things S1 E3]`,
      ].join('\n'),
    );
  });

  it('is most recent first, keeps 100 items and 30 lines, and cuts long text and meanings', () => {
    const items = Array.from({ length: 120 }, (_, i) =>
      item({ id: `i${i}`, text: `word ${i}`, meaning: 'm', updatedAt: `2026-10-10T10:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}.000Z` }),
    );
    const explanations = Array.from({ length: 40 }, (_, i) =>
      explanation({ id: `e${i}`, phrase: `Line ${i}`, updatedAt: `2026-10-10T09:${String(i).padStart(2, '0')}:00.000Z` }),
    );
    const block = learningHistoryBlock({ items, explanations }, 'Not in the list')!;
    const lines = block.split('\n');
    expect(lines.filter((l) => l.startsWith('- word '))).toHaveLength(HISTORY_ITEMS);
    expect(lines.filter((l) => l.startsWith('- "Line '))).toHaveLength(HISTORY_LINES);
    expect(lines[2]).toBe('- word 119 (idiom): m [Stranger Things S1 E3]'); // 10:59:01, the newest
    expect(lines.indexOf('- "Line 39" [Stranger Things S1 E3]')).toBe(lines.indexOf('Recently explained lines:') + 1);
    expect(block).not.toContain('"Line 9"'); // the 10 oldest lines are left out

    const long = learningHistoryBlock({ items: [item({ text: 'a'.repeat(200), meaning: 'b'.repeat(100) })], explanations: [] }, 'x')!;
    expect(long.split('\n')[2]).toBe(`- ${'a'.repeat(119)}… (idiom): ${'b'.repeat(79)}… [Stranger Things S1 E3]`);
  });

  it('leaves out the line being explained, and is null when there is nothing to say', () => {
    const block = learningHistoryBlock(
      { items: [], explanations: [explanation({ phrase: "I'm gonna\ncall it a night." }), explanation({ id: 'e2' })] },
      "i'm gonna call it a night.",
    )!;
    expect(block).not.toContain('call it a night');
    expect(block).toContain(`- "Where's Will?"`);
    expect(learningHistoryBlock({ items: [], explanations: [] }, 'x')).toBeNull();
    expect(learningHistoryBlock({ items: [], explanations: [explanation({ phrase: 'Same.' })] }, 'Same.')).toBeNull();
  });
});
