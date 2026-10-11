import { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type StreamParams } from '@/lib/ai/client';
import { toExplainError } from '@/lib/ai/errors';
import { createOpenAIClient } from '@/lib/ai/openai';
import { SUGGEST_SAVES_TOOL } from '@/lib/ai/suggestions';

afterEach(() => vi.unstubAllGlobals());

const KEY = 'sk-proj-test-key-0000';

interface SentRequest {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

/** A fake OpenAI API behind the SDK's `fetch` option: records each request and answers with `reply`. */
function fakeOpenAI(reply: (request: SentRequest, signal: AbortSignal | undefined) => Response) {
  const requests: SentRequest[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const request: SentRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return reply(request, init.signal ?? undefined);
  };
  return { fetch, requests };
}

/** Server-sent events as the Responses API streams them: `event:` is the event's type. */
const sse = (events: readonly { type: string }[]) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
const streamOf = (events: readonly { type: string }[]) =>
  new Response(sse(events), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const errorOf = (status: number, error: object) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

const message = (text: string) => ({
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});
const functionCall = (name: string, args: string) => ({ type: 'function_call', id: 'fc_1', call_id: 'call_1', name, arguments: args, status: 'completed' });
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [] };

/** One answer's events: created, a text delta per `deltas`, then the terminal event for `status` with the final response. */
function answer(deltas: string[], output: object[], status: 'completed' | 'incomplete' | 'failed' = 'completed', extra: object = {}) {
  const response = (state: string, items: object[], more: object = {}) => ({
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    model: 'gpt-6.1-sol',
    status: state,
    output: items,
    incomplete_details: null,
    error: null,
    ...more,
  });
  return [
    { type: 'response.created', sequence_number: 0, response: response('in_progress', []) },
    ...deltas.map((delta, i) => ({
      type: 'response.output_text.delta',
      sequence_number: i + 1,
      item_id: 'msg_1',
      output_index: 1,
      content_index: 0,
      delta,
      logprobs: [],
    })),
    { type: `response.${status}`, sequence_number: deltas.length + 1, response: response(status, output, extra) },
  ];
}

const EXPLAIN: StreamParams = {
  kind: 'explain',
  system: [
    { text: 'Rules', cache: false },
    { text: 'Story so far', cache: true },
    { text: 'History', cache: true },
  ],
  messages: [{ role: 'user', content: 'Explain >>> Hi' }],
  tools: [SUGGEST_SAVES_TOOL],
};

async function run(fetch: ReturnType<typeof fakeOpenAI>['fetch'], params: StreamParams = EXPLAIN, signal = new AbortController().signal) {
  const deltas: string[] = [];
  const activity = vi.fn();
  const result = await createOpenAIClient(KEY, { fetch }).stream(params, (delta) => deltas.push(delta), signal, activity);
  return { result, deltas, activity };
}

/** What a failed request becomes on the card. */
async function failureOf(fetch: ReturnType<typeof fakeOpenAI>['fetch'], params: StreamParams = EXPLAIN) {
  const error = await createOpenAIClient(KEY, { fetch })
    .stream(params, () => {}, new AbortController().signal, () => {})
    .then(
      () => null,
      (err: unknown) => err,
    );
  expect(error).not.toBeNull();
  return toExplainError(error, 'openai');
}

describe('OpenAI adapter: the request (free-own-key spec §4.3, §4.5)', () => {
  it('an explanation: GPT-6.1 Sol, not stored, low effort and verbosity, 8,000 tokens, cached developer blocks, the strict tool', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['ok'], [message('ok')])));
    await run(api.fetch);
    expect(api.requests).toHaveLength(1);
    const [request] = api.requests;
    expect(request!.url).toBe('https://api.openai.com/v1/responses');
    expect(request!.method).toBe('POST');
    expect(request!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(request!.body).toEqual({
      model: 'gpt-6.1-sol',
      store: false,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 8000,
      input: [
        {
          role: 'developer',
          content: [
            { type: 'input_text', text: 'Rules' },
            { type: 'input_text', text: 'Story so far', prompt_cache_breakpoint: { mode: 'explicit' } },
            { type: 'input_text', text: 'History', prompt_cache_breakpoint: { mode: 'explicit' } },
          ],
        },
        { role: 'user', content: 'Explain >>> Hi' },
      ],
      tools: [
        {
          type: 'function',
          name: 'suggest_saves',
          description: SUGGEST_SAVES_TOOL.description,
          parameters: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                maxItems: 6,
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['word', 'phrase', 'idiom', 'line'] },
                    text: { type: 'string' },
                    meaning: { type: 'string' },
                  },
                  required: ['type', 'text', 'meaning'],
                  additionalProperties: false,
                },
              },
            },
            required: ['items'],
            additionalProperties: false,
          },
          strict: true,
        },
      ],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      stream: true,
    });
  });

  it('a follow-up replays the earlier turns as text, with the same limit and no tools', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['No.'], [message('No.')])));
    await run(api.fetch, {
      kind: 'follow-up',
      system: [{ text: 'Follow-up rules', cache: false }],
      messages: [
        { role: 'user', content: 'Explain >>> Hi' },
        { role: 'assistant', content: 'Explanation' },
        { role: 'user', content: 'Is it rude?' },
      ],
    });
    expect(api.requests[0]!.body).toEqual({
      model: 'gpt-6.1-sol',
      store: false,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 8000,
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: 'Follow-up rules' }] },
        { role: 'user', content: 'Explain >>> Hi' },
        // OpenAI asks for `phase` on replayed assistant turns: newer models answer worse without it.
        { role: 'assistant', content: 'Explanation', phase: 'final_answer' },
        { role: 'user', content: 'Is it rude?' },
      ],
      stream: true,
    });
  });

  it('leaves out empty system blocks, and sends a plain system string as one block', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['ok'], [message('ok')])));
    await run(api.fetch, { kind: 'follow-up', system: [{ text: 'Rules', cache: false }, { text: '  ', cache: true }], messages: [] });
    await run(api.fetch, { kind: 'follow-up', system: 'Plain rules', messages: [] });
    expect(api.requests.map((r) => (r.body as { input: unknown[] }).input)).toEqual([
      [{ role: 'developer', content: [{ type: 'input_text', text: 'Rules' }] }],
      [{ role: 'developer', content: [{ type: 'input_text', text: 'Plain rules' }] }],
    ]);
  });
});

describe('OpenAI adapter: the answer', () => {
  it('streams text deltas and reports every stream event as activity', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['Hel', 'lo'], [reasoning, message('Hello')])));
    const { result, deltas, activity } = await run(api.fetch, { ...EXPLAIN, tools: [] });
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result).toEqual({ text: 'Hello', toolCalls: [] });
    expect(activity).toHaveBeenCalledTimes(4); // created, two deltas, completed
  });

  it('a suggest_saves function call becomes the tool call, its JSON arguments parsed', async () => {
    const items = { items: [{ type: 'word', text: 'Hi', meaning: 'hello' }] };
    const api = fakeOpenAI(() => streamOf(answer(['Hi.'], [reasoning, message('Hi.'), functionCall('suggest_saves', JSON.stringify(items))])));
    expect((await run(api.fetch)).result).toEqual({ text: 'Hi.', toolCalls: [{ name: 'suggest_saves', input: items }] });
  });

  it('unparseable arguments give a tool call with no input (so no suggestions), and keep the answer', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['Hi.'], [message('Hi.'), functionCall('suggest_saves', '{"items": [')])));
    expect((await run(api.fetch)).result).toEqual({ text: 'Hi.', toolCalls: [{ name: 'suggest_saves', input: null }] });
  });

  it('cut off by max_output_tokens: keeps the text and drops the tool call', async () => {
    const api = fakeOpenAI(() =>
      streamOf(
        answer(['Long'], [message('Long'), functionCall('suggest_saves', '{"items": []}')], 'incomplete', {
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      ),
    );
    expect((await run(api.fetch)).result).toEqual({ text: 'Long', toolCalls: [] });
  });

  it('cut off by max_output_tokens with no text (all reasoning): the answer was cut off', async () => {
    const api = fakeOpenAI(() => streamOf(answer([], [reasoning], 'incomplete', { incomplete_details: { reason: 'max_output_tokens' } })));
    expect(await failureOf(api.fetch)).toEqual({ code: 'api', message: 'The answer was cut off. Try again.' });
  });

  it('stopped by the content filter: OpenAI declined to answer this line', async () => {
    const filtered = fakeOpenAI(() =>
      streamOf(answer(['Partial'], [message('Partial')], 'incomplete', { incomplete_details: { reason: 'content_filter' } })),
    );
    expect(await failureOf(filtered.fetch)).toEqual({ code: 'api', message: 'OpenAI declined to answer this line.' });
  });

  it("incomplete for any other reason, or with none: OpenAI didn't finish the answer", async () => {
    for (const details of [{ reason: 'max_messages' }, { reason: 'steered' }, null]) {
      const api = fakeOpenAI(() => streamOf(answer(['Partial'], [message('Partial')], 'incomplete', { incomplete_details: details })));
      expect(await failureOf(api.fetch)).toEqual({ code: 'api', message: "OpenAI didn't finish the answer." });
    }
  });

  it("failed: OpenAI's message, else OpenAI didn't finish the answer", async () => {
    const failed = fakeOpenAI(() =>
      streamOf(answer([], [], 'failed', { error: { code: 'server_error', message: 'The model failed to answer.' } })),
    );
    expect(await failureOf(failed.fetch)).toEqual({ code: 'api', message: 'The model failed to answer.' });
    const silent = fakeOpenAI(() => streamOf(answer([], [], 'failed')));
    expect(await failureOf(silent.fetch)).toEqual({ code: 'api', message: "OpenAI didn't finish the answer." });
  });

  it('a stream that ends without a final event is a dropped connection', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['Hel'], []).slice(0, -1)));
    expect(await failureOf(api.fetch)).toEqual({ code: 'network', message: "Couldn't reach OpenAI" });
  });

  it('a connection that breaks mid-answer is a dropped connection too, with Retry', async () => {
    const api = fakeOpenAI(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse(answer(['Hel'], []).slice(0, 2))));
          // What Chrome's fetch throws when the network drops while the body is being read.
          controller.error(new TypeError('network error'));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    expect(await failureOf(api.fetch)).toEqual({ code: 'network', message: "Couldn't reach OpenAI" });
  });
});

describe('OpenAI adapter: errors (free-own-key spec §4.6)', () => {
  const rejectsWith = (status: number, error: object) => fakeOpenAI(() => errorOf(status, error)).fetch;

  it('401 is a rejected key', async () => {
    expect(await failureOf(rejectsWith(401, { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key.' }))).toEqual({
      code: 'bad-key',
      message: 'Your OpenAI key was rejected',
    });
  });

  it('429 insufficient_quota, and each spend or credit limit code, is out of credit', async () => {
    const outOfCredit = { code: 'no-credit', message: 'Your OpenAI account is out of credit' };
    expect(await failureOf(rejectsWith(429, { type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota.' }))).toEqual(
      outOfCredit,
    );
    for (const code of [
      'credit_balance_exhausted',
      'organization_spend_limit_exceeded',
      'project_spend_limit_exceeded',
      'organization_usage_limit_exceeded',
    ]) {
      expect(await failureOf(rejectsWith(429, { type: 'requests', code, message: 'Limit reached.' }))).toEqual(outOfCredit);
    }
  });

  it('any other 429, and 500 or 503, is busy', async () => {
    const busy = { code: 'busy', message: 'OpenAI is busy right now' };
    expect(await failureOf(rejectsWith(429, { type: 'requests', code: 'rate_limit_exceeded', message: 'Slow down.' }))).toEqual(busy);
    expect(await failureOf(rejectsWith(500, { type: 'server_error', code: null, message: 'Oops.' }))).toEqual(busy);
    expect(await failureOf(rejectsWith(503, { type: 'server_error', code: 'server_is_overloaded', message: 'Overloaded.' }))).toEqual(busy);
  });

  it("can't connect, or timed out, is a network error", async () => {
    const offline = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await failureOf(offline)).toEqual({ code: 'network', message: "Couldn't reach OpenAI" });
    expect(toExplainError(new APIConnectionTimeoutError(), 'openai')).toEqual({ code: 'network', message: "Couldn't reach OpenAI" });
  });

  it("anything else shows OpenAI's own message, including an error event during the stream", async () => {
    expect(await failureOf(rejectsWith(400, { type: 'invalid_request_error', code: 'model_not_found', message: 'The model does not exist.' }))).toEqual({
      code: 'api',
      message: 'The model does not exist.',
    });
    const midStream = fakeOpenAI(() =>
      streamOf([
        ...answer(['Hel'], []).slice(0, -1),
        { type: 'error', code: 'rate_limit_exceeded', message: 'Too many tokens in flight.', param: null, sequence_number: 2 } as { type: string },
      ]),
    );
    expect(await failureOf(midStream.fetch)).toEqual({ code: 'api', message: 'Too many tokens in flight.' });
  });
});

describe('OpenAI adapter: abort', () => {
  it('aborting mid-stream rejects, so nothing is saved', async () => {
    const abort = new AbortController();
    const api = fakeOpenAI((_request, signal) => {
      const [created, delta] = answer(['Hel'], []);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse([created!, delta!])));
          signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const deltas: string[] = [];
    const pending = createOpenAIClient(KEY, { fetch: api.fetch }).stream(EXPLAIN, (d) => deltas.push(d), abort.signal, () => {});
    await vi.waitFor(() => expect(deltas).toEqual(['Hel']));
    abort.abort();
    await expect(pending).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it('aborting before the answer starts rejects too', async () => {
    const abort = new AbortController();
    abort.abort();
    const api = fakeOpenAI(() => streamOf(answer(['ok'], [message('ok')])));
    await expect(createOpenAIClient(KEY, { fetch: api.fetch }).stream(EXPLAIN, () => {}, abort.signal, () => {})).rejects.toBeInstanceOf(
      APIUserAbortError,
    );
  });
});

describe('OpenAI adapter: Test key', () => {
  it('lists the models with the key', async () => {
    const api = fakeOpenAI(() => Response.json({ object: 'list', data: [] }));
    await createOpenAIClient(KEY, { fetch: api.fetch }).checkKey();
    expect(api.requests.map((r) => [r.method, r.url, r.headers.get('authorization')])).toEqual([
      ['GET', 'https://api.openai.com/v1/models', `Bearer ${KEY}`],
    ]);
  });

  it('a 403 (a key not allowed to list models) counts as working; a 401 does not', async () => {
    const restricted = fakeOpenAI(() => errorOf(403, { type: 'invalid_request_error', code: 'missing_scope', message: 'Missing scopes: api.model.read' }));
    await expect(createOpenAIClient(KEY, { fetch: restricted.fetch }).checkKey()).resolves.toBeUndefined();
    const rejected = fakeOpenAI(() => errorOf(401, { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key.' }));
    const error = await createOpenAIClient(KEY, { fetch: rejected.fetch }).checkKey().catch((err: unknown) => err);
    expect(toExplainError(error, 'openai').code).toBe('bad-key');
  });
});

describe('createClient', () => {
  it('hands an OpenAI key to the OpenAI adapter, and refuses a key that is neither', async () => {
    const api = fakeOpenAI(() => Response.json({ object: 'list', data: [] }));
    vi.stubGlobal('fetch', api.fetch);
    await createClient('sk-svcacct-key').checkKey();
    expect(api.requests.map((r) => r.url)).toEqual(['https://api.openai.com/v1/models']);
    expect(() => createClient('AIzaSy-key')).toThrow("This doesn't look like a Claude or OpenAI key.");
  });
});
