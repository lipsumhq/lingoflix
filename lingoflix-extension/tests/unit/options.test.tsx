// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '@/entrypoints/options/App';
import { loadSettings } from '@/lib/settings';
import { THEME_ATTR } from '@/lib/theme';

beforeEach(() => fakeBrowser.reset());
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute(THEME_ATTR);
});

describe('options page', () => {
  it('Appearance → Dark is saved and applied right away; System hands back to the OS', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.getAttribute(THEME_ATTR)).toBe('dark'));
    expect((await loadSettings()).theme).toBe('dark');
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    await waitFor(() => expect(document.documentElement.hasAttribute(THEME_ATTR)).toBe(false));
  });

  it('has the settings, a study tip and the donation card', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Shortcuts' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Reminders' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Try this' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'GitHub Sponsors' })).toBeTruthy();
    expect(screen.getByText('Not affiliated with or endorsed by Netflix.')).toBeTruthy();
  });

  it('links the open-source code on GitHub from the sidebar, in a new tab', async () => {
    render(<App />);
    const heading = await screen.findByRole('heading', { name: 'Open source' });
    expect(heading.closest('section')?.textContent).toContain('Read the code and see what LingoFlix sends, and where.');
    const link = screen.getByRole('link', { name: 'View on GitHub' });
    expect(link.getAttribute('href')).toBe('https://github.com/lipsumhq/lingoflix');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('the stepper changes Rewind seconds', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Increase Rewind seconds' }));
    await waitFor(async () => expect((await loadSettings()).rewindSeconds).toBe(6));
  });

  it('#/study-log opens the Study Log tab', async () => {
    location.hash = '#/study-log';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Study Log', level: 1 })).toBeTruthy();
    location.hash = '';
  });

  it('gives the Study Log the full width, with tips and support below it', async () => {
    window.location.hash = '#/study-log';
    try {
      render(<App />);
      const main = await screen.findByRole('main');
      expect(main.parentElement!.className).toContain('max-w-7xl');
      expect(main.parentElement!.className).not.toContain('lg:grid-cols-[minmax(0,1fr)_260px]');
    } finally {
      window.location.hash = '';
    }
  });
});
