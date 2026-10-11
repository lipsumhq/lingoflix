import { describe, expect, it, vi } from "vitest";
import { CloudflareEmailError } from "@/lib/email/cloudflare";
import { parseFrom, sendSignInEmail, signInEmailContent } from "@/lib/email/sign-in-email";

const LINK =
  "https://lingoflix.lipsum.fun/api/auth/magic-link/verify?token=tok123&callbackURL=%2Fconnect&errorCallbackURL=%2Fsign-in";
const CONFIGURED = {
  NODE_ENV: "production",
  CLOUDFLARE_ACCOUNT_ID: "acc123",
  CLOUDFLARE_EMAIL_TOKEN: "tok-1",
};

function cloudflareReplying(status: number, result: Record<string, unknown> | null, errors: unknown[] = []) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ success: status < 400, errors, messages: [], result }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const accepted = (to: string, where: "delivered" | "queued" = "delivered") => ({
  delivered: where === "delivered" ? [to] : [],
  queued: where === "queued" ? [to] : [],
  permanent_bounces: [],
});

describe("signInEmailContent", () => {
  it("says what the link does, that it works once, expires in 15 minutes, and can be ignored", () => {
    const { subject, text, html } = signInEmailContent(LINK);
    expect(subject).toBe("Sign in to LingoFlix");
    expect(text).toContain(LINK);
    expect(text).toContain("The link works once and expires in 15 minutes.");
    expect(text).toContain("If you didn't ask to sign in, you can ignore this email.");
    expect(html).toContain("The link works once and expires in 15 minutes.");
    expect(html).toContain("If you didn&#39;t ask to sign in, you can ignore this email.");
    expect(text).not.toContain("\u2014");
    expect(html).not.toContain("\u2014");
  });

  it("escapes the link inside the HTML", () => {
    const { html } = signInEmailContent('https://x.test/verify?token=a&b="c"<d>');
    expect(html).toContain('href="https://x.test/verify?token=a&amp;b=&quot;c&quot;&lt;d&gt;"');
    expect(html).not.toContain('b="c"');
  });
});

describe("parseFrom", () => {
  it('reads "Name <address>" as a named address, a plain address as is, and defaults to LingoFlix', () => {
    expect(parseFrom("LingoFlix <hello@lipsum.fun>")).toEqual({ name: "LingoFlix", address: "hello@lipsum.fun" });
    expect(parseFrom("hello@lipsum.fun")).toBe("hello@lipsum.fun");
    expect(parseFrom(undefined)).toEqual({ name: "LingoFlix", address: "login@lipsum.fun" });
    expect(parseFrom("  ")).toEqual({ name: "LingoFlix", address: "login@lipsum.fun" });
  });
});

describe("sendSignInEmail", () => {
  it("sends through Cloudflare from LingoFlix by default", async () => {
    const { fetchFn, calls } = cloudflareReplying(200, accepted("learner@example.com"));
    await sendSignInEmail("learner@example.com", LINK, { env: CONFIGURED, fetch: fetchFn });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/email/sending/send");
    const { subject, text, html } = signInEmailContent(LINK);
    expect(calls[0]!.body).toEqual({
      from: { name: "LingoFlix", address: "login@lipsum.fun" },
      to: "learner@example.com",
      subject,
      text,
      html,
    });
  });

  it("uses EMAIL_FROM when it is set", async () => {
    const { fetchFn, calls } = cloudflareReplying(200, accepted("learner@example.com"));
    await sendSignInEmail("learner@example.com", LINK, {
      env: { ...CONFIGURED, EMAIL_FROM: "LingoFlix <hello@lipsum.fun>" },
      fetch: fetchFn,
    });
    expect(calls[0]!.body.from).toEqual({ name: "LingoFlix", address: "hello@lipsum.fun" });
  });

  it("counts a queued email as sent and matches the address in any letter case", async () => {
    const { fetchFn } = cloudflareReplying(200, accepted("Learner@Example.com", "queued"));
    await expect(sendSignInEmail("learner@example.com", LINK, { env: CONFIGURED, fetch: fetchFn })).resolves.toBeUndefined();
  });

  it("throws when Cloudflare does not accept the address (a bounce or a suppressed address)", async () => {
    const { fetchFn } = cloudflareReplying(200, {
      delivered: [],
      queued: [],
      permanent_bounces: ["learner@example.com"],
    });
    await expect(sendSignInEmail("learner@example.com", LINK, { env: CONFIGURED, fetch: fetchFn })).rejects.toThrow(
      "The sign-in email was not accepted",
    );
  });

  it("passes Cloudflare errors through", async () => {
    const { fetchFn } = cloudflareReplying(403, null, [{ code: 10105, message: "email.sending.error.authentication.not_entitled" }]);
    await expect(sendSignInEmail("learner@example.com", LINK, { env: CONFIGURED, fetch: fetchFn })).rejects.toBeInstanceOf(
      CloudflareEmailError,
    );
  });

  it("prints the link instead of sending when Cloudflare is not set up outside production", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const log = vi.fn();
    await sendSignInEmail("learner@example.com", LINK, { env: { NODE_ENV: "development" }, fetch: fetchFn, log });
    expect(log).toHaveBeenCalledWith(`Sign-in link for learner@example.com: ${LINK}`);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses to run without Cloudflare in production", async () => {
    const log = vi.fn();
    await expect(
      sendSignInEmail("learner@example.com", LINK, { env: { NODE_ENV: "production", CLOUDFLARE_ACCOUNT_ID: "acc123" }, log }),
    ).rejects.toThrow("Cloudflare email is not configured");
    expect(log).not.toHaveBeenCalled();
  });
});
