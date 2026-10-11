import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/types";
import type { Auth } from "@/lib/auth";
import { createTestDb } from "../support/test-db";

// getAuth() builds Better Auth on getDb(). Here that is an in-memory Postgres with every migration applied, so
// Better Auth's first look at its tables succeeds and no connection is opened anywhere.
const database = vi.hoisted(() => ({ current: null as Kysely<Database> | null }));
vi.mock("@/db/client", () => ({
  getDb: () => {
    if (!database.current) throw new Error("the test database is not ready");
    return database.current;
  },
}));

const BASE_URL = "http://localhost:3000";
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

/** The app's environment, plus TEST=1: Better Auth's isTest() would turn its Origin and callback-URL checks off. */
const ENVIRONMENT = {
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123456",
  BETTER_AUTH_URL: BASE_URL,
  GOOGLE_CLIENT_ID: "test-google-id",
  GOOGLE_CLIENT_SECRET: "test-google-secret",
  EXTENSION_ID: "",
  CLOUDFLARE_ACCOUNT_ID: "",
  CLOUDFLARE_EMAIL_TOKEN: "",
  TEST: "1",
};

const built: Auth[] = [];

/** A fresh getAuth() (the module caches its Better Auth) called with the app's environment and `overrides`. */
async function getAuthWith(overrides: Partial<Record<keyof typeof ENVIRONMENT, string | undefined>> = {}): Promise<Auth> {
  for (const [name, value] of Object.entries({ ...ENVIRONMENT, ...overrides })) vi.stubEnv(name, value);
  vi.resetModules();
  const { getAuth } = await import("@/lib/auth");
  const auth = getAuth();
  built.push(auth);
  return auth;
}

beforeAll(async () => {
  database.current = await createTestDb();
});

afterEach(async () => {
  // A request waits for Better Auth's schema check, so none is still reading the database when it closes.
  await Promise.all(built.splice(0).map((auth) => auth.handler(new Request(`${BASE_URL}/api/auth/ok`))));
});

afterAll(async () => {
  await database.current?.destroy();
  database.current = null;
});

describe("getAuth(): Origin and callback-URL checks", () => {
  it("keeps the checks on even when the environment looks like a test run", async () => {
    const auth = await getAuthWith();
    expect(auth.options.advanced?.disableOriginCheck).toBe(false);
  });

  it("refuses a sign-in link whose callbackURL points to another site", async () => {
    const auth = await getAuthWith();
    // Better Auth logs every refused URL with console.error; keep the expected one out of the test output.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "learner@example.com", callbackURL: "https://evil.example/x" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "INVALID_CALLBACK_URL" });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("Invalid callbackURL: https://evil.example/x"));
    // With no Cloudflare credentials the link would be printed instead of emailed: nothing was.
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("getAuth(): EXTENSION_ID", () => {
  it.each([
    { label: "a wildcard", value: "*" },
    { label: "a wildcard inside an ID", value: "abcdefghijklmnop?bcdefghijklmnop" },
    { label: "too short", value: "abc" },
    { label: "uppercase", value: "ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP" },
    { label: "33 letters", value: `${EXTENSION_ID}a` },
    { label: "a letter after p", value: "abcdefghijklmnopabcdefghijklmnoq" },
  ])("refuses $label ($value)", async ({ value }) => {
    await expect(getAuthWith({ EXTENSION_ID: value })).rejects.toThrow(
      "EXTENSION_ID must be a 32-letter Chrome extension ID (a to p)",
    );
  });

  it("trusts the extension's origin when EXTENSION_ID is a Chrome extension ID", async () => {
    const auth = await getAuthWith({ EXTENSION_ID });
    expect(auth.options.trustedOrigins).toEqual([`chrome-extension://${EXTENSION_ID}`]);
  });

  it.each([
    { label: "empty", value: "" },
    { label: "unset", value: undefined },
  ])("trusts no extension when EXTENSION_ID is $label", async ({ value }) => {
    const auth = await getAuthWith({ EXTENSION_ID: value });
    expect(auth.options.trustedOrigins).toEqual([]);
  });
});
