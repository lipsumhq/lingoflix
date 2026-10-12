import { parseTitleInfo } from '@/lib/bridge/protocol';
import { isExplanationLanguage } from '@/lib/languages';
import { CARD_SECTION_IDS, type CardSections } from '@/lib/settings';
import type { Explanation } from '@/lib/study-log/types';
import { STORY_SEND_LIMIT, type StoryLine } from '@/lib/subtitles/context';
import type { ExplainRequest } from './prompt';
import { PROVIDERS, type Provider } from './provider';

/** One Port per request (spec §6.3); disconnecting only stops that card watching (finish-answers spec §3.2). */
export const EXPLAIN_PORT = 'explain';

export type ExplainClientMessage =
  | { type: 'start'; request: ExplainRequest }
  | { type: 'follow-up'; explanationId: string; question: string; sections: CardSections; storySoFar: StoryLine[] };

export type ExplainErrorCode = 'no-key' | 'bad-key' | 'no-credit' | 'busy' | 'network' | 'api';

/** The `network` headline when no provider is known: the Port dropped, or the background failed before reading the key. */
export const UNREACHABLE = "Couldn't reach LingoFlix's background";

/**
 * Free-own-key spec §4.6 card headlines, naming the key's provider (its company for credit). For `api`, the card
 * shows the provider's own message when there is one. Kept here, not in errors.ts, so the content script can use
 * it without bundling an SDK.
 */
export function errorCopy(code: ExplainErrorCode, provider: Provider | null): string {
  if (code === 'no-key') return 'Add your API key';
  if (provider === null) return UNREACHABLE;
  const { name, company } = PROVIDERS[provider];
  switch (code) {
    case 'bad-key':
      return `Your ${name} key was rejected`;
    case 'no-credit':
      return `Your ${company} account is out of credit`;
    case 'busy':
      return `${name} is busy right now`;
    case 'network':
      return `Couldn't reach ${name}`;
    case 'api':
      return `${name} returned an error`;
  }
}

/**
 * v2 spec §4.2: the stored explanation, and the index keys of its card rows that are saved. An error names the
 * key's provider (null when none is known), for the card's billing link.
 */
export type ExplainServerMessage =
  | { type: 'delta'; text: string }
  | { type: 'done'; explanation: Explanation; savedKeys: string[] }
  | { type: 'error'; code: ExplainErrorCode; message: string; provider: Provider | null };

/** The longest phrase, context line or story line a request may carry. */
export const MAX_LINE_CHARS = 2000;
const MAX_QUESTION_CHARS = 2000;
/** The most characters the story so far may carry in all; the content script fits it with `fitStory`. */
export const MAX_STORY_CHARS = 200_000;

/** `text` cut to at most `max` code units, never between the two halves of a surrogate pair. */
function cutText(text: string, max: number): string {
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * The story so far, fitted to what `parseClientMessage` accepts, so an unusual subtitle file can't make every
 * request for its title fail: the newest STORY_SEND_LIMIT lines, each cut to MAX_LINE_CHARS, then the oldest
 * dropped until the total is at most MAX_STORY_CHARS. A story within the limits comes back unchanged.
 */
export function fitStory(lines: readonly StoryLine[]): StoryLine[] {
  const newest = lines.slice(Math.max(0, lines.length - STORY_SEND_LIMIT));
  const cut = newest.map((line) => (line.text.length > MAX_LINE_CHARS ? { ...line, text: cutText(line.text, MAX_LINE_CHARS) } : line));
  let total = cut.reduce((sum, line) => sum + line.text.length, 0);
  let first = 0;
  while (total > MAX_STORY_CHARS) total -= cut[first++]!.text.length;
  return cut.slice(first);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isLine = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_LINE_CHARS;
const isLines = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 6 && value.every(isLine);

function parseSections(value: unknown): CardSections | null {
  if (!isRecord(value) || !CARD_SECTION_IDS.every((id) => typeof value[id] === 'boolean')) return null;
  return { meaning: !!value.meaning, keyExpressions: !!value.keyExpressions, howToUse: !!value.howToUse, followUp: !!value.followUp };
}

/** v2 spec §5.2: at most STORY_SEND_LIMIT lines, each a subtitle line with an episode time. */
function parseStory(value: unknown): StoryLine[] | null {
  if (!Array.isArray(value) || value.length > STORY_SEND_LIMIT) return null;
  const lines: StoryLine[] = [];
  let total = 0;
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const { startMs, text } = raw;
    if (typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0) return null;
    if (!isLine(text)) return null;
    total += text.length;
    if (total > MAX_STORY_CHARS) return null;
    lines.push({ startMs, text });
  }
  return lines;
}

function parseRequest(value: unknown): ExplainRequest | null {
  if (!isRecord(value)) return null;
  const { phrase, context, title, videoId, videoTimeMs, language, sections, storySoFar } = value;
  if (!isLine(phrase) || !phrase.trim()) return null;
  if (!isRecord(context) || !isLines(context.before) || !isLines(context.after)) return null;
  if (typeof videoId !== 'string' || !/^\d+$/.test(videoId)) return null;
  if (typeof videoTimeMs !== 'number' || !Number.isFinite(videoTimeMs) || videoTimeMs < 0) return null;
  if (!isExplanationLanguage(language)) return null;
  const parsedSections = parseSections(sections);
  const parsedTitle = title === null ? null : parseTitleInfo(title);
  const parsedStory = parseStory(storySoFar);
  if (!parsedSections || !parsedStory || (title !== null && !parsedTitle)) return null;
  return {
    phrase,
    context: { before: context.before, after: context.after },
    title: parsedTitle,
    videoId,
    videoTimeMs,
    language,
    sections: parsedSections,
    storySoFar: parsedStory,
  };
}

export function parseClientMessage(value: unknown): ExplainClientMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === 'start') {
    const request = parseRequest(value.request);
    return request ? { type: 'start', request } : null;
  }
  if (value.type === 'follow-up') {
    const { explanationId, question } = value;
    const sections = parseSections(value.sections);
    const storySoFar = parseStory(value.storySoFar);
    if (typeof explanationId !== 'string' || !explanationId || !sections || !storySoFar) return null;
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_CHARS) return null;
    return { type: 'follow-up', explanationId, question, sections, storySoFar };
  }
  return null;
}
