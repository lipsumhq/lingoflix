import { normalizeLine, type Cue } from './cue';
import type { LineHistory, ObservedLine } from './history';

export const CONTEXT_LINES = 6;
/** An observed line starts this much before it appeared (spec §8.2). */
export const OBSERVED_START_LEAD_MS = 300;
/** Slack when matching an observed time to a cue's time range. */
export const CUE_MATCH_TOLERANCE_MS = 1500;

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
 * once (two speakers), so a cue contained in the displayed text also matches; an exact match wins,
 * otherwise the earliest contained cue.
 */
export function findCue(cues: readonly Cue[], normalizedLine: string, atMs: number, toleranceMs = CUE_MATCH_TOLERANCE_MS): number {
  if (!normalizedLine) return -1;
  let contained = -1;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]!;
    if (cue.startMs - toleranceMs > atMs) break; // cues are sorted by start
    if (cue.endMs + toleranceMs < atMs) continue;
    const text = normalizeLine(cue.text);
    if (text === normalizedLine) return i;
    if (contained < 0 && text && normalizedLine.includes(text)) contained = i;
  }
  return contained;
}

/** Spec §8.2 validation: a subtitle file is used only if it has the line Netflix displayed, at that time. */
export function trackMatchesLine(cues: readonly Cue[], line: ObservedLine): boolean {
  return line.shownAtMs !== null && findCue(cues, line.normalized, line.shownAtMs) >= 0;
}

/** Context and timing for a line: from the subtitle file when it matches, else from the rolling history. */
export function describeLine(line: ObservedLine, cues: readonly Cue[] | null, history: Pick<LineHistory, 'before'>): LineDetails {
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
    context: { before: history.before(line, CONTEXT_LINES).map((l) => l.text), after: [] },
    timing: at === null ? null : { startMs: Math.max(0, at - OBSERVED_START_LEAD_MS), endMs: line.hiddenAtMs },
    fromTrack: false,
  };
}
