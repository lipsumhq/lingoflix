import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_API_BASE_URL, CLAUDE_EXPLAIN_MAX_TOKENS, CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from '@/lib/config';
import type { AiClient, SystemBlock, ToolCall } from './client';

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The tool_use blocks of a final message's content, in order. */
export function readToolCalls(content: readonly unknown[]): ToolCall[] {
  return content
    .filter((block): block is Record<string, unknown> & { name: string } => isRecord(block) && block.type === 'tool_use' && typeof block.name === 'string')
    .map((block) => ({ name: block.name, input: block.input }));
}

const KEY_CHECK_TIMEOUT_MS = 15_000;

/** The Claude adapter (free-own-key spec §4.2): Anthropic's SDK, as before the move. */
export function createAnthropicClient(apiKey: string): AiClient {
  // Runs in the extension's service worker; the key only ever goes to api.anthropic.com.
  const client = new Anthropic({ apiKey, baseURL: CLAUDE_API_BASE_URL, dangerouslyAllowBrowser: true });
  return {
    async stream(params, onText, signal) {
      const tools = params.tools ?? [];
      const body: Parameters<typeof client.messages.stream>[0] = {
        model: CLAUDE_MODEL,
        max_tokens: params.kind === 'explain' ? CLAUDE_EXPLAIN_MAX_TOKENS : CLAUDE_MAX_TOKENS,
        system: toSdkSystem(params.system),
        messages: params.messages,
        ...(tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: { ...tool.input_schema, type: 'object' as const },
              })),
              tool_choice: { type: 'auto' as const },
            }
          : {}),
      };
      // No SDK retries: a retried 429/529 (which may wait out a long retry-after) would outlast the 30 s idle
      // timer and show "Couldn't reach Claude" instead of "Claude is busy right now" (spec §7.4).
      const stream = client.messages.stream(body, { signal, maxRetries: 0 });
      stream.on('text', (delta) => onText(delta));
      const message = await stream.finalMessage();
      return {
        text: message.content.map((block) => (block.type === 'text' ? block.text : '')).join(''),
        // A tool call cut off by max_tokens is only partly parsed: drop it (v2 spec §5.4).
        toolCalls: message.stop_reason === 'max_tokens' ? [] : readToolCalls(message.content),
      };
    },
    async checkKey() {
      await client.models.list({ limit: 1 }, { timeout: KEY_CHECK_TIMEOUT_MS, maxRetries: 0 });
    },
  };
}
