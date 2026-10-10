import { useEffect, useState } from 'react';
import { SEEK_SECONDS_MAX, SEEK_SECONDS_MIN, clampSeekSeconds } from '@/lib/settings';

interface SecondsInputProps {
  label: string;
  value: number;
  onCommit(seconds: number): void;
}

export function SecondsInput({ label, value, onCommit }: SecondsInputProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = draft.trim() === '' ? value : clampSeekSeconds(Number(draft), value);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <label className="mt-1 flex items-center gap-2 text-sm text-neutral-400">
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
        className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100 focus-visible:outline-2 focus-visible:outline-yellow-400"
      />
      seconds
    </label>
  );
}
