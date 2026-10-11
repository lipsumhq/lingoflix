import { useId } from 'react';
import { focusRing } from './styles';

interface ToggleProps {
  label: string;
  /** Accessible name when the visible label changes with the state (e.g. "You're all set!" / "Taking a break"). */
  name?: string;
  description?: string;
  checked: boolean;
  onChange(next: boolean): void;
}

export function Toggle({ label, name, description, checked, onChange }: ToggleProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={name}
      aria-labelledby={name ? undefined : `${id}-label`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-4 rounded-2xl text-left ${focusRing}`}
    >
      <span className="min-w-0">
        <span id={`${id}-label`} className="block text-base font-extrabold text-ink">
          {label}
        </span>
        {description && (
          <span id={`${id}-desc`} className="mt-0.5 block text-[13px] leading-snug font-semibold text-mute">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-8 w-[52px] shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand shadow-[inset_0_-3px_0_var(--lf-brand-edge)]' : 'bg-line shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)]'
        }`}
      >
        <span
          className={`absolute top-1 left-1 size-6 rounded-full bg-white shadow-[0_2px_0_rgb(0_0_0/0.15)] transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </span>
    </button>
  );
}
