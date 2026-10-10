import { browser } from '#imports';
import { BookOpen, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { buttonSecondary, card, iconTile } from '@/components/styles';
import { setPendingSeek } from '@/lib/pending-seek';
import { episodeLabel, seasonLabel } from '@/lib/study-log/format';
import { groupStudyLog, type StudyLogTree as Tree } from '@/lib/study-log/group';
import { deleteEntries, listEntries, resetStudyLog, watchStudyLog } from '@/lib/study-log/store';
import type { StudyLogEntry } from '@/lib/study-log/types';
import { StudyLogEntries } from './StudyLogEntries';
import { StudyLogTree } from './StudyLogTree';

interface Selectable {
  key: string;
  heading: string;
  subheading: string;
  deleteLabel: string;
  entries: StudyLogEntry[];
}

interface PendingDelete {
  title: string;
  body: string;
  confirmLabel?: string;
  run(): Promise<void>;
}

const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;

/** Episodes in tree order, then movies — what the right-hand panel can show. */
function selectable(tree: Tree): Selectable[] {
  const episodes = tree.series.flatMap((series) =>
    series.seasons.flatMap((season) =>
      season.episodes.map((episode) => ({
        key: episode.key,
        heading: series.title,
        subheading: `${seasonLabel(season.seasonNumber)} · ${episodeLabel(episode)}`,
        deleteLabel: 'Delete episode',
        entries: episode.entries,
      })),
    ),
  );
  const movies = tree.movies.map((movie) => ({
    key: movie.key,
    heading: movie.title,
    subheading: 'Movie',
    deleteLabel: 'Delete movie',
    entries: movie.entries,
  }));
  return [...episodes, ...movies];
}

/** Spec §5.5 Open at this moment: leave a pending seek, then open the episode on Netflix. */
async function openInNetflix(entry: StudyLogEntry): Promise<void> {
  await setPendingSeek(entry.videoId, entry.videoTimeMs);
  await browser.tabs.create({ url: `https://www.netflix.com/watch/${entry.videoId}` });
}

export function StudyLogTab({ openAtMoment = openInNetflix }: { openAtMoment?: (entry: StudyLogEntry) => Promise<void> } = {}) {
  const [entries, setEntries] = useState<StudyLogEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      void listEntries().then((list) => {
        if (active) setEntries(list);
      });
    load();
    const unwatch = watchStudyLog(load);
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  const tree = useMemo(() => groupStudyLog(entries ?? []), [entries]);
  const nodes = useMemo(() => selectable(tree), [tree]);
  const current = nodes.find((n) => n.key === selected) ?? nodes[0] ?? null;

  const confirmDelete = (title: string, body: string, ids: string[]) =>
    setPending({ title, body, run: () => deleteEntries(ids) });

  if (entries === null) return <p className="text-sm font-semibold text-mute">Loading…</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-black tracking-tight">Study Log</h1>
          <p className="mt-1 text-[15px] font-semibold text-mute">Every line you've explained, by show and episode.</p>
        </div>
        {tree.total > 0 && (
          <button
            type="button"
            className={buttonSecondary}
            onClick={() =>
              setPending({
                title: 'Reset your Study Log?',
                body: "Every saved line and explanation will be removed. This can't be undone.",
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

      {tree.total === 0 ? (
        <section className={`${card} flex items-start gap-3.5 px-5 py-5`}>
          <span className={iconTile}>
            <BookOpen size={20} strokeWidth={2.5} aria-hidden />
          </span>
          <div>
            <h2 className="text-[19px] font-black">Nothing here yet</h2>
            <p className="mt-0.5 text-sm font-semibold text-mute">
              Hover a subtitle on Netflix to explain your first line. It lands here automatically.
            </p>
          </div>
        </section>
      ) : (
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <StudyLogTree
            tree={tree}
            selected={current?.key ?? null}
            onSelect={setSelected}
            onDeleteSeries={(series) =>
              confirmDelete(
                `Delete ${series.title}?`,
                `All ${lines(series.count)} from this show will be removed.`,
                series.seasons.flatMap((s) => s.episodes.flatMap((e) => e.entries.map((x) => x.id))),
              )
            }
            onDeleteSeason={(series, season) =>
              confirmDelete(
                `Delete ${series.title} ${seasonLabel(season.seasonNumber)}?`,
                `All ${lines(season.count)} from this season will be removed.`,
                season.episodes.flatMap((e) => e.entries.map((x) => x.id)),
              )
            }
          />
          {current && (
            <StudyLogEntries
              heading={current.heading}
              subheading={current.subheading}
              entries={current.entries}
              deleteLabel={current.deleteLabel}
              onDeleteAll={() =>
                confirmDelete(
                  `${current.deleteLabel}?`,
                  `All ${lines(current.entries.length)} from ${current.subheading === 'Movie' ? 'this movie' : 'this episode'} will be removed.`,
                  current.entries.map((e) => e.id),
                )
              }
              onDeleteEntry={(entry) =>
                confirmDelete('Delete this line?', `“${entry.phrase}” and its explanation will be removed from your Study Log.`, [entry.id])
              }
              onOpenAtMoment={(entry) => void openAtMoment(entry)}
            />
          )}
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
