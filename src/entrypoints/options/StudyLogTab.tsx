import { browser } from '#imports';
import { BookOpen, RotateCcw } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { buttonSecondary, card, iconTile } from '@/components/styles';
import { useWideLayout } from '@/hooks/useWideLayout';
import { downloadText } from '@/lib/download';
import { setPendingSeek } from '@/lib/pending-seek';
import { EXPORT_MIME, exportFileName, toAnki, toBackup, toCsv, type ExportKind } from '@/lib/study-log/export';
import { filterItems, newestFirst, type TypeFilter } from '@/lib/study-log/filter';
import { episodeLabel, savedItemsLabel, seasonLabel } from '@/lib/study-log/format';
import { groupStudyLog, type StudyLogTree as Tree } from '@/lib/study-log/group';
import { IMPORT_ERROR_COPY, IMPORT_FAILED_COPY, importBackup, importSummaryText } from '@/lib/study-log/import';
import { deleteItems, listItems, migrateIfNeeded } from '@/lib/study-log/items';
import { listExplanations, readStudyLog, resetStudyLog, watchStudyLog } from '@/lib/study-log/store';
import type { SavedItem } from '@/lib/study-log/types';
import { StudyLogDetail } from './StudyLogDetail';
import { StudyLogExportMenu } from './StudyLogExportMenu';
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

/** Main spec §5.5 Open at this moment: leave a pending seek, then open the episode on Netflix. */
async function openInNetflix(item: SavedItem): Promise<void> {
  await setPendingSeek(item.videoId, item.lineTimeMs);
  await browser.tabs.create({ url: `https://www.netflix.com/watch/${item.videoId}` });
}

/** v2 spec §6: the learner's saved words, phrases, idioms and lines, with a detail view. */
export function StudyLogTab({
  openAtMoment = openInNetflix,
  download = downloadText,
}: {
  openAtMoment?: (item: SavedItem) => Promise<void>;
  download?: (fileName: string, text: string, mimeType: string) => void;
} = {}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string>(ALL_ITEMS);
  const [type, setType] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const wide = useWideLayout();
  const grid = useRef<HTMLDivElement>(null);
  const lastOpenId = useRef<string | null>(null);
  const [importStatus, setImportStatus] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** v2 spec §7.4: adds the chosen backup; the list reloads through watchStudyLog. */
  const importFile = async (file: File) => {
    try {
      const result = await importBackup(await file.text());
      setImportStatus(result.ok ? { tone: 'good', text: importSummaryText(result.summary) } : { tone: 'bad', text: IMPORT_ERROR_COPY[result.error] });
    } catch {
      setImportStatus({ tone: 'bad', text: IMPORT_FAILED_COPY });
    }
  };

  useEffect(() => {
    let active = true;
    const load = () =>
      void readStudyLog().then(({ items, explanations }) => {
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
  // Gone when it was deleted (here or from another tab).
  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;
  // A selected node or item that's gone is dropped from the selection, not only hidden: a later reload that brings
  // it back (a Netflix tab saving to that episode again, an import) must not jump the page to it unasked. Adjusting
  // state during render: React re-renders right away, before anything is shown.
  if (current.key !== selected) setSelected(ALL_ITEMS);
  if (selectedItemId !== null && selectedItem === null) setSelectedItemId(null);

  // v2 spec §6.1: Escape closes the detail view. A confirmation dialog handles its own Escape first.
  useEffect(() => {
    if (!selectedItem || pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedItemId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedItem, pending]);

  // The detail takes the focus when it opens (StudyLogDetail). When it closes and the focus went with it (Back,
  // Close details, Escape, its item deleted), the focus goes back to that item's row, or to the list heading when
  // the row is gone or filtered out. Focus that is still somewhere (the tree, the search box) stays there.
  const openId = selectedItem?.id ?? null;
  useLayoutEffect(() => {
    const closedId = lastOpenId.current;
    lastOpenId.current = openId;
    if (closedId === null || openId !== null) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const root = grid.current;
    if (!root) return;
    const row = [...root.querySelectorAll<HTMLElement>('[data-item-id]')].find((el) => el.dataset.itemId === closedId);
    (row ?? root.querySelector<HTMLElement>('#study-log-items-heading') ?? root.querySelector<HTMLElement>('nav [aria-current="true"]'))?.focus();
  }, [openId]);

  const confirmDelete = (title: string, body: string, ids: string[]) => setPending({ title, body, run: () => deleteItems(ids) });
  const clearFilters = () => {
    setType('all');
    setQuery('');
  };
  const closeDetail = () => setSelectedItemId(null);
  const askDeleteItem = (item: SavedItem) =>
    setPending({
      title: 'Delete this item?',
      body: `“${item.text}” will be removed from your Study Log. Its explanation stays in your history.`,
      run: async () => {
        await deleteItems([item.id]);
        setSelectedItemId((id) => (id === item.id ? null : id));
      },
    });

  if (data === null) return <p className="text-sm font-semibold text-mute">Loading…</p>;

  const hasItems = items.length > 0;

  const exportAs = async (kind: ExportKind) => {
    const now = new Date();
    const text = kind === 'anki' ? toAnki(visible) : kind === 'csv' ? toCsv(visible) : toBackup(await listItems(), await listExplanations(), now);
    download(exportFileName(kind, now), text, EXPORT_MIME[kind]);
  };

  // Full backup also covers explanation history, which exists even with no saved items (v2 spec §7.3).
  const exportMenu = (
    <StudyLogExportMenu
      canExportView={visible.length > 0}
      canBackup={hasItems || data.historyCount > 0}
      onExport={(kind) => void exportAs(kind)}
      onImport={() => fileInput.current?.click()}
    />
  );

  const detail = selectedItem && (
    <StudyLogDetail
      key={selectedItem.id}
      item={selectedItem}
      narrow={!wide}
      onClose={closeDetail}
      onDelete={askDeleteItem}
      onOpenAtMoment={(item) => void openAtMoment(item)}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-black tracking-tight">Study Log</h1>
          <p className="mt-1 text-[15px] font-semibold text-mute">Words, phrases, idioms and lines you saved.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!hasItems && exportMenu}
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
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        aria-label="Backup file"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = ''; // choosing the same file again fires change again
          if (file) void importFile(file);
        }}
      />
      {/* Kept in the accessibility tree while empty (sr-only, not display: none), so its first message is announced. */}
      <p role="status" className={importStatus ? `text-sm font-bold ${importStatus.tone === 'bad' ? 'text-danger' : 'text-ink'}` : 'sr-only'}>
        {importStatus?.text ?? ''}
      </p>

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
        <div
          ref={grid}
          // One template at a time: `wide` already is the 1100 px query, and two breakpoint variants would fight
          // over source order in the built CSS (Tailwind puts `min-[1100px]:` before `md:`, so `md:` would win).
          className={`grid gap-5 ${detail && wide ? 'md:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]' : 'md:grid-cols-[220px_minmax(0,1fr)]'}`}
        >
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
          {detail && !wide ? (
            detail
          ) : (
            <div className="flex min-w-0 flex-col gap-4">
              <StudyLogToolbar type={type} onTypeChange={setType} query={query} onQueryChange={setQuery} actions={exportMenu} />
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
          )}
          {detail && wide && detail}
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
