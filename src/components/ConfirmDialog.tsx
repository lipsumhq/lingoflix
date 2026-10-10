import { useEffect, useId, useRef } from 'react';
import { buttonSecondary, card, focusRing } from './styles';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm(): void;
  onCancel(): void;
}

/** Spec §5.5: every delete and Reset all asks first. Cancel has focus, so Enter never deletes by accident. */
export function ConfirmDialog({ title, body, confirmLabel = 'Delete', onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} className={`${card} w-full max-w-sm p-5`}>
        <h2 id={titleId} className="text-lg font-black">
          {title}
        </h2>
        <p id={bodyId} className="mt-1 text-sm font-semibold text-mute">
          {body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancel} type="button" onClick={onCancel} className={buttonSecondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex items-center rounded-2xl bg-danger px-4 py-2 text-xs font-extrabold tracking-wider text-on-danger uppercase shadow-[0_3px_0_rgb(0_0_0/0.25)] active:translate-y-[3px] active:shadow-none ${focusRing}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
