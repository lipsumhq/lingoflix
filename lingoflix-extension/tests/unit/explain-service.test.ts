import { APIError } from '@anthropic-ai/sdk';
import { RateLimitError as OpenAIRateLimitError } from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { AiClient, StreamParams, SystemBlock, ToolCall } from '@/lib/ai/client';
import { createExplainService, type ExplainPort, type ExplainServiceDeps } from '@/lib/ai/explain-service';
import type { ExplainRequest } from '@/lib/ai/prompt';
import type { ExplainServerMessage } from '@/lib/ai/protocol';
import { PROVIDERS } from '@/lib/ai/provider';
import { SUGGEST_SAVES_TOOL } from '@/lib/ai/suggestions';
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
  model: PROVIDERS.claude.model,
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
  const client: AiClient = {
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

function deps(client: AiClient, over: Partial<ExplainServiceDeps> = {}): ExplainServiceDeps {
  return {
    getApiKey: async () => 'sk-ant-test-key-0000',
    createClient: () => client,
    saveExplanation: (fields) => saveExplanation(fields),
    getExplanation,
    appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
    loadHistory: async () => ({ items: await listItems(), explanations: await listExplanations() }),
    savedKeysFor,
    keepAlive: () => {},
    ...over,
  };
}

/** One card's Port, served by its own service (tests of a single card). */
const serveExplainPort = (port: ExplainPort, d: ExplainServiceDeps) => createExplainService(d).serve(port);

/** A client the test drives: each stream waits for the test's text, then for it to finish or fail. */
function controlledClient() {
  const streams: { signal: AbortSignal; text(delta: string): void; finish(toolCalls?: ToolCall[]): void; fail(error: unknown): void }[] = [];
  const client: AiClient = {
    stream: (_params, onText, signal) =>
      new Promise((resolve, reject) => {
        let text = '';
        signal.addEventListener('abort', () => reject(new Error('aborted')));
        streams.push({
          signal,
          text: (delta) => {
            text += delta;
            onText(delta);
          },
          finish: (toolCalls = []) => resolve({ text, toolCalls }),
          fail: reject,
        });
      }),
    async checkKey() {},
  };
  return { client, streams };
}

const START = { type: 'start', request: REQUEST } as const;

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
      model: 'claude-sonnet-5-5',
      context: REQUEST.context,
      suggestions: [
        { type: 'idiom', text: 'call it a night', meaning: '그만 자러 가다' },
        { type: 'word', text: 'gonna', meaning: 'going to' },
      ],
    });
    expect(done.savedKeys).toEqual([]);
    expect(await findExplanation('80077211', 'ko', REQUEST.phrase)).toEqual(done.explanation);
    expect(calls[0]).toMatchObject({ kind: 'explain', tools: [SUGGEST_SAVES_TOOL] });
    expect(calls[0]).not.toHaveProperty('model');
    expect(systemOf(calls[0]!)[0]).toEqual({ text: expect.stringContaining('Korean (한국어)'), cache: false });
    expect(systemOf(calls[0]!)[0]!.text).toContain('suggest_saves');
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: expect.stringContaining(">>> I'm gonna call it a night.") }]);
  });

  it('stores the model that wrote the explanation: GPT-6.1 Sol for an OpenAI key (free-own-key spec §4.8)', async () => {
    const { client } = fakeClient({ deltas: ['ok'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client, { getApiKey: async () => 'sk-proj-test-key-0000' }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(doneOf(sent).explanation.model).toBe('gpt-6.1-sol');
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

  it("leaves this line's saved items out of the history, so Claude can suggest them again (Regenerate, v2 spec §4.1)", async () => {
    const stored = await saveExplanation(STORED);
    await saveItem(stored, { type: 'idiom', text: 'call it a night', meaning: '그만 자러 가다' });
    const other = await saveExplanation({ ...STORED, phrase: 'Where is Will?', videoTimeMs: 600_000, suggestions: [] });
    await saveItem(other, { type: 'phrase', text: 'Where is', meaning: 'asking for a place' });
    const { client, calls } = fakeClient({ deltas: ['ok'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: { ...REQUEST, storySoFar: [{ startMs: 1_700_000, text: 'Old line' }] } });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    const history = systemOf(calls[0]!)[2]!;
    expect(history.cache).toBe(true);
    expect(history.text).toContain('- Where is (phrase): asking for a place');
    expect(history.text).not.toContain('call it a night');
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

  it('a failure reading the learning history still sends the request, without a history block', async () => {
    const { client, calls } = fakeClient({ deltas: ['ok'] });
    const { port, sent, send } = fakePort();
    const loadHistory = vi.fn(async () => Promise.reject(new Error('storage')));
    serveExplainPort(port, deps(client, { loadHistory }));
    send({ type: 'start', request: { ...REQUEST, storySoFar: [{ startMs: 1_700_000, text: 'Old line' }] } });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(loadHistory).toHaveBeenCalledOnce();
    expect(sent.slice(0, -1)).toEqual([{ type: 'delta', text: 'ok' }]);
    const system = systemOf(calls[0]!);
    expect(system).toHaveLength(2);
    expect(system[1]).toEqual({ text: expect.stringContaining('Old line'), cache: true });
    expect(system[2]).toBeUndefined();
    expect(doneOf(sent).explanation.response).toBe('ok');

    const saved = await saveExplanation(STORED);
    const followUp = fakePort();
    serveExplainPort(followUp.port, deps(client, { loadHistory }));
    followUp.send({ type: 'follow-up', explanationId: saved.id, question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] });
    await vi.waitFor(() => expect(followUp.sent.at(-1)?.type).toBe('done'));
    expect(systemOf(calls[1]!)).toEqual([{ text: expect.stringContaining('follow-up question'), cache: false }]);
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
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'no-key', message: 'Add your API key', provider: null }]));
    expect(createClient).not.toHaveBeenCalled();
  });

  it('a saved key that is not a Claude or OpenAI key counts as no key', async () => {
    const createClient = vi.fn();
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(fakeClient().client, { getApiKey: async () => 'legacy-key-1234', createClient }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'no-key', message: 'Add your API key', provider: null }]));
    expect(createClient).not.toHaveBeenCalled();
  });

  it("a background failure before the key is read (storage gone) says it couldn't reach LingoFlix's background", async () => {
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
    await vi.waitFor(() =>
      expect(sent).toEqual([{ type: 'error', code: 'network', message: "Couldn't reach LingoFlix's background", provider: null }]),
    );
  });

  it("a failure after the key is read (storage gone) names the key's provider", async () => {
    const { port, sent, send } = fakePort();
    serveExplainPort(
      port,
      deps(fakeClient().client, {
        getApiKey: async () => 'sk-proj-test-key-0000',
        getExplanation: async () => {
          throw new Error('storage gone');
        },
      }),
    );
    send({ type: 'follow-up', explanationId: 'e1', question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'network', message: "Couldn't reach OpenAI", provider: 'openai' }]));
  });

  it("a silent stream times out as Couldn't reach Claude", async () => {
    const { client } = fakeClient({ hang: true });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client, { idleTimeoutMs: 20 }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'network', message: "Couldn't reach Claude", provider: 'claude' }]));
    expect(await listExplanations()).toEqual([]);
  });

  it('any stream event keeps the request alive, not only text (free-own-key spec §4.3)', async () => {
    vi.useFakeTimers();
    try {
      let events: { activity(): void; finish(): void } | undefined;
      const client: AiClient = {
        stream: (_params, onText, signal, onActivity) =>
          new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
            events = {
              activity: onActivity,
              finish: () => {
                onText('ok');
                resolve({ text: 'ok', toolCalls: [] });
              },
            };
          }),
        async checkKey() {},
      };
      const { port, sent, send } = fakePort();
      serveExplainPort(port, deps(client, { idleTimeoutMs: 30_000 }));
      send({ type: 'start', request: REQUEST });
      await vi.waitFor(() => expect(events).toBeDefined());
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(20_000); // 60 s in all with no text, never 30 s without an event
        events!.activity();
      }
      events!.finish();
      await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
      expect(sent.filter((m) => m.type === 'error')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps API errors to card states and saves nothing', async () => {
    const rejected = APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'x', new Headers());
    const { client } = fakeClient({ deltas: [], error: rejected });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'bad-key', message: 'Your Claude key was rejected', provider: 'claude' }]));
    expect(await listExplanations()).toEqual([]);
  });

  it("names the key's provider in errors, and its company when out of credit", async () => {
    for (const [apiKey, error, expected] of [
      [
        'sk-ant-test-key-0000',
        APIError.generate(402, { error: { type: 'billing_error', message: 'No credit' } }, 'x', new Headers()),
        { type: 'error', code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' },
      ],
      [
        'sk-proj-test-key-0000',
        new OpenAIRateLimitError(429, { type: 'insufficient_quota', code: 'insufficient_quota', message: 'No quota' }, 'x', new Headers()),
        { type: 'error', code: 'no-credit', message: 'Your OpenAI account is out of credit', provider: 'openai' },
      ],
    ] as const) {
      const { client } = fakeClient({ error });
      const { port, sent, send } = fakePort();
      serveExplainPort(port, deps(client, { getApiKey: async () => apiKey }));
      send({ type: 'start', request: REQUEST });
      await vi.waitFor(() => expect(sent).toEqual([expected]));
    }
  });

  it('an empty answer is an error, not an explanation', async () => {
    const { client } = fakeClient({ deltas: ['  '], toolCalls: [SUGGESTIONS] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() =>
      expect(sent.at(-1)).toEqual({ type: 'error', code: 'api', message: 'Claude returned an empty answer.', provider: 'claude' }),
    );
    expect(await listExplanations()).toEqual([]);

    const openai = fakePort();
    serveExplainPort(openai.port, deps(fakeClient({ deltas: [' '] }).client, { getApiKey: async () => 'sk-proj-test-key-0000' }));
    openai.send({ type: 'start', request: REQUEST });
    await vi.waitFor(() =>
      expect(openai.sent.at(-1)).toEqual({ type: 'error', code: 'api', message: 'OpenAI returned an empty answer.', provider: 'openai' }),
    );
  });
});

describe('explain service: answers finish (finish-answers spec)', () => {
  it('a card that closes mid-answer stops watching; the answer still finishes and is saved', async () => {
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const card = fakePort();
    service.serve(card.port);
    card.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.text('Part one. ');
    card.disconnect();
    streams[0]!.text('Part two.');
    streams[0]!.finish([SUGGESTIONS]);

    await vi.waitFor(async () => expect(await findExplanation('80077211', 'ko', REQUEST.phrase)).not.toBeNull());
    const saved = (await findExplanation('80077211', 'ko', REQUEST.phrase))!;
    expect(saved.response).toBe('Part one. Part two.');
    expect(saved.suggestions.map((s) => s.text)).toEqual(['call it a night', 'gonna']);
    expect(streams[0]!.signal.aborted).toBe(false);
    expect(card.sent).toEqual([{ type: 'delta', text: 'Part one. ' }]);
  });

  it('a card that reopens the line joins the answer: the text so far, then the rest and done; the AI is asked once', async () => {
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const first = fakePort();
    service.serve(first.port);
    first.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.text('Part one. ');
    streams[0]!.text('Part two. ');
    first.disconnect();

    // The same line, spaced differently, with a later story: still the same answer.
    const reopened = fakePort();
    service.serve(reopened.port);
    reopened.send({
      type: 'start',
      request: { ...REQUEST, phrase: `  ${REQUEST.phrase.replace(' ', '  ')} `, storySoFar: [{ text: 'Hi.', startMs: 1_000 }] },
    });
    expect(reopened.sent).toEqual([{ type: 'delta', text: 'Part one. Part two. ' }]);

    streams[0]!.text('Part three.');
    streams[0]!.finish();
    await vi.waitFor(() => expect(reopened.sent.at(-1)?.type).toBe('done'));
    expect(reopened.sent.slice(0, 2)).toEqual([
      { type: 'delta', text: 'Part one. Part two. ' },
      { type: 'delta', text: 'Part three.' },
    ]);
    expect(doneOf(reopened.sent).explanation.response).toBe('Part one. Part two. Part three.');
    expect(first.sent).toEqual([
      { type: 'delta', text: 'Part one. ' },
      { type: 'delta', text: 'Part two. ' },
    ]);
    expect(streams).toHaveLength(1);
    expect(await listExplanations()).toHaveLength(1);
  });

  it('two cards that start the same line before the key is read share one request', async () => {
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const [a, b] = [fakePort(), fakePort()];
    service.serve(a.port);
    service.serve(b.port);
    a.send(START);
    b.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.text('Shared.');
    streams[0]!.finish();
    await vi.waitFor(() => expect(b.sent.at(-1)?.type).toBe('done'));
    expect(a.sent).toEqual(b.sent);
    expect(streams).toHaveLength(1);
  });

  it("a card whose Port is already gone stops neither the answer nor the other cards", async () => {
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const [gone, card] = [fakePort(), fakePort()];
    service.serve(gone.port);
    service.serve(card.port);
    gone.send(START);
    card.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    // Chrome throws when a Port closed before its disconnect event arrived.
    gone.port.postMessage = () => {
      throw new Error('Attempting to use a disconnected port object');
    };
    streams[0]!.text('Still here.');
    streams[0]!.finish();
    await vi.waitFor(() => expect(card.sent.at(-1)?.type).toBe('done'));
    expect(card.sent[0]).toEqual({ type: 'delta', text: 'Still here.' });
    expect(await listExplanations()).toHaveLength(1);
  });

  it('a card that joins while the answer is being saved gets the whole text and done', async () => {
    const { client, streams } = controlledClient();
    let save: (() => void) | undefined;
    const service = createExplainService(
      deps(client, {
        saveExplanation: async (fields) => {
          await new Promise<void>((resolve) => (save = resolve));
          return saveExplanation(fields);
        },
      }),
    );
    const first = fakePort();
    service.serve(first.port);
    first.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.text('Whole answer.');
    streams[0]!.finish();
    await vi.waitFor(() => expect(save).toBeDefined());
    first.disconnect();

    const late = fakePort();
    service.serve(late.port);
    late.send(START);
    save!();
    await vi.waitFor(() => expect(late.sent.at(-1)?.type).toBe('done'));
    expect(late.sent[0]).toEqual({ type: 'delta', text: 'Whole answer.' });
    expect(streams).toHaveLength(1);
  });

  it('an error reaches every card watching; with none watching nothing is saved, and the next start asks again', async () => {
    const rejected = APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'x', new Headers());
    const error = { type: 'error', code: 'bad-key', message: 'Your Claude key was rejected', provider: 'claude' };
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const [a, b] = [fakePort(), fakePort()];
    service.serve(a.port);
    service.serve(b.port);
    a.send(START);
    b.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.fail(rejected);
    await vi.waitFor(() => expect(a.sent).toEqual([error]));
    expect(b.sent).toEqual([error]);

    const closed = fakePort();
    service.serve(closed.port);
    closed.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(2)); // the failed answer was dropped: a new request
    closed.disconnect();
    streams[1]!.fail(rejected);
    await new Promise((r) => setTimeout(r, 0));
    expect(closed.sent).toEqual([]);
    expect(await listExplanations()).toEqual([]);

    const next = fakePort();
    service.serve(next.port);
    next.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(3));
  });

  it('a silent stream ends the answer for every card, saves nothing, and the next start asks again', async () => {
    const error = { type: 'error', code: 'network', message: "Couldn't reach Claude", provider: 'claude' };
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client, { idleTimeoutMs: 20 }));
    const [a, b, closed] = [fakePort(), fakePort(), fakePort()];
    for (const card of [a, b, closed]) {
      service.serve(card.port);
      card.send(START);
    }
    closed.disconnect();
    await vi.waitFor(() => expect(a.sent).toEqual([error]));
    expect(b.sent).toEqual([error]);
    expect(closed.sent).toEqual([]);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.signal.aborted).toBe(true);
    expect(await listExplanations()).toEqual([]);

    const again = fakePort();
    service.serve(again.port);
    again.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(2));
  });

  it('a follow-up whose card closes still finishes and is appended', async () => {
    const stored = await saveExplanation(STORED);
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const card = fakePort();
    service.serve(card.port);
    card.send({
      type: 'follow-up',
      explanationId: stored.id,
      question: 'Why "gonna"?',
      sections: DEFAULT_SETTINGS.cardSections,
      storySoFar: [],
    });
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    card.disconnect();
    streams[0]!.text('It is casual speech.');
    streams[0]!.finish();
    await vi.waitFor(async () =>
      expect((await getExplanation(stored.id))!.followUps).toEqual([{ question: 'Why "gonna"?', answer: 'It is casual speech.' }]),
    );
    expect(card.sent).toEqual([]);
  });

  it('a follow-up that finishes after its explanation was regenerated is not appended (it was about the old response)', async () => {
    const stored = await saveExplanation(STORED);
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const followUp = fakePort();
    service.serve(followUp.port);
    followUp.send({ type: 'follow-up', explanationId: stored.id, question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] });
    await vi.waitFor(() => expect(streams).toHaveLength(1));

    // Regenerate: the line is explained again and saved, under the same id, before the follow-up finishes.
    const regenerate = fakePort();
    service.serve(regenerate.port);
    regenerate.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(2));
    streams[1]!.text('New explanation');
    streams[1]!.finish();
    await vi.waitFor(() => expect(regenerate.sent.at(-1)?.type).toBe('done'));
    expect(doneOf(regenerate.sent).explanation.id).toBe(stored.id);

    streams[0]!.text('Because.');
    streams[0]!.finish();
    // Regenerate cancels the follow-up's Port; one still watching hears the explanation it was about is gone.
    await vi.waitFor(() =>
      expect(followUp.sent.at(-1)).toEqual({ type: 'error', code: 'api', message: 'This explanation is no longer available.', provider: 'claude' }),
    );
    expect(await getExplanation(stored.id)).toMatchObject({ response: 'New explanation', followUps: [] });
  });

  it('keeps the background alive every 25 s while an answer or follow-up is in progress, then stops', async () => {
    vi.useFakeTimers();
    try {
      const keepAlive = vi.fn();
      const { client, streams } = controlledClient();
      const service = createExplainService(deps(client, { keepAlive, idleTimeoutMs: 600_000 }));
      const [a, b] = [fakePort(), fakePort()];
      service.serve(a.port);
      service.serve(b.port);
      a.send(START);
      b.send({ type: 'start', request: { ...REQUEST, phrase: 'Night.' } }); // another line: its own answer
      await vi.waitFor(() => expect(streams).toHaveLength(2));
      a.disconnect();
      b.disconnect();
      expect(keepAlive).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(50_000);
      expect(keepAlive).toHaveBeenCalledTimes(2);
      streams[0]!.text('One.');
      streams[0]!.finish();
      await vi.advanceTimersByTimeAsync(25_000);
      expect(keepAlive).toHaveBeenCalledTimes(3); // the other answer is still in progress

      streams[1]!.text('Two.');
      streams[1]!.finish();
      await vi.waitFor(async () => expect(await listExplanations()).toHaveLength(2));
      keepAlive.mockClear();
      await vi.advanceTimersByTimeAsync(100_000);
      expect(keepAlive).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a follow-up alone in progress keeps the background alive too, and the timer stops after it', async () => {
    vi.useFakeTimers();
    try {
      const stored = await saveExplanation(STORED);
      const keepAlive = vi.fn();
      const { client, streams } = controlledClient();
      const service = createExplainService(deps(client, { keepAlive, idleTimeoutMs: 600_000 }));
      const card = fakePort();
      service.serve(card.port);
      card.send({ type: 'follow-up', explanationId: stored.id, question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] });
      await vi.waitFor(() => expect(streams).toHaveLength(1));
      card.disconnect();

      await vi.advanceTimersByTimeAsync(50_000);
      expect(keepAlive).toHaveBeenCalledTimes(2);
      streams[0]!.text('Because.');
      streams[0]!.finish();
      await vi.waitFor(async () => expect((await getExplanation(stored.id))!.followUps).toHaveLength(1));
      keepAlive.mockClear();
      await vi.advanceTimersByTimeAsync(100_000);
      expect(keepAlive).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a keep-alive call that fails (e.g. while the extension shuts down) is ignored, and the answer still finishes', async () => {
    vi.useFakeTimers();
    try {
      // A plain function, not vi.fn: a mock handles the promises it returns, which would hide a leaked rejection
      // (Vitest fails the run on an unhandled one).
      let calls = 0;
      const keepAlive = () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('Extension context invalidated.'));
        throw new Error('Extension context invalidated.');
      };
      const { client, streams } = controlledClient();
      const service = createExplainService(deps(client, { keepAlive, idleTimeoutMs: 600_000 }));
      const card = fakePort();
      service.serve(card.port);
      card.send(START);
      await vi.waitFor(() => expect(streams).toHaveLength(1));

      await vi.advanceTimersByTimeAsync(50_000); // a rejected call, then one that throws
      expect(calls).toBe(2);
      streams[0]!.text('Still here.');
      streams[0]!.finish();
      await vi.waitFor(() => expect(card.sent.at(-1)?.type).toBe('done'));
      expect(doneOf(card.sent).explanation.response).toBe('Still here.');
    } finally {
      vi.useRealTimers();
    }
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
    expect(calls[0]).toMatchObject({ kind: 'follow-up' });
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

  it('two identical follow-ups started at once are not joined: each is asked, and both are appended', async () => {
    const stored = await saveExplanation(STORED);
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const [a, b] = [fakePort(), fakePort()];
    for (const card of [a, b]) {
      service.serve(card.port);
      card.send({ type: 'follow-up', explanationId: stored.id, question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] });
    }
    await vi.waitFor(() => expect(streams).toHaveLength(2));
    streams[0]!.text('First.');
    streams[0]!.finish();
    await vi.waitFor(() => expect(a.sent.at(-1)?.type).toBe('done'));
    streams[1]!.text('Second.');
    streams[1]!.finish();
    await vi.waitFor(() => expect(b.sent.at(-1)?.type).toBe('done'));
    expect(a.sent[0]).toEqual({ type: 'delta', text: 'First.' });
    expect(b.sent[0]).toEqual({ type: 'delta', text: 'Second.' });
    expect((await getExplanation(stored.id))!.followUps).toEqual([
      { question: 'Why?', answer: 'First.' },
      { question: 'Why?', answer: 'Second.' },
    ]);
  });

  it('a follow-up on a deleted explanation, malformed messages, and second messages are handled', async () => {
    const { client } = fakeClient({ deltas: ['x'] });
    const a = fakePort();
    serveExplainPort(a.port, deps(client));
    a.send({ type: 'follow-up', explanationId: 'gone', question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] });
    await vi.waitFor(() =>
      expect(a.sent).toEqual([{ type: 'error', code: 'api', message: 'This explanation is no longer available.', provider: 'claude' }]),
    );

    const b = fakePort();
    serveExplainPort(b.port, deps(client));
    b.send({ type: 'start', request: { ...REQUEST, phrase: '' } });
    b.send({ type: 'start', request: REQUEST }); // ignored: one request per port
    await vi.waitFor(() =>
      expect(b.sent).toEqual([{ type: 'error', code: 'api', message: 'LingoFlix sent a request it could not read.', provider: null }]),
    );
  });
});
