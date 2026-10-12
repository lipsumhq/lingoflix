import { describe, expect, it, vi } from 'vitest';
import { JSON_REPLY_INSTRUCTION, createAnthropicClient, toSdkSystem } from '@/lib/ai/anthropic';
import { createClient, type ToolDefinition } from '@/lib/ai/client';
import { CLAUDE_API_BASE_URL, CLAUDE_EXPLAIN_MAX_TOKENS, CLAUDE_MAX_TOKENS } from '@/lib/config';

const sdk = vi.hoisted(() => ({ stream: vi.fn(), constructed: [] as unknown[] }));

// Only the SDK's client class is replaced; its error classes stay real.
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    messages = { stream: sdk.stream };
    models = { list: async () => ({}) };
    constructor(options: unknown) {
      sdk.constructed.push(options);
    }
  }
  return { ...actual, default: FakeAnthropic };
});

/**
 * Stands in for the SDK's MessageStream: replays a stream event per text delta (each followed by its `text`
 * event) between message_start and message_stop, then resolves with the final content.
 */
function fakeStream(deltas: string[], content: unknown[], stopReason = 'end_turn') {
  const handlers = new Map<string, Array<(arg: unknown) => void>>();
  const emit = (event: string, arg: unknown) => handlers.get(event)?.forEach((handler) => handler(arg));
  return {
    on(event: string, handler: (arg: never) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler as (arg: unknown) => void]);
      return this;
    },
    async finalMessage() {
      emit('streamEvent', { type: 'message_start' });
      for (const delta of deltas) {
        emit('streamEvent', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } });
        emit('text', delta);
      }
      emit('streamEvent', { type: 'message_stop' });
      return { content, stop_reason: stopReason };
    },
  };
}

/** maxItems is left out of the JSON reply's schema: structured outputs don't take array size limits. */
const TOOL: ToolDefinition = {
  name: 'suggest_saves',
  description: 'Save suggestions.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: { type: { type: 'string', enum: ['word', 'line'] }, text: { type: 'string' }, meaning: { type: 'string' } },
          required: ['type', 'text', 'meaning'],
        },
      },
    },
    required: ['items'],
  },
};

describe('toSdkSystem', () => {
  it('passes a string through, maps cache to a cache_control breakpoint, and leaves out empty blocks', () => {
    expect(toSdkSystem('Rules')).toBe('Rules');
    expect(
      toSdkSystem([
        { text: 'Rules', cache: false },
        { text: 'Story so far', cache: true },
        { text: '   ', cache: true },
        { text: 'History', cache: true },
      ]),
    ).toEqual([
      { type: 'text', text: 'Rules' },
      { type: 'text', text: 'Story so far', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'History', cache_control: { type: 'ephemeral' } },
    ]);
  });
});

describe('createAnthropicClient', () => {
  it('explanations get room for the JSON reply and any thinking (4096 tokens); follow-ups get 2048', () => {
    expect(CLAUDE_EXPLAIN_MAX_TOKENS).toBe(4096);
    expect(CLAUDE_MAX_TOKENS).toBe(2048);
  });

  it('asks for an explanation with tools as one JSON reply: no tools or tool_choice, a closed schema, low effort', async () => {
    const reply = '{"explanation":"Hello","suggest_saves":{"items":[{"type":"word","text":"Hello","meaning":"hi"}]}}';
    sdk.stream.mockReturnValue(fakeStream([reply], [{ type: 'text', text: reply }]));
    const signal = new AbortController().signal;
    await createAnthropicClient('sk-ant-test').stream(
      {
        kind: 'explain',
        system: [
          { text: 'Rules', cache: false },
          { text: 'Story so far', cache: true },
        ],
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [TOOL],
      },
      () => {},
      signal,
      () => {},
    );
    expect(sdk.constructed.at(-1)).toMatchObject({ apiKey: 'sk-ant-test', baseURL: CLAUDE_API_BASE_URL });
    const [body, options] = sdk.stream.mock.calls.at(-1)!;
    expect(body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 4096,
      system: [
        { type: 'text', text: 'Rules' },
        { type: 'text', text: 'Story so far', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: JSON_REPLY_INSTRUCTION(['suggest_saves']) },
      ],
      messages: [{ role: 'user', content: 'Hi' }],
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              explanation: { type: 'string', description: 'Your whole answer for the learner, in Markdown.' },
              suggest_saves: {
                type: 'object',
                description: 'Save suggestions.',
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { type: { type: 'string', enum: ['word', 'line'] }, text: { type: 'string' }, meaning: { type: 'string' } },
                      required: ['type', 'text', 'meaning'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['items'],
                additionalProperties: false,
              },
            },
            required: ['explanation', 'suggest_saves'],
            additionalProperties: false,
          },
        },
      },
    });
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    expect(options).toEqual({ signal, maxRetries: 0 });
  });

  it("streams the reply's explanation as it arrives and returns the tool's part as its call", async () => {
    const reply = '{"explanation":"## Meaning\\n\\"Hola\\" means hello.","suggest_saves":{"items":[{"type":"word","text":"Hola","meaning":"hello"}]}}';
    const pieces = reply.match(/.{1,5}/gs)!;
    sdk.stream.mockReturnValue(fakeStream(pieces, [{ type: 'thinking', thinking: '' }, { type: 'text', text: reply }]));
    const deltas: string[] = [];
    const result = await createAnthropicClient('sk-ant-test').stream(
      { kind: 'explain', system: 'Rules', messages: [{ role: 'user', content: 'Q' }], tools: [TOOL] },
      (delta) => deltas.push(delta),
      new AbortController().signal,
      () => {},
    );
    expect(deltas.join('')).toBe('## Meaning\n"Hola" means hello.');
    expect(deltas.length).toBeGreaterThan(1);
    expect(result).toEqual({
      text: '## Meaning\n"Hola" means hello.',
      toolCalls: [{ name: 'suggest_saves', input: { items: [{ type: 'word', text: 'Hola', meaning: 'hello' }] } }],
    });
    const [body] = sdk.stream.mock.calls.at(-1)!;
    expect(body.system).toEqual([{ type: 'text', text: 'Rules' }, { type: 'text', text: JSON_REPLY_INSTRUCTION(['suggest_saves']) }]);
  });

  it('keeps the explanation so far and no suggestions when the reply is cut off by max_tokens (v2 spec §5.4)', async () => {
    const cut = '{"explanation":"Long expla';
    sdk.stream.mockReturnValue(fakeStream([cut], [{ type: 'text', text: cut }], 'max_tokens'));
    const deltas: string[] = [];
    const result = await createAnthropicClient('sk-ant-test').stream(
      { kind: 'explain', system: 'Rules', messages: [{ role: 'user', content: 'Q' }], tools: [TOOL] },
      (delta) => deltas.push(delta),
      new AbortController().signal,
      () => {},
    );
    expect(deltas.join('')).toBe('Long expla');
    expect(result).toEqual({ text: 'Long expla', toolCalls: [] });
  });

  it('shows the explanation at the end when it is not the first field, and leaves out a missing tool part', async () => {
    const reply = '{"suggest_saves":{"items":[]},"explanation":"Hi"}';
    sdk.stream.mockReturnValue(fakeStream([reply], [{ type: 'text', text: reply }]));
    const deltas: string[] = [];
    const result = await createAnthropicClient('sk-ant-test').stream(
      { kind: 'explain', system: 'Rules', messages: [{ role: 'user', content: 'Q' }], tools: [TOOL] },
      (delta) => deltas.push(delta),
      new AbortController().signal,
      () => {},
    );
    expect(deltas).toEqual(['Hi']);
    expect(result).toEqual({ text: 'Hi', toolCalls: [{ name: 'suggest_saves', input: { items: [] } }] });

    sdk.stream.mockReturnValue(fakeStream(['{"explanation":"Hi"}'], [{ type: 'text', text: '{"explanation":"Hi"}' }]));
    const noTool = await createAnthropicClient('sk-ant-test').stream(
      { kind: 'explain', system: 'Rules', messages: [{ role: 'user', content: 'Q' }], tools: [TOOL] },
      () => {},
      new AbortController().signal,
      () => {},
    );
    expect(noTool).toEqual({ text: 'Hi', toolCalls: [] });
  });

  it('reports every stream event as activity, not only text (free-own-key spec §4.3)', async () => {
    sdk.stream.mockReturnValue(fakeStream(['Hel', 'lo'], [{ type: 'text', text: 'Hello' }]));
    const activity = vi.fn();
    await createAnthropicClient('sk-ant-test').stream(
      { kind: 'follow-up', system: 'Rules', messages: [{ role: 'user', content: 'Q' }] },
      () => {},
      new AbortController().signal,
      activity,
    );
    expect(activity).toHaveBeenCalledTimes(4); // message_start, two deltas, message_stop
  });

  it('a follow-up is plain streamed text at low effort with 2048 tokens; a plain system string passes through', async () => {
    sdk.stream.mockReturnValue(fakeStream(['A', 'B'], [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'AB' }]));
    const deltas: string[] = [];
    const result = await createAnthropicClient('sk-ant-test').stream(
      { kind: 'follow-up', system: 'Rules', messages: [{ role: 'user', content: 'Q' }] },
      (delta) => deltas.push(delta),
      new AbortController().signal,
      () => {},
    );
    expect(deltas).toEqual(['A', 'B']);
    expect(result).toEqual({ text: 'AB', toolCalls: [] });
    const [body] = sdk.stream.mock.calls.at(-1)!;
    expect(body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 2048,
      system: 'Rules',
      messages: [{ role: 'user', content: 'Q' }],
      output_config: { effort: 'low' },
    });
  });
});

describe('createClient', () => {
  it('hands a Claude key to the Claude adapter', async () => {
    sdk.stream.mockReturnValue(fakeStream(['A'], [{ type: 'text', text: 'A' }]));
    const result = await createClient('sk-ant-api03-key').stream(
      { kind: 'follow-up', system: 'Rules', messages: [{ role: 'user', content: 'Q' }] },
      () => {},
      new AbortController().signal,
      () => {},
    );
    expect(result).toEqual({ text: 'A', toolCalls: [] });
    expect(sdk.constructed.at(-1)).toMatchObject({ apiKey: 'sk-ant-api03-key', dangerouslyAllowBrowser: true });
  });
});
