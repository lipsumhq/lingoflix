import {
  AlignLeft,
  Captions,
  FastForward,
  MessageSquareText,
  Monitor,
  Moon,
  Repeat,
  Rewind,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sun,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Toggle } from '@/components/Toggle';
import { buttonSecondary, card, iconTile } from '@/components/styles';
import { useSettings } from '@/hooks/useSettings';
import type { NotificationPermission } from '@/lib/reminders/permission';
import { DEFAULT_SETTINGS, type SeekMode, type Settings, type ThemePreference } from '@/lib/settings';
import { ACTION_IDS, ACTION_LABELS, DEFAULT_SHORTCUTS, type ActionId, type Binding } from '@/lib/shortcuts';
import type { Send } from './ApiKeyCard';
import { ApiKeyCard } from './ApiKeyCard';
import { ExplanationsCard } from './ExplanationsCard';
import { RemindersCard } from './RemindersCard';
import { SecondsStepper } from './SecondsStepper';
import { ShortcutRecorder } from './ShortcutRecorder';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const satisfies readonly { value: ThemePreference; label: string; icon: LucideIcon }[];

const SEEK_MODE_OPTIONS = [
  { value: 'seconds', label: 'Seconds', icon: Timer },
  { value: 'line', label: 'One line', icon: AlignLeft },
] as const satisfies readonly { value: SeekMode; label: string; icon: LucideIcon }[];

const ACTION_ICONS: Record<ActionId, ReactNode> = {
  rewind: <Rewind size={20} strokeWidth={2.5} fill="currentColor" aria-hidden />,
  forward: <FastForward size={20} strokeWidth={2.5} fill="currentColor" aria-hidden />,
  previousLine: <SkipBack size={20} strokeWidth={2.5} fill="currentColor" aria-hidden />,
  nextLine: <SkipForward size={20} strokeWidth={2.5} fill="currentColor" aria-hidden />,
  replayLine: <Repeat size={20} strokeWidth={2.5} aria-hidden />,
  toggleSubtitles: <Captions size={20} strokeWidth={2.5} aria-hidden />,
  explainLine: <MessageSquareText size={20} strokeWidth={2.5} aria-hidden />,
};

const ACTION_HINTS: Partial<Record<ActionId, string>> = {
  previousLine: 'Back to the line before.',
  nextLine: 'On to the next line.',
  replayLine: 'Hear the current line again.',
  toggleSubtitles: 'Test your ears, then peek.',
  explainLine: 'Explain the current line.',
};

export function SettingsTab({ send, permission }: { send?: Send; permission?: NotificationPermission } = {}) {
  const { settings, update } = useSettings();
  if (!settings) return <p className="text-sm font-semibold text-mute">Loading…</p>;

  const setBinding = (action: ActionId, binding: Binding | null) =>
    void update((s) => ({ ...s, shortcuts: { ...s.shortcuts, [action]: binding } }));

  const actionDetail = (action: ActionId, s: Settings): ReactNode => {
    if (action === 'rewind')
      return (
        <>
          <SegmentedControl
            label="Rewind jumps by"
            value={s.rewindMode}
            options={SEEK_MODE_OPTIONS}
            onChange={(rewindMode) => void update((cur) => ({ ...cur, rewindMode }))}
          />
          {s.rewindMode === 'seconds' && (
            <SecondsStepper
              label="Rewind seconds"
              value={s.rewindSeconds}
              onCommit={(rewindSeconds) => void update((cur) => ({ ...cur, rewindSeconds }))}
            />
          )}
        </>
      );
    if (action === 'forward')
      return (
        <>
          <SegmentedControl
            label="Forward jumps by"
            value={s.forwardMode}
            options={SEEK_MODE_OPTIONS}
            onChange={(forwardMode) => void update((cur) => ({ ...cur, forwardMode }))}
          />
          {s.forwardMode === 'seconds' && (
            <SecondsStepper
              label="Forward seconds"
              value={s.forwardSeconds}
              onCommit={(forwardSeconds) => void update((cur) => ({ ...cur, forwardSeconds }))}
            />
          )}
        </>
      );
    return ACTION_HINTS[action] ?? null;
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[28px] font-black tracking-tight">Settings</h1>
        <p className="mt-1 text-[15px] font-semibold text-mute">Make LingoFlix work the way you watch.</p>
      </div>

      <section aria-labelledby="general-heading" className={`${card} px-5 py-4`}>
        <h2 id="general-heading" className="sr-only">
          General
        </h2>
        <div className="pb-3.5">
          <Toggle
            name="Enabled"
            label={settings.enabled ? 'LingoFlix is on' : 'LingoFlix is off'}
            description={
              settings.enabled
                ? 'Turn it off and Netflix works like normal.'
                : 'Turn it on to use your shortcuts on Netflix.'
            }
            checked={settings.enabled}
            onChange={(enabled) => void update((s) => ({ ...s, enabled }))}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-soft pt-3.5">
          <div>
            <p className="text-base font-extrabold">Appearance</p>
            <p className="mt-0.5 text-[13px] font-semibold text-mute">Popup and settings colors.</p>
          </div>
          <SegmentedControl
            label="Appearance"
            value={settings.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => void update((s) => ({ ...s, theme }))}
          />
        </div>
      </section>

      <ApiKeyCard send={send} />
      <ExplanationsCard settings={settings} update={update} />
      <RemindersCard send={send} permission={permission} />

      <section aria-labelledby="shortcuts-heading" className={`${card} px-5 py-4`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="shortcuts-heading" className="text-[19px] font-black">
              Shortcuts
            </h2>
            <p className="mt-0.5 text-sm font-semibold text-mute">
              Click a key, then press the new one. Keys you don't use here keep Netflix's normal behavior.
            </p>
          </div>
          <button
            type="button"
            aria-label="Reset shortcuts to defaults"
            onClick={() =>
              void update((s) => ({
                ...s,
                shortcuts: DEFAULT_SHORTCUTS,
                rewindSeconds: DEFAULT_SETTINGS.rewindSeconds,
                forwardSeconds: DEFAULT_SETTINGS.forwardSeconds,
                rewindMode: DEFAULT_SETTINGS.rewindMode,
                forwardMode: DEFAULT_SETTINGS.forwardMode,
              }))
            }
            className={`${buttonSecondary} shrink-0`}
          >
            <RotateCcw size={14} strokeWidth={3} aria-hidden />
            Reset
          </button>
        </div>
        <ul className="mt-2">
          {ACTION_IDS.map((action) => (
            <li key={action} className="flex items-center gap-3.5 border-t-2 border-soft py-3.5 first:border-t-0 last:pb-1">
              <span className={iconTile}>{ACTION_ICONS[action]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-extrabold">{ACTION_LABELS[action]}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-mute">
                  {actionDetail(action, settings)}
                </div>
              </div>
              <ShortcutRecorder
                action={action}
                shortcuts={settings.shortcuts}
                onChange={(binding) => setBinding(action, binding)}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
