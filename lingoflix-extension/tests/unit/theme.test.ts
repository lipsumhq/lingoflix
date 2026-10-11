// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_ATTR, applyTheme } from '@/lib/theme';

afterEach(() => document.documentElement.removeAttribute(THEME_ATTR));

describe('applyTheme', () => {
  it('pins light or dark on the page', () => {
    applyTheme(document.documentElement, 'dark');
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe('dark');
    applyTheme(document.documentElement, 'light');
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe('light');
  });

  it('removes the pin for system, so the CSS follows the OS setting live', () => {
    applyTheme(document.documentElement, 'dark');
    applyTheme(document.documentElement, 'system');
    expect(document.documentElement.hasAttribute(THEME_ATTR)).toBe(false);
  });
});
