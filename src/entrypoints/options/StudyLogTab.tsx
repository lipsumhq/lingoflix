import { BookOpen, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { buttonSecondary, card, iconTile } from '@/components/styles';
import { filterItems, newestFirst, type TypeFilter } from '@/lib/study-log/filter';
import { episodeLabel, savedItemsLabel, seasonLabel } from '@/lib/study-log/format';
import { groupStudyLog, type StudyLogTree as Tree } from '@/lib/study-log/group';
import { deleteItems, listItems, migrateIfNeeded } from '@/lib/study-log/items';
import { listExplanations, resetStudyLog, watchStudyLog } from '@/lib/study-log/store';
import type { SavedItem } from '@/lib/study-log/types';
import { StudyLogItems } from './StudyLogItems';
import { StudyLogToolbar } from './StudyLogToolbar';
import { ALL_ITEMS, StudyLogTree } from './StudyLogTree';

interface Selectable {
  key: string;
  heading: string;
  subheading: string;
  scope: 'all' | 'node';
  /** "Delete episode" or "Delete movie"; null for All items. */
  deleteLabel: string | null;
  /** "this episode" or "this movie", for the confirmation text. */
  place: string;
  items: SavedItem[];
}

interface PendingDelete {
  title: string;
  body: string;
  confirmLabel?: string;
  run(): Promise<void>;
}

interface Loaded {
  items: SavedItem[];
  /** How many explanations are in the history (Reset all also clears them). */
  historyCount: number;
}

const NO_ITEMS: SavedItem[] = [];
const KEEP_HISTORY = 'Explanations stay in your history.';

/** All items first, then episodes in tree order, then movies: what the list can show. */
function selectable(tree: Tree, all: readonly SavedItem[]): Selectable[] {
  const everything: Selectable = {
    key: ALL_ITEMS,
    heading: 'All items',
    subheading: savedItemsLabel(all.length),
    scope: 'all',
    deleteLabel: null,
    place: '',
    items: newestFirst(all),
  };
  const episodes = tree.series.flatMap((series) =>
    series.seasons.flatMap((season) =>
      season.episodes.map(
        (episode): Selectable => ({
          key: episode.key,
          heading: series.title,
          subheading: `${seasonLabel(season.seasonNumber)} · ${episodeLabel(episode)}`,
          scope: 'node',
          deleteLabel: 'Delete episode',
          place: 'this episode',
          items: episode.items,
        }),
      ),
    ),
  );
  const movies = tree.movies.map(
    (movie): Selectable => ({
      key: movie.key,
      heading: movie.title,
      subheading: 'Movie',
      scope: 'node',
      deleteLabel: 'Delete movie',
      place: 'this movie',
      items: movie.items,
    }),
  );
  return [everything, ...episodes, ...movies];
}

/** v2 spec §6: the learner's saved words, phrases, idioms and lines. */
export function StudyLogTab() {
  const [data, setData] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string>(ALL_ITEMS);
  const [type, setType] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      void Promise.all([listItems(), listExplanations()]).then(([items, explanations]) => {
        if (active) setData({ items, historyCount: explanations.length });
      });
    // Explanations from before v2 become saved lines first (v2 spec §3.3). migrateIfNeeded reads only the marker
    // once converted and runs one conversion at a time (StrictMode runs this effect twice); it never rejects, so
    // a failed conversion still shows what's there.
    void migrateIfNeeded().then(load, load);
    const unwatch = watchStudyLog(load);
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  const items = data?.items ?? NO_ITEMS;
  const tree = useMemo(() => groupStudyLog(items), [items]);
  const nodes = useMemo(() => selectable(tree, items), [tree, items]);
  const current = nodes.find((n) => n.key === selected) ?? nodes[0]!;
  const visible = useMemo(() => filterItems(current.items, { type, query }), [current, type, query]);

  const confirmDelete = (title: string, body: string, ids: string[]) => setPending({ title, body, run: () => deleteItems(ids) });
  const clearFilters = () => {
    setType('all');
    setQuery('');
  };

  if (data === null) return <p className="text-sm font-semibold text-mute">Loading…</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-black tracking-tight">Study Log</h1>
          <p className="mt-1 text-[15px] font-semibold text-mute">Words, phrases, idioms and lines you saved.</p>
        </div>
        {items.length + data.historyCount > 0 && (
          <button
            type="button"
            className={buttonSecondary}
            onClick={() =>
              setPending({
                title: 'Reset your Study Log?',
                body: "Every saved item and every explanation in your history will be removed. This can't be undone.",
                confirmLabel: 'Reset all',
                run: resetStudyLog,
              })
            }
          >
            <RotateCcw size={14} strokeWidth={3} aria-hidden />
            Reset all
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <section className={`${card} flex items-start gap-3.5 px-5 py-5`}>
          <span className={iconTile}>
            <BookOpen size={20} strokeWidth={2.5} aria-hidden />
          </span>
          <div>
            <h2 className="text-[19px] font-black">Nothing saved yet</h2>
            <p className="mt-0.5 text-sm font-semibold text-mute">Hover a line on Netflix and save words, phrases, idioms or whole lines.</p>
          </div>
        </section>
      ) : (
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <StudyLogTree
            tree={tree}
            selected={current.key}
            onSelect={(key) => {
              setSelected(key);
              setSelectedItemId(null);
            }}
            onDeleteSeries={(series) =>
              confirmDelete(
                `Delete ${series.title}?`,
                `All ${savedItemsLabel(series.count)} from this show will be removed. ${KEEP_HISTORY}`,
                series.seasons.flatMap((s) => s.episodes.flatMap((e) => e.items.map((i) => i.id))),
              )
            }
            onDeleteSeason={(series, season) =>
              confirmDelete(
                `Delete ${series.title} ${seasonLabel(season.seasonNumber)}?`,
                `All ${savedItemsLabel(season.count)} from this season will be removed. ${KEEP_HISTORY}`,
                season.episodes.flatMap((e) => e.items.map((i) => i.id)),
              )
            }
          />
          <div className="flex min-w-0 flex-col gap-4">
            <StudyLogToolbar type={type} onTypeChange={setType} query={query} onQueryChange={setQuery} />
            <StudyLogItems
              heading={current.heading}
              subheading={current.subheading}
              items={visible}
              scope={current.scope}
              selectedId={selectedItemId}
              onSelectItem={(item) => setSelectedItemId(item.id)}
              deleteLabel={current.deleteLabel}
              onDeleteAll={() =>
                confirmDelete(
                  `${current.deleteLabel}?`,
                  `All ${savedItemsLabel(current.items.length)} from ${current.place} will be removed. ${KEEP_HISTORY}`,
                  current.items.map((i) => i.id),
                )
              }
              onClearFilters={clearFilters}
            />
          </div>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirmLabel}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            void action.run();
          }}
        />
      )}
    </div>
  );
}
