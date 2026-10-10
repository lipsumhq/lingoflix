import { getExplanationLanguage } from '@/lib/languages';
import type { TitleInfo } from '@/lib/netflix/title';
import type { CardSections } from '@/lib/settings';
import type { Explanation } from '@/lib/study-log/types';
import type { DialogueContext } from '@/lib/subtitles/context';
import { normalizeLine } from '@/lib/subtitles/cue';

/** Everything the overlay sends to explain a line (spec §7.2). Times are episode ms. */
export interface ExplainRequest {
  phrase: string;
  context: DialogueContext;
  title: TitleInfo | null;
  videoId: string;
  videoTimeMs: number;
  /** A code from src/lib/languages.ts. */
  language: string;
  sections: CardSections;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type ContentSection = 'meaning' | 'keyExpressions' | 'howToUse';
const CONTENT_SECTIONS: readonly ContentSection[] = ['meaning', 'keyExpressions', 'howToUse'];

/** One-sentence descriptions from spec §5.3. */
const SECTION_TEXT: Record<ContentSection, string> = {
  meaning: 'Meaning: natural translation plus what the line means in this scene: tone, nuance, sarcasm, slang, register.',
  keyExpressions: 'Key expressions: idioms, phrasal verbs, slang in the line, each with a short definition.',
  howToUse: 'How to use it: 2 or 3 everyday example sentences in the original language, each with a translation.',
};

function languageName(code: string): string {
  const l = getExplanationLanguage(code);
  return l.englishName === l.nativeName ? l.englishName : `${l.englishName} (${l.nativeName})`;
}

/** Spec §7.2 (and §7.3 when `followUp`). With every content section off, Meaning is still asked for. */
export function buildSystemPrompt(language: string, sections: CardSections, followUp = false): string {
  const lang = languageName(language);
  const enabled = CONTENT_SECTIONS.filter((id) => sections[id]);
  const list = (enabled.length > 0 ? enabled : (['meaning'] as const)).map((id, i) => `${i + 1}. ${SECTION_TEXT[id]}`).join('\n');
  const prompt =
    'You are a language tutor helping a learner understand dialogue from a show or film they are watching on Netflix. ' +
    `Write your entire answer in ${lang}; quote words from the original line in their original language. ` +
    'Use the surrounding dialogue and the title information to work out the speaker, the tone, and what the line actually means in this scene. ' +
    'Text in square brackets is a sound description or speaker label, not dialogue. ' +
    'Be concise: the learner has paused the video. ' +
    'Do not use em dashes; use a colon or a comma instead. ' +
    `Use Markdown with exactly these sections, in this order, with headings written in ${lang}:\n${list}`;
  return followUp
    ? `${prompt}\n\nThe learner is now asking a follow-up question about this line. Answer it directly and briefly in ${lang}, without those sections.`
    : prompt;
}

/** `Title: Stranger Things, Season 1, Episode 3 "Holly, Jolly"` or `Movie: Roma`. */
export function titleLine(title: TitleInfo | null): string {
  if (!title) return 'Title: unknown';
  if (title.kind === 'movie') return `Movie: ${title.seriesTitle}`;
  const numbers = [
    title.seasonNumber !== null ? `Season ${title.seasonNumber}` : null,
    title.episodeNumber !== null ? `Episode ${title.episodeNumber}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const detail = [numbers, title.episodeTitle ? `"${title.episodeTitle}"` : null].filter(Boolean).join(' ');
  return detail ? `Title: ${title.seriesTitle}, ${detail}` : `Title: ${title.seriesTitle}`;
}

export function buildUserMessage(request: Pick<ExplainRequest, 'phrase' | 'context' | 'title'>): string {
  const indent = (line: string) => `  ${normalizeLine(line)}`;
  return [
    titleLine(request.title),
    'Dialogue (the line to explain is marked with >>>):',
    ...request.context.before.map(indent),
    `>>> ${normalizeLine(request.phrase)}`,
    ...request.context.after.map(indent),
  ].join('\n');
}

const titleOf = (entry: Explanation): TitleInfo => ({
  videoId: entry.videoId,
  kind: entry.kind,
  seriesId: entry.seriesId,
  seriesTitle: entry.seriesTitle,
  seasonNumber: entry.seasonNumber,
  episodeNumber: entry.episodeNumber,
  episodeTitle: entry.episodeTitle,
});

/** Spec §7.3: [user: initial request, assistant: explanation, user: q1, assistant: a1, …, user: new question]. */
export function buildFollowUpMessages(entry: Explanation, question: string): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'user', content: buildUserMessage({ phrase: entry.phrase, context: entry.context, title: titleOf(entry) }) },
    { role: 'assistant', content: entry.response },
  ];
  for (const followUp of entry.followUps) {
    messages.push({ role: 'user', content: followUp.question }, { role: 'assistant', content: followUp.answer });
  }
  messages.push({ role: 'user', content: question.trim() });
  return messages;
}
