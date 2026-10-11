import * as Anthropic from '@anthropic-ai/sdk';
import * as OpenAI from 'openai';
import type { Provider } from './provider';
import { errorCopy, type ExplainErrorCode } from './protocol';

/** OpenAI's codes for an account out of credit or over a spend limit (free-own-key spec §4.6). */
const OPENAI_NO_CREDIT_CODES: ReadonlySet<unknown> = new Set([
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

/**
 * Anthropic usually reports a low balance as a 400 invalid_request_error ("Your credit balance is too low to access
 * the Anthropic API."), not a 402. A text match: if Anthropic rewords it, the card shows Anthropic's own sentence.
 */
const ANTHROPIC_LOW_CREDIT = /credit balance/i;

function anthropicCode(err: Anthropic.APIError): ExplainErrorCode {
  if (err instanceof Anthropic.AuthenticationError) return 'bad-key';
  if (err instanceof Anthropic.RateLimitError) return 'busy';
  if (err instanceof Anthropic.APIConnectionError) return 'network'; // includes timeouts
  // 402, or a billing error during the stream (no status).
  if (err.status === 402 || err.type === 'billing_error') return 'no-credit';
  if (err.status === 400 && err.type === 'invalid_request_error' && ANTHROPIC_LOW_CREDIT.test(providerMessage(err))) {
    return 'no-credit';
  }
  // 5xx (including a gateway's HTML page) and mid-stream rate limit or overload errors, which have no status.
  if (err.status !== undefined && err.status >= 500) return 'busy';
  if (err.type === 'overloaded_error' || err.type === 'rate_limit_error') return 'busy';
  return 'api';
}

function openAICode(err: OpenAI.APIError): ExplainErrorCode {
  if (err instanceof OpenAI.AuthenticationError) return 'bad-key';
  if (err instanceof OpenAI.APIConnectionError) return 'network'; // includes timeouts
  if (err.type === 'insufficient_quota' || OPENAI_NO_CREDIT_CODES.has(err.code)) return 'no-credit';
  // Any other 429, and 5xx. A stream `error` event has no status and stays `api`.
  if (err instanceof OpenAI.RateLimitError || err instanceof OpenAI.InternalServerError) return 'busy';
  return 'api';
}

/** The provider's own message: Anthropic's SDK keeps the whole body, OpenAI's the `error` object in it. */
function providerMessage(err: Anthropic.APIError | OpenAI.APIError): string {
  const body = err.error as { message?: unknown; error?: { message?: unknown } } | undefined;
  const message = err instanceof Anthropic.APIError ? body?.error?.message : body?.message;
  return typeof message === 'string' && message ? message : err.message;
}

/** An SDK's error as a card state (free-own-key spec §4.6), its headline naming `provider`. */
export function toExplainError(err: unknown, provider: Provider): { code: ExplainErrorCode; message: string } {
  const failure = (code: ExplainErrorCode, message = '') => ({ code, message: message || errorCopy(code, provider) });
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    const code = err instanceof Anthropic.APIError ? anthropicCode(err) : openAICode(err);
    return failure(code, code === 'api' ? providerMessage(err) : '');
  }
  return failure('api', err instanceof Error ? err.message : String(err));
}
