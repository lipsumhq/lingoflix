import { OBSERVED_START_LEAD_MS } from './context';
import type { Cue } from './cue';
import type { ObservedLine } from './history';

/** A line with known timing, from the subtitle file or from what was seen on screen. Sorted by start. */
export interface TimedLine {
  startMs: number;
  endMs: number;
}

/** A seek that lands on a line's start counts as being on that line. */
const ON_LINE_SLACK_MS = 250;
/** Two observations of the same moment (e.g. after rewinding) closer than this are one line. */
const DUPLICATE_WITHIN_MS = 500;

export function cuesAsTimedLines(cues: readonly Cue[]): TimedLine[] {
  return cues.map(({ startMs, endMs }) => ({ startMs, endMs }));
}

/** Lines seen so far: start 300 ms before they appeared; the one still on screen runs open-ended. */
export function historyAsTimedLines(lines: readonly ObservedLine[]): TimedLine[] {
  const timed = lines
    .filter((l): l is ObservedLine & { shownAtMs: number } => l.shownAtMs !== null)
    .map((l) => ({
      startMs: Math.max(0, l.shownAtMs - OBSERVED_START_LEAD_MS),
      endMs: l.hiddenAtMs ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.startMs - b.startMs);
  const merged: TimedLine[] = [];
  for (const line of timed) {
    const last = merged.at(-1);
    if (last && line.startMs - last.startMs < DUPLICATE_WITHIN_MS) continue;
    merged.push(line);
  }
  return merged;
}

/** Lines that start within ON_LINE_SLACK_MS of the first line of their group (two speakers) form one line. */
function collapseTogetherStarts(lines: readonly TimedLine[]): TimedLine[] {
  const collapsed: TimedLine[] = [];
  for (const line of lines) {
    const group = collapsed.at(-1);
    if (group && line.startMs - group.startMs <= ON_LINE_SLACK_MS) {
      group.endMs = Math.max(group.endMs, line.endMs);
    } else {
      collapsed.push({ ...line });
    }
  }
  return collapsed;
}

/** Spec §5.1.1 Previous line: inside a line → the line before it; between lines → the most recent line. */
export function previousLineStart(input: readonly TimedLine[], atMs: number): number | null {
  const lines = collapseTogetherStarts(input);
  let latest = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startMs <= atMs + ON_LINE_SLACK_MS) latest = i;
    else break;
  }
  if (latest < 0) return null;
  const onLine = atMs < lines[latest]!.endMs;
  const target = onLine ? lines[latest - 1] : lines[latest];
  return target ? target.startMs : null;
}

/** Spec §5.1.1 Next line: the first line that starts after now. */
export function nextLineStart(input: readonly TimedLine[], atMs: number): number | null {
  for (const line of collapseTogetherStarts(input)) if (line.startMs > atMs + ON_LINE_SLACK_MS) return line.startMs;
  return null;
}
