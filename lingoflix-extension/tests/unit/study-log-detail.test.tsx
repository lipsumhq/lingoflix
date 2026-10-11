// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyLogDetail, detailWhere } from '@/entrypoints/options/StudyLogDetail';
import { useWideLayout, WIDE_LAYOUT_QUERY } from '@/hooks/useWideLayout';
import { highlightParts } from '@/lib/study-log/highlight';
import type { Explanation, SavedItem } from '@/lib/study-log/types';

afterEach(cleanup);

const ITEM: SavedItem = {
  id: 'i1',
  type: 'idiom',
  text: 'call it a night',
  meaning: 'stop for the evening',
  explanationId: 'e1',
  line: "I'm gonna call it\na night. Call it a night!",
  lineTimeMs: 1_834_200,
  context: { before: ['Where are you going?', 'Home.'], after: ['Night, Mike.'] },
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  explanationLanguage: 'en',
  savedAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
};

const EXPLANATION = {
  id: 'e1',
  response: '## Meaning\nTime to **sleep**.',
  followUps: [{ question: 'Formal?', answer: 'No, casual.' }],
} as Explanation;

function renderDetail(over: Partial<SavedItem> = {}, opts: { narrow?: boolean; explanation?: Explanation | null } = {}) {
  const handlers = { onClose: vi.fn(), onDelete: vi.fn(), onOpenAtMoment: vi.fn() };
  const loadExplanation = vi.fn(async (_id: string) => (opts.explanation === undefined ? EXPLANATION : opts.explanation));
  const view = render(<StudyLogDetail item={{ ...ITEM, ...over }} narrow={opts.narrow ?? false} loadExplanation={loadExplanation} {...handlers} />);
  return { ...handlers, loadExplanation, container: view.container };
}

describe('highlightParts', () => {
  it('marks every occurrence, ignoring case and matching across line breaks', () => {
    expect(highlightParts("I'm gonna call it\na night. Call it a night!", 'call it a night')).toEqual([
      { text: "I'm gonna ", mark: false },
      { text: 'call it\na night', mark: true },
      { text: '. ', mark: false },
      { text: 'Call it a night', mark: true },
      { text: '!', mark: false },
    ]);
  });

  it('treats the text literally and leaves the line alone when it is not found', () => {
    expect(highlightParts('Is it 1+1?', '1+1')).toEqual([
      { text: 'Is it ', mark: false },
      { text: '1+1', mark: true },
      { text: '?', mark: false },
    ]);
    expect(highlightParts('What?', 'Why (not)?')).toEqual([{ text: 'What?', mark: false }]);
    expect(highlightParts('Line', '   ')).toEqual([{ text: 'Line', mark: false }]);
  });
});

describe('useWideLayout', () => {
  it('follows (min-width: 1100px)', () => {
    let matches = false;
    const listeners: (() => void)[] = [];
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          get matches() {
            return matches;
          },
          media: query,
          addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useWideLayout());
    expect(matchMedia).toHaveBeenCalledWith(WIDE_LAYOUT_QUERY);
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      for (const listener of listeners) listener();
    });
    expect(result.current).toBe(true);
  });

  it('is wide when matchMedia is missing', () => {
    const original = window.matchMedia;
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    try {
      const { result } = renderHook(() => useWideLayout());
      expect(result.current).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('detailWhere', () => {
  it('names the show, season, episode and time, or the movie and time', () => {
    expect(detailWhere(ITEM)).toBe('Stranger Things · Season 1 · E3 "Holly, Jolly" · 30:34');
    expect(detailWhere({ ...ITEM, kind: 'movie', seriesTitle: 'Roma', seasonNumber: null, episodeNumber: null, episodeTitle: null, lineTimeMs: 3_723_000 })).toBe(
      'Roma · 1:02:03',
    );
    expect(detailWhere({ ...ITEM, seasonNumber: null, episodeNumber: null, episodeTitle: 'Special' })).toBe('Stranger Things · "Special" · 30:34');
    expect(detailWhere({ ...ITEM, episodeTitle: null })).toBe('Stranger Things · Season 1 · E3 · 30:34');
  });
});

describe('StudyLogDetail', () => {
  it('shows the type, text, meaning, the line with the item highlighted, where it is from, and when it was saved', () => {
    const { container } = renderDetail();
    const detail = screen.getByRole('region', { name: 'call it a night' });
    expect(within(detail).getByText('Idiom')).toBeTruthy();
    expect(within(detail).getByText('stop for the evening')).toBeTruthy();
    expect([...container.querySelectorAll('blockquote mark')].map((m) => m.textContent)).toEqual(['call it\na night', 'Call it a night']);
    expect(within(detail).getByText('Stranger Things · Season 1 · E3 "Holly, Jolly" · 30:34')).toBeTruthy();
    expect(within(detail).getByText(`Saved ${new Date(ITEM.savedAt).toLocaleString()}`)).toBeTruthy();
  });

  it('takes the focus when it opens', () => {
    renderDetail();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'call it a night' }));
  });

  it('does not highlight a whole-line item', () => {
    const { container } = renderDetail({ type: 'line', text: ITEM.line, meaning: '' });
    expect(container.querySelector('blockquote')?.textContent).toBe(ITEM.line);
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });

  it('shows the dialogue around the line when expanded, with the line marked', () => {
    renderDetail();
    const toggle = screen.getByRole('button', { name: 'Dialogue around it' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const rows = within(screen.getByRole('list', { name: 'Dialogue around it' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Where are you going?', 'Home.', ITEM.line, 'Night, Mike.']);
    expect(rows[2]!.getAttribute('aria-current')).toBe('true');
    expect(rows[2]!.querySelectorAll('mark')).toHaveLength(2);
  });

  it('loads the explanation, collapsed when the item has a meaning', async () => {
    const { loadExplanation } = renderDetail();
    const toggle = screen.getByRole('button', { name: 'Explanation' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(await screen.findByRole('heading', { name: 'Meaning' })).toBeTruthy();
    expect(screen.getByText('sleep').tagName).toBe('STRONG');
    expect(screen.getByText('Formal?')).toBeTruthy();
    expect(screen.getByText('No, casual.')).toBeTruthy();
    expect(loadExplanation).toHaveBeenCalledWith('e1');
  });

  it("opens the explanation by default when there is no meaning, and says when it isn't available", async () => {
    const first = renderDetail({ meaning: '', explanationId: null });
    expect(screen.getByRole('button', { name: 'Explanation' }).getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText("The explanation isn't available for this item.")).toBeTruthy();
    expect(first.loadExplanation).not.toHaveBeenCalled();
    cleanup();

    renderDetail({ meaning: '' }, { explanation: null });
    expect(await screen.findByText("The explanation isn't available for this item.")).toBeTruthy();
  });

  it('Open at this moment, Delete and Close call back; Back replaces Close on a narrow window', () => {
    const wide = renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Open at this moment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(wide.onOpenAtMoment).toHaveBeenCalledWith(ITEM);
    expect(wide.onDelete).toHaveBeenCalledWith(ITEM);
    expect(wide.onClose).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    cleanup();

    const narrow = renderDetail({}, { narrow: true });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(narrow.onClose).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close details' })).toBeNull();
  });
});
