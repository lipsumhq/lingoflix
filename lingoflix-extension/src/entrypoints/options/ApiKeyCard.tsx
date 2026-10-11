import { Eye, EyeOff, KeyRound, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { buttonSecondary, card, focusRing, iconTile } from '@/components/styles';
import { NOT_A_KEY } from '@/lib/ai/provider';
import { ANTHROPIC_KEYS_URL } from '@/lib/config';
import { sendToBackground } from '@/lib/messages';

export type Send = typeof sendToBackground;

type KeyStatus = { set: boolean; masked: string | null } | 'unknown' | null;
type Note = { tone: 'good' | 'bad' | 'info'; text: string };

const NOTE_COLOR: Record<Note['tone'], string> = { good: 'text-tint-ink', bad: 'text-danger', info: 'text-mute' };
const UNREACHABLE: Note = { tone: 'bad', text: "Couldn't reach LingoFlix's background. Try again." };

/** Spec §5.8: the key goes to the background worker; this page only ever sees whether one is set (masked). */
export function ApiKeyCard({ send = sendToBackground }: { send?: Send }) {
  const [status, setStatus] = useState<KeyStatus>(null);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await send({ type: 'api-key:status' }));
    } catch {
      setStatus('unknown');
    }
  }, [send]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    try {
      const res = await send({ type: 'api-key:set', key: draft });
      if (!res.ok) {
        setNote({ tone: 'bad', text: NOT_A_KEY });
        return;
      }
    } catch {
      setNote(UNREACHABLE);
      return;
    }
    setDraft('');
    setShow(false);
    setNote({ tone: 'good', text: 'Key saved.' });
    await refresh();
  };

  const test = async () => {
    setTesting(true);
    setNote({ tone: 'info', text: 'Testing…' });
    try {
      const res = await send({ type: 'api-key:test', ...(draft.trim() ? { key: draft.trim() } : {}) });
      setNote({ tone: res.result === 'valid' ? 'good' : 'bad', text: res.message });
    } catch {
      setNote(UNREACHABLE);
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    try {
      await send({ type: 'api-key:remove' });
    } catch {
      setNote(UNREACHABLE);
      return;
    }
    setNote({ tone: 'info', text: 'Key removed.' });
    await refresh();
  };

  const saved = typeof status === 'object' && status?.set === true;

  return (
    <section className={`${card} px-5 py-4`}>
      <div className="flex items-start gap-3.5">
        <span className={iconTile}>
          <KeyRound size={20} strokeWidth={2.5} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-black">
            Claude API key
          </h2>
          <p className="mt-0.5 text-sm font-semibold text-mute">
            LingoFlix asks Claude with your own key. Create one at{' '}
            <a href={ANTHROPIC_KEYS_URL} target="_blank" rel="noopener noreferrer" className={`underline ${focusRing}`}>
              console.anthropic.com
            </a>
            . Usage is billed to your Anthropic account. The key stays on this computer and is sent only to Anthropic.
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm font-bold">
        {status === null && 'Checking…'}
        {status === 'unknown' && "Couldn't check the saved key."}
        {typeof status === 'object' && status !== null && !status.set && 'No key saved yet.'}
        {saved && (
          <>
            Saved key: <code className="rounded bg-soft px-1.5 py-0.5 text-[13px]">{(status as { masked: string }).masked}</code>
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <input
            type={show ? 'text' : 'password'}
            aria-label="Claude API key"
            placeholder={saved ? 'Paste a new key to replace it' : 'sk-ant-…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border-2 border-line bg-card px-3 py-2 pr-10 font-mono text-sm text-ink outline-none focus:border-brand"
          />
          <button
            type="button"
            aria-label={show ? 'Hide key' : 'Show key'}
            onClick={() => setShow(!show)}
            className={`absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-mute hover:text-ink ${focusRing}`}
          >
            {show ? <EyeOff size={16} strokeWidth={2.5} aria-hidden /> : <Eye size={16} strokeWidth={2.5} aria-hidden />}
          </button>
        </div>
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={() => void save()}
          className={`inline-flex items-center rounded-xl bg-brand px-4 py-2 text-xs font-extrabold tracking-wider text-on-brand uppercase shadow-[0_3px_0_var(--lf-brand-edge)] active:translate-y-[3px] active:shadow-none disabled:opacity-40 ${focusRing}`}
        >
          Save
        </button>
        <button type="button" disabled={testing || (!draft.trim() && !saved)} onClick={() => void test()} className={`${buttonSecondary} disabled:opacity-40`}>
          <Zap size={14} strokeWidth={3} aria-hidden />
          Test key
        </button>
        {saved && (
          <button type="button" onClick={() => void remove()} className={buttonSecondary}>
            <Trash2 size={14} strokeWidth={3} aria-hidden />
            Remove
          </button>
        )}
      </div>
      {note && (
        <p role="status" className={`mt-2 text-sm font-bold ${NOTE_COLOR[note.tone]}`}>
          {note.text}
        </p>
      )}
    </section>
  );
}
