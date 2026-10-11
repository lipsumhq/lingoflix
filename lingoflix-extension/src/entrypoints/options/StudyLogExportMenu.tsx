import { ChevronDown, Download } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { buttonSecondary, card, focusRing } from '@/components/styles';
import type { ExportKind } from '@/lib/study-log/export';

export interface StudyLogExportMenuProps {
  /** Anki and CSV export the current view; off when it is empty. */
  canExportView: boolean;
  /** Full backup: off when there are no saved items and no explanations. */
  canBackup: boolean;
  onExport(kind: ExportKind): void;
  /** Offers "Import backup…" after the export formats. Always available: it is how a backup comes back after Reset all. */
  onImport?(): void;
}

const FORMATS: readonly { kind: ExportKind; label: string }[] = [
  { kind: 'anki', label: 'Anki (.txt)' },
  { kind: 'csv', label: 'CSV (.csv)' },
  { kind: 'backup', label: 'Full backup (.json)' },
];

const menuItem = `flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold text-ink hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${focusRing}`;

/** v2 spec §7: Export ▾ on the Study Log page. */
export function StudyLogExportMenu({ canExportView, canBackup, onExport, onImport }: StudyLogExportMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const enabledItems = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

  useEffect(() => {
    if (!open) return;
    enabledItems()[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // the detail view behind the menu closes on Escape too
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = enabledItems();
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className={buttonSecondary}>
        <Download size={14} strokeWidth={3} aria-hidden />
        Export
        <ChevronDown size={14} strokeWidth={3} className={open ? 'rotate-180' : ''} aria-hidden />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Export"
          className={`${card} absolute right-0 z-20 mt-2 flex w-56 flex-col gap-0.5 p-1.5 shadow-[0_4px_0_var(--lf-line)]`}
        >
          {FORMATS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              disabled={kind === 'backup' ? !canBackup : !canExportView}
              className={menuItem}
              onClick={() => {
                close();
                onExport(kind);
              }}
            >
              {label}
            </button>
          ))}
          {onImport && (
            <>
              <div role="separator" className="my-1 h-0.5 rounded-full bg-soft" />
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={() => {
                  close();
                  onImport();
                }}
              >
                Import backup…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
