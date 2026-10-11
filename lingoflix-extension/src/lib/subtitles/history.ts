import { normalizeLine } from './cue';

/** A subtitle line as seen on screen. Times are episode ms from the page bridge, or null if it couldn't be read. */
export interface ObservedLine {
  /** As displayed, trimmed; line breaks kept. */
  text: string;
  normalized: string;
  shownAtMs: number | null;
  /** Null while still on screen. */
  hiddenAtMs: number | null;
}

/** Enough lines to send as the story so far when there is no subtitle file (v2 spec §5.2). */
export const HISTORY_LIMIT = 600;

export interface LineHistory {
  /** Report what Netflix displays now ("" for nothing). Repeats of the same text are ignored. */
  observe(text: string, atMs: number | null): void;
  /** The line on screen, or null between lines. */
  displayed(): ObservedLine | null;
  /** The line on screen, else the most recently displayed one (spec §5.1 "current line"). */
  current(): ObservedLine | null;
  /** Up to `count` lines shown before `line`, oldest first. */
  before(line: ObservedLine, count: number): ObservedLine[];
  all(): readonly ObservedLine[];
  clear(): void;
}

export function createLineHistory(limit = HISTORY_LIMIT): LineHistory {
  let lines: ObservedLine[] = [];
  let shown: ObservedLine | null = null;

  return {
    observe(text, atMs) {
      const normalized = normalizeLine(text);
      if (shown && shown.normalized === normalized) return;
      if (shown) {
        shown.hiddenAtMs = atMs;
        shown = null;
      }
      if (!normalized) return;
      shown = { text: text.trim(), normalized, shownAtMs: atMs, hiddenAtMs: null };
      lines.push(shown);
      if (lines.length > limit) lines = lines.slice(-limit);
    },
    displayed: () => shown,
    current: () => shown ?? lines.at(-1) ?? null,
    before(line, count) {
      const index = lines.indexOf(line);
      const end = index < 0 ? lines.length : index;
      return lines.slice(Math.max(0, end - count), end);
    },
    all: () => lines,
    clear() {
      lines = [];
      shown = null;
    },
  };
}
