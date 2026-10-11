import { APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { toExplainError } from '@/lib/ai/errors';
import {
  SUGGEST_INSTRUCTION,
  buildFollowUpMessages,
  buildSystemPrompt,
  buildUserMessage,
  titleLine,
  type ExplainRequest,
} from '@/lib/ai/prompt';
import { MAX_LINE_CHARS, MAX_STORY_CHARS, UNREACHABLE, errorCopy, fitStory, parseClientMessage } from '@/lib/ai/protocol';
import type { TitleInfo } from '@/lib/netflix/title';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import type { Explanation } from '@/lib/study-log/types';
import { STORY_SEND_LIMIT, type StoryLine } from '@/lib/subtitles/context';

const ALL = DEFAULT_SETTINGS.cardSections;
const EPISODE: TitleInfo = {
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
};

describe('buildSystemPrompt', () => {
  it('is the spec §7.2 prompt in the chosen language with every enabled section', () => {
    const prompt = buildSystemPrompt('ko', ALL);
    expect(prompt).toContain(
      'You are a language tutor helping a learner understand dialogue from a show or film they are watching on Netflix. Write your entire answer in Korean (한국어); quote words from the original line in their original language.',
    );
    expect(prompt).toContain('Text in square brackets is a sound description or speaker label, not dialogue.');
    expect(prompt).toContain('Be concise: the learner has paused the video. Do not use em dashes; use a colon or a comma instead. ');
    expect(prompt).toContain(
      'with headings written in Korean (한국어):\n' +
        '1. Meaning: natural translation plus what the line means in this scene: tone, nuance, sarcasm, slang, register.\n' +
        '2. Key expressions: idioms, phrasal verbs, slang in the line, each with a short definition.\n' +
        '3. How to use it: 2 or 3 everyday example sentences in the original language, each with a translation.\n\n' +
        SUGGEST_INSTRUCTION('Korean (한국어)'),
    );
    expect(prompt.endsWith(SUGGEST_INSTRUCTION('Korean (한국어)'))).toBe(true);
    expect(prompt).not.toMatch(/[\u2013\u2014]/);
  });

  it('lists only the enabled sections, and falls back to Meaning when none are', () => {
    expect(buildSystemPrompt('en', { ...ALL, meaning: false, keyExpressions: false })).toMatch(/written in English:\n1\. How to use it: /);
    const none = buildSystemPrompt('en', { meaning: false, keyExpressions: false, howToUse: false, followUp: true });
    expect(none).toMatch(/written in English:\n1\. Meaning: /);
    expect(none).not.toContain('2.');
  });

  it('adds the follow-up instruction (spec §7.3)', () => {
    expect(buildSystemPrompt('ja', ALL, true)).toMatch(
      /The learner is now asking a follow-up question about this line\. Answer it directly and briefly in Japanese \(日本語\), without those sections\.$/,
    );
  });

  it('asks for suggest_saves after the explanation (v2 spec §5.3), never in follow-ups', () => {
    expect(SUGGEST_INSTRUCTION('Korean (한국어)')).toBe(
      'After the explanation, call suggest_saves once with up to 6 items from the subtitle line that are worth studying: ' +
        'single words, phrases, idioms, and the whole line if it is worth keeping as a sentence. ' +
        'Use the exact text as it appears in the line. ' +
        'Give each a meaning of at most 12 words in Korean (한국어). ' +
        'Leave out items the learner already saved. ' +
        "Don't mention the tool or the suggestions in your explanation.",
    );
    expect(SUGGEST_INSTRUCTION('Korean (한국어)')).not.toMatch(/[–—]/);
    expect(buildSystemPrompt('ko', ALL, true)).not.toContain('suggest_saves');
  });
});

describe('user message', () => {
  it('matches the spec §7.2 layout', () => {
    const request = {
      phrase: "I'm gonna call it\na night.",
      context: { before: ['Where are you going?', 'Home.'], after: ['Night, Mike.'] },
      title: EPISODE,
    };
    expect(buildUserMessage(request)).toBe(
      [
        'Title: Stranger Things, Season 1, Episode 3 "Holly, Jolly"',
        'Dialogue (the line to explain is marked with >>>):',
        '  Where are you going?',
        '  Home.',
        ">>> I'm gonna call it a night.",
        '  Night, Mike.',
      ].join('\n'),
    );
  });

  it('names movies and incomplete titles', () => {
    expect(titleLine({ ...EPISODE, kind: 'movie', seriesTitle: 'Roma', seasonNumber: null, episodeNumber: null, episodeTitle: null })).toBe('Movie: Roma');
    expect(titleLine({ ...EPISODE, seasonNumber: null, episodeTitle: null })).toBe('Title: Stranger Things, Episode 3');
    expect(titleLine({ ...EPISODE, seasonNumber: null, episodeNumber: null, episodeTitle: null })).toBe('Title: Stranger Things');
    expect(titleLine(null)).toBe('Title: unknown');
  });

  it('puts the story just before the dialogue on top (chunk B, v2 spec §5.1)', () => {
    const request = { phrase: 'Line', context: { before: ['Before'], after: [] }, title: EPISODE };
    expect(
      buildUserMessage(request, [
        { startMs: 1000, text: 'Earlier one.' },
        { startMs: 2000, text: 'Earlier two.' },
      ]),
    ).toBe(
      [
        'Just before:',
        '  Earlier one.',
        '  Earlier two.',
        '',
        'Title: Stranger Things, Season 1, Episode 3 "Holly, Jolly"',
        'Dialogue (the line to explain is marked with >>>):',
        '  Before',
        '>>> Line',
      ].join('\n'),
    );
    expect(buildUserMessage(request, [])).toBe(buildUserMessage(request));
  });
});

describe('buildFollowUpMessages', () => {
  it('replays the conversation: request, explanation, earlier Q&A, new question', () => {
    const entry = {
      phrase: 'Line',
      response: 'Explanation',
      followUps: [{ question: 'Q1', answer: 'A1' }],
      context: { before: [], after: [] },
      ...EPISODE,
    } as unknown as Explanation;
    const messages = buildFollowUpMessages(entry, '  Q2  ');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(messages[0]!.content).toContain('>>> Line');
    expect(messages.slice(1).map((m) => m.content)).toEqual(['Explanation', 'Q1', 'A1', 'Q2']);
  });

  it('puts the story just before the dialogue on top of the first message too', () => {
    const explanation = {
      phrase: 'Line',
      response: 'Explanation',
      followUps: [],
      context: { before: [], after: [] },
      suggestions: [],
      ...EPISODE,
    } as unknown as Explanation;
    const messages = buildFollowUpMessages(explanation, 'Q', [{ startMs: 0, text: 'Earlier.' }]);
    expect(messages[0]!.content.startsWith('Just before:\n  Earlier.\n\nTitle: Stranger Things')).toBe(true);
    expect(buildFollowUpMessages(explanation, 'Q')[0]!.content.startsWith('Title: ')).toBe(true);
  });
});

describe('errorCopy (free-own-key spec §4.6 card headlines)', () => {
  it('names the provider, or its company for credit', () => {
    expect((['no-key', 'bad-key', 'no-credit', 'busy', 'network', 'api'] as const).map((code) => [errorCopy(code, 'claude'), errorCopy(code, 'openai')])).toEqual([
      ['Add your API key', 'Add your API key'],
      ['Your Claude key was rejected', 'Your OpenAI key was rejected'],
      ['Your Anthropic account is out of credit', 'Your OpenAI account is out of credit'],
      ['Claude is busy right now', 'OpenAI is busy right now'],
      ["Couldn't reach Claude", "Couldn't reach OpenAI"],
      ['Claude returned an error', 'OpenAI returned an error'],
    ]);
  });

  it("without a provider (no key, or the background dropped before reading it), names none", () => {
    expect(errorCopy('no-key', null)).toBe('Add your API key');
    expect(errorCopy('network', null)).toBe(UNREACHABLE);
    expect(UNREACHABLE).toBe("Couldn't reach LingoFlix's background");
  });
});

describe('toExplainError (Anthropic SDK errors)', () => {
  const headers = new Headers();
  it('maps API failures to the card states of spec §4.6, naming the provider', () => {
    expect(
      toExplainError(APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'x', headers), 'claude'),
    ).toEqual({ code: 'bad-key', message: 'Your Claude key was rejected' });
    expect(toExplainError(APIError.generate(429, { error: { type: 'rate_limit_error', message: 'slow' } }, 'x', headers), 'claude').code).toBe('busy');
    expect(toExplainError(APIError.generate(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, 'x', headers), 'claude').code).toBe('busy');
    expect(toExplainError(new APIConnectionError({ message: 'fetch failed' }), 'claude')).toEqual({ code: 'network', message: "Couldn't reach Claude" });
    expect(toExplainError(new APIConnectionTimeoutError(), 'claude').code).toBe('network');
  });

  it('a 402 billing_error, before or during the stream, is no-credit', () => {
    const billing = { error: { type: 'billing_error', message: 'Your credit balance is too low.' } };
    expect(toExplainError(APIError.generate(402, billing, 'x', headers), 'claude')).toEqual({
      code: 'no-credit',
      message: 'Your Anthropic account is out of credit',
    });
    const midStream = new APIError(undefined, { type: 'error', ...billing }, undefined, undefined, 'billing_error');
    expect(toExplainError(midStream, 'claude').code).toBe('no-credit');
  });

  it('server errors and mid-stream rate limit or overload errors are busy, never raw HTML', () => {
    expect(toExplainError(APIError.generate(500, { error: { type: 'api_error', message: 'x' } }, 'x', headers), 'claude')).toEqual({
      code: 'busy',
      message: 'Claude is busy right now',
    });
    const badGateway = toExplainError(APIError.generate(502, '<html>bad gateway</html>' as never, '502 <html>', headers), 'claude');
    expect(badGateway).toEqual({ code: 'busy', message: 'Claude is busy right now' });
    for (const type of ['rate_limit_error', 'overloaded_error'] as const) {
      const midStream = new APIError(undefined, { type: 'error', error: { type, message: 'slow' } }, undefined, undefined, type);
      expect(toExplainError(midStream, 'claude').code).toBe('busy');
    }
  });

  it("a 400 about the credit balance is no-credit too (a text match on Anthropic's sentence, any case)", () => {
    for (const message of ['Your credit balance is too low to access the Anthropic API.', 'Your CREDIT BALANCE is too low.']) {
      const credit = APIError.generate(400, { error: { type: 'invalid_request_error', message } }, 'x', headers);
      expect(toExplainError(credit, 'claude')).toEqual({ code: 'no-credit', message: 'Your Anthropic account is out of credit' });
    }
  });

  it("shows Anthropic's own message for other API errors, else names the provider", () => {
    const tooLong = APIError.generate(
      400,
      { error: { type: 'invalid_request_error', message: 'prompt is too long: 250000 tokens > 200000 maximum' } },
      'x',
      headers,
    );
    expect(toExplainError(tooLong, 'claude')).toEqual({ code: 'api', message: 'prompt is too long: 250000 tokens > 200000 maximum' });
    const notFound = APIError.generate(404, { error: { type: 'not_found_error', message: 'model: no credit balance here' } }, 'x', headers);
    expect(toExplainError(notFound, 'claude')).toEqual({ code: 'api', message: 'model: no credit balance here' });
    expect(toExplainError(new Error(''), 'claude')).toEqual({ code: 'api', message: 'Claude returned an error' });
  });
});

describe('parseClientMessage', () => {
  const story: StoryLine[] = [
    { startMs: 1000, text: 'Earlier line' },
    { startMs: 4000, text: 'Another line' },
  ];
  const request: ExplainRequest = {
    phrase: 'Hi',
    context: { before: ['a'], after: [] },
    title: EPISODE,
    videoId: '80077211',
    videoTimeMs: 10_000,
    language: 'ko',
    sections: ALL,
    storySoFar: story,
  };

  it('accepts well-formed start and follow-up messages, with the story so far', () => {
    expect(parseClientMessage({ type: 'start', request })).toEqual({ type: 'start', request });
    expect(parseClientMessage({ type: 'start', request: { ...request, storySoFar: [] } })).toEqual({
      type: 'start',
      request: { ...request, storySoFar: [] },
    });
    expect(parseClientMessage({ type: 'follow-up', explanationId: 'e1', question: 'Why?', sections: ALL, storySoFar: story })).toEqual({
      type: 'follow-up',
      explanationId: 'e1',
      question: 'Why?',
      sections: ALL,
      storySoFar: story,
    });
  });

  it('rejects malformed ones', () => {
    expect(parseClientMessage({ type: 'start', request: { ...request, phrase: '' } })).toBeNull();
    expect(parseClientMessage({ type: 'start', request: { ...request, language: 'xx' } })).toBeNull();
    expect(parseClientMessage({ type: 'start', request: { ...request, videoTimeMs: Number.NaN } })).toBeNull();
    expect(parseClientMessage({ type: 'start', request: { ...request, context: { before: [1], after: [] } } })).toBeNull();
    expect(parseClientMessage({ type: 'follow-up', explanationId: 'e1', question: '   ', sections: ALL, storySoFar: [] })).toBeNull();
    expect(parseClientMessage({ type: 'follow-up', entryId: 'e1', question: 'Why?', sections: ALL, storySoFar: [] })).toBeNull(); // old field name
    expect(parseClientMessage({ type: 'follow-up', explanationId: 'e1', question: 'Why?', sections: ALL })).toBeNull(); // no story
    expect(parseClientMessage({ type: 'nope' })).toBeNull();
  });

  it('rejects a story that is malformed or larger than the content script ever sends', () => {
    const start = (storySoFar: unknown) => parseClientMessage({ type: 'start', request: { ...request, storySoFar } });
    expect(start(undefined)).toBeNull();
    expect(start([{ startMs: -1, text: 'x' }])).toBeNull();
    expect(start([{ startMs: Number.NaN, text: 'x' }])).toBeNull();
    expect(start([{ startMs: 1, text: 7 }])).toBeNull();
    expect(start(['just text'])).toBeNull();
    expect(start([{ startMs: 1, text: 'x'.repeat(2001) }])).toBeNull();
    expect(start(Array.from({ length: STORY_SEND_LIMIT + 1 }, (_, i) => ({ startMs: i, text: 'x' })))).toBeNull();
    expect(start(Array.from({ length: 101 }, (_, i) => ({ startMs: i, text: 'x'.repeat(2000) })))).toBeNull(); // 202 000 characters
    expect(start(Array.from({ length: STORY_SEND_LIMIT }, (_, i) => ({ startMs: i, text: 'line' })))).not.toBeNull();
  });
});

describe('fitStory (the story so far always fits what parseClientMessage accepts)', () => {
  const request: ExplainRequest = {
    phrase: 'Hi',
    context: { before: [], after: [] },
    title: EPISODE,
    videoId: '80077211',
    videoTimeMs: 10_000,
    language: 'ko',
    sections: ALL,
    storySoFar: [],
  };
  const accepted = (storySoFar: StoryLine[]) => parseClientMessage({ type: 'start', request: { ...request, storySoFar } }) !== null;
  const lines = (count: number, chars: number): StoryLine[] =>
    Array.from({ length: count }, (_, i) => ({ startMs: i * 1000, text: `${i}:`.padEnd(chars, 'x') }));

  it('leaves a story within the limits unchanged', () => {
    const story: StoryLine[] = [
      { startMs: 1000, text: 'Earlier line' },
      { startMs: 4000, text: 'Another line' },
    ];
    expect(fitStory(story)).toEqual(story);
    expect(fitStory([])).toEqual([]);
    const full = lines(STORY_SEND_LIMIT, 200); // exactly the total limit
    expect(fitStory(full)).toEqual(full);
  });

  it('cuts a line over the per-line limit', () => {
    const story: StoryLine[] = [
      { startMs: 1000, text: 'Earlier line' },
      { startMs: 4000, text: 'y'.repeat(5000) },
    ];
    expect(accepted(story)).toBe(false);
    const fitted = fitStory(story);
    expect(accepted(fitted)).toBe(true);
    expect(fitted).toEqual([
      { startMs: 1000, text: 'Earlier line' },
      { startMs: 4000, text: 'y'.repeat(MAX_LINE_CHARS) },
    ]);
  });

  it('does not split a character made of two code units when cutting', () => {
    const fitted = fitStory([{ startMs: 0, text: `${'y'.repeat(MAX_LINE_CHARS - 1)}\u{1F600} and more` }]);
    expect(fitted).toEqual([{ startMs: 0, text: 'y'.repeat(MAX_LINE_CHARS - 1) }]);
  });

  it('drops the oldest lines until the total fits, keeping the newest in order', () => {
    const story = lines(1000, 300); // 300 000 characters
    expect(accepted(story)).toBe(false);
    const fitted = fitStory(story);
    expect(accepted(fitted)).toBe(true);
    expect(fitted).toEqual(story.slice(-Math.floor(MAX_STORY_CHARS / 300)));
  });

  it('keeps at most the newest STORY_SEND_LIMIT lines, and applies every limit at once', () => {
    const long = lines(STORY_SEND_LIMIT + 500, 10);
    expect(fitStory(long)).toEqual(long.slice(-STORY_SEND_LIMIT));
    const huge = lines(STORY_SEND_LIMIT + 500, 5000);
    const fitted = fitStory(huge);
    expect(accepted(fitted)).toBe(true);
    expect(fitted.map((l) => l.startMs)).toEqual(huge.slice(-(MAX_STORY_CHARS / MAX_LINE_CHARS)).map((l) => l.startMs));
  });
});
