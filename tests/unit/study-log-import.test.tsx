// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { StudyLogExportMenu } from '@/entrypoints/options/StudyLogExportMenu';
import { StudyLogTab } from '@/entrypoints/options/StudyLogTab';
import { toBackup } from '@/lib/study-log/export';
import { importBackup, importSummaryText } from '@/lib/study-log/import';
import { MIGRATION_KEY, getItem, listItems, saveItem } from '@/lib/study-log/items';
import { findExplanation, getExplanation, listExplanations, saveExplanation } from '@/lib/study-log/store';
import type { Explanation, NewExplanation, SavedItem } from '@/lib/study-log/types';

beforeEach(async () => {
  fakeBrowser.reset();
  // Keep the one-time conversion (Task 2) from adding line items of its own.
  await fakeBrowser.storage.local.set({ [MIGRATION_KEY]: true });
});
afterEach(cleanup);

const LINE = "I'm gonna call it a night.";

const newExplanation = (over: Partial<NewExplanation> = {}): NewExplanation => ({
  phrase: LINE,
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

/** An explanation as it appears in a backup file. */
const explanation = (over: Partial<Explanation> = {}): Explanation => ({
  ...newExplanation(),
  id: 'e1',
  followUps: [],
  savedAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  ...over,
});

/** A saved item as it appears in a backup file. */
const savedItem = (over: Partial<SavedItem> = {}): SavedItem => ({
  id: 'i1',
  type: 'idiom',
  text: 'call it a night',
  meaning: 'stop for the night',
  explanationId: 'e1',
  line: LINE,
  lineTimeMs: 1_834_200,
  context: { before: ['Where are you going?'], after: ['Night.'] },
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  explanationLanguage: 'en',
  savedAt: '2026-10-10T10:05:00.000Z',
  updatedAt: '2026-10-10T10:05:00.000Z',
  ...over,
});

const backupFile = (items: unknown[], explanations: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'lingoflix-backup', version: 1, exportedAt: '2026-10-10T21:41:00.000Z', items, explanations, ...extra });

/** What this computer already has: explanation e1 and its idiom item i1. */
async function seedLocal() {
  const e1 = await saveExplanation(newExplanation(), new Date('2026-10-10T10:00:00Z'), () => 'e1');
  await saveItem(e1, e1.suggestions[0]!, new Date('2026-10-10T10:05:00Z'), () => 'i1');
}

describe('importBackup', () => {
  it('refuses files that are not LingoFlix backups, or come from a newer LingoFlix, and changes nothing', async () => {
    const before = await fakeBrowser.storage.local.get(null);
    const notBackups = [
      'not json',
      '[]',
      'null',
      JSON.stringify({ format: 'something-else', version: 1, items: [], explanations: [] }),
      JSON.stringify({ format: 'lingoflix-backup', version: 1, items: [] }), // no explanations array
      JSON.stringify({ format: 'lingoflix-backup', version: '1', items: [], explanations: [] }),
      JSON.stringify({ format: 'lingoflix-backup', version: 0, items: [], explanations: [] }),
      JSON.stringify({ format: 'lingoflix-backup', version: 1.5, items: [], explanations: [] }),
    ];
    for (const text of notBackups) expect(await importBackup(text)).toEqual({ ok: false, error: 'not-backup' });
    expect(await importBackup(backupFile([savedItem()], [explanation()], { version: 2 }))).toEqual({ ok: false, error: 'newer-version' });
    expect(await fakeBrowser.storage.local.get(null)).toEqual(before);
  });

  it('a newer backup is newer-version even when its arrays are not the ones this version knows', async () => {
    const before = await fakeBrowser.storage.local.get(null);
    expect(await importBackup(JSON.stringify({ format: 'lingoflix-backup', version: 2, entries: [] }))).toEqual({
      ok: false,
      error: 'newer-version',
    });
    expect(await importBackup(JSON.stringify({ format: 'lingoflix-backup', version: 3 }))).toEqual({ ok: false, error: 'newer-version' });
    // The format is checked first: a file of another format is never newer-version.
    expect(await importBackup(JSON.stringify({ format: 'other', version: 2, entries: [] }))).toEqual({ ok: false, error: 'not-backup' });
    expect(await fakeBrowser.storage.local.get(null)).toEqual(before);
  });

  it('adds a backup to an empty Study Log, index keys included', async () => {
    const result = await importBackup(toBackup([savedItem()], [explanation()], new Date('2026-10-10T21:41:00Z')));
    expect(result).toEqual({ ok: true, summary: { itemsAdded: 1, explanationsAdded: 1, skipped: 0, invalid: 0 } });
    expect((await findExplanation('80077211', 'en', LINE))?.id).toBe('e1');
    expect(await listItems()).toEqual([savedItem()]);
  });

  it('add-only merge with duplicates, invalid records and orphan items (Review Focus 4)', async () => {
    await seedLocal();
    const text = backupFile(
      [
        savedItem({ meaning: 'CHANGED' }), // i1: same id as the local item
        savedItem({ id: 'i2', type: 'line', text: 'Where are you going?', meaning: '', line: 'Where are you going?', lineTimeMs: 1000, explanationId: 'e2' }),
        savedItem({ id: 'i3', type: 'word', text: 'night', explanationId: 'gone' }), // its explanation is nowhere
        savedItem({ id: 'i4' }), // same line, type and text as the local i1: a duplicate by index key
        savedItem({ id: 'i5', type: 'word', text: 'gonna', explanationId: 'e3' }), // e3 is skipped as a copy of e1
        'not an item',
      ],
      [
        explanation({ response: 'CHANGED' }), // e1: same id as the local explanation
        explanation({ id: 'e2', phrase: 'Where are you going?', videoTimeMs: 1000, suggestions: [] }),
        explanation({ id: 'e3', response: 'Another take on the same line.' }), // same line as e1: a duplicate by index key
        { id: 'broken' },
      ],
    );

    expect(await importBackup(text)).toEqual({ ok: true, summary: { itemsAdded: 3, explanationsAdded: 1, skipped: 4, invalid: 2 } });

    // Nothing here was overwritten.
    expect((await getExplanation('e1'))?.response).toBe('## Meaning\nTime to sleep.');
    expect((await getItem('i1'))?.meaning).toBe('stop for the night');
    // Duplicates were not added.
    expect(await getExplanation('e3')).toBeNull();
    expect(await getItem('i4')).toBeNull();
    // New records came in, findable by their index keys.
    expect((await findExplanation('80077211', 'en', 'Where are you going?'))?.id).toBe('e2');
    expect((await listItems()).map((i) => i.id).sort()).toEqual(['i1', 'i2', 'i3', 'i5']);
    // An item of a skipped copy points to the explanation already here; an orphan keeps its id.
    expect((await getItem('i5'))?.explanationId).toBe('e1');
    expect((await getItem('i3'))?.explanationId).toBe('gone');
    expect((await listExplanations()).map((e) => e.id).sort()).toEqual(['e1', 'e2']);

    // Importing the same file again adds nothing.
    expect(await importBackup(text)).toEqual({ ok: true, summary: { itemsAdded: 0, explanationsAdded: 0, skipped: 8, invalid: 2 } });
  });

  it('counts an explanation with a malformed follow-up as unreadable and adds nothing for it', async () => {
    const before = await fakeBrowser.storage.local.get(null);
    const text = backupFile(
      [],
      [
        { ...explanation(), followUps: [1] },
        explanation({ id: 'e2', phrase: 'Where are you going?', videoTimeMs: 1000, suggestions: [] }),
      ],
    );
    expect(await importBackup(text)).toEqual({ ok: true, summary: { itemsAdded: 0, explanationsAdded: 1, skipped: 0, invalid: 1 } });
    // Only e2 and its index key were written: nothing under e1's id or e1's line.
    const after = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(after).filter((key) => !(key in before)).sort()).toEqual(['log:e2', 'logkey:80077211|en|Where are you going?']);
    expect(await getExplanation('e1')).toBeNull();
    expect(await findExplanation('80077211', 'en', LINE)).toBeNull();
  });

  it('counts a record repeated within one file once', async () => {
    const text = backupFile([savedItem(), savedItem()], [explanation(), explanation()]);
    expect(await importBackup(text)).toEqual({ ok: true, summary: { itemsAdded: 1, explanationsAdded: 1, skipped: 2, invalid: 0 } });
  });

  it('stores only the saved-item fields', async () => {
    await importBackup(backupFile([{ ...savedItem(), note: '<script>' }], [explanation()]));
    expect(await getItem('i1')).toEqual(savedItem());
  });

  it('stores only the explanation fields, inside follow-ups, context and suggestions too', async () => {
    const clean = explanation({ followUps: [{ question: 'Formal?', answer: 'No.' }] });
    const extra = {
      ...clean,
      note: '<script>',
      followUps: [{ question: 'Formal?', answer: 'No.', html: '<b>' }],
      context: { ...clean.context, speaker: 'Hopper' },
      suggestions: [{ ...clean.suggestions[0]!, score: 9 }],
    };
    expect(await importBackup(backupFile([], [extra]))).toEqual({
      ok: true,
      summary: { itemsAdded: 0, explanationsAdded: 1, skipped: 0, invalid: 0 },
    });
    expect((await fakeBrowser.storage.local.get('log:e1'))['log:e1']).toEqual(clean);
  });

  it('counts an explanation whose time is not a finite number of ms at or after 0 as unreadable', async () => {
    // JSON has no Infinity: 1e400 parses as Infinity.
    const text = backupFile([], [explanation({ videoTimeMs: 123_456_789 })]).replace('123456789', '1e400');
    expect(JSON.parse(text).explanations[0].videoTimeMs).toBe(Number.POSITIVE_INFINITY);
    expect(await importBackup(text)).toEqual({ ok: true, summary: { itemsAdded: 0, explanationsAdded: 0, skipped: 0, invalid: 1 } });
    expect(await importBackup(backupFile([], [explanation({ videoTimeMs: -1 })]))).toEqual({
      ok: true,
      summary: { itemsAdded: 0, explanationsAdded: 0, skipped: 0, invalid: 1 },
    });
    expect(await listExplanations()).toEqual([]);
  });
});

describe('importSummaryText', () => {
  it('reports what was added, skipped and unreadable', () => {
    expect(importSummaryText({ itemsAdded: 40, explanationsAdded: 52, skipped: 12, invalid: 0 })).toBe(
      'Added 40 items and 52 explanations. Skipped 12 already in your Study Log.',
    );
    expect(importSummaryText({ itemsAdded: 40, explanationsAdded: 52, skipped: 12, invalid: 3 })).toBe(
      "Added 40 items and 52 explanations. Skipped 12 already in your Study Log. 3 records couldn't be read.",
    );
    expect(importSummaryText({ itemsAdded: 1, explanationsAdded: 1, skipped: 0, invalid: 0 })).toBe('Added 1 item and 1 explanation.');
    expect(importSummaryText({ itemsAdded: 3, explanationsAdded: 0, skipped: 0, invalid: 1 })).toBe("Added 3 items. 1 record couldn't be read.");
    expect(importSummaryText({ itemsAdded: 0, explanationsAdded: 2, skipped: 1, invalid: 0 })).toBe(
      'Added 2 explanations. Skipped 1 already in your Study Log.',
    );
    expect(importSummaryText({ itemsAdded: 0, explanationsAdded: 0, skipped: 5, invalid: 0 })).toBe(
      'Nothing new to add. Skipped 5 already in your Study Log.',
    );
  });
});

describe('Import backup on the Study Log page', () => {
  const chooseFile = (contents: string) => {
    const input = screen.getByLabelText('Backup file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([contents], 'lingoflix-backup-2026-10-10.json', { type: 'application/json' })] } });
  };

  it('is always in the menu, even when nothing can be exported', () => {
    const onImport = vi.fn();
    render(<StudyLogExportMenu canExportView={false} canBackup={false} onExport={vi.fn()} onImport={onImport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const item = screen.getByRole('menuitem', { name: 'Import backup…' }) as HTMLButtonElement;
    expect(item.disabled).toBe(false);
    fireEvent.click(item);
    expect(onImport).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a file picker, adds the backup, and says what happened', async () => {
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import backup…' }));
    expect(pick).toHaveBeenCalled();

    chooseFile(toBackup([savedItem()], [explanation()], new Date('2026-10-10T21:41:00Z')));
    expect(await screen.findByText('Added 1 item and 1 explanation.')).toBeTruthy();
    expect((await screen.findAllByText('call it a night')).length).toBeGreaterThan(0); // the list shows it
  });

  it('explains a wrong file or a newer backup, and changes nothing', async () => {
    render(<StudyLogTab />);
    await screen.findByRole('button', { name: 'Export' });
    chooseFile('{"hello": "world"}');
    expect(await screen.findByText("This isn't a LingoFlix backup file.")).toBeTruthy();
    chooseFile(backupFile([savedItem()], [explanation()], { version: 2 }));
    expect(await screen.findByText('This backup was made by a newer LingoFlix.')).toBeTruthy();
    expect(await listItems()).toEqual([]);
  });
});
