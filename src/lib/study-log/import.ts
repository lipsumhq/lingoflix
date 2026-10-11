import { browser } from '#imports';
import { BACKUP_FORMAT, BACKUP_VERSION } from './export';
import { ITEM_PREFIX, itemIndexKey } from './items';
import { EXPLANATION_PREFIX, explanationIndexKey } from './store';
import { isSavedItem, toExplanation, type Explanation, type SavedItem } from './types';

export interface ImportSummary {
  itemsAdded: number;
  explanationsAdded: number;
  skipped: number;
  invalid: number;
}

export type ImportResult = { ok: true; summary: ImportSummary } | { ok: false; error: 'not-backup' | 'newer-version' };

/** v2 spec §7.4. */
export const IMPORT_ERROR_COPY: Record<'not-backup' | 'newer-version', string> = {
  'not-backup': "This isn't a LingoFlix backup file.",
  'newer-version': 'This backup was made by a newer LingoFlix.',
};

/** The file was fine, but it couldn't be read or saved (not covered by the spec's copy). */
export const IMPORT_FAILED_COPY = "Couldn't import this backup. Try again.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Only the SavedItem fields: anything else in a file never reaches storage. */
function pickItem(item: SavedItem): SavedItem {
  return {
    id: item.id,
    type: item.type,
    text: item.text,
    meaning: item.meaning,
    explanationId: item.explanationId,
    line: item.line,
    lineTimeMs: item.lineTimeMs,
    context: { before: item.context.before, after: item.context.after },
    videoId: item.videoId,
    kind: item.kind,
    seriesId: item.seriesId,
    seriesTitle: item.seriesTitle,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
    episodeTitle: item.episodeTitle,
    explanationLanguage: item.explanationLanguage,
    savedAt: item.savedAt,
    updatedAt: item.updatedAt,
  };
}

const explanationKeys = (e: Explanation) => [`${EXPLANATION_PREFIX}${e.id}`, explanationIndexKey(e.videoId, e.explanationLanguage, e.phrase)] as const;
const itemKeys = (i: SavedItem) => [`${ITEM_PREFIX}${i.id}`, itemIndexKey(i.videoId, i.line, i.type, i.text)] as const;

/**
 * v2 spec §7.4: adds what a backup file has and this computer doesn't. Never deletes or overwrites:
 * a record is skipped when its id or its index key is already taken. Rejects with storage errors.
 */
export async function importBackup(text: string): Promise<ImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-backup' };
  }
  if (!isRecord(data) || data.format !== BACKUP_FORMAT || !Array.isArray(data.items) || !Array.isArray(data.explanations)) {
    return { ok: false, error: 'not-backup' };
  }
  const { version } = data;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, error: 'not-backup' };
  if (version > BACKUP_VERSION) return { ok: false, error: 'newer-version' };

  let invalid = 0;
  const explanations: Explanation[] = [];
  for (const raw of data.explanations) {
    const explanation = toExplanation(raw);
    if (explanation) explanations.push(explanation);
    else invalid++;
  }
  const items: SavedItem[] = [];
  for (const raw of data.items) {
    if (isSavedItem(raw)) items.push(pickItem(raw));
    else invalid++;
  }

  const stored = await browser.storage.local.get([...explanations.flatMap(explanationKeys), ...items.flatMap(itemKeys)]);
  /** Every key that is taken, here or earlier in this file, with its value (index keys hold ids). */
  // A requested key that doesn't exist may come back as undefined (WXT's fake browser does this): not taken.
  const taken = new Map<string, unknown>(Object.entries(stored).filter(([, value]) => value !== undefined));
  const writes: Record<string, unknown> = {};
  /** A skipped file explanation's id → the id of the explanation of the same line already here. */
  const sameLine = new Map<string, string>();
  let explanationsAdded = 0;
  let itemsAdded = 0;
  let skipped = 0;

  for (const explanation of explanations) {
    const [idKey, indexKey] = explanationKeys(explanation);
    if (taken.has(idKey) || taken.has(indexKey)) {
      skipped++;
      const owner = taken.get(indexKey);
      if (typeof owner === 'string' && owner !== explanation.id) sameLine.set(explanation.id, owner);
      continue;
    }
    writes[idKey] = explanation;
    writes[indexKey] = explanation.id;
    taken.set(idKey, explanation).set(indexKey, explanation.id);
    explanationsAdded++;
  }

  for (const fileItem of items) {
    const owner = fileItem.explanationId === null ? undefined : sameLine.get(fileItem.explanationId);
    const item = owner ? { ...fileItem, explanationId: owner } : fileItem;
    const [idKey, indexKey] = itemKeys(item);
    if (taken.has(idKey) || taken.has(indexKey)) {
      skipped++;
      continue;
    }
    writes[idKey] = item;
    writes[indexKey] = item.id;
    taken.set(idKey, item).set(indexKey, item.id);
    itemsAdded++;
  }

  if (Object.keys(writes).length > 0) await browser.storage.local.set(writes);
  return { ok: true, summary: { itemsAdded, explanationsAdded, skipped, invalid } };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Added 40 items and 52 explanations. Skipped 12 already in your Study Log. 3 records couldn't be read." */
export function importSummaryText(summary: ImportSummary): string {
  const added = [
    summary.itemsAdded > 0 ? count(summary.itemsAdded, 'item', 'items') : null,
    summary.explanationsAdded > 0 ? count(summary.explanationsAdded, 'explanation', 'explanations') : null,
  ].filter((part): part is string => part !== null);
  const sentences = [added.length > 0 ? `Added ${added.join(' and ')}.` : 'Nothing new to add.'];
  if (summary.skipped > 0) sentences.push(`Skipped ${summary.skipped} already in your Study Log.`);
  if (summary.invalid > 0) sentences.push(`${count(summary.invalid, 'record', 'records')} couldn't be read.`);
  return sentences.join(' ');
}
