import { useId } from 'react';

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange(next: boolean): void;
}

export function Toggle({ label, description, checked, onChange }: ToggleProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-md py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400"
    >
      <span>
        <span id={`${id}-label`} className="block text-sm font-medium text-neutral-100">
          {label}
        </span>
        {description && (
          <span id={`${id}-desc`} className="block text-xs text-neutral-400">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-yellow-400' : 'bg-neutral-600'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full shadow transition-transform ${checked ? 'translate-x-4 bg-neutral-950' : 'bg-white'}`}
        />
      </span>
    </button>
  );
}
