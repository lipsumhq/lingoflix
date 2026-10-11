// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Card } from '@/entrypoints/netflix.content/overlay/Card';
import type { CardState } from '@/entrypoints/netflix.content/overlay/card-state';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { suggestionKey } from '@/lib/study-log/items';
import type { Explanation, SaveSuggestion } from '@/lib/study-log/types';

afterEach(cleanup);

const LINE = "I'm gonna call it\na night.";
const IDIOM: SaveSuggestion = { type: 'idiom', text: 'call it a night', meaning: 'end the evening' };
const WORD: SaveSuggestion = { type: 'word', text: 'gonna', meaning: 'going to (casual)' };
const EXPLANATION = { id: 'e1', videoId: '80077211', phrase: LINE, followUps: [], suggestions: [IDIOM, WORD] } as unknown as Explanation;
const key = (row: Pick<SaveSuggestion, 'type' | 'text'>) => suggestionKey(EXPLANATION, row);

const BASE: CardState = {
  key: 1,
  line: LINE,
  anchor: null,
  openedBy: 'hover',
  status: 'done',
  response: '## Meaning\nTime to **sleep**. See [this](https://example.com).\n\nPlain <b>bold</b> text.\n\n<script>alert(1)</script>',
  explanation: EXPLANATION,
  error: null,
  followUps: [],
  followUpBusy: false,
  sections: DEFAULT_SETTINGS.cardSections,
  explainedBefore: true,
  savedKeys: [],
  saveStatus: {},
};

function renderCard(over: Partial<CardState> = {}) {
  const handlers = {
    onRegenerate: vi.fn(),
    onRetry: vi.fn(),
    onFollowUp: vi.fn(),
    onToggleSave: vi.fn(),
    onClose: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  render(<Card card={{ ...BASE, ...over }} player={{ left: 0, top: 0, width: 1280, height: 720 }} {...handlers} />);
  return handlers;
}

const saveSection = () => screen.getByRole('region', { name: 'Save' });
const saveButtonNames = () => within(saveSection()).getAllByRole('button').map((b) => b.getAttribute('aria-label'));

describe('explanation card', () => {
  it('shows the line and the explanation as Markdown: no links, no raw HTML', () => {
    renderCard();
    expect(screen.getByRole('dialog', { name: 'LingoFlix explanation' }).textContent).toContain("I'm gonna call it");
    expect(screen.getByRole('heading', { name: 'Meaning' })).toBeTruthy();
    expect(screen.getByText('sleep').tagName).toBe('STRONG');
    expect(screen.getByText('this')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('b, script')).toBeNull(); // raw HTML is dropped, its text stays plain
    expect(dialog.textContent).not.toContain('alert(1)');
  });

  it('says "Explained before" only for an explanation from the history', () => {
    renderCard();
    expect(screen.getByText('Explained before')).toBeTruthy();
    expect(screen.queryByText('From your Study Log')).toBeNull();
    cleanup();
    renderCard({ explainedBefore: false });
    expect(screen.queryByText('Explained before')).toBeNull();
  });

  it('Regenerate and Close call back', () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(h.onRegenerate).toHaveBeenCalled();
    expect(h.onClose).toHaveBeenCalled();
  });

  it('shows "Thinking…" while loading, without Regenerate or a Save section', () => {
    renderCard({ status: 'loading', response: '', explanation: null, explainedBefore: false });
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Save' })).toBeNull();
  });

  it('error cards follow free-own-key spec §4.6', () => {
    const error = (code: NonNullable<CardState['error']>['code'], message: string, provider: 'claude' | 'openai' | null = 'claude') =>
      renderCard({ status: 'error', response: '', explanation: null, error: { code, message, provider } });
    const noKey = error('no-key', 'Add your API key', null);
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(noKey.onOpenSettings).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    cleanup();
    error('bad-key', 'Your OpenAI key was rejected', 'openai');
    expect(screen.getByRole('alert').textContent).toBe('Your OpenAI key was rejected');
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeTruthy();
    cleanup();
    const offline = error('network', "Couldn't reach Claude");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(offline.onRetry).toHaveBeenCalled();
    cleanup();
    error('busy', 'OpenAI is busy right now', 'openai');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    cleanup();
    error('api', 'prompt is too long: 250000 tokens > 200000 maximum');
    expect(screen.getByRole('alert').textContent).toBe('prompt is too long: 250000 tokens > 200000 maximum');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Save' })).toBeNull();
    cleanup();
    renderCard({
      status: 'error',
      line: '',
      response: '',
      explanation: null,
      error: { code: 'image-subs', message: "This title's subtitles can't be read as text", provider: null },
    });
    expect(screen.getByRole('alert').textContent).toBe("This title's subtitles can't be read as text");
  });

  it("out of credit: the company's headline, a link to its billing page, and Retry", () => {
    const anthropic = renderCard({
      status: 'error',
      response: '',
      explanation: null,
      error: { code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' },
    });
    expect(screen.getByRole('alert').textContent).toBe('Your Anthropic account is out of credit');
    const link = screen.getByRole('link', { name: 'Add credit at console.anthropic.com' });
    expect(link.getAttribute('href')).toBe('https://console.anthropic.com/settings/billing');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(anthropic.onRetry).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    cleanup();
    renderCard({
      status: 'error',
      response: '',
      explanation: null,
      error: { code: 'no-credit', message: 'Your OpenAI account is out of credit', provider: 'openai' },
    });
    expect(screen.getByRole('link', { name: 'Add credit at platform.openai.com' }).getAttribute('href')).toBe(
      'https://platform.openai.com/settings/organization/billing/overview',
    );
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

  it('a follow-up question is capped at the 2000 characters the background accepts', () => {
    renderCard();
    expect(screen.getByLabelText('Ask a follow-up question').getAttribute('maxlength')).toBe('2000');
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
    expect(screen.queryByRole('region', { name: 'Save' })).toBeNull();
  });
});

describe('the Save section (v2 spec §4.1)', () => {
  it("lists Claude's suggestions, then the whole line, with type badges and meanings", () => {
    renderCard();
    expect(saveButtonNames()).toEqual(['Save "call it a night"', 'Save "gonna"', 'Save whole line']);
    const section = saveSection();
    for (const text of ['IDIOM', 'WORD', 'LINE', 'call it a night', 'end the evening', 'gonna', 'going to (casual)', 'Whole line']) {
      expect(within(section).getByText(text)).toBeTruthy();
    }
  });

  it("offers Claude's whole-line suggestion last, with its meaning", () => {
    const lineRow: SaveSuggestion = { type: 'line', text: LINE, meaning: 'Time for bed.' };
    renderCard({ explanation: { ...EXPLANATION, suggestions: [lineRow, IDIOM] } });
    expect(saveButtonNames()).toEqual(['Save "call it a night"', 'Save whole line']);
    expect(within(saveSection()).getByText('Time for bed.')).toBeTruthy();
  });

  it("shows Save, Saved, and Couldn't save, and calls back with the row", () => {
    const h = renderCard({ savedKeys: [key(IDIOM)], saveStatus: { [key(WORD)]: 'error' } });
    const idiom = screen.getByRole('button', { name: 'Save "call it a night"' });
    expect(idiom.getAttribute('aria-pressed')).toBe('true');
    expect(idiom.textContent).toBe('Saved');
    const word = screen.getByRole('button', { name: 'Save "gonna"' });
    expect(word.getAttribute('aria-pressed')).toBe('false');
    expect(word.textContent).toBe("Couldn't save");
    expect(screen.getByRole('button', { name: 'Save whole line' }).textContent).toBe('Save');
    fireEvent.click(word);
    fireEvent.click(idiom);
    expect(h.onToggleSave.mock.calls).toEqual([[WORD], [IDIOM]]);
  });

  it('a row that is saving is disabled', () => {
    const h = renderCard({ saveStatus: { [key(IDIOM)]: 'saving' } });
    const saving = screen.getByRole('button', { name: 'Save "call it a night"' }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(saving.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(saving);
    expect(h.onToggleSave).not.toHaveBeenCalled();
  });
});
