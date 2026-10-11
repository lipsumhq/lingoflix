import { APIConnectionError, APIError, AuthenticationError, RateLimitError } from '@anthropic-ai/sdk';
import type { Provider } from './provider';
import { errorCopy, type ExplainErrorCode } from './protocol';

/**
 * Anthropic usually reports a low balance as a 400 invalid_request_error ("Your credit balance is too low to access
 * the Anthropic API."), not a 402. A text match: if Anthropic rewords it, the card shows Anthropic's own sentence.
 */
const ANTHROPIC_LOW_CREDIT = /credit balance/i;

function anthropicMessage(err: APIError): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  return typeof message === 'string' && message ? message : err.message;
}

/** An SDK's error as a card state (free-own-key spec §4.6), its headline naming `provider`. */
export function toExplainError(err: unknown, provider: Provider): { code: ExplainErrorCode; message: string } {
  const failure = (code: ExplainErrorCode, message = '') => ({ code, message: message || errorCopy(code, provider) });
  if (err instanceof AuthenticationError) return failure('bad-key');
  if (err instanceof RateLimitError) return failure('busy');
  if (err instanceof APIConnectionError) return failure('network'); // includes timeouts
  if (err instanceof APIError) {
    // 402, or a billing error during the stream (no status).
    if (err.status === 402 || err.type === 'billing_error') return failure('no-credit');
    if (err.status === 400 && err.type === 'invalid_request_error' && ANTHROPIC_LOW_CREDIT.test(anthropicMessage(err))) {
      return failure('no-credit');
    }
    // 5xx (including a gateway's HTML page) and mid-stream rate limit or overload errors, which have no status.
    if (err.status !== undefined && err.status >= 500) return failure('busy');
    if (err.type === 'overloaded_error' || err.type === 'rate_limit_error') return failure('busy');
    return failure('api', anthropicMessage(err));
  }
  return failure('api', err instanceof Error ? err.message : String(err));
}
