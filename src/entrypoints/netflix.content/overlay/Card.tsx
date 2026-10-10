import { ArrowUp, BookOpen, Loader2, RotateCcw, Settings as SettingsIcon, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { LogoMark } from '@/components/Logo';
import { Markdown } from '@/components/Markdown';
import type { Box, CardState } from './card-state';
import { placeCard } from './positioning';

export interface CardProps {
  card: CardState;
  /** The player's viewport rect; null falls back to the bottom-right corner. */
  player: Box | null;
  onRegenerate(): void;
  onRetry(): void;
  onFollowUp(question: string): void;
  onClose(): void;
  onOpenSettings(): void;
  cardRef?(element: HTMLElement | null): void;
}

const secondaryButton =
  'inline-flex items-center gap-1.5 rounded-xl border-2 border-line bg-card px-3 py-1.5 text-[12px] font-extrabold tracking-wide text-ink uppercase shadow-[0_3px_0_var(--lf-line)] hover:bg-soft active:translate-y-[3px] active:shadow-none disabled:opacity-40';
const primaryButton =
  'inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-[12px] font-extrabold tracking-wide text-on-brand uppercase shadow-[0_3px_0_var(--lf-brand-edge)] active:translate-y-[3px] active:shadow-none';

function ErrorBlock({ error, onRetry, onOpenSettings }: { error: NonNullable<CardState['error']>; onRetry(): void; onOpenSettings(): void }) {
  const needsSettings = error.code === 'no-key' || error.code === 'bad-key';
  const canRetry = error.code === 'busy' || error.code === 'network';
  return (
    <div className="rounded-xl border-2 border-line bg-soft px-3 py-2.5">
      <p role="alert" className="text-[14px] font-extrabold">
        {error.message}
      </p>
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

/** The explanation card (spec §5.3–5.4), styled with the dark tokens (spec §5.10). */
export function Card({ card, player, onRegenerate, onRetry, onFollowUp, onClose, onOpenSettings, cardRef }: CardProps) {
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

      {card.sections.followUp && card.status === 'done' && card.entry && <FollowUpBox busy={card.followUpBusy} onSend={onFollowUp} />}

      {card.status === 'done' && (
        <footer className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-mute">
            {card.fromStudyLog && (
              <>
                <BookOpen size={14} aria-hidden />
                From your Study Log
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
