import { APIConnectionError, APIError, AuthenticationError, RateLimitError } from '@anthropic-ai/sdk';
import { ERROR_COPY, type ExplainErrorCode } from './protocol';

const failure = (code: ExplainErrorCode) => ({ code, message: ERROR_COPY[code] });

function anthropicMessage(err: APIError): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  return typeof message === 'string' && message ? message : err.message;
}

export function toExplainError(err: unknown): { code: ExplainErrorCode; message: string } {
  if (err instanceof AuthenticationError) return failure('bad-key');
  if (err instanceof RateLimitError) return failure('busy');
  if (err instanceof APIConnectionError) return failure('network'); // includes timeouts
  if (err instanceof APIError) {
    // 5xx (including a gateway's HTML page) and mid-stream rate limit or overload errors, which have no status.
    if (err.status !== undefined && err.status >= 500) return failure('busy');
    if (err.type === 'overloaded_error' || err.type === 'rate_limit_error') return failure('busy');
    return { code: 'api', message: anthropicMessage(err) };
  }
  return { code: 'api', message: err instanceof Error ? err.message : String(err) };
}
