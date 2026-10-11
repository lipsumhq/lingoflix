import { ArrowLeft, ChevronDown, Play, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Markdown } from '@/components/Markdown';
import { buttonSecondary, card, focusRing } from '@/components/styles';
import { formatTimestamp } from '@/lib/study-log/format';
import { highlightParts } from '@/lib/study-log/highlight';
import { getExplanation } from '@/lib/study-log/store';
import type { Explanation, SavedItem } from '@/lib/study-log/types';
import { TypeBadge } from './StudyLogItems';

interface StudyLogDetailProps {
  item: SavedItem;
  /** Narrow windows: the detail replaces the list, and Back returns to it. */
  narrow: boolean;
  onClose(): void;
  onDelete(item: SavedItem): void;
  onOpenAtMoment(item: SavedItem): void;
  loadExplanation?(id: string): Promise<Explanation | null>;
}

/** v2 spec §6.2: `Stranger Things · Season 1 · E3 "Holly, Jolly" · 30:34`, or `Roma · 1:02:03`. */
export function detailWhere(
  item: Pick<SavedItem, 'kind' | 'seriesTitle' | 'seasonNumber' | 'episodeNumber' | 'episodeTitle' | 'lineTimeMs'>,
): string {
  const time = formatTimestamp(item.lineTimeMs);
  if (item.kind === 'movie') return `${item.seriesTitle} · ${time}`;
  const title = item.episodeTitle ? `"${item.episodeTitle}"` : null;
  const episode = item.episodeNumber !== null ? [`E${item.episodeNumber}`, title].filter(Boolean).join(' ') : title;
  return [item.seriesTitle, item.seasonNumber !== null ? `Season ${item.seasonNumber}` : null, episode, time].filter(Boolean).join(' · ');
}

function Highlighted({ line, text, highlight }: { line: string; text: string; highlight: boolean }) {
  if (!highlight) return <>{line}</>;
  return (
    <>
      {highlightParts(line, text).map((part, i) =>
        part.mark ? (
          <mark key={i} className="rounded bg-tint px-0.5 text-tint-ink">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Collapsible({ label, defaultOpen, children }: { label: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="border-t-2 border-soft pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 text-[13px] font-extrabold text-mute hover:text-ink ${focusRing}`}
      >
        <ChevronDown size={14} strokeWidth={3} className={open ? 'rotate-180' : ''} aria-hidden />
        {label}
      </button>
      {open && (
        <div id={id} className="mt-2">
          {children}
        </div>
      )}
    </div>
  );
}

/** v2 spec §6.2: one saved item with everything known about where it came from. */
export function StudyLogDetail({ item, narrow, onClose, onDelete, onOpenAtMoment, loadExplanation = getExplanation }: StudyLogDetailProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // undefined while loading; null when there is none.
  const [explanation, setExplanation] = useState<Explanation | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setExplanation(undefined);
    const id = item.explanationId;
    const load = id ? loadExplanation(id).catch(() => null) : Promise.resolve(null);
    void load.then((found) => {
      if (active) setExplanation(found);
    });
    return () => {
      active = false;
    };
  }, [item.explanationId, loadExplanation]);

  // Keyboard and screen reader users land on the item when the detail opens (it may have replaced the list).
  useEffect(() => heading.current?.focus(), []);

  const highlight = item.type !== 'line';

  return (
    <section aria-labelledby={headingId} className={`${card} flex min-w-0 flex-col gap-3 px-5 py-4`}>
      <div className="flex items-center justify-between gap-2">
        {narrow ? (
          <button type="button" onClick={onClose} className={buttonSecondary}>
            <ArrowLeft size={14} strokeWidth={3} aria-hidden />
            Back
          </button>
        ) : (
          <TypeBadge type={item.type} />
        )}
        {!narrow && (
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className={`grid size-8 place-items-center rounded-lg text-mute hover:bg-soft hover:text-ink ${focusRing}`}
          >
            <X size={16} strokeWidth={3} aria-hidden />
          </button>
        )}
      </div>
      {narrow && (
        <div>
          <TypeBadge type={item.type} />
        </div>
      )}

      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-[22px] leading-tight font-black whitespace-pre-line outline-none">
        {item.text}
      </h2>
      {item.meaning && <p className="text-[15px] font-bold text-mute">{item.meaning}</p>}

      <blockquote className="rounded-xl border-2 border-line bg-soft px-3 py-2 text-[15px] font-bold whitespace-pre-line">
        <Highlighted line={item.line} text={item.text} highlight={highlight} />
      </blockquote>
      <p className="text-sm font-bold">{detailWhere(item)}</p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onOpenAtMoment(item)} className={buttonSecondary}>
          <Play size={14} strokeWidth={3} fill="currentColor" aria-hidden />
          Open at this moment
        </button>
        <button type="button" onClick={() => onDelete(item)} className={buttonSecondary}>
          <Trash2 size={14} strokeWidth={3} aria-hidden />
          Delete
        </button>
      </div>
      <p className="text-[13px] font-semibold text-mute">Saved {new Date(item.savedAt).toLocaleString()}</p>

      <Collapsible label="Dialogue around it" defaultOpen={false}>
        <ol aria-label="Dialogue around it" className="flex flex-col gap-1 text-sm">
          {item.context.before.map((line, i) => (
            <li key={`before-${i}`} className="font-semibold whitespace-pre-line text-mute">
              {line}
            </li>
          ))}
          <li aria-current="true" className="font-extrabold whitespace-pre-line">
            <Highlighted line={item.line} text={item.text} highlight={highlight} />
          </li>
          {item.context.after.map((line, i) => (
            <li key={`after-${i}`} className="font-semibold whitespace-pre-line text-mute">
              {line}
            </li>
          ))}
        </ol>
      </Collapsible>

      <Collapsible label="Claude's explanation" defaultOpen={item.meaning === ''}>
        {explanation === undefined && <p className="text-sm font-semibold text-mute">Loading…</p>}
        {explanation === null && <p className="text-sm font-semibold text-mute">Claude's explanation isn't available for this item.</p>}
        {explanation && (
          <>
            <Markdown>{explanation.response}</Markdown>
            {explanation.followUps.map((f, i) => (
              <div key={i} className="mt-3 border-t-2 border-soft pt-2">
                <p className="text-[13px] font-extrabold text-tint-ink">{f.question}</p>
                <Markdown>{f.answer}</Markdown>
              </div>
            ))}
          </>
        )}
      </Collapsible>
    </section>
  );
}
