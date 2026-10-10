import { useEffect } from 'react';
import type { ThemePreference } from '@/lib/settings';
import { applyTheme } from '@/lib/theme';

/** Applies the saved appearance to this page. Until settings load, the page follows the OS. */
export function useTheme(preference: ThemePreference | undefined) {
  useEffect(() => applyTheme(document.documentElement, preference ?? 'system'), [preference]);
}
