import { Film, Trash2 } from 'lucide-react';
import { focusRing } from '@/components/styles';
import { episodeLabel, savedItemsLabel, seasonLabel } from '@/lib/study-log/format';
import type { SeasonNode, SeriesNode, StudyLogTree as Tree } from '@/lib/study-log/group';

/** The tree node that lists every saved item, newest first (v2 spec §6.1). */
export const ALL_ITEMS = 'all-items';

const countPill = 'ml-auto rounded-full bg-soft px-2 text-[11px] font-extrabold text-mute';
const trashButton = `grid size-7 shrink-0 place-items-center rounded-lg text-mute hover:bg-soft hover:text-danger ${focusRing}`;

interface StudyLogTreeProps {
  tree: Tree;
  selected: string;
  onSelect(key: string): void;
  onDeleteSeries(series: SeriesNode): void;
  onDeleteSeason(series: SeriesNode, season: SeasonNode): void;
}

function NodeButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={`${label}, ${savedItemsLabel(count)}`}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-xl border-2 px-2.5 py-1.5 text-left text-sm font-bold ${focusRing} ${
        active ? 'border-tint-line bg-tint text-tint-ink' : 'border-transparent hover:bg-soft'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span aria-hidden="true" className={countPill}>
        {count}
      </span>
    </button>
  );
}

/** A row's count: the pill is what you see, "N saved items" is what a screen reader says. */
function Count({ n }: { n: number }) {
  return (
    <>
      <span aria-hidden="true" className={countPill}>
        {n}
      </span>
      <span className="sr-only">{savedItemsLabel(n)}</span>
    </>
  );
}

/** v2 spec §6.1: All items, then Series → Season → Episode with saved-item counts, plus Movies. */
export function StudyLogTree({ tree, selected, onSelect, onDeleteSeries, onDeleteSeason }: StudyLogTreeProps) {
  return (
    <nav aria-label="Shows and movies" className="flex flex-col gap-4">
      <NodeButton label="All items" count={tree.total} active={selected === ALL_ITEMS} onClick={() => onSelect(ALL_ITEMS)} />
      {tree.series.map((series) => (
        <div key={series.key}>
          <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate text-[15px] font-black">{series.title}</p>
            <Count n={series.count} />
            <button type="button" aria-label={`Delete ${series.title}`} onClick={() => onDeleteSeries(series)} className={trashButton}>
              <Trash2 size={14} strokeWidth={2.5} aria-hidden />
            </button>
          </div>
          {series.seasons.map((season) => (
            <div key={season.key} className="mt-1.5">
              <div className="flex items-center gap-1 pl-1">
                <p className="flex-1 text-[12px] font-extrabold tracking-wide text-mute uppercase">{seasonLabel(season.seasonNumber)}</p>
                <Count n={season.count} />
                <button
                  type="button"
                  aria-label={`Delete ${series.title} ${seasonLabel(season.seasonNumber)}`}
                  onClick={() => onDeleteSeason(series, season)}
                  className={trashButton}
                >
                  <Trash2 size={14} strokeWidth={2.5} aria-hidden />
                </button>
              </div>
              <ul className="mt-1 flex flex-col gap-1">
                {season.episodes.map((episode) => (
                  <li key={episode.key}>
                    <NodeButton
                      label={episodeLabel(episode)}
                      count={episode.items.length}
                      active={selected === episode.key}
                      onClick={() => onSelect(episode.key)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
      {tree.movies.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-[15px] font-black">
            <Film size={16} strokeWidth={2.5} aria-hidden />
            Movies
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {tree.movies.map((movie) => (
              <li key={movie.key}>
                <NodeButton label={movie.title} count={movie.items.length} active={selected === movie.key} onClick={() => onSelect(movie.key)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
