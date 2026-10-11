import type { Kysely } from "kysely";
import { createAuth, type Auth } from "@/lib/auth";
import type { Database } from "@/db/types";
import { createTestDb } from "./test-db";

export const TEST_BASE_URL = "http://localhost:3000";
export const TEST_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
export const TEST_EXTENSION_ORIGIN = `chrome-extension://${TEST_EXTENSION_ID}`;

export interface TestAuth {
  auth: Auth;
  db: Kysely<Database>;
  /** Every sign-in email "sent", newest last. */
  sent: { to: string; url: string }[];
  close(): Promise<void>;
}

/**
 * Better Auth on a fresh in-memory Postgres with every migration applied.
 * Under Vitest, Better Auth turns off its Origin, CSRF and callback-URL checks by default; this turns them back on,
 * as in production. `enforceOriginCheck: false` restores Better Auth's test default.
 */
export async function createTestAuth(
  opts: { magicLinkExpiresIn?: number; enforceOriginCheck?: boolean } = {},
): Promise<TestAuth> {
  const db = await createTestDb(); // migrate BEFORE constructing Better Auth: it caches a schema mismatch
  const sent: { to: string; url: string }[] = [];
  const auth = createAuth({
    db,
    secret: "test-secret-test-secret-test-secret-123456",
    baseURL: TEST_BASE_URL,
    googleClientId: "test-google-id",
    googleClientSecret: "test-google-secret",
    extensionId: TEST_EXTENSION_ID,
    sendSignInEmail: async (to, url) => {
      sent.push({ to, url });
    },
    magicLinkExpiresIn: opts.magicLinkExpiresIn,
    // undefined (not true) keeps Better Auth's own default, which also skips its disableOriginCheck deprecation notice.
    disableOriginCheck: opts.enforceOriginCheck === false ? undefined : false,
  });
  return { auth, db, sent, close: () => db.destroy() };
}

/** Asks for a sign-in link, as the /sign-in page does. */
export async function requestMagicLink(t: TestAuth, email: string): Promise<{ to: string; url: string }> {
  const res = await t.auth.handler(
    new Request(`${TEST_BASE_URL}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/connect", errorCallbackURL: "/sign-in?next=%2Fconnect" }),
    }),
  );
  if (!res.ok) throw new Error(`sign-in/magic-link answered ${res.status}`);
  const link = t.sent.at(-1);
  if (!link || link.to !== email) throw new Error("no sign-in link was sent");
  return link;
}

/** Opens a fresh sign-in link, as the learner's browser does. */
export async function signInWithMagicLink(t: TestAuth, email: string): Promise<{ res: Response; bearer: string | null }> {
  const { url } = await requestMagicLink(t, email);
  const res = await t.auth.handler(new Request(url));
  return { res, bearer: res.headers.get("set-auth-token") };
}

/** The `better-auth.session_token=...` pair from a response's set-cookie header. */
export function sessionCookie(res: Response): string {
  const match = /better-auth\.session_token=[^;]+/.exec(res.headers.get("set-cookie") ?? "");
  if (!match) throw new Error("no session cookie");
  return match[0];
}
