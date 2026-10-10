import { Toggle } from '@/components/Toggle';
import { useSettings } from '@/hooks/useSettings';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { ACTION_IDS, ACTION_LABELS, DEFAULT_SHORTCUTS, type ActionId, type Binding } from '@/lib/shortcuts';
import { SecondsInput } from './SecondsInput';
import { ShortcutRecorder } from './ShortcutRecorder';

export function SettingsTab() {
  const { settings, update } = useSettings();
  if (!settings) return <p className="text-sm text-neutral-400">Loading…</p>;

  const setBinding = (action: ActionId, binding: Binding | null) =>
    void update((s) => ({ ...s, shortcuts: { ...s.shortcuts, [action]: binding } }));

  return (
    <div className="space-y-10">
      <section aria-labelledby="general-heading" className="space-y-2">
        <h2 id="general-heading" className="text-lg font-semibold">
          General
        </h2>
        <Toggle
          label="Enabled"
          description="When off, LingoFlix does nothing on Netflix."
          checked={settings.enabled}
          onChange={(enabled) => void update((s) => ({ ...s, enabled }))}
        />
      </section>

      <section aria-labelledby="shortcuts-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="shortcuts-heading" className="text-lg font-semibold">
            Shortcuts
          </h2>
          <button
            type="button"
            onClick={() =>
              void update((s) => ({
                ...s,
                shortcuts: DEFAULT_SHORTCUTS,
                rewindSeconds: DEFAULT_SETTINGS.rewindSeconds,
                forwardSeconds: DEFAULT_SETTINGS.forwardSeconds,
              }))
            }
            className="text-sm text-neutral-400 underline-offset-4 hover:text-neutral-100 hover:underline focus-visible:outline-2 focus-visible:outline-yellow-400"
          >
            Reset to defaults
          </button>
        </div>
        <p className="text-sm text-neutral-400">
          Click a shortcut, then press the new key. Shortcuts work while watching on Netflix. Keys you don't use here
          keep Netflix's normal behavior.
        </p>
        <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
          {ACTION_IDS.map((action) => (
            <li key={action} className="flex items-start justify-between gap-6 py-4">
              <div>
                <span className="text-sm font-medium">{ACTION_LABELS[action]}</span>
                {action === 'rewind' && (
                  <SecondsInput
                    label="Rewind seconds"
                    value={settings.rewindSeconds}
                    onCommit={(rewindSeconds) => void update((s) => ({ ...s, rewindSeconds }))}
                  />
                )}
                {action === 'forward' && (
                  <SecondsInput
                    label="Forward seconds"
                    value={settings.forwardSeconds}
                    onCommit={(forwardSeconds) => void update((s) => ({ ...s, forwardSeconds }))}
                  />
                )}
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
