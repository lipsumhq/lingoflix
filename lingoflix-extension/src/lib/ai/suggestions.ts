import { ITEM_TYPES, type ItemType, type SaveSuggestion } from '@/lib/study-log/types';
import { normalizeLine } from '@/lib/subtitles/cue';

// Bundled into the Netflix content script (the card uses cardRows): never import an SDK here.

export const SUGGEST_SAVES_TOOL_NAME = 'suggest_saves';
export const MAX_SUGGESTIONS = 6;
const MAX_TEXT_CHARS = 120;
const MAX_MEANING_CHARS = 200;

/** The shape of a Messages API tool definition, as the Claude client sends it. */
interface ToolShape {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** v2 spec §5.3, exactly. Claude calls it once, after the explanation. */
export const SUGGEST_SAVES_TOOL: ToolShape = {
  name: SUGGEST_SAVES_TOOL_NAME,
  description: 'Save suggestions for the learner: items from the subtitle line worth studying.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: MAX_SUGGESTIONS,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...ITEM_TYPES] },
            text: { type: 'string' },
            meaning: { type: 'string' },
          },
          required: ['type', 'text', 'meaning'],
        },
      },
    },
    required: ['items'],
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Comparable form: case, spacing and line breaks don't matter. */
const fold = (text: string) => normalizeLine(text).toLowerCase();

/**
 * Claude's `suggest_saves` input, checked (v2 spec §5.4); anything invalid is dropped silently.
 * - The type must be word, phrase, idiom or line, and text and meaning must be strings.
 * - Word, phrase and idiom text is trimmed and must be non-empty, at most 120 characters, and appear in the line
 *   (ignoring case, spacing and line breaks). A line suggestion's text is replaced by the line itself.
 * - Meanings are trimmed and cut at 200 characters.
 * - The first of two suggestions with the same type and text wins (so at most one line); at most 6 are kept.
 */
export function validateSuggestions(toolInput: unknown, line: string): SaveSuggestion[] {
  const items = isRecord(toolInput) && Array.isArray(toolInput.items) ? toolInput.items : [];
  const foldedLine = fold(line);
  const seen = new Set<string>();
  const valid: SaveSuggestion[] = [];
  for (const raw of items) {
    if (valid.length >= MAX_SUGGESTIONS) break;
    if (!isRecord(raw)) continue;
    const { type, text, meaning } = raw;
    if (!ITEM_TYPES.includes(type as ItemType) || typeof text !== 'string' || typeof meaning !== 'string') continue;
    const itemType = type as ItemType;
    const itemText = itemType === 'line' ? line : text.trim();
    if (itemType !== 'line' && (!itemText || itemText.length > MAX_TEXT_CHARS || !foldedLine.includes(fold(itemText)))) continue;
    const key = `${itemType}|${fold(itemText)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ type: itemType, text: itemText, meaning: meaning.trim().slice(0, MAX_MEANING_CHARS) });
  }
  return valid;
}

/**
 * The card's Save rows (v2 spec §4.1): Claude's suggestions in order, the `line` one last. When Claude suggested
 * no line, a Whole line row without a meaning; the line can always be saved.
 */
export function cardRows(suggestions: readonly SaveSuggestion[], line: string): SaveSuggestion[] {
  const lineSuggestion = suggestions.find((s) => s.type === 'line');
  return [...suggestions.filter((s) => s.type !== 'line'), { type: 'line', text: line, meaning: lineSuggestion?.meaning ?? '' }];
}
