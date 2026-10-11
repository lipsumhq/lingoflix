// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '@/entrypoints/popup/App';
import type { sendToBackground } from '@/lib/messages';
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

const send = (set: boolean) =>
  vi.fn(async () => ({ set, masked: set ? 'sk-ant-…1234' : null })) as unknown as typeof sendToBackground;

describe('popup', () => {
  it('says "You\'re all set!" when on and "Taking a break" after switching off', async () => {
    render(<App send={send(true)} />);
    const sw = await screen.findByRole('switch', { name: 'Enabled' });
    expect(sw.textContent).toContain("You're all set!");
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Enabled' }).textContent).toContain('Taking a break'));
    expect((await loadSettings()).enabled).toBe(false);
  });

  it('opens Settings', async () => {
    const open = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue();
    render(<App send={send(true)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(open).toHaveBeenCalled();
  });

  it('uses the saved appearance', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
    render(<App send={send(true)} />);
    await waitFor(() => expect(document.documentElement.getAttribute(THEME_ATTR)).toBe('dark'));
  });

  it('shows the key status and links to Settings when the key is missing', async () => {
    const open = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue();
    render(<App send={send(false)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add your Claude API key' }));
    expect(open).toHaveBeenCalled();
    cleanup();
    render(<App send={send(true)} />);
    expect(await screen.findByText('Claude key set')).toBeTruthy();
  });

  it('toggles Pause on hover and opens the Study Log', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    render(<App send={send(true)} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Pause on hover' }));
    await waitFor(async () => expect((await loadSettings()).pauseOnHover).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Study Log' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ url: expect.stringMatching(/options\.html#\/study-log$/) }));
  });
});
