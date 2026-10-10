import type { DialogueContext } from '@/lib/subtitles/context';

export interface FollowUp {
  question: string;
  answer: string;
}

/** One explained line (spec §5.5). Times are episode ms; dates are ISO 8601. */
export interface StudyLogEntry {
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
}

export type NewStudyLogEntry = Omit<StudyLogEntry, 'id' | 'followUps' | 'savedAt' | 'updatedAt'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown) => Array.isArray(value) && value.every((v) => typeof v === 'string');

export function isStudyLogEntry(value: unknown): value is StudyLogEntry {
  if (!isRecord(value)) return false;
  const v = value;
  return (
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
    isStringArray(v.context.after)
  );
}
