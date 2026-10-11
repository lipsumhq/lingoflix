import { normalizeLine, type Cue } from './cue';
import type { LineHistory, ObservedLine } from './history';

export const CONTEXT_LINES = 6;
/** An observed line starts this much before it appeared (spec §8.2). */
export const OBSERVED_START_LEAD_MS = 300;
/** Slack when matching an observed time to a cue's time range. */
export const CUE_MATCH_TOLERANCE_MS = 1500;
/** The same line seen twice this close together (e.g. after rewinding) is one line. */
const REWATCHED_WITHIN_MS = 500;

export interface DialogueContext {
  before: string[];
  after: string[];
}

export interface LineTiming {
  startMs: number;
  endMs: number | null;
}

export interface LineDetails {
  context: DialogueContext;
  /** Null when the line's time couldn't be read from the player. */
  timing: LineTiming | null;
  /** True when context and timing came from the subtitle file. */
  fromTrack: boolean;
}

/**
 * Index of the cue Netflix displays as `normalizedLine` around `atMs`, or -1. Netflix may show two cues at
 * once (two speakers), so a cue contained in the displayed text also matches. An exact match wins over a
 * contained one; among several matches of the same kind (a line repeated nearby), the cue nearest `atMs`
 * wins (0 while it is shown, else the gap to its nearer edge).
 */
export function findCue(cues: readonly Cue[], normalizedLine: string, atMs: number, toleranceMs = CUE_MATCH_TOLERANCE_MS): number {
  if (!normalizedLine) return -1;
  let exact = -1;
  let exactGap = Number.POSITIVE_INFINITY;
  let contained = -1;
  let containedGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]!;
    if (cue.startMs - toleranceMs > atMs) break; // cues are sorted by start
    if (cue.endMs + toleranceMs < atMs) continue;
    const text = normalizeLine(cue.text);
    const gap = cueGap(cue, atMs);
    if (text === normalizedLine) {
      if (gap < exactGap) {
        exact = i;
        exactGap = gap;
      }
    } else if (text && normalizedLine.includes(text)) {
      if (gap < containedGap) {
        contained = i;
        containedGap = gap;
      }
    }
  }
  return exact >= 0 ? exact : contained;
}

/** Distance from `atMs` to a cue's time range: 0 while it is shown, else the gap to the nearer edge. */
function cueGap(cue: Cue, atMs: number): number {
  if (atMs < cue.startMs) return cue.startMs - atMs;
  if (atMs > cue.endMs) return atMs - cue.endMs;
  return 0;
}

/** Spec §8.2 validation: a subtitle file is used only if it has the line Netflix displayed, at that time. */
export function trackMatchesLine(cues: readonly Cue[], line: ObservedLine): boolean {
  return line.shownAtMs !== null && findCue(cues, line.normalized, line.shownAtMs) >= 0;
}

type TimedLine = ObservedLine & { shownAtMs: number };

/**
 * Lines seen before episode time `at`, in episode order, not in the order they were seen: after rewinding or
 * Replay, lines seen again are new history entries. Repeats of `line` itself, untimed lines, and rewatched
 * duplicates (same text within 500 ms) are left out.
 */
function seenBefore(line: ObservedLine, at: number, history: Pick<LineHistory, 'all'>): TimedLine[] {
  const earlier = history
    .all()
    .filter((l): l is TimedLine => l.shownAtMs !== null && l.shownAtMs < at)
    .filter((l) => l.normalized !== line.normalized)
    .sort((a, b) => a.shownAtMs - b.shownAtMs);
  const lastSeen = new Map<string, number>();
  const merged: TimedLine[] = [];
  for (const l of earlier) {
    const previous = lastSeen.get(l.normalized);
    if (previous !== undefined && l.shownAtMs - previous <= REWATCHED_WITHIN_MS) continue;
    lastSeen.set(l.normalized, l.shownAtMs);
    merged.push(l);
  }
  return merged;
}

/** Up to CONTEXT_LINES lines seen before `line`, in episode order (see seenBefore). */
function historyBefore(line: ObservedLine, history: Pick<LineHistory, 'before' | 'all'>): string[] {
  const at = line.shownAtMs;
  if (at === null) return history.before(line, CONTEXT_LINES).map((l) => l.text);
  return seenBefore(line, at, history).slice(-CONTEXT_LINES).map((l) => l.text);
}

/** Context and timing for a line: from the subtitle file when it matches, else from the rolling history. */
export function describeLine(
  line: ObservedLine,
  cues: readonly Cue[] | null,
  history: Pick<LineHistory, 'before' | 'all'>,
): LineDetails {
  const at = line.shownAtMs;
  const first = cues && at !== null ? findCue(cues, line.normalized, at) : -1;
  if (cues && first >= 0) {
    // Include cues shown together with the first one (two speakers) in the line itself, not in "after".
    let last = first;
    while (last + 1 < cues.length) {
      const next = cues[last + 1]!;
      if (next.startMs > cues[last]!.endMs + CUE_MATCH_TOLERANCE_MS) break;
      if (!line.normalized.includes(normalizeLine(next.text))) break;
      last++;
    }
    return {
      context: {
        before: cues.slice(Math.max(0, first - CONTEXT_LINES), first).map((c) => c.text),
        after: cues.slice(last + 1, last + 1 + CONTEXT_LINES).map((c) => c.text),
      },
      timing: { startMs: cues[first]!.startMs, endMs: cues[last]!.endMs },
      fromTrack: true,
    };
  }
  return {
    context: { before: historyBefore(line, history), after: [] },
    timing: at === null ? null : { startMs: Math.max(0, at - OBSERVED_START_LEAD_MS), endMs: line.hiddenAtMs },
    fromTrack: false,
  };
}

/** One line of the story so far: when it starts (episode ms) and its text on one line. */
export interface StoryLine {
  startMs: number;
  text: string;
}

/** The content script sends at most this many story lines (v2 spec §5.2). */
export const STORY_SEND_LIMIT = 1000;

/**
 * The story so far (v2 spec §5.2): the lines before `line`'s context window, oldest first, at most `limit`.
 * From the subtitle file when it has the line, else from the lines seen (starting 300 ms before they
 * appeared). Never the line itself, its CONTEXT_LINES lines before, or anything after it, so Claude never sees
 * past the context (no spoilers).
 */
export function storyBefore(
  line: ObservedLine,
  cues: readonly Cue[] | null,
  history: Pick<LineHistory, 'before' | 'all'>,
  limit = STORY_SEND_LIMIT,
): StoryLine[] {
  const at = line.shownAtMs;
  if (at === null || limit <= 0) return [];
  const first = cues ? findCue(cues, line.normalized, at) : -1;
  if (cues && first >= 0) {
    const end = Math.max(0, first - CONTEXT_LINES);
    return cues.slice(Math.max(0, end - limit), end).map((c) => ({ startMs: c.startMs, text: normalizeLine(c.text) }));
  }
  const seen = seenBefore(line, at, history);
  const end = Math.max(0, seen.length - CONTEXT_LINES);
  return seen
    .slice(Math.max(0, end - limit), end)
    .map((l) => ({ startMs: Math.max(0, l.shownAtMs - OBSERVED_START_LEAD_MS), text: l.normalized }));
}
