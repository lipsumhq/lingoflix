import { sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TEST_BASE_URL,
  TEST_EXTENSION_ORIGIN,
  createTestAuth,
  requestMagicLink,
  sessionCookie,
  signInWithMagicLink,
  type TestAuth,
} from "../support/test-auth";

let t: TestAuth;
afterEach(async () => {
  await t.close();
});

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });

/** Where a redirect goes, read as a URL so the order of query parameters doesn't matter. */
const redirectOf = (res: Response) => new URL(res.headers.get("location") ?? "", TEST_BASE_URL);

describe("sign-in links", () => {
  it("a link signs the learner in and redirects to the callback with a session cookie and a bearer token", async () => {
    t = await createTestAuth();
    const { res, bearer: token } = await signInWithMagicLink(t, "learner@example.com");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${TEST_BASE_URL}/connect`);
    expect(sessionCookie(res)).toMatch(/^better-auth\.session_token=.+/);
    expect(token).toBeTruthy();
  });

  it("a link works only once: the second open lands on the sign-in page with INVALID_TOKEN", async () => {
    t = await createTestAuth();
    const { url } = await requestMagicLink(t, "learner@example.com");
    expect((await t.auth.handler(new Request(url))).status).toBe(302);
    const again = redirectOf(await t.auth.handler(new Request(url)));
    expect(again.pathname).toBe("/sign-in");
    expect(again.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(again.searchParams.get("next")).toBe("/connect");
  });

  it("an unknown token lands on the sign-in page with INVALID_TOKEN", async () => {
    t = await createTestAuth();
    const url = new URL((await requestMagicLink(t, "learner@example.com")).url);
    url.searchParams.set("token", "not-a-real-token");
    const landed = redirectOf(await t.auth.handler(new Request(url)));
    expect(landed.pathname).toBe("/sign-in");
    expect(landed.searchParams.get("error")).toBe("INVALID_TOKEN");
  });

  it("an expired link lands on the sign-in page with INVALID_TOKEN", async () => {
    t = await createTestAuth({ magicLinkExpiresIn: 1 });
    const { url } = await requestMagicLink(t, "learner@example.com");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const landed = redirectOf(await t.auth.handler(new Request(url)));
    expect(landed.pathname).toBe("/sign-in");
    expect(landed.searchParams.get("error")).toBe("INVALID_TOKEN");
  });

  it("keeps only a hash of the link token in the database", async () => {
    t = await createTestAuth();
    const token = new URL((await requestMagicLink(t, "learner@example.com")).url).searchParams.get("token")!;
    const { rows } = await sql<{ identifier: string; value: string }>`select "identifier", "value" from "verification"`.execute(t.db);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.identifier).not.toBe(token);
      expect(row.value).not.toContain(token);
    }
  });
});

describe("bearer tokens (the extension)", () => {
  it("accepts the signed token and the raw session token, and rejects a forged signature", async () => {
    t = await createTestAuth();
    const { bearer: signed } = await signInWithMagicLink(t, "learner@example.com");
    const viaSigned = await t.auth.api.getSession({ headers: bearer(signed!) });
    expect(viaSigned?.user.email).toBe("learner@example.com");
    const raw = viaSigned!.session.token;
    expect(signed!.startsWith(`${raw}.`)).toBe(true);
    expect((await t.auth.api.getSession({ headers: bearer(raw) }))?.session.id).toBe(viaSigned!.session.id);
    expect(await t.auth.api.getSession({ headers: bearer(`${raw}.forged`) })).toBeNull();
  });

  it("signing out with the bearer token ends the session", async () => {
    t = await createTestAuth();
    const { bearer: token } = await signInWithMagicLink(t, "learner@example.com");
    const res = await t.auth.handler(
      new Request(`${TEST_BASE_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(await res.json()).toEqual({ success: true });
    expect(await t.auth.api.getSession({ headers: bearer(token!) })).toBeNull();
  });
});

describe("Google", () => {
  it("sends the learner to Google with our callback URL", async () => {
    t = await createTestAuth();
    const res = await t.auth.handler(
      new Request(`${TEST_BASE_URL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: "/connect" }),
      }),
    );
    const { url } = (await res.json()) as { url: string };
    const google = new URL(url);
    expect(google.hostname).toBe("accounts.google.com");
    expect(google.searchParams.get("redirect_uri")).toBe(`${TEST_BASE_URL}/api/auth/callback/google`);
  });
});

describe("trusted origins", () => {
  it("accepts a cookie request from the LingoFlix extension and refuses one from another site", async () => {
    t = await createTestAuth({ enforceOriginCheck: true });
    // Better Auth logs every refused origin with console.error; keep the expected one out of the test output.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res } = await signInWithMagicLink(t, "learner@example.com");
    const cookie = sessionCookie(res);
    const signOutFrom = (origin: string) =>
      t.auth.handler(
        new Request(`${TEST_BASE_URL}/api/auth/sign-out`, {
          method: "POST",
          headers: { cookie, origin, "content-type": "application/json" },
          body: "{}",
        }),
      );
    const evil = await signOutFrom("https://evil.example");
    expect(evil.status).toBe(403);
    expect(await evil.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("Invalid origin: https://evil.example"));
    expect((await signOutFrom(TEST_EXTENSION_ORIGIN)).status).toBe(200);
  });
});
