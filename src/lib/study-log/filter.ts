import { normalizeLine } from '@/lib/subtitles/cue';
import type { ItemType, SavedItem } from './types';

/** The Study Log toolbar's type filter (v2 spec §6.1). */
export type TypeFilter = ItemType | 'all';

/** Comparable form for search: case, spacing and line breaks don't matter (a whole line keeps its subtitle break). */
const fold = (text: string) => normalizeLine(text).toLocaleLowerCase();

/** Type filter plus a case-insensitive search over the item's text and meaning (v2 spec §6.1). */
export function filterItems(items: readonly SavedItem[], filter: { type: TypeFilter; query: string }): SavedItem[] {
  const query = fold(filter.query);
  return items.filter(
    (item) =>
      (filter.type === 'all' || item.type === filter.type) &&
      (!query || fold(item.text).includes(query) || fold(item.meaning).includes(query)),
  );
}

/** All items view: most recently saved first. */
export function newestFirst(items: readonly SavedItem[]): SavedItem[] {
  return [...items].sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id));
}
