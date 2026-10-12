import OpenAI, { APIConnectionError, APIUserAbortError, OpenAIError, PermissionDeniedError } from 'openai';
import type {
  EasyInputMessage,
  FunctionTool,
  Response,
  ResponseCreateParamsStreaming,
  ResponseInputText,
} from 'openai/resources/responses/responses';
import { OPENAI_API_BASE_URL, OPENAI_MAX_OUTPUT_TOKENS } from '@/lib/config';
import type { AiClient, StreamResult, SystemBlock, ToolCall, ToolDefinition } from './client';
import { PROVIDERS } from './provider';
import { closedSchema } from './schema';

const KEY_CHECK_TIMEOUT_MS = 15_000;
/** Free-own-key spec §4.3: the output limit cut the answer off before any text (all of it went to reasoning). */
const CUT_OFF = 'The answer was cut off. Try again.';
/** Stopped by OpenAI's content filter. */
const DECLINED = 'OpenAI declined to answer this line.';
/** Incomplete for any other reason, or failed without a message. Never a raw reason code. */
const UNFINISHED = "OpenAI didn't finish the answer.";

/**
 * The system prompt as one developer message's text items (spec §4.5): `cache` puts an explicit prompt-cache
 * breakpoint on the item (the top-level `instructions` field can't carry one). Empty blocks are left out.
 */
export function toDeveloperContent(system: string | readonly SystemBlock[]): ResponseInputText[] {
  const blocks = typeof system === 'string' ? [{ text: system, cache: false }] : system;
  return blocks
    .filter((block) => block.text.trim())
    .map((block): ResponseInputText =>
      block.cache
        ? { type: 'input_text', text: block.text, prompt_cache_breakpoint: { mode: 'explicit' } }
        : { type: 'input_text', text: block.text },
    );
}

/** Spec §4.3: the tool as a strict function tool, with the same schema as the Claude tool. */
export function toFunctionTool(tool: ToolDefinition): FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: closedSchema({ ...tool.input_schema, type: 'object' }),
    strict: true,
  };
}

function parseArguments(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null; // unparseable arguments mean no suggestions (spec §4.3)
  }
}

/** The text of the answer's messages, joined. */
function textOf(response: Response): string {
  return response.output
    .flatMap((item) => (item.type === 'message' ? item.content : []))
    .map((part) => (part.type === 'output_text' ? part.text : ''))
    .join('');
}

function toolCallsOf(response: Response): ToolCall[] {
  return response.output.flatMap((item) => (item.type === 'function_call' ? [{ name: item.name, input: parseArguments(item.arguments) }] : []));
}

/**
 * Spec §4.3: a completed answer, or one cut off by the output limit that has text. Anything else is an `api` error
 * whose message is the card's headline: never a raw reason code.
 */
function resultOf(response: Response): StreamResult {
  const text = textOf(response);
  if (response.status === 'completed') return { text, toolCalls: toolCallsOf(response) };
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    if (reason === 'max_output_tokens') {
      // As with Claude, the text so far is kept and a tool call cut off with it dropped (v2 spec §5.4).
      if (text.trim()) return { text, toolCalls: [] };
      throw new OpenAIError(CUT_OFF);
    }
    throw new OpenAIError(reason === 'content_filter' ? DECLINED : UNFINISHED);
  }
  // Failed: OpenAI's own message when it gave one.
  throw new OpenAIError(response.error?.message || UNFINISHED);
}

/** The OpenAI adapter (free-own-key spec §4.3): the Responses API, one request per answer. `fetch` is for tests. */
export function createOpenAIClient(apiKey: string, options: { fetch?: typeof fetch } = {}): AiClient {
  // Runs in the extension's service worker; the key only ever goes to api.openai.com. No SDK retries, as for
  // Claude: a retried 429 would outlast the idle timer.
  const client = new OpenAI({ apiKey, baseURL: OPENAI_API_BASE_URL, dangerouslyAllowBrowser: true, maxRetries: 0, fetch: options.fetch });
  return {
    async stream(params, onText, signal, onActivity) {
      const tools = params.tools ?? [];
      const developer = toDeveloperContent(params.system);
      const body: ResponseCreateParamsStreaming = {
        model: PROVIDERS.openai.model,
        // Otherwise OpenAI keeps every response for at least 30 days; follow-ups replay earlier turns as text.
        store: false,
        reasoning: { effort: 'low' },
        text: { verbosity: 'low' },
        // Reasoning counts toward the limit, so both kinds get room for it; the prompt still asks for brevity.
        max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
        input: [
          ...(developer.length > 0 ? [{ role: 'developer' as const, content: developer }] : []),
          // Replayed answers are marked final: OpenAI says newer models answer follow-ups worse without `phase`.
          ...params.messages.map(
            (message): EasyInputMessage =>
              message.role === 'assistant'
                ? { role: 'assistant', content: message.content, phase: 'final_answer' }
                : { role: message.role, content: message.content },
          ),
        ],
        ...(tools.length > 0 ? { tools: tools.map(toFunctionTool), tool_choice: 'auto' as const, parallel_tool_calls: false } : {}),
        stream: true,
      };
      // The raw event stream, not `responses.stream()`: its finalResponse() parses a strict tool's arguments
      // itself and rejects the whole answer when they aren't JSON (spec §4.3 wants no suggestions instead).
      const events = await client.responses.create(body, { signal });
      let response: Response | null = null;
      try {
        for await (const event of events) {
          onActivity();
          if (event.type === 'response.output_text.delta') onText(event.delta);
          else if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
            response = event.response;
          }
        }
      } catch (err) {
        // OpenAI's own errors (an `error` event) keep their meaning; anything else while reading the body, such as
        // Chrome's "network error" when the connection drops, is a dropped connection the learner can retry.
        if (err instanceof OpenAIError || signal.aborted) throw err;
        throw new APIConnectionError({ message: 'The connection dropped.', cause: err instanceof Error ? err : undefined });
      }
      // An aborted request ends the SDK's iteration quietly: reject, so nothing is saved.
      if (signal.aborted) throw new APIUserAbortError();
      if (!response) throw new APIConnectionError({ message: 'The answer stopped before it finished.' });
      return resultOf(response);
    },
    async checkKey() {
      try {
        await client.models.list({ timeout: KEY_CHECK_TIMEOUT_MS });
      } catch (err) {
        // A key restricted from listing models answers 403 but can still be used (spec §4.6).
        if (err instanceof PermissionDeniedError) return;
        throw err;
      }
    },
  };
}
