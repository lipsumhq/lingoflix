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
 */
export function toExplanation(value: unknown): Explanation | null {
  if (!isRecord(value)) return null;
  const v = value;
  const valid =
    typeof v.id === 'string' &&
    typeof v.phrase === 'string' &&
    typeof v.response === 'string' &&
    Array.isArray(v.followUps) &&
    typeof v.videoTimeMs === 'number' &&
    typeof v.savedAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    typeof v.videoId === 'string' &&
    (v.kind === 'episode' || v.kind === 'movie') &&
    typeof v.seriesTitle === 'string' &&
    typeof v.explanationLanguage === 'string' &&
    isRecord(v.context) &&
    isStringArray(v.context.before) &&
    isStringArray(v.context.after);
  if (!valid) return null;
  const suggestions = Array.isArray(v.suggestions) ? v.suggestions.filter(isSaveSuggestion) : [];
  return { ...(v as unknown as Explanation), suggestions };
}
