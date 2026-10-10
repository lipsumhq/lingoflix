import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_API_BASE_URL } from '@/lib/config';
import type { ChatMessage } from './prompt';

export interface StreamParams {
  model: string;
  maxTokens: number;
  system: string;
  messages: ChatMessage[];
}

/** The slice of the Anthropic SDK LingoFlix uses. Tests substitute a fake. */
export interface ClaudeClient {
  /** Streams text deltas to `onText` and resolves with the full text; rejects with the SDK's errors. */
  streamText(params: StreamParams, onText: (delta: string) => void, signal: AbortSignal): Promise<string>;
  /** The cheapest authenticated call, `GET /v1/models` (spec §5.8 Test key). */
  checkKey(): Promise<void>;
}

const KEY_CHECK_TIMEOUT_MS = 15_000;

export function createSdkClient(apiKey: string): ClaudeClient {
  // Runs in the extension's service worker; the key only ever goes to api.anthropic.com.
  const client = new Anthropic({ apiKey, baseURL: CLAUDE_API_BASE_URL, dangerouslyAllowBrowser: true });
  return {
    async streamText(params, onText, signal) {
      const stream = client.messages.stream(
        { model: params.model, max_tokens: params.maxTokens, system: params.system, messages: params.messages },
        // No SDK retries: a retried 429/529 (which may wait out a long retry-after) would outlast the 30 s idle
        // timer and show "Couldn't reach Claude" instead of "Claude is busy right now" (spec §7.4).
        { signal, maxRetries: 0 },
      );
      stream.on('text', (delta) => onText(delta));
      const message = await stream.finalMessage();
      return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    },
    async checkKey() {
      await client.models.list({ limit: 1 }, { timeout: KEY_CHECK_TIMEOUT_MS, maxRetries: 0 });
    },
  };
}
