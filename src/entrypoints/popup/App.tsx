import { browser } from '#imports';
import { Settings as SettingsIcon } from 'lucide-react';
import { DonationCard } from '@/components/DonationCard';
import { Logo } from '@/components/Logo';
import { Toggle } from '@/components/Toggle';
import { buttonPrimary, card } from '@/components/styles';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';

export function App() {
  const { settings, update } = useSettings();
  useTheme(settings?.theme);

  return (
    <main className="flex w-80 flex-col gap-3.5 p-4">
      <header className="flex items-center gap-2">
        <Logo />
        <span className="ml-auto rounded-full border-2 border-line px-2 text-[11px] font-extrabold text-mute">
          v{browser.runtime.getManifest().version}
        </span>
      </header>

      <section className={`${card} p-3.5`}>
        {settings ? (
          <Toggle
            name="Enabled"
            label={settings.enabled ? "You're all set!" : 'Taking a break'}
            description={
              settings.enabled
                ? 'Your shortcuts are live on Netflix.'
                : 'Netflix works like normal until you turn this back on.'
            }
            checked={settings.enabled}
            onChange={(enabled) => void update((s) => ({ ...s, enabled }))}
          />
        ) : (
          <p className="text-sm font-semibold text-mute">Loading…</p>
        )}
      </section>

      <button type="button" onClick={() => void browser.runtime.openOptionsPage()} className={`${buttonPrimary} w-full`}>
        <SettingsIcon size={18} strokeWidth={2.75} aria-hidden />
        Settings
      </button>

      <DonationCard compact />
    </main>
  );
}
