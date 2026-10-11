import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { bearer, magicLink } from "better-auth/plugins";
import type { Kysely } from "kysely";
import { getDb } from "../db/client";
import type { Database } from "../db/types";
import { sendSignInEmail } from "./email/sign-in-email";

/** Sign-in links work once and expire after 15 minutes. */
export const MAGIC_LINK_EXPIRES_IN = 60 * 15;

export interface AuthDeps {
  db: Kysely<Database>;
  secret: string;
  baseURL: string;
  googleClientId: string;
  googleClientSecret: string;
  /** The LingoFlix extension's Chrome Web Store id (spec §7.8); null until it is known. */
  extensionId: string | null;
  sendSignInEmail: (to: string, url: string) => Promise<void>;
  /** Tests only: seconds a sign-in link lasts (default MAGIC_LINK_EXPIRES_IN). */
  magicLinkExpiresIn?: number;
  /**
   * Better Auth skips its Origin, CSRF and callback-URL checks when NODE_ENV is "test" or TEST is set; false keeps
   * them on regardless (the app always passes false). Unset keeps Better Auth's default, which some tests want.
   */
  disableOriginCheck?: boolean;
}

/**
 * Sign-in for the site and the extension (spec §5.2): Google, emailed sign-in links, and bearer tokens
 * for the extension. Better Auth reads and writes its tables through our Kysely instance.
 */
export function createAuth(deps: AuthDeps) {
  return betterAuth({
    database: { db: deps.db, type: "postgres" },
    secret: deps.secret,
    baseURL: deps.baseURL,
    trustedOrigins: deps.extensionId ? [`chrome-extension://${deps.extensionId}`] : [],
    socialProviders: {
      google: { clientId: deps.googleClientId, clientSecret: deps.googleClientSecret },
    },
    ...(deps.disableOriginCheck === undefined ? {} : { advanced: { disableOriginCheck: deps.disableOriginCheck } }),
    // Google sign-in errors (and Better Auth's error page) land on /sign-in?error=<code>, which shows a message;
    // otherwise production redirects them to /?error=<code>, which shows nothing.
    onAPIError: { errorURL: "/sign-in" },
    plugins: [
      magicLink({
        expiresIn: deps.magicLinkExpiresIn ?? MAGIC_LINK_EXPIRES_IN,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          await deps.sendSignInEmail(email, url);
        },
      }),
      bearer(),
      nextCookies(), // must stay last
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const REQUIRED_ENV = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;

/**
 * `EXTENSION_ID` becomes a trusted origin, where `*` and `?` are wildcards, so only a real Chrome extension ID
 * (32 letters, a to p) is accepted. Empty or unset means no extension yet.
 */
function extensionIdFrom(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^[a-p]{32}$/.test(value)) throw new Error("EXTENSION_ID must be a 32-letter Chrome extension ID (a to p)");
  return value;
}

let cached: Auth | null = null;

/** The app's Better Auth, built on first use (never at import, so builds and tests need no secrets). */
export function getAuth(): Auth {
  if (cached) return cached;
  const env = process.env;
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  const extensionId = extensionIdFrom(env.EXTENSION_ID);
  cached = createAuth({
    db: getDb(),
    secret: env.BETTER_AUTH_SECRET!,
    baseURL: env.BETTER_AUTH_URL!,
    googleClientId: env.GOOGLE_CLIENT_ID!,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET!,
    extensionId,
    sendSignInEmail: (to, url) => sendSignInEmail(to, url),
    // Never left to Better Auth: a stray NODE_ENV=test or TEST variable in production would turn the checks off.
    disableOriginCheck: false,
  });
  return cached;
}
