import { describe, expect, it } from 'vitest';
import { OBSERVED_START_LEAD_MS, describeLine, findCue, trackMatchesLine } from '@/lib/subtitles/context';
import type { Cue } from '@/lib/subtitles/cue';
import { createLineHistory } from '@/lib/subtitles/history';
import { cuesAsTimedLines, historyAsTimedLines, nextLineStart, previousLineStart } from '@/lib/subtitles/navigation';

// Line i runs from 1000 + 3000·i to 3000 + 3000·i.
const CUES: Cue[] = Array.from({ length: 15 }, (_, i) => ({ startMs: 1000 + i * 3000, endMs: 3000 + i * 3000, text: `Line ${i}` }));

function observeAll(texts: [string, number][]) {
  const history = createLineHistory();
  for (const [text, at] of texts) history.observe(text, at);
  return history;
}

describe('line history', () => {
  it('records each displayed line with when it appeared and disappeared', () => {
    const h = observeAll([
      ['Hello', 1000],
      ['', 2500],
      ['World\nagain', 3000],
    ]);
    expect(h.all().map((l) => [l.text, l.shownAtMs, l.hiddenAtMs])).toEqual([
      ['Hello', 1000, 2500],
      ['World\nagain', 3000, null],
    ]);
    expect(h.displayed()?.normalized).toBe('World again');
  });

  it('ignores repeated reports of the same text (Netflix re-renders the same line)', () => {
    const h = observeAll([
      ['Hello', 1000],
      ['Hello ', 1100],
      [' Hello', 1200],
    ]);
    expect(h.all()).toHaveLength(1);
  });

  it('current() is the displayed line, else the most recent one', () => {
    const h = observeAll([
      ['Hello', 1000],
      ['', 2000],
    ]);
    expect(h.displayed()).toBeNull();
    expect(h.current()?.text).toBe('Hello');
  });

  it('keeps the last 50 lines and lists earlier lines oldest first', () => {
    const h = createLineHistory();
    for (let i = 0; i < 60; i++) h.observe(`L${i}`, i * 1000);
    expect(h.all()).toHaveLength(50);
    expect(h.all()[0]!.text).toBe('L10');
    const last = h.current()!;
    expect(h.before(last, 3).map((l) => l.text)).toEqual(['L56', 'L57', 'L58']);
  });
});

describe('findCue / trackMatchesLine', () => {
  it('finds the cue with the same text around the observed time', () => {
    expect(findCue(CUES, 'Line 7', 22_100)).toBe(7);
  });

  it('does not match the same words much later in the episode', () => {
    const cues: Cue[] = [
      { startMs: 1000, endMs: 2000, text: 'Yes.' },
      { startMs: 50_000, endMs: 51_000, text: 'Yes.' },
    ];
    expect(findCue(cues, 'Yes.', 50_200)).toBe(1);
    expect(findCue(cues, 'No.', 1000)).toBe(-1);
  });

  it('a track is used only if it matches the displayed line', () => {
    const h = observeAll([['Line 7', 22_100]]);
    expect(trackMatchesLine(CUES, h.current()!)).toBe(true);
    const other = observeAll([['Something else', 22_100]]);
    expect(trackMatchesLine(CUES, other.current()!)).toBe(false);
    const untimed = observeAll([['Line 7', null as unknown as number]]);
    expect(trackMatchesLine(CUES, untimed.current()!)).toBe(false);
  });
});

describe('describeLine', () => {
  it('uses up to 6 cues before and after, and the cue timing', () => {
    const h = observeAll([['Line 7', 22_100]]);
    expect(describeLine(h.current()!, CUES, h)).toEqual({
      context: {
        before: ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6'],
        after: ['Line 8', 'Line 9', 'Line 10', 'Line 11', 'Line 12', 'Line 13'],
      },
      timing: { startMs: 22_000, endMs: 24_000 },
      fromTrack: true,
    });
  });

  it('matches when two cues are displayed together (two speakers)', () => {
    const cues: Cue[] = [
      { startMs: 1000, endMs: 3000, text: 'Hello.' },
      { startMs: 1200, endMs: 3200, text: 'Who is it?' },
      { startMs: 4000, endMs: 5000, text: 'Me.' },
    ];
    const h = observeAll([['Hello.\nWho is it?', 1300]]);
    expect(describeLine(h.current()!, cues, h)).toEqual({
      context: { before: [], after: ['Me.'] },
      timing: { startMs: 1000, endMs: 3200 },
      fromTrack: true,
    });
  });

  it('without a usable track: up to 6 history lines before, none after, start 300 ms early', () => {
    const h = createLineHistory();
    for (let i = 0; i < 8; i++) {
      h.observe(`Seen ${i}`, 10_000 + i * 2000);
      h.observe('', 11_000 + i * 2000);
    }
    const line = h.current()!;
    expect(describeLine(line, null, h)).toEqual({
      context: { before: ['Seen 1', 'Seen 2', 'Seen 3', 'Seen 4', 'Seen 5', 'Seen 6'], after: [] },
      timing: { startMs: 24_000 - OBSERVED_START_LEAD_MS, endMs: 25_000 },
      fromTrack: false,
    });
  });

  it('a line whose time is unknown has no timing', () => {
    const h = observeAll([['Hello', null as unknown as number]]);
    expect(describeLine(h.current()!, null, h).timing).toBeNull();
  });
});

describe('line navigation', () => {
  const lines = cuesAsTimedLines(CUES);

  it('previous: inside a line → the line before; between lines → the most recent line', () => {
    expect(previousLineStart(lines, 22_500)).toBe(19_000); // inside Line 7 → Line 6
    expect(previousLineStart(lines, 24_500)).toBe(22_000); // after Line 7 ended → Line 7
    expect(previousLineStart(lines, 22_000)).toBe(19_000); // just jumped to Line 7 → Line 6 (repeat presses walk back)
  });

  it('previous: nothing before the first line', () => {
    expect(previousLineStart(lines, 500)).toBeNull();
    expect(previousLineStart(lines, 1500)).toBeNull();
  });

  it('next: the first line that starts after now', () => {
    expect(nextLineStart(lines, 22_500)).toBe(25_000);
    expect(nextLineStart(lines, 22_000)).toBe(25_000); // just jumped to Line 7 → Line 8
    expect(nextLineStart(lines, 50_000)).toBeNull();
  });

  it('history lines start 300 ms early, merge rewatched duplicates, and skip untimed lines', () => {
    const h = createLineHistory();
    h.observe('A', 10_000);
    h.observe('B', 12_000);
    h.observe('', 15_000);
    h.observe('A', 10_100); // rewound and saw A again
    h.observe('Untimed', null as unknown as number);
    expect(historyAsTimedLines(h.all())).toEqual([
      { startMs: 9700, endMs: 12_000 },
      { startMs: 11_700, endMs: 15_000 },
    ]);
  });
});
