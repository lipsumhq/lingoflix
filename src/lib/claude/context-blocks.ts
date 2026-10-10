import { whereLabel } from '@/lib/study-log/format';
import type { Explanation, SavedItem } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';
import { normalizeLine } from '@/lib/subtitles/cue';

/** v2 spec §5.2: chunk A ends at the last 5-minute boundary before the target line. */
export const STORY_CHUNK_MS = 300_000;
export const STORY_CACHED_MAX_LINES = 600;
export const STORY_CACHED_MAX_CHARS = 48_000;
export const STORY_RECENT_MAX_LINES = 200;

const STORY_HEADER = 'Story so far in this episode (subtitle lines before the dialogue below, oldest first):';
const RECENT_HEADER = 'Just before:';

/** The newest lines that fit in `maxLines` lines and `maxChars` characters (each line counts its newline). */
function newestWithin(lines: readonly StoryLine[], maxLines: number, maxChars: number): StoryLine[] {
  const kept: StoryLine[] = [];
  let chars = 0;
  for (let i = lines.length - 1; i >= 0 && kept.length < maxLines; i--) {
    const line = lines[i]!;
    chars += line.text.length + 1;
    if (chars > maxChars) break;
    kept.push(line);
  }
  return kept.reverse();
}

/**
 * Splits the story so far at the last 5-minute boundary before the target line (v2 spec §5.2). Chunk A
 * ("cached", before the boundary) depends only on the lines and the boundary, so every request in the same
 * window sends the same text and it is read from the prompt cache; caps apply after the split for that reason.
 * Chunk B ("recent") is the rest. Lines at or after the target's start never pass, whatever the page sent.
 */
export function splitStory(lines: readonly StoryLine[], targetStartMs: number): { cached: StoryLine[]; recent: StoryLine[] } {
  const boundary = Math.floor(Math.max(0, targetStartMs) / STORY_CHUNK_MS) * STORY_CHUNK_MS;
  const usable = lines
    .filter((l) => Number.isFinite(l.startMs) && l.startMs < targetStartMs)
    .map((l) => ({ startMs: l.startMs, text: normalizeLine(l.text) }))
    .filter((l) => l.text)
    .sort((a, b) => a.startMs - b.startMs);
  return {
    cached: newestWithin(
      usable.filter((l) => l.startMs < boundary),
      STORY_CACHED_MAX_LINES,
      STORY_CACHED_MAX_CHARS,
    ),
    recent: usable.filter((l) => l.startMs >= boundary).slice(-STORY_RECENT_MAX_LINES),
  };
}

/** `system[1]`: chunk A with its header, one line each; null when there is none. */
export function storyBlock(cached: readonly StoryLine[]): string | null {
  if (cached.length === 0) return null;
  return [STORY_HEADER, ...cached.map((l) => normalizeLine(l.text))].join('\n');
}

/** The top of the user message: chunk B under "Just before:"; null when there is none. */
export function recentStoryText(recent: readonly StoryLine[]): string | null {
  if (recent.length === 0) return null;
  return [RECENT_HEADER, ...recent.map((l) => `  ${normalizeLine(l.text)}`)].join('\n');
}

export interface HistorySources {
  items: readonly SavedItem[];
  explanations: readonly Explanation[];
}

/** v2 spec §5.2 limits for the learning history. */
export const HISTORY_ITEMS = 100;
export const HISTORY_LINES = 30;
const HISTORY_TEXT_CHARS = 120;
const HISTORY_MEANING_CHARS = 80;

const HISTORY_HEADER =
  "What this learner has studied (most recent first). Connect to it when useful, don't re-explain basics they already saved, and don't suggest items they already saved.";

function cut(text: string, max: number): string {
  const clean = normalizeLine(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const newestFirst = <T extends { updatedAt: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
const sameLine = (a: string, b: string) => normalizeLine(a).toLowerCase() === normalizeLine(b).toLowerCase();

/**
 * `system[2]`: what the learner saved and recently explained, most recent first (v2 spec §5.2), leaving out
 * the line being explained and the items saved from it: Claude is told not to suggest saved items, and after
 * Regenerate it must still suggest those so their rows show Saved (v2 spec §4.1). Null when there is nothing
 * to list.
 */
export function learningHistoryBlock(sources: HistorySources, excludeLine: string): string | null {
  const items = newestFirst(sources.items)
    .filter((i) => !sameLine(i.line, excludeLine))
    .slice(0, HISTORY_ITEMS);
  const lines = newestFirst(sources.explanations)
    .filter((e) => !sameLine(e.phrase, excludeLine))
    .slice(0, HISTORY_LINES);
  if (items.length === 0 && lines.length === 0) return null;
  const out = [HISTORY_HEADER];
  if (items.length > 0) {
    out.push('Saved:');
    for (const i of items) {
      const meaning = cut(i.meaning, HISTORY_MEANING_CHARS);
      out.push(`- ${cut(i.text, HISTORY_TEXT_CHARS)} (${i.type})${meaning ? `: ${meaning}` : ''} [${whereLabel(i)}]`);
    }
  }
  if (lines.length > 0) {
    out.push('Recently explained lines:');
    for (const e of lines) out.push(`- "${cut(e.phrase, HISTORY_TEXT_CHARS)}" [${whereLabel(e)}]`);
  }
  return out.join('\n');
}
