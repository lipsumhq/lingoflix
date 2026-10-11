import { browser } from '#imports';
import { cardRows } from '@/lib/ai/suggestions';
import { normalizeLine } from '@/lib/subtitles/cue';
import { EXPLANATION_PREFIX, ITEM_INDEX_PREFIX, ITEM_PREFIX, MIGRATION_KEY } from './keys';
import { isSavedItem, toExplanation, type Explanation, type ItemType, type SaveSuggestion, type SavedItem } from './types';

export { ITEM_INDEX_PREFIX, ITEM_PREFIX, MIGRATION_KEY } from './keys';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const itemKey = (id: string) => `${ITEM_PREFIX}${id}`;
/** Comparable form for lookup keys: case, spacing and line breaks don't matter. */
const fold = (text: string) => normalizeLine(text).toLowerCase();

export function itemIndexKey(videoId: string, line: string, type: ItemType, text: string): string {
  return `${ITEM_INDEX_PREFIX}${videoId}|${fold(line)}|${type}|${fold(text)}`;
}

/** The lookup key a card row would have: `line` rows use the explanation's phrase as their text. */
export function suggestionKey(
  explanation: Pick<Explanation, 'videoId' | 'phrase'>,
  suggestion: Pick<SaveSuggestion, 'type' | 'text'>,
): string {
  const text = suggestion.type === 'line' ? explanation.phrase : suggestion.text;
  return itemIndexKey(explanation.videoId, explanation.phrase, suggestion.type, text);
}

const indexKeyOf = (item: Pick<SavedItem, 'videoId' | 'line' | 'type' | 'text'>) =>
  itemIndexKey(item.videoId, item.line, item.type, item.text);

/** The item `suggestion` becomes. Every source field comes from the stored explanation, never from the page. */
export function itemFromSuggestion(explanation: Explanation, suggestion: SaveSuggestion, now: Date, id: string): SavedItem {
  const stamp = now.toISOString();
  return {
    id,
    type: suggestion.type,
    text: suggestion.type === 'line' ? explanation.phrase : suggestion.text,
    meaning: suggestion.meaning,
    explanationId: explanation.id,
    line: explanation.phrase,
    lineTimeMs: explanation.videoTimeMs,
    context: { before: [...explanation.context.before], after: [...explanation.context.after] },
    videoId: explanation.videoId,
    kind: explanation.kind,
    seriesId: explanation.seriesId,
    seriesTitle: explanation.seriesTitle,
    seasonNumber: explanation.seasonNumber,
    episodeNumber: explanation.episodeNumber,
    episodeTitle: explanation.episodeTitle,
    explanationLanguage: explanation.explanationLanguage,
    savedAt: stamp,
    updatedAt: stamp,
  };
}

export async function getItem(id: string): Promise<SavedItem | null> {
  const key = itemKey(id);
  const value = (await browser.storage.local.get(key))[key];
  return isSavedItem(value) ? value : null;
}

export async function listItems(): Promise<SavedItem[]> {
  const all = await browser.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ITEM_PREFIX))
    .map(([, value]) => value)
    .filter(isSavedItem);
}

/** Saves `suggestion` of `explanation`. Saving it again (same line, type and text) returns the item already saved. */
export async function saveItem(
  explanation: Explanation,
  suggestion: SaveSuggestion,
  now: Date = new Date(),
  newId: () => string = () => crypto.randomUUID(),
): Promise<SavedItem> {
  const indexKey = suggestionKey(explanation, suggestion);
  const existingId = (await browser.storage.local.get(indexKey))[indexKey];
  if (typeof existingId === 'string') {
    const existing = await getItem(existingId);
    if (existing) return existing;
  }
  const item = itemFromSuggestion(explanation, suggestion, now, newId());
  await browser.storage.local.set({ [itemKey(item.id)]: item, [indexKey]: item.id });
  return item;
}

/** Removes the item `suggestion` of `explanation` was saved as, with its lookup key. Nothing saved: no-op. */
export async function unsaveItem(
  explanation: Pick<Explanation, 'videoId' | 'phrase'>,
  suggestion: Pick<SaveSuggestion, 'type' | 'text'>,
): Promise<void> {
  const indexKey = suggestionKey(explanation, suggestion);
  const id = (await browser.storage.local.get(indexKey))[indexKey];
  if (typeof id !== 'string') return;
  await browser.storage.local.remove([indexKey, itemKey(id)]);
}

/** Removes items and the lookup keys that still point at them (a key re-pointed at another item stays). */
export async function deleteItems(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const keys = ids.map(itemKey);
  const items = Object.values(await browser.storage.local.get(keys)).filter(isSavedItem);
  const indexes = await browser.storage.local.get(items.map(indexKeyOf));
  const ownIndexes = Object.entries(indexes)
    .filter(([, id]) => typeof id === 'string' && ids.includes(id))
    .map(([key]) => key);
  await browser.storage.local.remove([...keys, ...ownIndexes]);
}

/** Lookup keys of the card rows (`cardRows`) of this explanation that are saved, in row order. */
export async function savedKeysFor(explanation: Explanation): Promise<string[]> {
  const keys = [...new Set(cardRows(explanation.suggestions, explanation.phrase).map((row) => suggestionKey(explanation, row)))];
  const saved = await browser.storage.local.get(keys);
  return keys.filter((key) => typeof saved[key] === 'string');
}

/**
 * v2 spec §3.3: before v2 every explanation was in the Study Log, so each one saved then (a record without a
 * `suggestions` field) becomes a saved whole-line item, dated like its explanation. Explanations written by v2
 * stay history only. Runs once (MIGRATION_KEY); a rerun after an interruption skips lines already saved.
 */
export async function migrateStudyLogV2(newId: () => string = () => crypto.randomUUID()): Promise<number> {
  const all = await browser.storage.local.get(null);
  if (all[MIGRATION_KEY] === true) return 0;
  const writes: Record<string, unknown> = {};
  let created = 0;
  for (const [key, raw] of Object.entries(all)) {
    if (!key.startsWith(EXPLANATION_PREFIX) || (isRecord(raw) && 'suggestions' in raw)) continue;
    const explanation = toExplanation(raw);
    if (!explanation) continue;
    const row: SaveSuggestion = { type: 'line', text: explanation.phrase, meaning: '' };
    const indexKey = suggestionKey(explanation, row);
    if (typeof all[indexKey] === 'string' || indexKey in writes) continue;
    const item: SavedItem = {
      ...itemFromSuggestion(explanation, row, new Date(), newId()),
      savedAt: explanation.savedAt,
      updatedAt: explanation.updatedAt,
    };
    writes[itemKey(item.id)] = item;
    writes[indexKey] = item.id;
    created++;
  }
  writes[MIGRATION_KEY] = true;
  await browser.storage.local.set(writes);
  return created;
}

let conversion: Promise<number> = Promise.resolve(0);

/** The Web Lock the worker and the options page both take to convert (same origin, so they share it). */
export const MIGRATION_LOCK = 'lingoflix:study-log-v2';

const convertUnlessMarked = async (): Promise<number> =>
  (await browser.storage.local.get(MIGRATION_KEY))[MIGRATION_KEY] === true ? 0 : migrateStudyLogV2();

/**
 * The conversion as the background (when the worker starts, and on install and update) and the Study Log tab run
 * it: `migrateStudyLogV2` unless the marker says it has run, reading only the marker then. Two runs that both read
 * storage before either writes would save each line twice, so calls run one at a time: queued within this context
 * (the worker starting and `runtime.onInstalled`, or StrictMode's double effect), and across contexts (a Study Log
 * tab restored at browser start while the worker converts) the marker check and the conversion run inside the
 * `MIGRATION_LOCK` Web Lock when `navigator.locks` exists. Never rejects: a failure is logged as a warning and
 * resolves 0, and the next call (or the options page) tries again.
 */
export function migrateIfNeeded(): Promise<number> {
  conversion = conversion
    .then(() => {
      const locks = globalThis.navigator?.locks;
      return locks ? locks.request(MIGRATION_LOCK, convertUnlessMarked) : convertUnlessMarked();
    })
    .catch((err: unknown) => {
      console.warn('LingoFlix: Study Log v2 conversion failed', err);
      return 0;
    });
  return conversion;
}
