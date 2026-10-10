import { APIError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ClaudeClient, StreamParams } from '@/lib/claude/client';
import { serveExplainPort, type ExplainPort, type ExplainServiceDeps } from '@/lib/claude/explain-service';
import type { ExplainRequest } from '@/lib/claude/prompt';
import type { ExplainServerMessage } from '@/lib/claude/protocol';
import { CLAUDE_MODEL } from '@/lib/config';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { appendFollowUp, findExplanation, getExplanation, listExplanations, saveExplanation } from '@/lib/study-log/store';

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
  videoTimeMs: 1_834_200,
  language: 'ko',
  sections: DEFAULT_SETTINGS.cardSections,
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

function fakeClient(script: { deltas?: string[]; error?: unknown; hang?: boolean } = {}) {
  const calls: StreamParams[] = [];
  const signals: AbortSignal[] = [];
  const client: ClaudeClient = {
    async streamText(params, onText, signal) {
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
      return (script.deltas ?? []).join('');
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
    ...over,
  };
}

describe('explain service', () => {
  it('streams deltas, saves the explanation, and finishes with the saved entry', async () => {
    const { client, calls } = fakeClient({ deltas: ['## 의미\n', '잘 시간이야.'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(sent.slice(0, 2)).toEqual([
      { type: 'delta', text: '## 의미\n' },
      { type: 'delta', text: '잘 시간이야.' },
    ]);
    const done = sent.at(-1) as Extract<ExplainServerMessage, { type: 'done' }>;
    expect(done.entry).toMatchObject({
      phrase: REQUEST.phrase,
      response: '## 의미\n잘 시간이야.',
      videoTimeMs: 1_834_200,
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      explanationLanguage: 'ko',
      model: CLAUDE_MODEL,
      context: REQUEST.context,
    });
    expect(await findExplanation('80077211', 'ko', REQUEST.phrase)).toEqual(done.entry);
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5-5', maxTokens: 1024 });
    expect(calls[0]!.system).toContain('Korean (한국어)');
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: expect.stringContaining(">>> I'm gonna call it a night.") }]);
  });

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

  it('an empty answer is an error, not an entry', async () => {
    const { client } = fakeClient({ deltas: ['  '] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)).toEqual({ type: 'error', code: 'api', message: 'Claude returned an empty answer.' }));
    expect(await listExplanations()).toEqual([]);
  });

  it('follow-up: replays the conversation and appends the Q&A to the entry', async () => {
    const saved = await saveExplanation({
      phrase: REQUEST.phrase,
      response: 'Explanation',
      videoTimeMs: 1000,
      videoId: '80077211',
      kind: 'episode',
      seriesId: '1',
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      episodeTitle: null,
      context: { before: [], after: [] },
      explanationLanguage: 'ko',
      model: CLAUDE_MODEL,
      suggestions: [],
    });
    const { client, calls } = fakeClient({ deltas: ['아니요.'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'follow-up', entryId: saved.id, question: ' Is it formal? ', sections: DEFAULT_SETTINGS.cardSections });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(calls[0]!.system).toContain('follow-up question');
    expect(calls[0]!.messages.map((m) => m.content).slice(1)).toEqual(['Explanation', 'Is it formal?']);
    expect((await getExplanation(saved.id))?.followUps).toEqual([{ question: 'Is it formal?', answer: '아니요.' }]);
  });

  it('follow-up on a deleted entry, malformed messages, and second messages are handled', async () => {
    const { client } = fakeClient({ deltas: ['x'] });
    const a = fakePort();
    serveExplainPort(a.port, deps(client));
    a.send({ type: 'follow-up', entryId: 'gone', question: 'Why?', sections: DEFAULT_SETTINGS.cardSections });
    await vi.waitFor(() => expect(a.sent).toEqual([{ type: 'error', code: 'api', message: 'This explanation is no longer in your Study Log.' }]));

    const b = fakePort();
    serveExplainPort(b.port, deps(client));
    b.send({ type: 'start', request: { ...REQUEST, phrase: '' } });
    b.send({ type: 'start', request: REQUEST }); // ignored: one request per port
    await vi.waitFor(() => expect(b.sent).toEqual([{ type: 'error', code: 'api', message: 'LingoFlix sent a request it could not read.' }]));
  });
});
