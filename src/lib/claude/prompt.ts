import { getExplanationLanguage } from '@/lib/languages';
import type { TitleInfo } from '@/lib/netflix/title';
import type { CardSections } from '@/lib/settings';
import type { Explanation } from '@/lib/study-log/types';
import type { DialogueContext, StoryLine } from '@/lib/subtitles/context';
import { normalizeLine } from '@/lib/subtitles/cue';
import { recentStoryText } from './context-blocks';
import { MAX_SUGGESTIONS, SUGGEST_SAVES_TOOL_NAME } from './suggestions';

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

/** v2 spec §5.3: asks for the suggest_saves call after the explanation. */
export const SUGGEST_INSTRUCTION = (languageName: string): string =>
  `After the explanation, call ${SUGGEST_SAVES_TOOL_NAME} once with up to ${MAX_SUGGESTIONS} items from the subtitle line that are worth studying: ` +
  'single words, phrases, idioms, and the whole line if it is worth keeping as a sentence. ' +
  'Use the exact text as it appears in the line. ' +
  `Give each a meaning of at most 12 words in ${languageName}. ` +
  'Leave out items the learner already saved. ' +
  "Don't mention the tool or the suggestions in your explanation.";

/**
 * Spec §7.2 plus the suggest_saves instruction (v2 spec §5.3), or §7.3 when `followUp` (no suggestions).
 * With every content section off, Meaning is still asked for.
 */
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
    : `${prompt}\n\n${SUGGEST_INSTRUCTION(lang)}`;
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

/** Spec §7.2 layout, with the story just before it (v2 spec §5.2 chunk B) on top when there is one. */
export function buildUserMessage(request: Pick<ExplainRequest, 'phrase' | 'context' | 'title'>, recent: readonly StoryLine[] = []): string {
  const indent = (line: string) => `  ${normalizeLine(line)}`;
  const dialogue = [
    titleLine(request.title),
    'Dialogue (the line to explain is marked with >>>):',
    ...request.context.before.map(indent),
    `>>> ${normalizeLine(request.phrase)}`,
    ...request.context.after.map(indent),
  ].join('\n');
  const story = recentStoryText(recent);
  return story ? `${story}\n\n${dialogue}` : dialogue;
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

/**
 * Spec §7.3: [user: initial request, assistant: explanation, user: q1, assistant: a1, …, user: new question].
 * `recent` is chunk B of the story so far, on top of the first message as in the original request.
 */
export function buildFollowUpMessages(explanation: Explanation, question: string, recent: readonly StoryLine[] = []): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'user', content: buildUserMessage({ phrase: explanation.phrase, context: explanation.context, title: titleOf(explanation) }, recent) },
    { role: 'assistant', content: explanation.response },
  ];
  for (const followUp of explanation.followUps) {
    messages.push({ role: 'user', content: followUp.question }, { role: 'assistant', content: followUp.answer });
  }
  messages.push({ role: 'user', content: question.trim() });
  return messages;
}
