// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '@/entrypoints/popup/App';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/lib/settings';
import { THEME_ATTR } from '@/lib/theme';

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ manifest_version: 3, name: 'LingoFlix', version: '0.1.0' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute(THEME_ATTR);
});

describe('popup', () => {
  it('says "You\'re all set!" when on and "Taking a break" after switching off', async () => {
    render(<App />);
    const sw = await screen.findByRole('switch', { name: 'Enabled' });
    expect(sw.textContent).toContain("You're all set!");
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Enabled' }).textContent).toContain('Taking a break'));
    expect((await loadSettings()).enabled).toBe(false);
  });

  it('opens Settings', async () => {
    const open = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(open).toHaveBeenCalled();
  });

  it('uses the saved appearance', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
    render(<App />);
    await waitFor(() => expect(document.documentElement.getAttribute(THEME_ATTR)).toBe('dark'));
  });
});
