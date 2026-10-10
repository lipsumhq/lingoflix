import { parseTitleInfo } from '@/lib/bridge/protocol';
import { isExplanationLanguage } from '@/lib/languages';
import { CARD_SECTION_IDS, type CardSections } from '@/lib/settings';
import type { StudyLogEntry } from '@/lib/study-log/types';
import type { ExplainRequest } from './prompt';

/** One Port per request (spec §6.3); disconnecting aborts it. */
export const EXPLAIN_PORT = 'explain';

export type ExplainClientMessage =
  | { type: 'start'; request: ExplainRequest }
  | { type: 'follow-up'; entryId: string; question: string; sections: CardSections };

export type ExplainErrorCode = 'no-key' | 'bad-key' | 'busy' | 'network' | 'api';

/**
 * Spec §7.4 card headlines. For `api`, the card shows Anthropic's own message instead. Kept here, not in
 * errors.ts, so the content script can use it without bundling the Anthropic SDK.
 */
export const ERROR_COPY: Record<ExplainErrorCode, string> = {
  'no-key': 'Add your Claude API key',
  'bad-key': 'Your API key was rejected',
  busy: 'Claude is busy right now',
  network: "Couldn't reach Claude",
  api: 'Claude returned an error',
};

export type ExplainServerMessage =
  | { type: 'delta'; text: string }
  | { type: 'done'; entry: StudyLogEntry }
  | { type: 'error'; code: ExplainErrorCode; message: string };

const MAX_LINE_CHARS = 2000;
const MAX_QUESTION_CHARS = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isLine = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_LINE_CHARS;
const isLines = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 6 && value.every(isLine);

function parseSections(value: unknown): CardSections | null {
  if (!isRecord(value) || !CARD_SECTION_IDS.every((id) => typeof value[id] === 'boolean')) return null;
  return { meaning: !!value.meaning, keyExpressions: !!value.keyExpressions, howToUse: !!value.howToUse, followUp: !!value.followUp };
}

function parseRequest(value: unknown): ExplainRequest | null {
  if (!isRecord(value)) return null;
  const { phrase, context, title, videoId, videoTimeMs, language, sections } = value;
  if (!isLine(phrase) || !phrase.trim()) return null;
  if (!isRecord(context) || !isLines(context.before) || !isLines(context.after)) return null;
  if (typeof videoId !== 'string' || !/^\d+$/.test(videoId)) return null;
  if (typeof videoTimeMs !== 'number' || !Number.isFinite(videoTimeMs) || videoTimeMs < 0) return null;
  if (!isExplanationLanguage(language)) return null;
  const parsedSections = parseSections(sections);
  const parsedTitle = title === null ? null : parseTitleInfo(title);
  if (!parsedSections || (title !== null && !parsedTitle)) return null;
  return {
    phrase,
    context: { before: context.before, after: context.after },
    title: parsedTitle,
    videoId,
    videoTimeMs,
    language,
    sections: parsedSections,
  };
}

export function parseClientMessage(value: unknown): ExplainClientMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === 'start') {
    const request = parseRequest(value.request);
    return request ? { type: 'start', request } : null;
  }
  if (value.type === 'follow-up') {
    const { entryId, question } = value;
    const sections = parseSections(value.sections);
    if (typeof entryId !== 'string' || !entryId || !sections) return null;
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_CHARS) return null;
    return { type: 'follow-up', entryId, question, sections };
  }
  return null;
}
