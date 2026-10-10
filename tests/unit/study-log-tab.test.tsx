// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { StudyLogTab } from '@/entrypoints/options/StudyLogTab';
import { takePendingSeek } from '@/lib/pending-seek';
import { listEntries, saveExplanation } from '@/lib/study-log/store';
import type { NewStudyLogEntry } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());
afterEach(cleanup);

const line = (over: Partial<NewStudyLogEntry>): NewStudyLogEntry => ({
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
  ...over,
});

async function seed() {
  await saveExplanation(line({ phrase: "I'm gonna call it a night.", videoTimeMs: 1_834_200 }));
  await saveExplanation(line({ phrase: 'Where are you going?', videoTimeMs: 1000 }));
  await saveExplanation(line({ phrase: 'Pilot line', videoId: '80077209', episodeNumber: 1, episodeTitle: 'The Vanishing of Will Byers' }));
  await saveExplanation(
    line({ phrase: 'Movie line', videoId: '80240715', kind: 'movie', seriesId: null, seriesTitle: 'Roma', seasonNumber: null, episodeNumber: null, episodeTitle: null }),
  );
}

describe('Study Log tab', () => {
  it('invites a first explanation when empty', async () => {
    render(<StudyLogTab />);
    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
  });

  it('shows series → season → episode with counts, and the selected episode’s lines in time order', async () => {
    await seed();
    render(<StudyLogTab />);
    const tree = await screen.findByRole('navigation', { name: 'Shows and movies' });
    expect(within(tree).getByText('Stranger Things')).toBeTruthy();
    expect(within(tree).getByText('Season 1')).toBeTruthy();
    expect(within(tree).getByRole('button', { name: 'Roma, 1 line' })).toBeTruthy();
    expect(await screen.findByText('Pilot line')).toBeTruthy(); // first episode selected by default
    fireEvent.click(within(tree).getByRole('button', { name: 'E3 · Holly, Jolly, 2 lines' }));
    const lines = await screen.findByRole('list', { name: 'Explained lines' });
    const items = within(lines).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('p')?.textContent)).toEqual(['Where are you going?', "I'm gonna call it a night."]);
    expect(within(items[0]!).getByText('0:01')).toBeTruthy();
    expect(within(items[1]!).getByText('30:34')).toBeTruthy();
  });

  it('expands an explanation', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show explanation' }));
    expect(screen.getByRole('heading', { name: 'Meaning' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide explanation' })).toBeTruthy();
  });

  it('Open at this moment leaves a pending seek and opens the episode on Netflix', async () => {
    await seed();
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    render(<StudyLogTab />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Shows and movies' })).getByRole('button', { name: 'E3 · Holly, Jolly, 2 lines' }));
    const night = (await screen.findByText("I'm gonna call it a night.")).closest('li')!;
    fireEvent.click(within(night).getByRole('button', { name: 'Open at this moment' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ url: 'https://www.netflix.com/watch/80077211' }));
    expect(await takePendingSeek('80077211')).toBe(1_834_200);
  });

  it('deleting a line asks first; Cancel keeps it', async () => {
    await seed();
    render(<StudyLogTab />);
    const pilot = (await screen.findByText('Pilot line')).closest('li')!;
    fireEvent.click(within(pilot).getByRole('button', { name: 'Delete line' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this line?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await listEntries()).toHaveLength(4);
    fireEvent.click(within(pilot).getByRole('button', { name: 'Delete line' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await listEntries()).toHaveLength(3));
    await waitFor(() => expect(screen.queryByText('Pilot line')).toBeNull());
  });

  it('deletes a whole season after confirming', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Stranger Things Season 1' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await listEntries()).map((e) => e.phrase)).toEqual(['Movie line']));
  });

  it('Reset all empties the Study Log after confirming', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reset all' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Reset your Study Log?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset all' }));
    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
    expect(await listEntries()).toEqual([]);
  });

  it('shows a line saved from a Netflix tab without reloading', async () => {
    render(<StudyLogTab />);
    await screen.findByText('Nothing here yet');
    await saveExplanation(line({ phrase: 'Fresh line' }));
    expect(await screen.findByText('Fresh line')).toBeTruthy();
  });
});
