import { BookOpen, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DonationCard } from '@/components/DonationCard';
import { SourceCard } from '@/components/SourceCard';
import { Logo } from '@/components/Logo';
import { TipCard } from '@/components/TipCard';
import { focusRing } from '@/components/styles';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { SettingsTab } from './SettingsTab';
import { StudyLogTab } from './StudyLogTab';

const TABS = [
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'study-log', label: 'Study Log', icon: BookOpen },
] as const;
type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const id = location.hash.replace(/^#\/?/, '');
  return TABS.find((t) => t.id === id)?.id ?? 'settings';
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const { settings } = useSettings();
  useTheme(settings?.theme);
  // v2 spec §6.1: the Study Log needs room for tree, list and detail; tips and support go below it.
  const fullWidth = tab === 'study-log';
  const width = fullWidth ? 'max-w-7xl' : 'max-w-5xl';

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b-2 border-soft">
        <div className={`mx-auto flex ${width} flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4`}>
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

      <div className={`mx-auto grid ${width} gap-6 px-6 py-8 ${fullWidth ? '' : 'lg:grid-cols-[minmax(0,1fr)_260px]'}`}>
        <main className="flex flex-col gap-5">
          {tab === 'settings' && <SettingsTab />}
          {tab === 'study-log' && <StudyLogTab />}
          <p className="text-xs font-semibold text-mute">Not affiliated with or endorsed by Netflix.</p>
        </main>
        <aside aria-label="Tips, support and source code" className={fullWidth ? 'grid gap-4 md:grid-cols-3' : 'flex flex-col gap-4 lg:pt-[74px]'}>
          <TipCard />
          <DonationCard />
          <SourceCard />
        </aside>
      </div>
    </div>
  );
}
