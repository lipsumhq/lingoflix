import { browser } from '#imports';
import { normalizeLine } from '@/lib/subtitles/cue';
import { isStudyLogEntry, type FollowUp, type NewStudyLogEntry, type StudyLogEntry } from './types';

/** `log:{id}` holds an entry (spec §5.5). */
export const ENTRY_PREFIX = 'log:';
/** `logkey:{videoId}|{language}|{normalized line}` holds the id of that line's entry. */
export const INDEX_PREFIX = 'logkey:';

const entryKey = (id: string) => `${ENTRY_PREFIX}${id}`;

export function indexKey(videoId: string, language: string, phrase: string): string {
  return `${INDEX_PREFIX}${videoId}|${language}|${normalizeLine(phrase)}`;
}

const indexKeyOf = (e: Pick<StudyLogEntry, 'videoId' | 'explanationLanguage' | 'phrase'>) =>
  indexKey(e.videoId, e.explanationLanguage, e.phrase);

export async function getEntry(id: string): Promise<StudyLogEntry | null> {
  const key = entryKey(id);
  const value = (await browser.storage.local.get(key))[key];
  return isStudyLogEntry(value) ? value : null;
}

/** Spec §5.3 step 3.1: the saved explanation of this line, in this language, in this video. */
export async function findEntry(videoId: string, language: string, phrase: string): Promise<StudyLogEntry | null> {
  const key = indexKey(videoId, language, phrase);
  const id = (await browser.storage.local.get(key))[key];
  return typeof id === 'string' ? getEntry(id) : null;
}

export async function listEntries(): Promise<StudyLogEntry[]> {
  const all = await browser.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ENTRY_PREFIX))
    .map(([, value]) => value)
    .filter(isStudyLogEntry);
}

/**
 * Saves a finished explanation. Saving a line that already has an entry replaces its response and clears
 * its follow-ups (they referred to the old response) but keeps its id and savedAt — that is Regenerate.
 */
export async function saveExplanation(
  fields: NewStudyLogEntry,
  now: Date = new Date(),
  newId: () => string = () => crypto.randomUUID(),
): Promise<StudyLogEntry> {
  const existing = await findEntry(fields.videoId, fields.explanationLanguage, fields.phrase);
  const stamp = now.toISOString();
  const entry: StudyLogEntry = existing
    ? { ...existing, ...fields, followUps: [], updatedAt: stamp }
    : { ...fields, id: newId(), followUps: [], savedAt: stamp, updatedAt: stamp };
  await browser.storage.local.set({ [entryKey(entry.id)]: entry, [indexKeyOf(entry)]: entry.id });
  return entry;
}

export async function appendFollowUp(id: string, followUp: FollowUp, now: Date = new Date()): Promise<StudyLogEntry | null> {
  const entry = await getEntry(id);
  if (!entry) return null;
  const next: StudyLogEntry = { ...entry, followUps: [...entry.followUps, followUp], updatedAt: now.toISOString() };
  await browser.storage.local.set({ [entryKey(id)]: next });
  return next;
}

export async function deleteEntries(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const keys = ids.map(entryKey);
  const stored = Object.values(await browser.storage.local.get(keys)).filter(isStudyLogEntry);
  const indexes = await browser.storage.local.get(stored.map(indexKeyOf));
  const ownIndexes = Object.entries(indexes)
    .filter(([, id]) => typeof id === 'string' && ids.includes(id))
    .map(([key]) => key);
  await browser.storage.local.remove([...keys, ...ownIndexes]);
}

/** Spec §5.5 Reset all: every entry and lookup key, nothing else (the API key stays). */
export async function resetStudyLog(): Promise<void> {
  const keys = Object.keys(await browser.storage.local.get(null)).filter(
    (key) => key.startsWith(ENTRY_PREFIX) || key.startsWith(INDEX_PREFIX),
  );
  if (keys.length > 0) await browser.storage.local.remove(keys);
}

/** Calls back whenever any entry is added, changed, or removed (e.g. from a Netflix tab). */
export function watchStudyLog(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(ENTRY_PREFIX))) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
