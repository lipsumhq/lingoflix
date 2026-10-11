import { ArrowUp, BookOpen, Check, Loader2, Plus, RotateCcw, Settings as SettingsIcon, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { LogoMark } from '@/components/Logo';
import { Markdown } from '@/components/Markdown';
import { PROVIDERS } from '@/lib/ai/provider';
import { cardRows } from '@/lib/ai/suggestions';
import { suggestionKey } from '@/lib/study-log/items';
import type { Explanation, ItemType, SaveSuggestion } from '@/lib/study-log/types';
import type { Box, CardState, SaveStatus } from './card-state';
import { placeCard } from './positioning';

export interface CardProps {
  card: CardState;
  /** The player's viewport rect; null falls back to the bottom-right corner. */
  player: Box | null;
  onRegenerate(): void;
  onRetry(): void;
  onFollowUp(question: string): void;
  /** Saves a Save row, or removes it when it is saved. */
  onToggleSave(row: SaveSuggestion): void;
  onClose(): void;
  onOpenSettings(): void;
  cardRef?(element: HTMLElement | null): void;
}

const secondaryButton =
  'inline-flex items-center gap-1.5 rounded-xl border-2 border-line bg-card px-3 py-1.5 text-[12px] font-extrabold tracking-wide text-ink uppercase shadow-[0_3px_0_var(--lf-line)] hover:bg-soft active:translate-y-[3px] active:shadow-none disabled:opacity-40';
const primaryButton =
  'inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-[12px] font-extrabold tracking-wide text-on-brand uppercase shadow-[0_3px_0_var(--lf-brand-edge)] active:translate-y-[3px] active:shadow-none';
const saveToggle =
  'inline-flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1 text-[12px] font-extrabold tracking-wide uppercase active:translate-y-[3px] active:shadow-none disabled:opacity-60';
const saveButton = `${saveToggle} border-2 border-line bg-card text-ink shadow-[0_3px_0_var(--lf-line)] hover:bg-soft`;
const savedButton = `${saveToggle} border-2 border-brand bg-brand text-on-brand shadow-[0_3px_0_var(--lf-brand-edge)]`;

const TYPE_BADGE: Record<ItemType, string> = { word: 'WORD', phrase: 'PHRASE', idiom: 'IDIOM', line: 'LINE' };

/** Free-own-key spec §4.6: the headline, then Open Settings or Retry; out of credit also links to the billing page. */
function ErrorBlock({ error, onRetry, onOpenSettings }: { error: NonNullable<CardState['error']>; onRetry(): void; onOpenSettings(): void }) {
  const needsSettings = error.code === 'no-key' || error.code === 'bad-key';
  const canRetry = error.code === 'busy' || error.code === 'network' || error.code === 'no-credit';
  const billing = error.code === 'no-credit' && error.provider ? PROVIDERS[error.provider] : null;
  return (
    <div className="rounded-xl border-2 border-line bg-soft px-3 py-2.5">
      <p role="alert" className="text-[14px] font-extrabold">
        {error.message}
      </p>
      {billing && (
        <a
          href={billing.billingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-[13px] font-bold text-tint-ink underline underline-offset-2"
        >
          Add credit at {billing.console}
        </a>
      )}
      {needsSettings && (
        <button type="button" className={`${primaryButton} mt-2`} onClick={onOpenSettings}>
          <SettingsIcon size={14} strokeWidth={3} aria-hidden />
          Open Settings
        </button>
      )}
      {canRetry && (
        <button type="button" className={`${secondaryButton} mt-2`} onClick={onRetry}>
          <RotateCcw size={14} strokeWidth={3} aria-hidden />
          Retry
        </button>
      )}
    </div>
  );
}

function SaveRow({ row, saved, status, onToggle }: { row: SaveSuggestion; saved: boolean; status: SaveStatus | undefined; onToggle(): void }) {
  const wholeLine = row.type === 'line';
  const label = status === 'error' ? "Couldn't save" : saved ? 'Saved' : 'Save';
  const Icon = status === 'saving' ? Loader2 : saved ? Check : Plus;
  return (
    <li className="flex items-start gap-2.5">
      <button
        type="button"
        aria-label={wholeLine ? 'Save whole line' : `Save "${row.text}"`}
        aria-pressed={saved}
        aria-busy={status === 'saving'}
        disabled={status === 'saving'}
        onClick={onToggle}
        className={saved ? savedButton : saveButton}
      >
        <Icon size={14} strokeWidth={3} className={status === 'saving' ? 'animate-spin' : undefined} aria-hidden />
        <span>{label}</span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-[14px] leading-snug font-extrabold">{wholeLine ? 'Whole line' : row.text}</span>
          <span className="rounded-lg bg-soft px-1.5 py-0.5 text-[10px] font-black tracking-wide text-mute">{TYPE_BADGE[row.type]}</span>
        </p>
        {row.meaning && <p className="text-[13px] leading-snug font-semibold text-mute">{row.meaning}</p>}
      </div>
    </li>
  );
}

/** v2 spec §4.1: Claude's suggestions, then the whole line, each with a Save toggle. */
function SaveSection({
  explanation,
  savedKeys,
  saveStatus,
  onToggle,
}: {
  explanation: Explanation;
  savedKeys: readonly string[];
  saveStatus: CardState['saveStatus'];
  onToggle(row: SaveSuggestion): void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-3 border-t-2 border-soft pt-3">
      <h3 id={headingId} className="text-[12px] font-extrabold tracking-wide text-mute uppercase">
        Save
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {cardRows(explanation.suggestions, explanation.phrase).map((row) => {
          const key = suggestionKey(explanation, row);
          return <SaveRow key={key} row={row} saved={savedKeys.includes(key)} status={saveStatus[key]} onToggle={() => onToggle(row)} />;
        })}
      </ul>
    </section>
  );
}

function FollowUpBox({ busy, onSend }: { busy: boolean; onSend(question: string): void }) {
  const [text, setText] = useState('');
  const send = () => {
    const question = text.trim();
    if (!question || busy) return;
    onSend(question);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends and Shift+Enter is a new line. An Enter that commits an IME composition (Korean,
    // Japanese, Chinese) does neither: isComposing, or keyCode 229 in Chrome.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    send();
  };
  return (
    <form
      className="flex items-end gap-2 border-t-2 border-soft px-4 py-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        aria-label="Ask a follow-up question"
        rows={1}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about this line…"
        className="max-h-24 min-h-9 flex-1 resize-none rounded-xl border-2 border-line bg-page px-3 py-1.5 text-[14px] text-ink outline-none placeholder:text-mute focus:border-brand"
      />
      <button
        type="submit"
        aria-label="Send question"
        disabled={busy || !text.trim()}
        className="grid size-9 place-items-center rounded-xl bg-brand text-on-brand shadow-[0_3px_0_var(--lf-brand-edge)] disabled:opacity-40"
      >
        <ArrowUp size={18} strokeWidth={3} aria-hidden />
      </button>
    </form>
  );
}

/** The explanation card (spec §5.3–5.4, v2 spec §4.1), styled with the dark tokens (spec §5.10). */
export function Card({ card, player, onRegenerate, onRetry, onFollowUp, onToggleSave, onClose, onOpenSettings, cardRef }: CardProps) {
  const element = useRef<HTMLElement | null>(null);
  const [naturalHeight, setNaturalHeight] = useState(320);
  useLayoutEffect(() => {
    const height = element.current?.scrollHeight ?? 0;
    if (height > 0 && Math.abs(height - naturalHeight) > 1) setNaturalHeight(height);
  });
  const placement = player ? placeCard(card.anchor, player, naturalHeight) : null;
  const busy = card.status === 'loading' || card.status === 'streaming';

  return (
    <section
      ref={(el) => {
        element.current = el;
        cardRef?.(el);
      }}
      role="dialog"
      aria-label="LingoFlix explanation"
      className="pointer-events-auto fixed z-[2147483646] flex flex-col overflow-hidden rounded-[18px] border-2 border-line bg-card text-ink shadow-[0_6px_0_rgb(0_0_0/0.35)]"
      style={
        placement
          ? { left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }
          : { right: 16, bottom: 96, width: 420, maxHeight: 480 }
      }
    >
      <header className="flex items-start gap-2.5 border-b-2 border-soft px-4 py-3">
        <LogoMark size={22} />
        <p className="flex-1 text-[15px] leading-snug font-extrabold whitespace-pre-line">{card.line}</p>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-lg text-mute hover:bg-soft hover:text-ink"
        >
          <X size={16} strokeWidth={3} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite" aria-busy={busy}>
        {card.status === 'loading' && (
          <p className="flex items-center gap-2 text-[14px] font-bold text-mute">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Thinking…
          </p>
        )}
        {card.response && <Markdown>{card.response}</Markdown>}
        {card.error && <ErrorBlock error={card.error} onRetry={onRetry} onOpenSettings={onOpenSettings} />}
        {card.status === 'done' && card.explanation && (
          <SaveSection explanation={card.explanation} savedKeys={card.savedKeys} saveStatus={card.saveStatus} onToggle={onToggleSave} />
        )}
        {card.followUps.map((followUp, i) => (
          <div key={i} className="mt-3 border-t-2 border-soft pt-3">
            <p className="text-[13px] font-extrabold text-tint-ink">{followUp.question}</p>
            {followUp.answer && <Markdown>{followUp.answer}</Markdown>}
            {followUp.status === 'streaming' && !followUp.answer && <Loader2 size={16} className="mt-1 animate-spin text-mute" aria-hidden />}
            {followUp.error && (
              <p role="alert" className="mt-1 text-[13px] font-bold text-danger">
                {followUp.error}
              </p>
            )}
          </div>
        ))}
      </div>

      {card.sections.followUp && card.status === 'done' && card.explanation && <FollowUpBox busy={card.followUpBusy} onSend={onFollowUp} />}

      {card.status === 'done' && (
        <footer className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-mute">
            {card.explainedBefore && (
              <>
                <BookOpen size={14} aria-hidden />
                Explained before
              </>
            )}
          </span>
          <button type="button" className={secondaryButton} onClick={onRegenerate} disabled={busy}>
            <RotateCcw size={14} strokeWidth={3} aria-hidden />
            Regenerate
          </button>
        </footer>
      )}
    </section>
  );
}
