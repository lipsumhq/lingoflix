import { APIError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ClaudeClient, StreamParams, SystemBlock, ToolCall } from '@/lib/claude/client';
import { serveExplainPort, type ExplainPort, type ExplainServiceDeps } from '@/lib/claude/explain-service';
import type { ExplainRequest } from '@/lib/claude/prompt';
import type { ExplainServerMessage } from '@/lib/claude/protocol';
import { SUGGEST_SAVES_TOOL } from '@/lib/claude/suggestions';
import { CLAUDE_MODEL } from '@/lib/config';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { listItems, saveItem, savedKeysFor, suggestionKey } from '@/lib/study-log/items';
import { appendFollowUp, findExplanation, getExplanation, listExplanations, saveExplanation } from '@/lib/study-log/store';
import type { NewExplanation } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());

const REQUEST: ExplainRequest = {
  phrase: "I'm gonna call it a night.",
  context: { before: ['Where are you going?'], after: ['Night.'] },
  title: {
    videoId: '80077211',
    kind: 'episode',
    seriesId: '80057281',
    seriesTitle: 'Stranger Things',
    seasonNumber: 1,
    episodeNumber: 3,
    episodeTitle: 'Holly, Jolly',
  },
  videoId: '80077211',
  videoTimeMs: 1_834_200, // 30:34, so the last 5-minute boundary is 30:00 (1 800 000 ms)
  language: 'ko',
  sections: DEFAULT_SETTINGS.cardSections,
  storySoFar: [],
};

/** What a stored explanation of REQUEST's line looks like. */
const STORED: NewExplanation = {
  phrase: REQUEST.phrase,
  response: 'Explanation',
  videoTimeMs: 1_834_200,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: REQUEST.context,
  explanationLanguage: 'ko',
  model: CLAUDE_MODEL,
  suggestions: [{ type: 'idiom', text: 'call it a night', meaning: '그만 자러 가다' }],
};

const SUGGESTIONS: ToolCall = {
  name: 'suggest_saves',
  input: {
    items: [
      { type: 'idiom', text: 'call it a night', meaning: ' 그만 자러 가다 ' },
      { type: 'word', text: 'gonna', meaning: 'going to' },
      { type: 'word', text: 'banana', meaning: 'not in the line' },
      { type: 'slang', text: 'night', meaning: 'not a type' },
    ],
  },
};

function fakePort() {
  const sent: ExplainServerMessage[] = [];
  let onMessage: (message: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const port: ExplainPort = {
    postMessage: (m) => sent.push(m),
    onMessage: { addListener: (l) => (onMessage = l) },
    onDisconnect: { addListener: (l) => (onDisconnect = l) },
  };
  return { port, sent, send: (m: unknown) => onMessage(m), disconnect: () => onDisconnect() };
}

function fakeClient(script: { deltas?: string[]; toolCalls?: ToolCall[]; error?: unknown; hang?: boolean } = {}) {
  const calls: StreamParams[] = [];
  const signals: AbortSignal[] = [];
  const client: ClaudeClient = {
    async stream(params, onText, signal) {
      calls.push(params);
      signals.push(signal);
      if (script.hang) {
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      for (const delta of script.deltas ?? []) {
        await Promise.resolve();
        onText(delta);
      }
      if (script.error) throw script.error;
      return { text: (script.deltas ?? []).join(''), toolCalls: script.toolCalls ?? [] };
    },
    async checkKey() {},
  };
  return { client, calls, signals };
}

function deps(client: ClaudeClient, over: Partial<ExplainServiceDeps> = {}): ExplainServiceDeps {
  return {
    getApiKey: async () => 'sk-ant-test-key-0000',
    createClient: () => client,
    saveExplanation: (fields) => saveExplanation(fields),
    getExplanation,
    appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
    loadHistory: async () => ({ items: await listItems(), explanations: await listExplanations() }),
    savedKeysFor,
    ...over,
  };
}

const systemOf = (params: StreamParams) => params.system as SystemBlock[];
const doneOf = (sent: ExplainServerMessage[]) => sent.at(-1) as Extract<ExplainServerMessage, { type: 'done' }>;

describe('explain service: explanations', () => {
  it('streams deltas, stores the explanation with its checked suggestions, and finishes with it and its saved keys', async () => {
    const { client, calls } = fakeClient({ deltas: ['## 의미\n', '잘 시간이야.'], toolCalls: [SUGGESTIONS] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(sent.slice(0, 2)).toEqual([
      { type: 'delta', text: '## 의미\n' },
      { type: 'delta', text: '잘 시간이야.' },
    ]);
    const done = doneOf(sent);
    expect(done.explanation).toMatchObject({
      phrase: REQUEST.phrase,
      response: '## 의미\n잘 시간이야.',
      videoTimeMs: 1_834_200,
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      explanationLanguage: 'ko',
      model: CLAUDE_MODEL,
      context: REQUEST.context,
      suggestions: [
        { type: 'idiom', text: 'call it a night', meaning: '그만 자러 가다' },
        { type: 'word', text: 'gonna', meaning: 'going to' },
      ],
    });
    expect(done.savedKeys).toEqual([]);
    expect(await findExplanation('80077211', 'ko', REQUEST.phrase)).toEqual(done.explanation);
    expect(calls[0]).toMatchObject({ model: CLAUDE_MODEL, maxTokens: 1536, tools: [SUGGEST_SAVES_TOOL] });
    expect(systemOf(calls[0]!)[0]).toEqual({ text: expect.stringContaining('Korean (한국어)'), cache: false });
    expect(systemOf(calls[0]!)[0]!.text).toContain('suggest_saves');
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: expect.stringContaining(">>> I'm gonna call it a night.") }]);
  });

  it('without a suggest_saves call, the explanation is stored with no suggestions', async () => {
    for (const toolCalls of [[], [{ name: 'some_other_tool', input: SUGGESTIONS.input }]]) {
      fakeBrowser.reset();
      const { client } = fakeClient({ deltas: ['Fine.'], toolCalls });
      const { port, sent, send } = fakePort();
      serveExplainPort(port, deps(client));
      send({ type: 'start', request: REQUEST });
      await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
      expect(doneOf(sent).explanation.suggestions).toEqual([]);
      expect((await findExplanation('80077211', 'ko', REQUEST.phrase))?.response).toBe('Fine.');
    }
  });

  it('sends the story so far: the part before the last 5-minute boundary cached in the system prompt, the rest in the message', async () => {
    const { client, calls } = fakeClient({ deltas: ['ok'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    const storySoFar = [
      { startMs: 1_700_000, text: 'Old line' },
      { startMs: 1_810_000, text: 'Recent line' },
    ];
    send({ type: 'start', request: { ...REQUEST, storySoFar } });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    const system = systemOf(calls[0]!);
    expect(system[1]).toEqual({ text: expect.stringContaining('Old line'), cache: true });
    expect(system[1]!.text).not.toContain('Recent line');
    const message = calls[0]!.messages[0]!.content;
    expect(message).toContain('Recent line');
    expect(message).not.toContain('Old line');
  });

  it('sends the learning history as a cached block, leaving out the line being explained', async () => {
    const other = await saveExplanation({ ...STORED, phrase: 'Where is Will?', videoTimeMs: 600_000, suggestions: [] });
    await saveItem(other, { type: 'line', text: 'Where is Will?', meaning: 'asking about Will' });
    await saveExplanation(STORED); // this line was explained before: it is the one being explained again
    const { client, calls } = fakeClient({ deltas: ['ok'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    const history = systemOf(calls[0]!).at(-1)!;
    expect(history.cache).toBe(true);
    expect(history.text).toContain('Where is Will?');
    expect(history.text).not.toContain(REQUEST.phrase);
  });

  it('leaves out empty blocks, and caches the story and history but not the instructions', async () => {
    const bare = fakeClient({ deltas: ['ok'] });
    const a = fakePort();
    serveExplainPort(a.port, deps(bare.client));
    a.send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(a.sent.at(-1)?.type).toBe('done'));
    expect(systemOf(bare.calls[0]!)).toEqual([{ text: expect.stringContaining('Korean'), cache: false }]);

    const full = fakeClient({ deltas: ['ok'] });
    const b = fakePort();
    serveExplainPort(b.port, deps(full.client)); // the store now holds an explanation: history is not empty
    b.send({ type: 'start', request: { ...REQUEST, phrase: 'Another line.', storySoFar: [{ startMs: 1000, text: 'Old line' }] } });
    await vi.waitFor(() => expect(b.sent.at(-1)?.type).toBe('done'));
    expect(systemOf(full.calls[0]!).map((block) => block.cache)).toEqual([false, true, true]);
  });

  it('the request never contains a line after the context window', async () => {
    const spoiler = { startMs: 1_900_000, text: 'SPOILER: who did it' };
    const storySoFar = [{ startMs: 1_000_000, text: 'Way back' }, spoiler, { startMs: 1_834_200, text: 'SPOILER at the same time' }];
    const { client, calls } = fakeClient({ deltas: ['ok'] });
    const a = fakePort();
    serveExplainPort(a.port, deps(client));
    a.send({ type: 'start', request: { ...REQUEST, storySoFar } });
    await vi.waitFor(() => expect(a.sent.at(-1)?.type).toBe('done'));
    const startRequest = JSON.stringify(calls[0]);
    expect(startRequest).toContain('Way back');
    expect(startRequest).toContain('Night.'); // the 6 lines after the target are context, and allowed
    expect(startRequest).not.toContain('SPOILER');

    const saved = await saveExplanation(STORED);
    const b = fakePort();
    serveExplainPort(b.port, deps(client));
    b.send({ type: 'follow-up', explanationId: saved.id, question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar });
    await vi.waitFor(() => expect(b.sent.at(-1)?.type).toBe('done'));
    const followUpRequest = JSON.stringify(calls[1]);
    expect(followUpRequest).toContain('Way back');
    expect(followUpRequest).not.toContain('SPOILER');
  });

  it('done carries the keys of saved rows, and Regenerate keeps saved items', async () => {
    const stored = await saveExplanation(STORED);
    await saveItem(stored, stored.suggestions[0]!);
    const { client } = fakeClient({ deltas: ['New explanation'], toolCalls: [SUGGESTIONS] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    const done = doneOf(sent);
    expect(done.explanation.id).toBe(stored.id);
    expect(done.savedKeys).toEqual([suggestionKey(REQUEST, { type: 'idiom', text: 'call it a night' })]);
    expect(await listItems()).toHaveLength(1);
  });

  it('a failure reading saved keys still finishes, with none', async () => {
    const { client } = fakeClient({ deltas: ['ok'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client, { savedKeysFor: async () => Promise.reject(new Error('storage')) }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(doneOf(sent).savedKeys).toEqual([]);
  });
});

describe('explain service: failures', () => {
  it('without a key, asks for one and makes no request', async () => {
    const createClient = vi.fn();
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(fakeClient().client, { getApiKey: async () => null, createClient }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'no-key', message: 'Add your Claude API key' }]));
    expect(createClient).not.toHaveBeenCalled();
  });

  it("a background failure before the request (storage gone) shows Couldn't reach Claude", async () => {
    const { port, sent, send } = fakePort();
    serveExplainPort(
      port,
      deps(fakeClient().client, {
        getApiKey: async () => {
          throw new Error('storage gone');
        },
      }),
    );
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'network', message: "Couldn't reach Claude" }]));
  });

  it('disconnect aborts the request and saves nothing', async () => {
    const { client, signals } = fakeClient({ hang: true });
    const { port, sent, send, disconnect } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    disconnect();
    await new Promise((r) => setTimeout(r, 0));
    expect(signals[0]!.aborted).toBe(true);
    expect(sent).toEqual([]);
    expect(await listExplanations()).toEqual([]);
  });

  it("a silent stream times out as Couldn't reach Claude", async () => {
    const { client } = fakeClient({ hang: true });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client, { idleTimeoutMs: 20 }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'network', message: "Couldn't reach Claude" }]));
    expect(await listExplanations()).toEqual([]);
  });

  it('maps API errors to card states and saves nothing', async () => {
    const rejected = APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'x', new Headers());
    const { client } = fakeClient({ deltas: [], error: rejected });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'bad-key', message: 'Your API key was rejected' }]));
    expect(await listExplanations()).toEqual([]);
  });

  it('an empty answer is an error, not an explanation', async () => {
    const { client } = fakeClient({ deltas: ['  '], toolCalls: [SUGGESTIONS] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)).toEqual({ type: 'error', code: 'api', message: 'Claude returned an empty answer.' }));
    expect(await listExplanations()).toEqual([]);
  });
});

describe('explain service: follow-ups', () => {
  it('replays the conversation with the same story and history, without tools, and appends the Q&A', async () => {
    const saved = await saveExplanation(STORED);
    const { client, calls } = fakeClient({ deltas: ['아니요.'], toolCalls: [SUGGESTIONS] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    const storySoFar = [
      { startMs: 1_700_000, text: 'Old line' },
      { startMs: 1_810_000, text: 'Recent line' },
    ];
    send({ type: 'follow-up', explanationId: saved.id, question: ' Is it formal? ', sections: DEFAULT_SETTINGS.cardSections, storySoFar });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(calls[0]).toMatchObject({ model: CLAUDE_MODEL, maxTokens: 1024 });
    expect(calls[0]!.tools).toBeUndefined();
    const system = systemOf(calls[0]!);
    expect(system[0]).toEqual({ text: expect.stringContaining('follow-up question'), cache: false });
    expect(system[1]).toEqual({ text: expect.stringContaining('Old line'), cache: true });
    expect(calls[0]!.messages[0]!.content).toContain('Recent line');
    expect(calls[0]!.messages.map((m) => m.content).slice(1)).toEqual(['Explanation', 'Is it formal?']);
    const done = doneOf(sent);
    expect(done.explanation.followUps).toEqual([{ question: 'Is it formal?', answer: '아니요.' }]);
    expect(done.explanation.suggestions).toEqual(STORED.suggestions); // a follow-up never changes the suggestions
    expect(done.savedKeys).toEqual([]);
    expect((await getExplanation(saved.id))?.followUps).toEqual([{ question: 'Is it formal?', answer: '아니요.' }]);
  });

  it('a follow-up on a deleted explanation, malformed messages, and second messages are handled', async () => {
    const { client } = fakeClient({ deltas: ['x'] });
    const a = fakePort();
    serveExplainPort(a.port, deps(client));
    a.send({ type: 'follow-up', explanationId: 'gone', question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] });
    await vi.waitFor(() => expect(a.sent).toEqual([{ type: 'error', code: 'api', message: 'This explanation is no longer available.' }]));

    const b = fakePort();
    serveExplainPort(b.port, deps(client));
    b.send({ type: 'start', request: { ...REQUEST, phrase: '' } });
    b.send({ type: 'start', request: REQUEST }); // ignored: one request per port
    await vi.waitFor(() => expect(b.sent).toEqual([{ type: 'error', code: 'api', message: 'LingoFlix sent a request it could not read.' }]));
  });
});
