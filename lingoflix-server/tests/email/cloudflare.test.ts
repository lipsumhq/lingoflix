import { describe, expect, it } from "vitest";
import { CloudflareEmailError, sendEmail, type SendEmailInput } from "@/lib/email/cloudflare";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: string) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const INPUT: SendEmailInput = {
  from: { address: "login@lipsum.fun", name: "LingoFlix" },
  to: "learner@example.com",
  subject: "Sign in to LingoFlix",
  text: "hello",
  html: "<p>hello</p>",
};

const OK_RESULT = {
  delivered: ["learner@example.com"],
  permanent_bounces: [],
  queued: [],
  message_id: "<abc@lipsum.fun>",
  suppressed_recipients: [],
};

describe("sendEmail", () => {
  it("posts the email to the account send endpoint with the bearer token and returns the result", async () => {
    const { fetchFn, calls } = fakeFetch(200, JSON.stringify({ success: true, errors: [], messages: [], result: OK_RESULT }));
    const result = await sendEmail(INPUT, { accountId: "acc123", apiToken: "tok-1", fetch: fetchFn });
    expect(result).toEqual(OK_RESULT);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/email/sending/send");
    expect(call.init.method).toBe("POST");
    expect(new Headers(call.init.headers).get("Authorization")).toBe("Bearer tok-1");
    expect(new Headers(call.init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(call.init.body))).toEqual(INPUT);
  });

  it("turns a Cloudflare error envelope into a CloudflareEmailError with the status and codes", async () => {
    const { fetchFn } = fakeFetch(
      403,
      JSON.stringify({
        success: false,
        errors: [{ code: 10102, message: "email.sending.error.authentication.forbidden" }],
        messages: [],
        result: null,
      }),
    );
    const error = await sendEmail(INPUT, { accountId: "acc123", apiToken: "tok-1", fetch: fetchFn }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareEmailError);
    expect((error as CloudflareEmailError).status).toBe(403);
    expect((error as CloudflareEmailError).errors).toEqual([{ code: 10102, message: "email.sending.error.authentication.forbidden" }]);
    expect((error as CloudflareEmailError).message).toBe(
      "Cloudflare Email Service 403: 10102 email.sending.error.authentication.forbidden",
    );
  });

  it("treats a body that is not JSON (for example a 502 page) as an error with no codes", async () => {
    const { fetchFn } = fakeFetch(502, "<html>Bad gateway</html>");
    const error = await sendEmail(INPUT, { accountId: "acc123", apiToken: "tok-1", fetch: fetchFn }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareEmailError);
    expect((error as CloudflareEmailError).status).toBe(502);
    expect((error as CloudflareEmailError).errors).toEqual([]);
  });
});
