import { describe, expect, it, vi } from 'vitest';
import { createAnthropicClient, readToolCalls, toSdkSystem } from '@/lib/ai/anthropic';
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

const TOOL: ToolDefinition = {
  name: 'suggest_saves',
  description: 'Save suggestions.',
  input_schema: { type: 'object', properties: { items: { type: 'array' } }, required: ['items'] },
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

describe('readToolCalls', () => {
  it('reads tool_use blocks and ignores everything else', () => {
    expect(
      readToolCalls([
        { type: 'text', text: 'Explanation' },
        { type: 'tool_use', id: 't1', name: 'suggest_saves', input: { items: [] } },
        { type: 'tool_use', id: 't2', input: {} }, // no name
        null,
        'junk',
      ]),
    ).toEqual([{ name: 'suggest_saves', input: { items: [] } }]);
    expect(readToolCalls([])).toEqual([]);
  });
});

describe('createAnthropicClient', () => {
  it('explanations get room for the tool call (1536 tokens); follow-ups keep 1024', () => {
    expect(CLAUDE_EXPLAIN_MAX_TOKENS).toBe(1536);
    expect(CLAUDE_MAX_TOKENS).toBe(1024);
  });

  it('streams text and returns it with the tool calls; system blocks, tools and tool_choice go to the SDK', async () => {
    sdk.stream.mockReturnValue(
      fakeStream(['Hel', 'lo'], [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 't1', name: 'suggest_saves', input: { items: [{ type: 'word', text: 'Hello', meaning: 'hi' }] } },
      ]),
    );
    const deltas: string[] = [];
    const signal = new AbortController().signal;
    const result = await createAnthropicClient('sk-ant-test').stream(
      {
        kind: 'explain',
        system: [
          { text: 'Rules', cache: false },
          { text: 'Story so far', cache: true },
        ],
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [TOOL],
      },
      (delta) => deltas.push(delta),
      signal,
      () => {},
    );
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result).toEqual({ text: 'Hello', toolCalls: [{ name: 'suggest_saves', input: { items: [{ type: 'word', text: 'Hello', meaning: 'hi' }] } }] });
    expect(sdk.constructed.at(-1)).toMatchObject({ apiKey: 'sk-ant-test', baseURL: CLAUDE_API_BASE_URL });
    const [body, options] = sdk.stream.mock.calls.at(-1)!;
    expect(body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 1536,
      system: [
        { type: 'text', text: 'Rules' },
        { type: 'text', text: 'Story so far', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [TOOL],
      tool_choice: { type: 'auto' },
    });
    expect(options).toEqual({ signal, maxRetries: 0 });
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

  it('drops tool calls cut off by max_tokens (v2 spec §5.4: no suggestions then)', async () => {
    sdk.stream.mockReturnValue(
      fakeStream(
        ['Long'],
        [
          { type: 'text', text: 'Long' },
          { type: 'tool_use', id: 't1', name: 'suggest_saves', input: { items: [{ type: 'word', text: 'Lo', meaning: 'cut' }] } },
        ],
        'max_tokens',
      ),
    );
    const result = await createAnthropicClient('sk-ant-test').stream(
      { kind: 'explain', system: 'Rules', messages: [{ role: 'user', content: 'Q' }], tools: [TOOL] },
      () => {},
      new AbortController().signal,
      () => {},
    );
    expect(result).toEqual({ text: 'Long', toolCalls: [] });
  });

  it('a follow-up gets 1024 tokens and, without tools, neither tools nor tool_choice; a plain system string passes through', async () => {
    sdk.stream.mockReturnValue(fakeStream(['A'], [{ type: 'text', text: 'A' }]));
    const result = await createAnthropicClient('sk-ant-test').stream(
      { kind: 'follow-up', system: 'Rules', messages: [{ role: 'user', content: 'Q' }] },
      () => {},
      new AbortController().signal,
      () => {},
    );
    expect(result).toEqual({ text: 'A', toolCalls: [] });
    const [body] = sdk.stream.mock.calls.at(-1)!;
    expect(body).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 1024, system: 'Rules', messages: [{ role: 'user', content: 'Q' }] });
    expect('tools' in body).toBe(false);
    expect('tool_choice' in body).toBe(false);
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
