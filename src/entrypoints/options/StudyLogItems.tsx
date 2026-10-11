import { Trash2 } from 'lucide-react';
import { buttonSecondary, focusRing } from '@/components/styles';
import { episodeCode, formatTimestamp, whereLabel } from '@/lib/study-log/format';
import type { ItemType, SavedItem } from '@/lib/study-log/types';

export const TYPE_LABEL: Record<ItemType, string> = { word: 'Word', phrase: 'Phrase', idiom: 'Idiom', line: 'Line' };

/** WORD, PHRASE, IDIOM, LINE (uppercase by CSS, so screen readers say the word). */
export function TypeBadge({ type }: { type: ItemType }) {
  return (
    <span className="shrink-0 rounded-lg bg-tint px-2 py-0.5 text-[11px] font-black tracking-wide text-tint-ink uppercase">{TYPE_LABEL[type]}</span>
  );
}

/**
 * Where a row's item is from (v2 spec §6.1): "S1 E3 30:34" inside an episode, the movie title and time for a
 * movie, and the show spelled out in All items, where shows are mixed ("Stranger Things S1 E3 30:34").
 */
export function whereText(item: SavedItem, scope: 'all' | 'node'): string {
  const time = formatTimestamp(item.lineTimeMs);
  if (scope === 'all' || item.kind === 'movie') return `${whereLabel(item)} ${time}`;
  return [episodeCode(item), time].filter(Boolean).join(' ');
}

interface StudyLogItemsProps {
  heading: string;
  subheading: string;
  /** Already filtered and ordered. */
  items: readonly SavedItem[];
  scope: 'all' | 'node';
  selectedId: string | null;
  onSelectItem(item: SavedItem): void;
  /** "Delete episode" or "Delete movie"; null in All items (no bulk delete there). */
  deleteLabel: string | null;
  onDeleteAll(): void;
  onClearFilters(): void;
}

/** v2 spec §6.1: the selected node's saved items. Empty only when the filters match nothing. */
export function StudyLogItems({
  heading,
  subheading,
  items,
  scope,
  selectedId,
  onSelectItem,
  deleteLabel,
  onDeleteAll,
  onClearFilters,
}: StudyLogItemsProps) {
  return (
    <section aria-labelledby="study-log-items-heading" className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* tabIndex -1: the focus lands here when the open item's detail closes and its row is gone. */}
          <h2 id="study-log-items-heading" tabIndex={-1} className="text-[19px] font-black outline-none">
            {heading}
          </h2>
          <p className="text-sm font-semibold text-mute">{subheading}</p>
        </div>
        {deleteLabel && (
          <button type="button" onClick={onDeleteAll} className={buttonSecondary}>
            <Trash2 size={14} strokeWidth={3} aria-hidden />
            {deleteLabel}
          </button>
        )}
      </header>
      {items.length === 0 ? (
        <div className="rounded-[18px] border-2 border-dashed border-line px-4 py-5 text-center">
          <p className="text-[15px] font-extrabold">Nothing matches.</p>
          <button type="button" onClick={onClearFilters} className={`${buttonSecondary} mt-3`}>
            Clear filters
          </button>
        </div>
      ) : (
        <ol aria-label="Saved items" className="flex flex-col gap-2">
          {items.map((item) => {
            const active = item.id === selectedId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  data-item-id={item.id}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelectItem(item)}
                  className={`flex w-full flex-col gap-1 rounded-[18px] border-2 px-4 py-3 text-left ${focusRing} ${
                    active ? 'border-tint-line bg-tint' : 'border-line bg-card hover:bg-soft'
                  }`}
                >
                  <span className="flex w-full items-start gap-2">
                    <TypeBadge type={item.type} />
                    <span data-item-text className="min-w-0 flex-1 text-[15px] font-extrabold whitespace-pre-line">
                      {item.text}
                    </span>
                    <span className="shrink-0 text-[12px] font-bold text-mute">{whereText(item, scope)}</span>
                  </span>
                  {item.meaning && <span className="text-sm font-semibold text-mute">{item.meaning}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
