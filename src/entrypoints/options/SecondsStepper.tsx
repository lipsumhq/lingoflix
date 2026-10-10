import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { buttonMini } from '@/components/styles';
import { SEEK_SECONDS_MAX, SEEK_SECONDS_MIN, clampSeekSeconds } from '@/lib/settings';

interface SecondsStepperProps {
  label: string;
  value: number;
  onCommit(seconds: number): void;
}

/** `– 5 s +`: the buttons step by one second; the number can also be typed (committed on blur or Enter). */
export function SecondsStepper({ label, value, onCommit }: SecondsStepperProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = draft.trim() === '' ? value : clampSeekSeconds(Number(draft), value);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  const step = (delta: number) => {
    const next = clampSeekSeconds(value + delta, value);
    if (next !== value) onCommit(next);
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={value <= SEEK_SECONDS_MIN}
        onClick={() => step(-1)}
        className={buttonMini}
      >
        <Minus size={14} strokeWidth={3} aria-hidden />
      </button>
      <span className="inline-flex items-baseline font-black text-ink">
        <input
          type="number"
          inputMode="numeric"
          min={SEEK_SECONDS_MIN}
          max={SEEK_SECONDS_MAX}
          step={1}
          value={draft}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          className="w-7 [appearance:textfield] rounded-md bg-transparent text-center text-sm focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span aria-hidden="true" className="text-sm">
          s
        </span>
      </span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={value >= SEEK_SECONDS_MAX}
        onClick={() => step(1)}
        className={buttonMini}
      >
        <Plus size={14} strokeWidth={3} aria-hidden />
      </button>
    </span>
  );
}
