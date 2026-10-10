import type { SaveSuggestion } from '@/lib/study-log/types';

/**
 * The card's Save rows (v2 spec §4.1): Claude's suggestions in order, the `line` one last. When Claude suggested
 * no line, a Whole line row without a meaning; the line can always be saved.
 */
export function cardRows(suggestions: readonly SaveSuggestion[], line: string): SaveSuggestion[] {
  const lineSuggestion = suggestions.find((s) => s.type === 'line');
  return [...suggestions.filter((s) => s.type !== 'line'), { type: 'line', text: line, meaning: lineSuggestion?.meaning ?? '' }];
}
