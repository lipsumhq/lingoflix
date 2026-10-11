import { X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { focusRing, keycap } from '@/components/styles';
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
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        {recording ? (
          <div
            ref={recorderRef}
            tabIndex={0}
            role="textbox"
            aria-label={`Press a new key for ${label}`}
            onKeyDown={onKeyDown}
            onBlur={() => setRecording(false)}
            className={`${keycap} min-w-40 border-brand bg-tint text-[13px] font-extrabold text-tint-ink hover:bg-tint`}
          >
            Press any key…
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
            className={`${keycap} ${binding ? '' : 'text-[13px] font-extrabold text-mute'}`}
          >
            {binding ? formatBinding(binding, platform) : 'Pick a key'}
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
            title="Clear"
            className={`grid size-8 place-items-center rounded-lg text-mute hover:bg-soft hover:text-ink ${focusRing}`}
          >
            <X size={16} strokeWidth={3} aria-hidden />
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-xs font-bold text-danger">
          {error}
        </p>
      ) : (
        binding &&
        overridesNetflix(binding) && (
          <p className="text-xs font-bold text-tint-ink">Overrides Netflix's {formatBinding(binding, platform)} shortcut.</p>
        )
      )}
    </div>
  );
}
