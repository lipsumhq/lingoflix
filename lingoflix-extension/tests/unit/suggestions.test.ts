import { describe, expect, it } from 'vitest';
import { MAX_SUGGESTIONS, SUGGEST_SAVES_TOOL, SUGGEST_SAVES_TOOL_NAME, cardRows, validateSuggestions } from '@/lib/claude/suggestions';
import type { SaveSuggestion } from '@/lib/study-log/types';

const LINE = "I'm gonna\ncall it a night.";
const IDIOM: SaveSuggestion = { type: 'idiom', text: 'call it a night', meaning: 'end the evening' };
const WORD: SaveSuggestion = { type: 'word', text: 'gonna', meaning: 'going to' };
const input = (...items: unknown[]) => ({ items });

describe('cardRows (v2 spec §4.1)', () => {
  it("keeps Claude's order and puts the line suggestion last, with its meaning", () => {
    expect(cardRows([{ type: 'line', text: LINE, meaning: 'Time for bed.' }, IDIOM, WORD], LINE)).toEqual([
      IDIOM,
      WORD,
      { type: 'line', text: LINE, meaning: 'Time for bed.' },
    ]);
  });

  it("takes the line row's text from the line, not from Claude's line suggestion, and keeps its meaning", () => {
    expect(cardRows([WORD, { type: 'line', text: 'call it a night', meaning: 'Time for bed.' }], LINE)).toEqual([
      WORD,
      { type: 'line', text: LINE, meaning: 'Time for bed.' },
    ]);
  });

  it('adds a Whole line row without a meaning when Claude suggested no line', () => {
    expect(cardRows([WORD], LINE)).toEqual([WORD, { type: 'line', text: LINE, meaning: '' }]);
    expect(cardRows([], LINE)).toEqual([{ type: 'line', text: LINE, meaning: '' }]);
  });
});

describe('the suggest_saves tool (v2 spec §5.3)', () => {
  it('is exactly the tool in the spec', () => {
    expect(SUGGEST_SAVES_TOOL_NAME).toBe('suggest_saves');
    expect(MAX_SUGGESTIONS).toBe(6);
    expect(SUGGEST_SAVES_TOOL).toEqual({
      name: 'suggest_saves',
      description: 'Save suggestions for the learner: items from the subtitle line worth studying.',
      input_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            maxItems: 6,
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['word', 'phrase', 'idiom', 'line'] },
                text: { type: 'string' },
                meaning: { type: 'string' },
              },
              required: ['type', 'text', 'meaning'],
            },
          },
        },
        required: ['items'],
      },
    });
  });
});

describe('validateSuggestions (v2 spec §5.4)', () => {
  it('keeps valid suggestions in order, with text and meaning trimmed', () => {
    expect(
      validateSuggestions(input({ type: 'idiom', text: '  call it a night ', meaning: ' end the evening ' }, { ...WORD }), LINE),
    ).toEqual([IDIOM, WORD]);
  });

  it('finds the text in the line whatever its case, spacing or line breaks, and keeps it as written', () => {
    expect(validateSuggestions(input({ type: 'phrase', text: 'GONNA  call', meaning: 'm' }), LINE)).toEqual([
      { type: 'phrase', text: 'GONNA  call', meaning: 'm' },
    ]);
  });

  it('drops text that is empty, longer than 120 characters, or not in the line', () => {
    const long = 'word '.repeat(30).trim(); // 149 characters, and in the line below
    expect(
      validateSuggestions(
        input(
          { type: 'word', text: '   ', meaning: 'm' },
          { type: 'word', text: 'tomorrow', meaning: 'm' },
          { type: 'phrase', text: long, meaning: 'm' },
        ),
        `${long} gonna`,
      ),
    ).toEqual([]);
  });

  it('drops unknown types and items without string text and meaning', () => {
    expect(
      validateSuggestions(
        input(
          { type: 'slang', text: 'gonna', meaning: 'm' },
          { type: 'word', text: 5, meaning: 'm' },
          { type: 'word', text: 'gonna' },
          { text: 'gonna', meaning: 'm' },
          'gonna',
          null,
          WORD,
        ),
        LINE,
      ),
    ).toEqual([WORD]);
  });

  it('returns no suggestions for input without an items array', () => {
    for (const bad of [undefined, null, 'items', [], {}, { items: 'gonna' }]) {
      expect(validateSuggestions(bad, LINE)).toEqual([]);
    }
  });

  it("uses the line itself as a line suggestion's text, whatever Claude wrote, even past 120 characters", () => {
    const longLine = `${'so '.repeat(50)}gonna`; // 155 characters
    expect(validateSuggestions(input({ type: 'line', text: 'something else', meaning: ' Time for bed. ' }), longLine)).toEqual([
      { type: 'line', text: longLine, meaning: 'Time for bed.' },
    ]);
  });

  it('keeps the first of duplicates (same type and text, any case or spacing), so at most one line', () => {
    expect(
      validateSuggestions(
        input(
          WORD,
          { type: 'word', text: ' GONNA ', meaning: 'other' },
          { type: 'phrase', text: 'gonna', meaning: 'as a phrase' },
          { type: 'line', text: LINE, meaning: 'first' },
          { type: 'line', text: 'x', meaning: 'second' },
        ),
        LINE,
      ),
    ).toEqual([WORD, { type: 'phrase', text: 'gonna', meaning: 'as a phrase' }, { type: 'line', text: LINE, meaning: 'first' }]);
  });

  it("keeps at most 6 valid suggestions; invalid ones don't count", () => {
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
    const result = validateSuggestions(
      input({ type: 'word', text: 'nine', meaning: 'm' }, ...words.map((text) => ({ type: 'word', text, meaning: 'm' }))),
      words.join(' '),
    );
    expect(result.map((s) => s.text)).toEqual(['one', 'two', 'three', 'four', 'five', 'six']);
  });

  it('cuts meanings at 200 characters', () => {
    const [only] = validateSuggestions(input({ ...WORD, meaning: 'x'.repeat(250) }), LINE);
    expect(only?.meaning).toBe('x'.repeat(200));
  });
});
