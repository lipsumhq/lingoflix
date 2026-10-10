import type { LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { focusRing } from './styles';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange(next: T): void;
}

/** A row of pill buttons that behaves as a radio group (one tab stop, arrow keys move and wrap). */
export function SegmentedControl<T extends string>({ label, value, options, onChange }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1 rounded-2xl border-2 border-line p-1">
      {options.map((option, index) => {
        const checked = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-extrabold ${focusRing} ${
              checked ? 'bg-brand text-on-brand shadow-[inset_0_-3px_0_var(--lf-brand-edge)]' : 'text-mute hover:text-ink'
            }`}
          >
            <Icon size={16} strokeWidth={2.5} aria-hidden />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
