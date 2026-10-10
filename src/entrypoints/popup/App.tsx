import { browser } from '#imports';
import { DonationLinks } from '@/components/DonationLinks';
import { Toggle } from '@/components/Toggle';
import { useSettings } from '@/hooks/useSettings';

export function App() {
  const { settings, update } = useSettings();

  return (
    <main className="w-80 space-y-4 bg-neutral-950 p-4 text-neutral-100">
      <header className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold">LingoFlix</h1>
        <span className="text-xs text-neutral-500">v{browser.runtime.getManifest().version}</span>
      </header>

      {settings ? (
        <Toggle
          label="Enabled"
          description="Turn LingoFlix on or off on Netflix"
          checked={settings.enabled}
          onChange={(enabled) => void update((s) => ({ ...s, enabled }))}
        />
      ) : (
        <p className="text-sm text-neutral-400">Loading…</p>
      )}

      <button
        type="button"
        onClick={() => void browser.runtime.openOptionsPage()}
        className="w-full rounded-md bg-yellow-400 px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-yellow-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400"
      >
        Settings
      </button>

      <hr className="border-neutral-800" />
      <DonationLinks />
    </main>
  );
}
