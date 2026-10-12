import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_API_BASE_URL, CLAUDE_EFFORT, CLAUDE_EXPLAIN_MAX_TOKENS, CLAUDE_MAX_TOKENS } from '@/lib/config';
import type { AiClient, StreamResult, SystemBlock, ToolCall, ToolDefinition } from './client';
import { createFirstStringFieldReader, type FirstStringFieldReader } from './json-field-stream';
import { PROVIDERS } from './provider';
import { closedSchema } from './schema';

type SdkSystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

/** The system prompt in the SDK's shape: `cache` becomes a cache_control breakpoint; empty blocks are left out. */
export function toSdkSystem(system: string | readonly SystemBlock[]): string | SdkSystemBlock[] {
  if (typeof system === 'string') return system;
  return system
    .filter((block) => block.text.trim())
    .map((block): SdkSystemBlock =>
      block.cache ? { type: 'text', text: block.text, cache_control: { type: 'ephemeral' } } : { type: 'text', text: block.text },
    );
}

/** The JSON reply's field for the answer itself; the schema puts it first, so it streams first. */
const EXPLANATION_FIELD = 'explanation';

/** Appended to the system prompt of a request with tools: how the prompt's tool instructions map onto the reply. */
export const JSON_REPLY_INSTRUCTION = (toolNames: readonly string[]): string =>
  `Reply with one JSON object in the given format. Put your whole answer for the learner, in Markdown, in "${EXPLANATION_FIELD}". ` +
  `Instead of calling ${toolNames.join(' or ')}, put what you would pass to it in the field of the same name.`;

/**
 * The reply's schema: the explanation, then one field per tool holding that tool's input. Structured outputs need
 * every object closed and take no array size limits (the suggestions are capped when they're validated).
 */
function replySchema(tools: readonly ToolDefinition[]): Record<string, unknown> {
  return closedSchema(
    {
      type: 'object',
      properties: {
        [EXPLANATION_FIELD]: { type: 'string', description: 'Your whole answer for the learner, in Markdown.' },
        ...Object.fromEntries(tools.map((tool) => [tool.name, { ...tool.input_schema, type: 'object', description: tool.description }])),
      },
      required: [EXPLANATION_FIELD, ...tools.map((tool) => tool.name)],
    },
    ['maxItems'],
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The finished JSON reply as the text and tool calls the service expects. Cut off (by max_tokens, so not valid
 * JSON): the explanation streamed so far, and no suggestions (v2 spec §5.4). An explanation that wasn't the first
 * field never streamed, so it goes to the card now.
 */
function readReply(json: string, tools: readonly ToolDefinition[], reader: FirstStringFieldReader, onText: (delta: string) => void): StreamResult {
  let reply: unknown;
  try {
    reply = JSON.parse(json);
  } catch {
    return { text: reader.text, toolCalls: [] };
  }
  if (!isRecord(reply) || typeof reply[EXPLANATION_FIELD] !== 'string') return { text: reader.text, toolCalls: [] };
  const text = reply[EXPLANATION_FIELD];
  if (!reader.started && text) onText(text);
  const toolCalls: ToolCall[] = tools.filter((tool) => tool.name in reply).map((tool) => ({ name: tool.name, input: reply[tool.name] }));
  return { text, toolCalls };
}

const KEY_CHECK_TIMEOUT_MS = 15_000;

/**
 * The Claude adapter (free-own-key spec §4.2). An explanation with tools is asked for as one structured JSON reply,
 * not text followed by a tool call: Claude Sonnet 5.5 can return text written before a tool call as an empty
 * thinking block (the card then had nothing to show), and tool_choice auto doesn't guarantee the call.
 */
export function createAnthropicClient(apiKey: string): AiClient {
  // Runs in the extension's service worker; the key only ever goes to api.anthropic.com.
  const client = new Anthropic({ apiKey, baseURL: CLAUDE_API_BASE_URL, dangerouslyAllowBrowser: true });
  return {
    async stream(params, onText, signal, onActivity) {
      const tools = params.tools ?? [];
      const structured = tools.length > 0;
      const system = toSdkSystem(params.system);
      const body: Parameters<typeof client.messages.stream>[0] = {
        model: PROVIDERS.claude.model,
        max_tokens: params.kind === 'explain' ? CLAUDE_EXPLAIN_MAX_TOKENS : CLAUDE_MAX_TOKENS,
        system: structured
          ? [
              ...(typeof system === 'string' ? [{ type: 'text' as const, text: system }] : system),
              { type: 'text', text: JSON_REPLY_INSTRUCTION(tools.map((tool) => tool.name)) },
            ]
          : system,
        messages: params.messages,
        output_config: structured
          ? { effort: CLAUDE_EFFORT, format: { type: 'json_schema', schema: replySchema(tools) } }
          : { effort: CLAUDE_EFFORT },
      };
      // No SDK retries: a retried 429/529 (which may wait out a long retry-after) would outlast the 30 s idle
      // timer and show "Couldn't reach Claude" instead of "Claude is busy right now" (spec §7.4).
      const stream = client.messages.stream(body, { signal, maxRetries: 0 });
      const reader = structured ? createFirstStringFieldReader(EXPLANATION_FIELD, onText) : null;
      stream.on('streamEvent', () => onActivity());
      stream.on('text', (delta) => (reader ? reader.push(delta) : onText(delta)));
      const message = await stream.finalMessage();
      const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
      return reader ? readReply(text, tools, reader, onText) : { text, toolCalls: [] };
    },
    async checkKey() {
      await client.models.list({ limit: 1 }, { timeout: KEY_CHECK_TIMEOUT_MS, maxRetries: 0 });
    },
  };
}
