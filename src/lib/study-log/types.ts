import type { DialogueContext } from '@/lib/subtitles/context';

export interface FollowUp {
  question: string;
  answer: string;
}

/** What Claude can suggest saving from a line, and what a saved item is (v2 spec §3.1). */
export type ItemType = 'word' | 'phrase' | 'idiom' | 'line';
export const ITEM_TYPES: readonly ItemType[] = ['word', 'phrase', 'idiom', 'line'];

/** One `suggest_saves` item, validated (v2 spec §5.4). */
export interface SaveSuggestion {
  type: ItemType;
  text: string;
  meaning: string;
}

/** One explanation: the automatic history (v2 spec §3.1). Times are episode ms; dates are ISO 8601. */
export interface Explanation {
  id: string;
  phrase: string;
  /** Markdown. */
  response: string;
  followUps: FollowUp[];
  videoTimeMs: number;
  savedAt: string;
  updatedAt: string;
  videoId: string;
  kind: 'episode' | 'movie';
  seriesId: string | null;
  /** Series title, or the movie title. */
  seriesTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  context: DialogueContext;
  explanationLanguage: string;
  model: string;
  /** Claude's save suggestions; `[]` when there were none, and for records written before v2. */
  suggestions: SaveSuggestion[];
}

export type NewExplanation = Omit<Explanation, 'id' | 'followUps' | 'savedAt' | 'updatedAt'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown) => Array.isArray(value) && value.every((v) => typeof v === 'string');
const isNullableString = (value: unknown) => value === null || typeof value === 'string';
const isNullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));
const isFollowUp = (value: unknown): value is FollowUp =>
  isRecord(value) && typeof value.question === 'string' && typeof value.answer === 'string';

export function isSaveSuggestion(value: unknown): value is SaveSuggestion {
  return (
    isRecord(value) &&
    ITEM_TYPES.includes(value.type as ItemType) &&
    typeof value.text === 'string' &&
    typeof value.meaning === 'string'
  );
}

/**
 * A stored (or imported) explanation, or null when the value isn't one. A record written before v2 has no
 * `suggestions`, so it reads as `[]`; malformed suggestions are dropped one by one and the rest are kept.
 * A malformed follow-up makes the whole record invalid: dropping it would lose part of a conversation.
 */
export function toExplanation(value: unknown): Explanation | null {
  if (!isRecord(value)) return null;
  const v = value;
  const valid =
    typeof v.id === 'string' &&
    typeof v.phrase === 'string' &&
    typeof v.response === 'string' &&
    Array.isArray(v.followUps) &&
    v.followUps.every(isFollowUp) &&
    typeof v.videoTimeMs === 'number' &&
    typeof v.savedAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    typeof v.videoId === 'string' &&
    (v.kind === 'episode' || v.kind === 'movie') &&
    isNullableString(v.seriesId) &&
    typeof v.seriesTitle === 'string' &&
    isNullableNumber(v.seasonNumber) &&
    isNullableNumber(v.episodeNumber) &&
    isNullableString(v.episodeTitle) &&
    typeof v.explanationLanguage === 'string' &&
    typeof v.model === 'string' &&
    isRecord(v.context) &&
    isStringArray(v.context.before) &&
    isStringArray(v.context.after);
  if (!valid) return null;
  const suggestions = Array.isArray(v.suggestions) ? v.suggestions.filter(isSaveSuggestion) : [];
  return { ...(v as unknown as Explanation), suggestions };
}

/** One saved item: the Study Log (v2 spec §3.2). Its source fields are copied from the explanation. */
export interface SavedItem {
  id: string;
  type: ItemType;
  /** The word, phrase or idiom as it appears in the line; for `line`, the whole line. */
  text: string;
  /** Short meaning in `explanationLanguage`; may be ''. */
  meaning: string;
  /** The explanation it came from; null when that record is gone or was never imported. */
  explanationId: string | null;
  /** The full subtitle line. */
  line: string;
  /** Episode time where the line starts. */
  lineTimeMs: number;
  context: DialogueContext;
  videoId: string;
  kind: 'episode' | 'movie';
  seriesId: string | null;
  /** Series title, or the movie title. */
  seriesTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  explanationLanguage: string;
  savedAt: string;
  updatedAt: string;
}

export function isSavedItem(value: unknown): value is SavedItem {
  if (!isRecord(value)) return false;
  const v = value;
  return (
    typeof v.id === 'string' &&
    ITEM_TYPES.includes(v.type as ItemType) &&
    typeof v.text === 'string' &&
    typeof v.meaning === 'string' &&
    isNullableString(v.explanationId) &&
    typeof v.line === 'string' &&
    typeof v.lineTimeMs === 'number' &&
    Number.isFinite(v.lineTimeMs) &&
    isRecord(v.context) &&
    isStringArray(v.context.before) &&
    isStringArray(v.context.after) &&
    typeof v.videoId === 'string' &&
    (v.kind === 'episode' || v.kind === 'movie') &&
    isNullableString(v.seriesId) &&
    typeof v.seriesTitle === 'string' &&
    isNullableNumber(v.seasonNumber) &&
    isNullableNumber(v.episodeNumber) &&
    isNullableString(v.episodeTitle) &&
    typeof v.explanationLanguage === 'string' &&
    typeof v.savedAt === 'string' &&
    typeof v.updatedAt === 'string'
  );
}
