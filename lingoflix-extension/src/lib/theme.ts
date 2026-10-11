import type { ThemePreference } from './settings';

/** Set on <html> to pin light or dark; absent means "follow the OS" (handled in CSS, so it tracks OS changes live). */
export const THEME_ATTR = 'data-theme';

export function applyTheme(root: HTMLElement, preference: ThemePreference): void {
  if (preference === 'system') root.removeAttribute(THEME_ATTR);
  else root.setAttribute(THEME_ATTR, preference);
}
