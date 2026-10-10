import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ACTION_LABELS,
  bindingFromEvent,
  findConflict,
  formatBinding,
  overridesNetflix,
  type ActionId,
  type Binding,
  type ShortcutMap,
} from '@/lib/shortcuts';

interface ShortcutRecorderProps {
  action: ActionId;
  shortcuts: ShortcutMap;
  onChange(binding: Binding | null): void;
}

const platform: 'mac' | 'other' = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac') ? 'mac' : 'other';

const chip =
  'min-w-16 rounded-md border px-3 py-1.5 text-center font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400';

export function ShortcutRecorder({ action, shortcuts, onChange }: ShortcutRecorderProps) {
  const label = ACTION_LABELS[action];
  const binding = shortcuts[action];
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasRecording = useRef(false);

  useEffect(() => {
    if (recording) recorderRef.current?.focus();
    else if (wasRecording.current) buttonRef.current?.focus();
    wasRecording.current = recording;
  }, [recording]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      setRecording(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      setRecording(false);
      return;
    }
    const next = bindingFromEvent(e);
    if (!next) return; // modifier only — keep waiting for the real key
    setRecording(false);
    const conflict = findConflict(shortcuts, next, action);
    if (conflict) {
      setError(`${formatBinding(next, platform)} is already used by ${ACTION_LABELS[conflict]}.`);
      return;
    }
    setError(null);
    onChange(next);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {recording ? (
          <div
            ref={recorderRef}
            tabIndex={0}
            role="textbox"
            aria-label={`Press a new key for ${label}`}
            onKeyDown={onKeyDown}
            onBlur={() => setRecording(false)}
            className={`${chip} border-yellow-400 text-yellow-300`}
          >
            Press a key…
          </div>
        ) : (
          <button
            ref={buttonRef}
            type="button"
            aria-label={`Change ${label} shortcut`}
            onClick={() => {
              setError(null);
              setRecording(true);
            }}
            className={`${chip} border-neutral-700 bg-neutral-900 text-neutral-100 hover:border-neutral-500`}
          >
            {formatBinding(binding, platform)}
          </button>
        )}
        {binding && !recording && (
          <button
            type="button"
            aria-label={`Clear ${label} shortcut`}
            onClick={() => {
              setError(null);
              onChange(null);
            }}
            className="rounded-md px-2 py-1.5 text-xs text-neutral-400 hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-yellow-400"
          >
            Clear
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      ) : (
        binding &&
        overridesNetflix(binding) && (
          <p className="text-xs text-yellow-300">Overrides Netflix's {formatBinding(binding, platform)} shortcut.</p>
        )
      )}
    </div>
  );
}
