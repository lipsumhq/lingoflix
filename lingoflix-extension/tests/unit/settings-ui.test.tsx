// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ApiKeyCard } from '@/entrypoints/options/ApiKeyCard';
import { SettingsTab } from '@/entrypoints/options/SettingsTab';
import type { sendToBackground } from '@/lib/messages';
import { loadSettings } from '@/lib/settings';

beforeEach(() => fakeBrowser.reset());
afterEach(cleanup);

/** Stands in for the background worker's API key handling. */
function fakeBackground(initialKey: string | null = null) {
  let key = initialKey;
  const send = vi.fn(async (m: { type: string; key?: string }) => {
    switch (m.type) {
      case 'api-key:status':
        return {
          set: key !== null,
          masked: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null,
          provider: key?.startsWith('sk-ant-') ? 'claude' : key?.startsWith('sk-') ? 'openai' : null,
        };
      case 'api-key:set': {
        const next = m.key?.trim() ?? '';
        if (!next || /\s/.test(next)) return { ok: false };
        key = next;
        return { ok: true };
      }
      case 'api-key:remove':
        key = null;
        return { ok: true };
      case 'api-key:test':
        return (m.key ?? key ?? '').includes('good')
          ? { result: 'valid', message: 'Your key works.' }
          : { result: 'rejected', message: 'Anthropic rejected this key.' };
      default:
        throw new Error(`unexpected ${m.type}`);
    }
  });
  return { send: send as unknown as typeof sendToBackground, calls: send.mock.calls };
}

describe('API key card (free-own-key spec §3.3)', () => {
  it('explains where to get a Claude or OpenAI key and saves one without ever showing it again', async () => {
    const { send } = fakeBackground();
    render(<ApiKeyCard send={send} />);
    expect(await screen.findByText('No key saved yet.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'API key' })).toBeTruthy();
    expect(screen.getByText(/LingoFlix explains lines/).textContent).toBe(
      'LingoFlix explains lines with your own Claude or OpenAI key. Get one at console.anthropic.com or platform.openai.com. ' +
        'Usage is billed to that account. The key stays on this computer and is sent only to Anthropic or OpenAI.',
    );
    expect(screen.getByRole('link', { name: 'console.anthropic.com' }).getAttribute('href')).toBe('https://console.anthropic.com/settings/keys');
    expect(screen.getByRole('link', { name: 'platform.openai.com' }).getAttribute('href')).toBe('https://platform.openai.com/api-keys');
    const input = screen.getByLabelText('API key') as HTMLInputElement;
    expect(input.placeholder).toBe('sk-ant-… or sk-…');
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(input.type).toBe('text');
    fireEvent.change(input, { target: { value: 'sk-ant-good-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Key saved.')).toBeTruthy();
    expect((await screen.findByText(/^Claude key:/)).textContent).toBe('Claude key: sk-ant-…1234');
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Paste a new key to replace it');
  });

  it('shows a saved OpenAI key as an OpenAI key', async () => {
    const { send } = fakeBackground('sk-proj-good-5678');
    render(<ApiKeyCard send={send} />);
    expect((await screen.findByText(/^OpenAI key:/)).textContent).toBe('OpenAI key: sk-proj…5678');
  });

  it('tests the saved key and reports the result', async () => {
    const { send } = fakeBackground('sk-ant-bad-0000');
    render(<ApiKeyCard send={send} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test key' }));
    expect(await screen.findByText('Anthropic rejected this key.')).toBeTruthy();
  });

  it('removes the key and refuses junk', async () => {
    const { send } = fakeBackground('sk-ant-good-9999');
    render(<ApiKeyCard send={send} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('No key saved yet.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'two words' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("This doesn't look like a Claude or OpenAI key.")).toBeTruthy();
  });

  it("says so when the background can't be reached to save, test, or remove the key", async () => {
    const { send } = fakeBackground('sk-ant-good-9999');
    const failing = vi.fn(async (m: { type: string }) => {
      if (m.type === 'api-key:status') return send(m as never);
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }) as unknown as typeof sendToBackground;
    render(<ApiKeyCard send={failing} />);
    const message = "Couldn't reach LingoFlix's background. Try again.";
    fireEvent.change(await screen.findByLabelText('API key'), { target: { value: 'sk-ant-new-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('status')).textContent).toBe(message);
    cleanup();

    render(<ApiKeyCard send={failing} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test key' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(message));
    expect((screen.getByRole('button', { name: 'Test key' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(message));
  });

  it('says so when the key status cannot be read', async () => {
    const send = vi.fn(async () => {
      throw new Error('no background');
    }) as unknown as typeof sendToBackground;
    render(<ApiKeyCard send={send} />);
    expect(await screen.findByText("Couldn't check the saved key.")).toBeTruthy();
  });
});

describe('explanation and line settings', () => {
  it('saves the explanation language, card sections, and Pause on hover', async () => {
    render(<SettingsTab send={fakeBackground().send} />);
    fireEvent.change(await screen.findByLabelText('Explain in'), { target: { value: 'ja' } });
    await waitFor(async () => expect((await loadSettings()).explanationLanguage).toBe('ja'));
    expect(screen.getByRole('option', { name: '日本語' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Key expressions' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Pause on hover' }));
    await waitFor(async () => {
      const s = await loadSettings();
      expect(s.cardSections.keyExpressions).toBe(false);
      expect(s.pauseOnHover).toBe(false);
    });
  });

  it('describes the explanation language and the follow-up box without naming a provider', async () => {
    render(<SettingsTab send={fakeBackground().send} />);
    const language = await screen.findByLabelText('Explain in');
    expect(document.getElementById(language.getAttribute('aria-describedby')!)?.textContent).toBe('Explanations are written in this language.');
    expect(screen.getByRole('switch', { name: 'Follow-up box' }).textContent).toContain('Ask more about the line.');
  });

  it('Rewind can jump by one line; the seconds stepper hides in that mode', async () => {
    render(<SettingsTab send={fakeBackground().send} />);
    const group = await screen.findByRole('radiogroup', { name: 'Rewind jumps by' });
    expect(screen.getByLabelText('Rewind seconds')).toBeTruthy();
    fireEvent.click(group.querySelector('[role="radio"]:last-child')!);
    await waitFor(async () => expect((await loadSettings()).rewindMode).toBe('line'));
    await waitFor(() => expect(screen.queryByLabelText('Rewind seconds')).toBeNull());
    expect(screen.getByLabelText('Forward seconds')).toBeTruthy();
  });

  it('saves Send the story so far', async () => {
    render(<SettingsTab send={fakeBackground().send} />);
    const toggle = await screen.findByRole('switch', { name: 'Send the story so far' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.textContent).toContain('Better explanations; more tokens late in an episode.');
    fireEvent.click(toggle);
    await waitFor(async () => expect((await loadSettings()).sendStorySoFar).toBe(false));
  });
});
