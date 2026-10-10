import { browser } from '#imports';
import { normalizeLine } from '@/lib/subtitles/cue';
import { toExplanation, type Explanation, type FollowUp, type NewExplanation } from './types';

/** `log:{id}` holds an explanation (v2 spec §3.1). */
export const EXPLANATION_PREFIX = 'log:';
/** `logkey:{videoId}|{language}|{normalized line}` holds the id of that line's explanation. */
export const EXPLANATION_INDEX_PREFIX = 'logkey:';

const explanationKey = (id: string) => `${EXPLANATION_PREFIX}${id}`;

export function explanationIndexKey(videoId: string, language: string, phrase: string): string {
  return `${EXPLANATION_INDEX_PREFIX}${videoId}|${language}|${normalizeLine(phrase)}`;
}

const indexKeyOf = (e: Pick<Explanation, 'videoId' | 'explanationLanguage' | 'phrase'>) =>
  explanationIndexKey(e.videoId, e.explanationLanguage, e.phrase);

const isExplanation = (value: Explanation | null): value is Explanation => value !== null;

export async function getExplanation(id: string): Promise<Explanation | null> {
  const key = explanationKey(id);
  return toExplanation((await browser.storage.local.get(key))[key]);
}

/** Main spec §5.3 step 3.1: the explanation of this line, in this language, in this video. */
export async function findExplanation(videoId: string, language: string, phrase: string): Promise<Explanation | null> {
  const key = explanationIndexKey(videoId, language, phrase);
  const id = (await browser.storage.local.get(key))[key];
  return typeof id === 'string' ? getExplanation(id) : null;
}

export async function listExplanations(): Promise<Explanation[]> {
  const all = await browser.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(EXPLANATION_PREFIX))
    .map(([, value]) => toExplanation(value))
    .filter(isExplanation);
}

/**
 * Saves a finished explanation. Saving a line that already has one replaces its response and suggestions and
 * clears its follow-ups (they referred to the old response) but keeps its id and savedAt: that is Regenerate.
 */
export async function saveExplanation(
  fields: NewExplanation,
  now: Date = new Date(),
  newId: () => string = () => crypto.randomUUID(),
): Promise<Explanation> {
  const existing = await findExplanation(fields.videoId, fields.explanationLanguage, fields.phrase);
  const stamp = now.toISOString();
  const explanation: Explanation = existing
    ? { ...existing, ...fields, followUps: [], updatedAt: stamp }
    : { ...fields, id: newId(), followUps: [], savedAt: stamp, updatedAt: stamp };
  await browser.storage.local.set({ [explanationKey(explanation.id)]: explanation, [indexKeyOf(explanation)]: explanation.id });
  return explanation;
}

export async function appendFollowUp(id: string, followUp: FollowUp, now: Date = new Date()): Promise<Explanation | null> {
  const explanation = await getExplanation(id);
  if (!explanation) return null;
  const next: Explanation = { ...explanation, followUps: [...explanation.followUps, followUp], updatedAt: now.toISOString() };
  await browser.storage.local.set({ [explanationKey(id)]: next });
  return next;
}

export async function deleteExplanations(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const keys = ids.map(explanationKey);
  const stored = Object.values(await browser.storage.local.get(keys))
    .map((value) => toExplanation(value))
    .filter(isExplanation);
  const indexes = await browser.storage.local.get(stored.map(indexKeyOf));
  const ownIndexes = Object.entries(indexes)
    .filter(([, id]) => typeof id === 'string' && ids.includes(id))
    .map(([key]) => key);
  await browser.storage.local.remove([...keys, ...ownIndexes]);
}

/** Main spec §5.5 Reset all: every explanation and lookup key, nothing else (the API key stays). */
export async function resetStudyLog(): Promise<void> {
  const keys = Object.keys(await browser.storage.local.get(null)).filter(
    (key) => key.startsWith(EXPLANATION_PREFIX) || key.startsWith(EXPLANATION_INDEX_PREFIX),
  );
  if (keys.length > 0) await browser.storage.local.remove(keys);
}

/** Calls back whenever any explanation is added, changed, or removed (e.g. from a Netflix tab). */
export function watchStudyLog(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(EXPLANATION_PREFIX))) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
