import { useCallback, useEffect, useState } from 'react';
import { loadSettings, updateSettings, watchSettings, type Settings } from '@/lib/settings';

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let active = true;
    void loadSettings().then((s) => {
      if (active) setSettings(s);
    });
    const unwatch = watchSettings((s) => {
      if (active) setSettings(s);
    });
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  const update = useCallback(async (fn: (s: Settings) => Settings) => {
    setSettings(await updateSettings(fn));
  }, []);

  return { settings, update };
}
