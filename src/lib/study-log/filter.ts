import type { ItemType, SavedItem } from './types';

/** The Study Log toolbar's type filter (v2 spec §6.1). */
export type TypeFilter = ItemType | 'all';

/** Type filter plus a case-insensitive search over the item's text and meaning (v2 spec §6.1). */
export function filterItems(items: readonly SavedItem[], filter: { type: TypeFilter; query: string }): SavedItem[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (filter.type === 'all' || item.type === filter.type) &&
      (!query || item.text.toLocaleLowerCase().includes(query) || item.meaning.toLocaleLowerCase().includes(query)),
  );
}

/** All items view: most recently saved first. */
export function newestFirst(items: readonly SavedItem[]): SavedItem[] {
  return [...items].sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id));
}
