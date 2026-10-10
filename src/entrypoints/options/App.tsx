import { useEffect, useState } from 'react';
import { DonationLinks } from '@/components/DonationLinks';
import { SettingsTab } from './SettingsTab';

const TABS = [{ id: 'settings', label: 'Settings' }] as const;
type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const id = location.hash.replace(/^#\/?/, '');
  return TABS.find((t) => t.id === id)?.id ?? 'settings';
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold">LingoFlix</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Understand every line on Netflix. Not affiliated with or endorsed by Netflix.
          </p>
          <nav aria-label="Sections" className="mt-6 flex gap-1 border-b border-neutral-800">
            {TABS.map((t) => (
              <a
                key={t.id}
                href={`#/${t.id}`}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-yellow-400 ${
                  tab === t.id
                    ? 'border-yellow-400 text-neutral-100'
                    : 'border-transparent text-neutral-400 hover:text-neutral-100'
                }`}
              >
                {t.label}
              </a>
            ))}
          </nav>
        </header>

        <main>{tab === 'settings' && <SettingsTab />}</main>

        <footer className="mt-16 border-t border-neutral-800 pt-6">
          <DonationLinks />
        </footer>
      </div>
    </div>
  );
}
