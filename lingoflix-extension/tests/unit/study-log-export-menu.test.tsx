// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { StudyLogExportMenu } from '@/entrypoints/options/StudyLogExportMenu';
import { StudyLogTab } from '@/entrypoints/options/StudyLogTab';
import { MIGRATION_KEY, saveItem } from '@/lib/study-log/items';
import { saveExplanation } from '@/lib/study-log/store';
import type { NewExplanation } from '@/lib/study-log/types';

beforeEach(async () => {
  fakeBrowser.reset();
  // These tests seed items themselves: keep the one-time conversion (Task 2) from adding any.
  await fakeBrowser.storage.local.set({ [MIGRATION_KEY]: true });
});
afterEach(cleanup);

const newExplanation = (over: Partial<NewExplanation> = {}): NewExplanation => ({
  phrase: "I'm gonna call it a night.",
  response: '## Meaning\nTime to sleep.',
  videoTimeMs: 1_834_200,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: ['Where are you going?'], after: ['Night.'] },
  explanationLanguage: 'en',
  model: 'claude-sonnet-5-5',
  suggestions: [{ type: 'idiom', text: 'call it a night', meaning: 'stop for the night' }],
  ...over,
});

async function seedOneItem() {
  const explanation = await saveExplanation(newExplanation(), new Date('2026-10-10T10:00:00Z'), () => 'e1');
  await saveItem(explanation, explanation.suggestions[0]!, new Date('2026-10-10T10:05:00Z'), () => 'i1');
}

function renderMenu(props: { canExportView?: boolean; canBackup?: boolean } = {}) {
  const onExport = vi.fn();
  render(
    <div>
      <p>Outside</p>
      <StudyLogExportMenu canExportView={props.canExportView ?? true} canBackup={props.canBackup ?? true} onExport={onExport} />
    </div>,
  );
  return { onExport, trigger: screen.getByRole('button', { name: 'Export' }) };
}

describe('Export menu', () => {
  it('lists the three formats and exports the chosen one', () => {
    const { onExport, trigger } = renderMenu();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Anki (.txt)', 'CSV (.csv)', 'Full backup (.json)']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }));
    expect(onExport).toHaveBeenCalledWith('csv');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disables what would export nothing', () => {
    renderMenu({ canExportView: false, canBackup: true });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect((screen.getByRole('menuitem', { name: 'Anki (.txt)' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'CSV (.csv)' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'Full backup (.json)' }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    renderMenu({ canExportView: false, canBackup: false });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getAllByRole('menuitem').every((m) => (m as HTMLButtonElement).disabled)).toBe(true);
  });

  it('moves between items with the arrow keys; Escape closes and returns focus', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger);
    const [anki, csv, backup] = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(anki);
    fireEvent.keyDown(anki!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(csv);
    fireEvent.keyDown(csv!, { key: 'ArrowUp' });
    fireEvent.keyDown(anki!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(backup); // wraps around
    const page = vi.fn();
    document.addEventListener('keydown', page);
    fireEvent.keyDown(backup!, { key: 'Escape' });
    document.removeEventListener('keydown', page);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(page).not.toHaveBeenCalled(); // Escape stays in the menu: the detail view behind it stays open
  });

  it('closes on a press outside it', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Export on the Study Log page', () => {
  it('exports the current view as Anki and CSV, and everything as a backup', async () => {
    await seedOneItem();
    const download = vi.fn();
    render(<StudyLogTab download={download} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Anki (.txt)' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [ankiName, ankiText, ankiMime] = download.mock.calls[0]!;
    expect(ankiName).toMatch(/^lingoflix-anki-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(ankiMime).toBe('text/plain;charset=utf-8');
    expect(ankiText).toContain("call it a night\tstop for the night<br><br>I'm gonna <b>call it a night</b>.");

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    const [csvName, csvText, csvMime] = download.mock.calls[1]!;
    expect(csvName).toMatch(/^lingoflix-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csvMime).toBe('text/csv;charset=utf-8');
    expect(csvText).toContain('"idiom","call it a night","stop for the night"');

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Full backup (.json)' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(3));
    const [backupName, backupText, backupMime] = download.mock.calls[2]!;
    expect(backupName).toMatch(/^lingoflix-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(backupMime).toBe('application/json');
    const backup = JSON.parse(backupText as string) as { items: { id: string }[]; explanations: { id: string }[] };
    expect(backup.items.map((i) => i.id)).toEqual(['i1']);
    expect(backup.explanations.map((e) => e.id)).toEqual(['e1']);
    expect(backupText).not.toContain('apiKey');
  });

  it('with no saved items, still offers a backup of the explanation history', async () => {
    await saveExplanation(newExplanation(), new Date('2026-10-10T10:00:00Z'), () => 'e1');
    render(<StudyLogTab download={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    expect((screen.getByRole('menuitem', { name: 'Anki (.txt)' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'CSV (.csv)' }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((screen.getByRole('menuitem', { name: 'Full backup (.json)' }) as HTMLButtonElement).disabled).toBe(false));
  });
});
