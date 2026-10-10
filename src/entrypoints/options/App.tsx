import { Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DonationCard } from '@/components/DonationCard';
import { Logo } from '@/components/Logo';
import { TipCard } from '@/components/TipCard';
import { focusRing } from '@/components/styles';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { SettingsTab } from './SettingsTab';

const TABS = [{ id: 'settings', label: 'Settings', icon: SettingsIcon }] as const;
type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const id = location.hash.replace(/^#\/?/, '');
  return TABS.find((t) => t.id === id)?.id ?? 'settings';
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const { settings } = useSettings();
  useTheme(settings?.theme);

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b-2 border-soft">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Logo large />
          <nav aria-label="Sections" className="flex gap-1.5">
            {TABS.map((t) => {
              const current = tab === t.id;
              const Icon = t.icon;
              return (
                <a
                  key={t.id}
                  href={`#/${t.id}`}
                  aria-current={current ? 'page' : undefined}
                  className={`inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-extrabold tracking-wide uppercase ${focusRing} ${
                    current ? 'border-tint-line bg-tint text-tint-ink' : 'border-transparent text-mute hover:text-ink'
                  }`}
                >
                  <Icon size={16} strokeWidth={2.5} aria-hidden />
                  {t.label}
                </a>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <main className="flex flex-col gap-5">
          {tab === 'settings' && <SettingsTab />}
          <p className="text-xs font-semibold text-mute">Not affiliated with or endorsed by Netflix.</p>
        </main>
        <aside aria-label="Tips and support" className="flex flex-col gap-4 lg:pt-[74px]">
          <TipCard />
          <DonationCard />
        </aside>
      </div>
    </div>
  );
}
