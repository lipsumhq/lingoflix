// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Card } from '@/entrypoints/netflix.content/overlay/Card';
import type { CardState } from '@/entrypoints/netflix.content/overlay/card-state';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import type { StudyLogEntry } from '@/lib/study-log/types';

afterEach(cleanup);

const BASE: CardState = {
  key: 1,
  line: "I'm gonna call it\na night.",
  anchor: null,
  openedBy: 'hover',
  status: 'done',
  response: '## Meaning\nTime to **sleep**. See [this](https://example.com).\n\nPlain <b>bold</b> text.\n\n<script>alert(1)</script>',
  entry: { id: 'e1' } as StudyLogEntry,
  error: null,
  followUps: [],
  followUpBusy: false,
  sections: DEFAULT_SETTINGS.cardSections,
  fromStudyLog: true,
};

function renderCard(over: Partial<CardState> = {}) {
  const handlers = { onRegenerate: vi.fn(), onRetry: vi.fn(), onFollowUp: vi.fn(), onClose: vi.fn(), onOpenSettings: vi.fn() };
  render(<Card card={{ ...BASE, ...over }} player={{ left: 0, top: 0, width: 1280, height: 720 }} {...handlers} />);
  return handlers;
}

describe('explanation card', () => {
  it('shows the line and the explanation as Markdown — no links, no raw HTML', () => {
    renderCard();
    expect(screen.getByRole('dialog', { name: 'LingoFlix explanation' }).textContent).toContain("I'm gonna call it");
    expect(screen.getByRole('heading', { name: 'Meaning' })).toBeTruthy();
    expect(screen.getByText('sleep').tagName).toBe('STRONG');
    expect(screen.getByText('this')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('b, script')).toBeNull(); // raw HTML is dropped, its text stays plain
    expect(dialog.textContent).not.toContain('alert(1)');
    expect(screen.getByText('From your Study Log')).toBeTruthy();
  });

  it('Regenerate and Close call back', () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(h.onRegenerate).toHaveBeenCalled();
    expect(h.onClose).toHaveBeenCalled();
  });

  it('shows "Thinking…" while loading, without Regenerate', () => {
    renderCard({ status: 'loading', response: '', entry: null, fromStudyLog: false });
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
  });

  it('error cards follow spec §7.4', () => {
    const noKey = renderCard({ status: 'error', response: '', error: { code: 'no-key', message: 'Add your Claude API key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(noKey.onOpenSettings).toHaveBeenCalled();
    cleanup();
    const offline = renderCard({ status: 'error', response: '', error: { code: 'network', message: "Couldn't reach Claude" } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(offline.onRetry).toHaveBeenCalled();
    cleanup();
    renderCard({ status: 'error', response: '', error: { code: 'api', message: 'Your credit balance is too low.' } });
    expect(screen.getByRole('alert').textContent).toBe('Your credit balance is too low.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    cleanup();
    renderCard({ status: 'error', line: '', response: '', entry: null, error: { code: 'image-subs', message: "This title's subtitles can't be read as text" } });
    expect(screen.getByRole('alert').textContent).toBe("This title's subtitles can't be read as text");
  });

  it('follow-up: Enter sends, Shift+Enter does not', () => {
    const h = renderCard();
    const box = screen.getByLabelText('Ask a follow-up question');
    fireEvent.change(box, { target: { value: '  Is it rude?  ' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(h.onFollowUp).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(h.onFollowUp).toHaveBeenCalledWith('Is it rude?');
  });

  it('Enter during IME composition does not send', () => {
    const h = renderCard();
    const box = screen.getByLabelText('Ask a follow-up question');
    fireEvent.change(box, { target: { value: '격식' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(h.onFollowUp).not.toHaveBeenCalled();
  });

  it('shows follow-ups, and hides the box when the section is off or the card is not done', () => {
    renderCard({ followUps: [{ question: 'Is it rude?', answer: 'Not at **all**.', status: 'done', error: null }] });
    expect(screen.getByText('Is it rude?')).toBeTruthy();
    expect(screen.getByText('all').tagName).toBe('STRONG');
    cleanup();
    renderCard({ sections: { ...DEFAULT_SETTINGS.cardSections, followUp: false } });
    expect(screen.queryByLabelText('Ask a follow-up question')).toBeNull();
    cleanup();
    renderCard({ status: 'streaming' });
    expect(screen.queryByLabelText('Ask a follow-up question')).toBeNull();
  });
});
