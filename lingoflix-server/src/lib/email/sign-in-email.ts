import { sendEmail, type EmailAddress } from "./cloudflare";

const DEFAULT_FROM: EmailAddress = { name: "LingoFlix", address: "login@lipsum.fun" };

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** The sign-in email (spec §5.2): one link, which works once and expires in 15 minutes. */
export function signInEmailContent(url: string): { subject: string; text: string; html: string } {
  const subject = "Sign in to LingoFlix";
  const text = [
    "Sign in to LingoFlix with this link:",
    "",
    url,
    "",
    "The link works once and expires in 15 minutes.",
    "If you didn't ask to sign in, you can ignore this email.",
  ].join("\n");
  const html = [
    "<!doctype html>",
    '<html><body style="margin:0;padding:24px;background:#f0f0f0;font-family:Nunito,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#3c3c3c">',
    '<div style="max-width:480px;margin:0 auto;background:#ffffff;border:2px solid #e5e5e5;border-radius:18px;padding:24px">',
    '<h1 style="margin:0 0 12px;font-size:22px;font-weight:900">Sign in to LingoFlix</h1>',
    '<p style="margin:0 0 20px;font-size:15px;line-height:1.5">Tap the button to sign in.</p>',
    `<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#ffc800;color:#3a2e00;text-decoration:none;font-weight:800;padding:12px 20px;border-radius:16px;border-bottom:4px solid #e0a800">Sign in</a></p>`,
    '<p style="margin:0 0 8px;font-size:13px;color:#6b6b6b">The link works once and expires in 15 minutes.</p>',
    `<p style="margin:0;font-size:13px;color:#6b6b6b">${escapeHtml("If you didn't ask to sign in, you can ignore this email.")}</p>`,
    "</div></body></html>",
  ].join("");
  return { subject, text, html };
}

/** `EMAIL_FROM`: "Name <address>" or a plain address; unset means LingoFlix <login@lipsum.fun>. */
export function parseFrom(value: string | undefined): EmailAddress {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_FROM;
  const named = /^(.*?)\s*<([^<>\s]+)>$/.exec(trimmed);
  if (named?.[1] && named[2]) return { name: named[1], address: named[2] };
  return trimmed;
}

/**
 * Sends the sign-in link through Cloudflare Email Service. Outside production with no Cloudflare
 * credentials, prints the link instead so sign-in works locally; in production that is an error.
 */
export async function sendSignInEmail(
  to: string,
  url: string,
  deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch; log?: (message: string) => void } = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_EMAIL_TOKEN;
  if (!accountId || !apiToken) {
    if (env.NODE_ENV === "production") throw new Error("Cloudflare email is not configured");
    (deps.log ?? console.info)(`Sign-in link for ${to}: ${url}`);
    return;
  }
  const { subject, text, html } = signInEmailContent(url);
  const result = await sendEmail(
    { from: parseFrom(env.EMAIL_FROM), to, subject, text, html },
    { accountId, apiToken, fetch: deps.fetch },
  );
  const wanted = to.toLowerCase();
  const acceptedAddresses = [...result.delivered, ...result.queued].map((address) => address.toLowerCase());
  if (!acceptedAddresses.includes(wanted)) throw new Error("The sign-in email was not accepted");
}
