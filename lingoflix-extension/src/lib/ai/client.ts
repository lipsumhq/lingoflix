import { createAnthropicClient } from './anthropic';

/** One part of the system prompt; `cache` puts a prompt-cache breakpoint after it (v2 spec §5.1). */
export interface SystemBlock {
  text: string;
  cache: boolean;
}

/** A tool the model may call. `input_schema` is a JSON Schema object; each adapter sends it in its API's shape. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamParams {
  /** Each adapter picks its model and output limit; `kind` says which limit (free-own-key spec §4.1). */
  kind: 'explain' | 'follow-up';
  system: string | SystemBlock[];
  messages: ChatMessage[];
  /** Offered with tool_choice auto, so the model still writes its explanation first. */
  tools?: ToolDefinition[];
}

export interface ToolCall {
  name: string;
  input: unknown;
}

export interface StreamResult {
  /** The answer's text, joined. */
  text: string;
  toolCalls: ToolCall[];
}

/** The provider-neutral client LingoFlix uses (free-own-key spec §4.1). Tests substitute a fake. */
export interface AiClient {
  /**
   * Streams text deltas to `onText`, and calls `onActivity` on every stream event (text or not), so the caller's
   * idle timer only fires on a silent stream (spec §4.3). Resolves with the text and tool calls; rejects with
   * the SDK's errors.
   */
  stream(params: StreamParams, onText: (delta: string) => void, signal: AbortSignal, onActivity: () => void): Promise<StreamResult>;
  /** The cheapest authenticated call, the provider's model list (spec §5.8 Test key). */
  checkKey(): Promise<void>;
}

/** The client for an API key. */
export function createClient(apiKey: string): AiClient {
  return createAnthropicClient(apiKey);
}
