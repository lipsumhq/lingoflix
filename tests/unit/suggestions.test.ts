import { describe, expect, it } from 'vitest';
import { cardRows } from '@/lib/claude/suggestions';
import type { SaveSuggestion } from '@/lib/study-log/types';

const LINE = "I'm gonna\ncall it a night.";
const IDIOM: SaveSuggestion = { type: 'idiom', text: 'call it a night', meaning: 'end the evening' };
const WORD: SaveSuggestion = { type: 'word', text: 'gonna', meaning: 'going to' };

describe('cardRows (v2 spec §4.1)', () => {
  it("keeps Claude's order and puts the line suggestion last, with its meaning", () => {
    expect(cardRows([{ type: 'line', text: LINE, meaning: 'Time for bed.' }, IDIOM, WORD], LINE)).toEqual([
      IDIOM,
      WORD,
      { type: 'line', text: LINE, meaning: 'Time for bed.' },
    ]);
  });

  it('adds a Whole line row without a meaning when Claude suggested no line', () => {
    expect(cardRows([WORD], LINE)).toEqual([WORD, { type: 'line', text: LINE, meaning: '' }]);
    expect(cardRows([], LINE)).toEqual([{ type: 'line', text: LINE, meaning: '' }]);
  });
});
