import { browser } from '#imports';
import { AlertTriangle, BookOpen, CheckCircle2, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DonationCard } from '@/components/DonationCard';
import { Logo } from '@/components/Logo';
import { Toggle } from '@/components/Toggle';
import { buttonPrimary, buttonSecondary, card, focusRing } from '@/components/styles';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { PROVIDERS, type Provider } from '@/lib/ai/provider';
import { sendToBackground } from '@/lib/messages';

type Send = typeof sendToBackground;

/** Free-own-key spec §3.4: whose key is set; a key that is neither Claude's nor OpenAI's counts as none. */
function KeyStatus({ send }: { send: Send }) {
  const [status, setStatus] = useState<{ provider: Provider | null } | null>(null);
  useEffect(() => {
    send({ type: 'api-key:status' }).then(
      (s) => setStatus({ provider: s.provider }),
      () => setStatus(null),
    );
  }, [send]);
  if (status === null) return null;
  return status.provider ? (
    <p className="flex items-center gap-1.5 text-[13px] font-bold text-mute">
      <CheckCircle2 size={16} strokeWidth={2.5} className="text-tint-ink" aria-hidden />
      {PROVIDERS[status.provider].name} key set
    </p>
  ) : (
    <button
      type="button"
      onClick={() => void browser.runtime.openOptionsPage()}
      className={`flex items-center gap-1.5 text-left text-[13px] font-extrabold text-danger underline-offset-2 hover:underline ${focusRing}`}
    >
      <AlertTriangle size={16} strokeWidth={2.5} aria-hidden />
      Add your API key
    </button>
  );
}

export function App({ send = sendToBackground }: { send?: Send } = {}) {
  const { settings, update } = useSettings();
  useTheme(settings?.theme);

  const openStudyLog = () => void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#/study-log` });

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
          <>
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
            <div className="mt-3 border-t-2 border-soft pt-3">
              <Toggle
                label="Pause on hover"
                description="Pause while you read an explanation."
                checked={settings.pauseOnHover}
                onChange={(pauseOnHover) => void update((s) => ({ ...s, pauseOnHover }))}
              />
            </div>
            <div className="mt-3 border-t-2 border-soft pt-3">
              <KeyStatus send={send} />
            </div>
          </>
        ) : (
          <p className="text-sm font-semibold text-mute">Loading…</p>
        )}
      </section>

      <button type="button" onClick={() => void browser.runtime.openOptionsPage()} className={`${buttonPrimary} w-full`}>
        <SettingsIcon size={18} strokeWidth={2.75} aria-hidden />
        Settings
      </button>
      <button type="button" onClick={openStudyLog} className={`${buttonSecondary} w-full py-2.5`}>
        <BookOpen size={16} strokeWidth={2.75} aria-hidden />
        Study Log
      </button>

      <DonationCard compact />
    </main>
  );
}
