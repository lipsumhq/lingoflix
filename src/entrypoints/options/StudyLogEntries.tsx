import { ChevronDown, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { buttonSecondary, card, focusRing } from '@/components/styles';
import { formatTimestamp } from '@/lib/study-log/format';
import type { StudyLogEntry } from '@/lib/study-log/types';

interface StudyLogEntriesProps {
  heading: string;
  subheading: string;
  entries: StudyLogEntry[];
  deleteLabel: string;
  onDeleteAll(): void;
  onDeleteEntry(entry: StudyLogEntry): void;
  onOpenAtMoment(entry: StudyLogEntry): void;
}

function EntryItem({ entry, onDelete, onOpen }: { entry: StudyLogEntry; onDelete(): void; onOpen(): void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`${card} px-4 py-3`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-lg bg-tint px-2 py-0.5 text-[12px] font-black text-tint-ink">{formatTimestamp(entry.videoTimeMs)}</span>
        <p className="min-w-0 flex-1 text-[15px] font-extrabold whitespace-pre-line">{entry.phrase}</p>
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`mt-2 inline-flex items-center gap-1 text-[13px] font-extrabold text-mute hover:text-ink ${focusRing}`}
      >
        <ChevronDown size={14} strokeWidth={3} className={open ? 'rotate-180' : ''} aria-hidden />
        {open ? 'Hide explanation' : 'Show explanation'}
      </button>
      {open && (
        <div className="mt-2 border-t-2 border-soft pt-2">
          <Markdown>{entry.response}</Markdown>
          {entry.followUps.map((f, i) => (
            <div key={i} className="mt-3 border-t-2 border-soft pt-2">
              <p className="text-[13px] font-extrabold text-tint-ink">{f.question}</p>
              <Markdown>{f.answer}</Markdown>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onOpen} className={buttonSecondary}>
          <Play size={14} strokeWidth={3} fill="currentColor" aria-hidden />
          Open at this moment
        </button>
        <button type="button" onClick={onDelete} className={buttonSecondary}>
          <Trash2 size={14} strokeWidth={3} aria-hidden />
          Delete line
        </button>
      </div>
    </li>
  );
}

/** Spec §5.5: the selected episode's lines in time order. */
export function StudyLogEntries({ heading, subheading, entries, deleteLabel, onDeleteAll, onDeleteEntry, onOpenAtMoment }: StudyLogEntriesProps) {
  return (
    <section aria-labelledby="study-log-entries-heading" className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="study-log-entries-heading" className="text-[19px] font-black">
            {heading}
          </h2>
          <p className="text-sm font-semibold text-mute">{subheading}</p>
        </div>
        <button type="button" onClick={onDeleteAll} className={buttonSecondary}>
          <Trash2 size={14} strokeWidth={3} aria-hidden />
          {deleteLabel}
        </button>
      </header>
      <ol aria-label="Explained lines" className="flex flex-col gap-3">
        {entries.map((entry) => (
          <EntryItem key={entry.id} entry={entry} onDelete={() => onDeleteEntry(entry)} onOpen={() => onOpenAtMoment(entry)} />
        ))}
      </ol>
    </section>
  );
}
