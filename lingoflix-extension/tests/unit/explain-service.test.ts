import { APIError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { AiClient, StreamParams, SystemBlock, ToolCall } from '@/lib/ai/client';
import { serveExplainPort, type ExplainPort, type ExplainServiceDeps } from '@/lib/ai/explain-service';
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
    const outOfCredit = APIError.generate(402, { error: { type: 'billing_error', message: 'No credit' } }, 'x', new Headers());
    for (const [apiKey, expected] of [
      ['sk-ant-test-key-0000', { type: 'error', code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' }],
      ['sk-proj-test-key-0000', { type: 'error', code: 'no-credit', message: 'Your OpenAI account is out of credit', provider: 'openai' }],
    ] as const) {
      const { client } = fakeClient({ error: outOfCredit });
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
