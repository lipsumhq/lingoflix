/**
 * Cloudflare Email Service, sending REST API (public beta). One small fetch wrapper instead of the
 * 69.5 MB `cloudflare` SDK. Docs: https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
 */

/** An email address, or an address with a display name (the REST API's `{ address, name }` shape). */
export type EmailAddress = string | { address: string; name?: string | null };

export interface SendEmailInput {
  from: EmailAddress;
  to: EmailAddress | EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: EmailAddress;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  /** Delivered right away. */
  delivered: string[];
  permanent_bounces: string[];
  /** Accepted, delivery queued for later. */
  queued: string[];
  message_id?: string;
  suppressed_recipients?: string[];
}

interface CloudflareEnvelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
  result: T | null;
}

export class CloudflareEmailError extends Error {
  readonly status: number;
  readonly errors: { code: number; message: string }[];

  constructor(status: number, errors: { code: number; message: string }[]) {
    super(`Cloudflare Email Service ${status}: ${errors.map((e) => `${e.code} ${e.message}`).join(", ")}`);
    this.name = "CloudflareEmailError";
    this.status = status;
    this.errors = errors;
  }
}

export async function sendEmail(
  input: SendEmailInput,
  opts: { accountId: string; apiToken: string; fetch?: typeof fetch },
): Promise<SendEmailResult> {
  const res = await (opts.fetch ?? fetch)(
    `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  let body: CloudflareEnvelope<SendEmailResult> | null = null;
  try {
    body = (await res.json()) as CloudflareEnvelope<SendEmailResult>;
  } catch {
    // Not JSON (a gateway error page): reported below with no codes.
  }
  if (!res.ok || !body?.success || !body.result) {
    throw new CloudflareEmailError(res.status, body?.errors ?? []);
  }
  return body.result;
}
