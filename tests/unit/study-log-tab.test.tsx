// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { takePendingSeek } from '@/lib/pending-seek';
import { StudyLogTab } from '@/entrypoints/options/StudyLogTab';
import { ITEM_PREFIX, MIGRATION_KEY, listItems, saveItem } from '@/lib/study-log/items';
import { listExplanations, saveExplanation } from '@/lib/study-log/store';
import type { NewExplanation, SaveSuggestion } from '@/lib/study-log/types';

beforeEach(async () => {
  fakeBrowser.reset();
  // An install that has already moved to v2; the conversion test below removes this.
  await fakeBrowser.storage.local.set({ [MIGRATION_KEY]: true });
});
afterEach(cleanup);

const line = (over: Partial<NewExplanation>): NewExplanation => ({
  phrase: 'Line',
  response: '## Meaning\nAn explanation.',
  videoTimeMs: 1000,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: [], after: [] },
  explanationLanguage: 'en',
  model: 'claude-sonnet-5-5',
  suggestions: [],
  ...over,
});

async function save(over: Partial<NewExplanation>, suggestion: SaveSuggestion, savedAt: string) {
  return saveItem(await saveExplanation(line(over)), suggestion, new Date(savedAt));
}

const NIGHT = { phrase: "I'm gonna call it a night.", videoTimeMs: 1_834_200 };
const PILOT = { phrase: 'Pilot line', videoId: '80077209', episodeNumber: 1, episodeTitle: 'The Vanishing of Will Byers', videoTimeMs: 5000 };
const ROMA = {
  phrase: 'Movie line',
  videoId: '80240715',
  kind: 'movie' as const,
  seriesId: null,
  seriesTitle: 'Roma',
  seasonNumber: null,
  episodeNumber: null,
  episodeTitle: null,
};

/** 5 saved items from 4 explanations: 3 in E3, 1 in E1, 1 in the movie Roma. */
async function seed() {
  await save(ROMA, { type: 'phrase', text: 'Movie line', meaning: 'a line from a film' }, '2026-10-10T08:00:00Z');
  await save(PILOT, { type: 'word', text: 'Pilot', meaning: 'first episode' }, '2026-10-10T09:00:00Z');
  await save(NIGHT, { type: 'idiom', text: 'call it a night', meaning: 'stop for the evening' }, '2026-10-10T10:00:00Z');
  await save({ phrase: 'Where are you going?', videoTimeMs: 1000 }, { type: 'line', text: 'Where are you going?', meaning: '' }, '2026-10-10T10:01:00Z');
  await save(NIGHT, { type: 'word', text: 'gonna', meaning: 'going to (casual)' }, '2026-10-10T10:02:00Z');
}

const tree = () => screen.findByRole('navigation', { name: 'Shows and movies' });

/** The texts of the rows in the Saved items list, in order. */
async function rowTexts(): Promise<(string | null | undefined)[]> {
  const list = await screen.findByRole('list', { name: 'Saved items' });
  return within(list)
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[data-item-text]')?.textContent);
}

/** The row button whose text is `text`. */
async function rowButton(text: string): Promise<HTMLElement> {
  const list = await screen.findByRole('list', { name: 'Saved items' });
  const button = within(list)
    .getAllByRole('button')
    .find((b) => b.querySelector('[data-item-text]')?.textContent === text);
  if (!button) throw new Error(`No row for ${text}`);
  return button;
}

/** happy-dom is 1024 px wide; tests pick the layout explicitly. */
function layout(wide: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: wide,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

describe('Study Log tab', () => {
  it('invites a first save when empty', async () => {
    render(<StudyLogTab />);
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(screen.getByText('Hover a line on Netflix and save words, phrases, idioms or whole lines.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset all' })).toBeNull();
  });

  it('opens on All items, newest first, with where each item is from', async () => {
    await seed();
    render(<StudyLogTab />);
    expect(await rowTexts()).toEqual(['gonna', 'Where are you going?', 'call it a night', 'Pilot', 'Movie line']);
    expect(within(await tree()).getByRole('button', { name: 'All items, 5 saved items' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Words, phrases, idioms and lines you saved.')).toBeTruthy();
    const first = within(screen.getByRole('list', { name: 'Saved items' })).getAllByRole('listitem')[0]!;
    expect(within(first).getByText('Word')).toBeTruthy();
    expect(within(first).getByText('going to (casual)')).toBeTruthy();
    expect(within(first).getByText('Stranger Things S1 E3 30:34')).toBeTruthy();
  });

  it('shows series → season → episode with saved-item counts, and an episode’s items in line order', async () => {
    await seed();
    render(<StudyLogTab />);
    const nav = await tree();
    const seriesRow = within(nav).getByText('Stranger Things').parentElement!;
    expect(within(seriesRow).getByText('4')).toBeTruthy();
    expect(within(seriesRow).getByText('4 saved items')).toBeTruthy();
    const seasonRow = within(nav).getByText('Season 1').parentElement!;
    expect(within(seasonRow).getByText('4 saved items')).toBeTruthy();

    fireEvent.click(within(nav).getByRole('button', { name: 'E3 · Holly, Jolly, 3 saved items' }));
    await waitFor(async () => expect(await rowTexts()).toEqual(['Where are you going?', 'call it a night', 'gonna']));
    const rows = within(screen.getByRole('list', { name: 'Saved items' })).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('S1 E3 0:01')).toBeTruthy();

    fireEvent.click(within(nav).getByRole('button', { name: 'Roma, 1 saved item' }));
    expect(await screen.findByText('Roma 0:01')).toBeTruthy();
  });

  it('filters by type and searches text and meaning; Clear filters brings everything back', async () => {
    await seed();
    render(<StudyLogTab />);
    await rowTexts();
    fireEvent.click(screen.getByRole('radio', { name: 'Idioms' }));
    expect(await rowTexts()).toEqual(['call it a night']);
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    const search = screen.getByRole('searchbox', { name: 'Search saved items' });
    fireEvent.change(search, { target: { value: 'EVENING' } });
    expect(await rowTexts()).toEqual(['call it a night']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByText('Nothing matches.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await rowTexts()).toHaveLength(5);
    expect(screen.getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('searchbox', { name: 'Search saved items' }) as HTMLInputElement).value).toBe('');
  });

  it('deleting an episode asks first and removes its saved items only', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(within(await tree()).getByRole('button', { name: 'E3 · Holly, Jolly, 3 saved items' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete episode' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete episode?' });
    expect(within(dialog).getByText('All 3 saved items from this episode will be removed. Explanations stay in your history.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await listItems()).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Delete episode' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await listItems()).map((i) => i.text).sort()).toEqual(['Movie line', 'Pilot']));
    expect(await listExplanations()).toHaveLength(4);
  });

  it('a deleted episode stays unselected when a Netflix tab saves to it again', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(within(await tree()).getByRole('button', { name: 'E3 · Holly, Jolly, 3 saved items' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete episode' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await rowTexts()).toEqual(['Pilot', 'Movie line']));
    // A Netflix tab saves to that episode again: the page stays on All items instead of jumping back to it.
    await save(NIGHT, { type: 'idiom', text: 'call it a night', meaning: 'stop for the evening' }, '2026-10-10T11:00:00Z');
    await waitFor(async () => expect(await rowTexts()).toEqual(['call it a night', 'Pilot', 'Movie line']));
    expect(within(await tree()).getByRole('button', { name: 'All items, 3 saved items' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('heading', { name: 'All items' })).toBeTruthy();
  });

  it('deletes a whole season from the tree after confirming', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Stranger Things Season 1' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Stranger Things Season 1?' });
    expect(within(dialog).getByText('All 4 saved items from this season will be removed. Explanations stay in your history.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await listItems()).map((i) => i.text)).toEqual(['Movie line']));
  });

  it('deletes a whole show from the tree after confirming, keeping its explanations', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Stranger Things' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Stranger Things?' });
    expect(within(dialog).getByText('All 4 saved items from this show will be removed. Explanations stay in your history.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await listItems()).map((i) => i.text)).toEqual(['Movie line']));
    expect(await listExplanations()).toHaveLength(4);
    expect(await rowTexts()).toEqual(['Movie line']);
  });

  it('Reset all clears saved items and explanation history after confirming', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reset all' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Reset your Study Log?' });
    expect(within(dialog).getByText("Every saved item and every explanation in your history will be removed. This can't be undone.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset all' }));
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(await listItems()).toEqual([]);
    expect(await listExplanations()).toEqual([]);
  });

  it('offers Reset all when only explanation history is left', async () => {
    await saveExplanation(line({ phrase: 'Explained, never saved' }));
    render(<StudyLogTab />);
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset all' })).toBeTruthy();
  });

  it('turns explanations from before v2 into saved lines the first time it opens, once', async () => {
    await fakeBrowser.storage.local.remove(MIGRATION_KEY);
    // As the Study Log stored it before v2: no `suggestions` field.
    const { suggestions: _none, ...preV2 } = await saveExplanation(line({ phrase: 'Old line' }));
    await fakeBrowser.storage.local.set({ [`log:${preV2.id}`]: preV2 });
    // StrictMode, as on the options page, runs the effect twice: the line must still be saved only once.
    render(
      <StrictMode>
        <StudyLogTab />
      </StrictMode>,
    );
    expect(await rowTexts()).toEqual(['Old line']);
    const row = within(screen.getByRole('list', { name: 'Saved items' })).getAllByRole('listitem')[0]!;
    expect(within(row).getByText('Line')).toBeTruthy();
    expect(await listItems()).toHaveLength(1);
  });

  it('shows an item saved from a Netflix tab without reloading', async () => {
    render(<StudyLogTab />);
    await screen.findByText('Nothing saved yet');
    await save({ phrase: 'Fresh line' }, { type: 'line', text: 'Fresh line', meaning: '' }, '2026-10-10T11:00:00Z');
    expect(await rowTexts()).toEqual(['Fresh line']);
  });

  it('selecting a row marks it as current (wide window)', async () => {
    layout(true);
    await seed();
    render(<StudyLogTab />);
    const pilot = await rowButton('Pilot');
    fireEvent.click(pilot);
    expect(pilot.getAttribute('aria-current')).toBe('true');
    expect((await rowButton('gonna')).getAttribute('aria-current')).toBeNull();
  });
});

describe('Study Log detail view', () => {
  it('opens next to the list on a wide window; Escape closes it', async () => {
    layout(true);
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('call it a night'));
    const detail = await screen.findByRole('region', { name: 'call it a night' });
    expect(within(detail).getByText('stop for the evening')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Saved items' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'call it a night' })).toBeNull());
  });

  it('replaces the list on a narrow window; Back returns to it', async () => {
    layout(false);
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('Pilot'));
    expect(await screen.findByRole('region', { name: 'Pilot' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Saved items' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('list', { name: 'Saved items' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Pilot' })).toBeNull();
  });

  it('Open at this moment leaves a pending seek and opens the episode on Netflix', async () => {
    layout(true);
    await seed();
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('call it a night'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open at this moment' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ url: 'https://www.netflix.com/watch/80077211' }));
    expect(await takePendingSeek('80077211')).toBe(1_834_200);
  });

  it('Delete asks first (Escape cancels and keeps the detail open), then removes only that item', async () => {
    layout(true);
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('gonna'));
    const detail = await screen.findByRole('region', { name: 'gonna' });
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this item?' });
    expect(within(dialog).getByText('“gonna” will be removed from your Study Log. Its explanation stays in your history.')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('region', { name: 'gonna' })).toBeTruthy();

    fireEvent.click(within(screen.getByRole('region', { name: 'gonna' })).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'gonna' })).toBeNull());
    expect((await listItems()).map((i) => i.text).sort()).toEqual(['Movie line', 'Pilot', 'Where are you going?', 'call it a night']);
    expect(await listExplanations()).toHaveLength(4);
  });

  it('switching to another show or episode closes the detail view', async () => {
    layout(true);
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('gonna'));
    expect(await screen.findByRole('region', { name: 'gonna' })).toBeTruthy();
    fireEvent.click(within(await tree()).getByRole('button', { name: 'Roma, 1 saved item' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'gonna' })).toBeNull());
  });

  it('closes when its item is deleted from another tab, and stays closed if the item comes back', async () => {
    layout(true);
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('gonna'));
    expect(await screen.findByRole('region', { name: 'gonna' })).toBeTruthy();
    const gonna = (await listItems()).find((i) => i.text === 'gonna')!;
    await fakeBrowser.storage.local.remove(`${ITEM_PREFIX}${gonna.id}`);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'gonna' })).toBeNull());
    // The same item back (as a backup import brings it): the page doesn't reopen it unasked.
    await fakeBrowser.storage.local.set({ [`${ITEM_PREFIX}${gonna.id}`]: gonna });
    await waitFor(async () => expect(await rowTexts()).toContain('gonna'));
    expect(screen.queryByRole('region', { name: 'gonna' })).toBeNull();
    expect((await rowButton('gonna')).getAttribute('aria-current')).toBeNull();
  });
});
