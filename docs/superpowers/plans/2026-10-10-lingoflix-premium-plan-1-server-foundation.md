# LingoFlix Premium Plan 1: Server Foundation Implementation Plan

Abandoned 2026-10-11: LingoFlix stays free with the learner's own key. See docs/superpowers/specs/2026-10-11-lingoflix-free-own-key-design.md.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `lingoflix-server/`, the LingoFlix website and API: a Next.js app with sign-in (Google and emailed links), its Postgres schema, and the public pages (`/`, `/welcome`, `/sign-in`, `/account`, `/upgrade`, `/connect`, `/goodbye`, `/privacy`, `/terms`), ready to deploy on Vercel with Neon.

**Architecture:** Next.js 16 (App Router, `src/`, Tailwind 4, Cache Components off), scaffolded with `create-next-app` inside the repo's pnpm workspace. Data access with Kysely on a `pg` Pool (Neon); every schema change is a kysely-ctl migration, including Better Auth's tables. Better Auth runs on the same Kysely instance with Google, the magic-link plugin (emails sent through Cloudflare Email Service's REST API) and the bearer plugin for the extension. Everything that needs secrets or the database is created lazily, so builds and tests need no environment. Tests use Vitest with an in-process Postgres (PGlite through Kysely's built-in dialect).

**Tech Stack:** Next.js 16.4.0, React 19.3.0, TypeScript 6.0.3, Tailwind 4, better-auth 1.7.6 (+ `auth` CLI 1.7.6), kysely 0.29.6, kysely-ctl 0.21.0, pg 8.23.0, @vercel/functions 3.9.11, @electric-sql/pglite 0.5.8 (tests), Vitest 5.0.3 + jsdom + Testing Library, pnpm 11 workspace.

**Spec:** `docs/superpowers/specs/2026-10-10-lingoflix-subscription-design.md` (§4, §5, §8, §10, §12 item 1). Billing (Plan 2) and AI plus the extension switch-over (Plan 3) are separate plans.

## Global Constraints

- The app is created with `create-next-app` (exact command in Task 1). Never hand-write Next.js boilerplate the CLI generates.
- Database access only through Kysely; every schema change is a kysely-ctl migration in `lingoflix-server/src/db/migrations/`. Better Auth's `migrate` command is never used.
- Exact versions (pinned, no `^`): `next` 16.4.0, `react`/`react-dom` 19.3.0, `typescript` 6.0.3, `better-auth` 1.7.6, `auth` 1.7.6 (dev), `kysely` 0.29.6, `kysely-ctl` 0.21.0 (dev), `pg` 8.23.0, `@types/pg` 8.23.1 (dev), `@vercel/functions` 3.9.11, `@electric-sql/pglite` 0.5.8 (dev), `vitest` 5.0.3 (dev), `@vitejs/plugin-react` 6.1.2 (dev), `jsdom` 30.1.2 (dev), `@testing-library/react` 16.3.3 (dev), `@testing-library/dom` 10.4.2 (dev), `@fontsource-variable/nunito` 5.3.0. `@types/node` `^24`. `eslint` stays `^9`.
- Kysely 0.29: `Migrator` and `FileMigrationProvider` are imported from `kysely/migration`, never from `kysely`.
- Nothing reads environment variables, opens a database connection or constructs Better Auth at module load. Use the lazy getters `getDb()` and `getAuth()`. `pnpm build`, `pnpm compile` and `pnpm test` must pass with no environment variables set.
- Environment variable names (server only unless `NEXT_PUBLIC_`): `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (migrations), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EXTENSION_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_TOKEN`, `EMAIL_FROM`, `NEXT_PUBLIC_CHROME_STORE_URL`.
- Session tokens are never logged, never put in a URL, and only handed to the extension by `/connect` through `chrome.runtime.sendMessage`.
- Site: `https://lingoflix.lipsum.fun`. Price copy: `$7.99/month` or `$59.99/year`, `7-day free trial`. Footer on every page: `Not affiliated with or endorsed by Netflix.` Support address: `support@lingoflix.lipsum.fun`.
- Magic links expire after 15 minutes and work once. Expired, used or unknown links show: `That link has expired or was already used. We can send you a new one.`
- If the sign-in email can't be sent: `Couldn't send the email. Try again or use Google.`
- No em dashes in any copy, comment or commit message (use a colon). Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests live in `lingoflix-server/tests/` (`*.test.ts`, `*.test.tsx`); DOM tests start with `// @vitest-environment jsdom`. Write each test first and watch it fail. A missing module fails as `Cannot find package '@/...'` in `.ts` tests and `Failed to resolve import "@/..."` in `.tsx` tests: either wording is the expected failure.
- In an agent session (`CLAUDECODE` or `AI_AGENT` set), Vitest's agent reporter hides console output from passing tests. Whenever a step checks for "no warnings", run Vitest with `--reporter=default` (e.g. `pnpm --filter lingoflix-server exec vitest run --reporter=default`).
- Commands run from the repo root: `pnpm --filter lingoflix-server <script>`; the root `pnpm test`, `pnpm compile` and `pnpm build` run every package.

## Review Focus

1. A `next` value that points off-site (`//evil.com`, `https://evil.com`, `/\evil.com`, `javascript:...`) never becomes a redirect target: it falls back to `/account`. (Task 6: `safeNextPath` tests.)
2. A sign-in link that an email scanner already opened, or that is opened twice or late, lands on `/sign-in` with the expired-link message and a way to send a new link, not a blank error. (Task 4: auth flow tests; Task 6: form tests.)
3. `/connect` with no extension installed, an unset `EXTENSION_ID`, or an extension that never answers shows "Install LingoFlix first" or a retry message within a few seconds, never a spinner forever. (Task 7: ConnectClient tests.)
4. A fresh clone with no `.env` can run `pnpm test`, `pnpm compile` and `pnpm build`: no module touches the environment or the database when imported. (Task 1 and Task 4: import-without-env tests; Task 8: full verification.)
5. The goodbye endpoint, which needs no sign-in, rejects junk (unknown reason, a comment over 500 characters, non-JSON, a huge body) with 400 and stores nothing. (Task 7: route tests.)

## File Structure

| Path (under `lingoflix-server/`) | Responsibility | Task |
|---|---|---|
| scaffold from create-next-app (`package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `AGENTS.md`, `src/app/*`, `public/*`) | Next.js app | 1 |
| `vitest.config.mts` | Test runner config | 1 |
| `src/lib/site.ts` | Site constants (name, URL, prices, support email, store URL) | 1 |
| `src/db/types.ts`, `src/db/client.ts` | Kysely types for our tables; lazy `getDb()` | 2 |
| `kysely.config.ts`, `src/db/migrations/*` | kysely-ctl config; Better Auth tables; `uninstall_feedback` | 2 |
| `tests/support/test-db.ts` | PGlite test database with migrations | 2 |
| `src/lib/email/cloudflare.ts`, `src/lib/email/sign-in-email.ts` | Cloudflare REST sender; sign-in email content and sending | 3 |
| `src/lib/auth.ts`, `src/lib/session.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts` | Better Auth server, session helper, browser client, route | 4 |
| `tests/support/test-auth.ts` | Better Auth on PGlite for tests | 4 |
| `src/app/layout.tsx`, `src/components/SiteHeader.tsx`, `src/components/SiteFooter.tsx`, `src/components/Pricing.tsx`, `src/app/page.tsx`, `src/app/welcome/page.tsx`, `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | Site shell and public pages | 5 |
| `src/lib/safe-next.ts`, `src/lib/upgrade.ts`, `src/app/sign-in/*`, `src/app/account/*`, `src/app/upgrade/page.tsx` | Sign-in, account, upgrade | 6 |
| `src/lib/goodbye.ts`, `src/app/api/goodbye/route.ts`, `src/app/goodbye/*`, `src/app/connect/*` | Goodbye form and endpoint; extension hand-off | 7 |
| `README.md`, `.env.example`, root `README.md` | Docs and the deployment checklist | 8 |

## Interfaces (every task's names, fixed here)

- **Task 1** `src/lib/site.ts`:
  `export const SITE_NAME = 'LingoFlix'`, `export const SITE_URL = 'https://lingoflix.lipsum.fun'`, `export const SUPPORT_EMAIL = 'support@lingoflix.lipsum.fun'`, `export const PRICE_MONTHLY = '$7.99'`, `export const PRICE_YEARLY = '$59.99'`, `export const TRIAL_DAYS = 7`, `export function chromeStoreUrl(env: Record<string, string | undefined> = process.env): string | null` (the `NEXT_PUBLIC_CHROME_STORE_URL` value when it starts with `https://chromewebstore.google.com/`, else null).
- **Task 2** `src/db/types.ts`: `export interface UninstallFeedbackTable { id: ColumnType<string, never, never>; created_at: ColumnType<Date, never, never>; reason: string; comment: string | null }`, `export interface Database { uninstall_feedback: UninstallFeedbackTable }`. `src/db/client.ts`: `export function getDb(): Kysely<Database>` (memoized; throws `Error('DATABASE_URL is not set')`). `tests/support/test-db.ts`: `export async function createTestDb(): Promise<Kysely<Database>>` (fresh in-memory PGlite, all migrations applied; `db.destroy()` closes it).
- **Task 3** `src/lib/email/cloudflare.ts`: `export interface SendEmailInput`, `export interface SendEmailResult`, `export class CloudflareEmailError extends Error { status: number; errors: { code: number; message: string }[] }`, `export async function sendEmail(input: SendEmailInput, opts: { accountId: string; apiToken: string; fetch?: typeof fetch }): Promise<SendEmailResult>`. `src/lib/email/sign-in-email.ts`: `export function signInEmailContent(url: string): { subject: string; text: string; html: string }`, `export function parseFrom(value: string | undefined): { address: string; name?: string }` (`EMAIL_FROM` as `Name <address>`; unset means `LingoFlix <login@lipsum.fun>`), `export async function sendSignInEmail(to: string, url: string, deps?: { env?: Record<string, string | undefined>; fetch?: typeof fetch; log?: (message: string) => void }): Promise<void>`.
- **Task 4** `src/lib/auth.ts`: `export const MAGIC_LINK_EXPIRES_IN = 60 * 15`, `export interface AuthDeps { db: Kysely<Database>; secret: string; baseURL: string; googleClientId: string; googleClientSecret: string; extensionId: string | null; sendSignInEmail: (to: string, url: string) => Promise<void>; magicLinkExpiresIn?: number; disableOriginCheck?: boolean }` (the last two are for tests), `export function createAuth(deps: AuthDeps)`, `export type Auth = ReturnType<typeof createAuth>`, `export function getAuth(): Auth` (memoized, built from env with `getDb()` and `sendSignInEmail`). `src/lib/session.ts`: `export interface CurrentSession { user: { id: string; email: string; name: string }; token: string }`, `export async function getCurrentSession(): Promise<CurrentSession | null>`. `src/lib/auth-client.ts`: `export const authClient` (`createAuthClient` with `magicLinkClient()`). Route `src/app/api/auth/[...all]/route.ts`: `GET` and `POST` call `getAuth().handler(request)`. `tests/support/test-auth.ts`: `export async function createTestAuth(opts?: { magicLinkExpiresIn?: number; enforceOriginCheck?: boolean }): Promise<{ auth: Auth; db: Kysely<Database>; sent: { to: string; url: string }[]; close(): Promise<void> }>`, `export async function requestMagicLink(t, email: string): Promise<{ to: string; url: string }>`, `export async function signInWithMagicLink(t, email: string): Promise<{ res: Response; bearer: string | null }>`, `export function sessionCookie(res: Response): string`, `export const TEST_BASE_URL = 'http://localhost:3000'`, `export const TEST_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'`, `export const TEST_EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'`. `tests/support/test-db.ts` (Task 2) also exports `createMigrator` and `MIGRATION_FOLDER`.
- **Task 5** components: `SiteHeader()`, `SiteFooter()`, `Pricing()` (no props), pages default-export synchronous components (no data fetching) so they render in Vitest.
- **Task 6** `src/lib/safe-next.ts`: `export function safeNextPath(value: string | null | undefined, fallback?: string): string` (default fallback `/account`). `src/lib/upgrade.ts`: `export function upgradeDestination(session: CurrentSession | null): string` (signed out: `/sign-in?next=%2Fupgrade`; signed in: `/account` until Plan 2 adds Checkout). `src/app/sign-in/SignInForm.tsx`: `export function SignInForm(props: { next: string; initialError: string | null; client?: SignInClient })` with `export interface SignInClient { magicLink(input: { email: string; callbackURL: string; errorCallbackURL: string }): Promise<{ error: { message?: string } | null }>; google(input: { callbackURL: string; errorCallbackURL: string }): Promise<{ error: { message?: string } | null }> }`. `src/app/account/SignOutButton.tsx`: `export function SignOutButton(props: { signOut?: () => Promise<unknown>; navigate?: (url: string) => void })`. Task 5 also adds `src/components/LogoMark.tsx`, `src/components/AddToChrome.tsx` and `src/components/styles.ts` (`primaryButton`, `secondaryButton`); Task 6 adds `src/app/account/AccountSummary.tsx`.
- **Task 7** `src/lib/goodbye.ts`: `export const GOODBYE_REASONS = ['too-expensive', 'not-using', 'missing-feature', 'not-working', 'other'] as const`, `export type GoodbyeReason = (typeof GOODBYE_REASONS)[number]`, `export const GOODBYE_REASON_LABELS: Record<GoodbyeReason, string>`, `export const GOODBYE_COMMENT_MAX = 500`, `export function parseGoodbye(body: unknown): { reason: GoodbyeReason; comment: string | null } | null`. `export function createGoodbyeHandler(getDb: () => Kysely<Database>): (request: Request) => Promise<Response>` (also in `src/lib/goodbye.ts`: route files may export only HTTP methods). `src/app/api/goodbye/route.ts`: `export const POST = createGoodbyeHandler(getDb)`. `src/app/connect/ConnectClient.tsx`: `export interface ExtensionRuntime { sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void; lastError?: { message?: string } }`, `export function ConnectClient(props: { extensionId: string | null; token: string; storeUrl: string | null; runtime?: ExtensionRuntime | null; timeoutMs?: number })`. Message: `{ type: 'lingoflix:session', token }`; success reply: `{ ok: true }`.

---
### Task 1: Scaffold `lingoflix-server` with create-next-app, the workspace, Vitest and site constants

**Files:**
- Create (generated by `create-next-app`): `lingoflix-server/` (`package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `next-env.d.ts`, `.gitignore`, `AGENTS.md`, `README.md`, `public/*.svg`, `src/app/favicon.ico`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`)
- Delete: `lingoflix-server/pnpm-workspace.yaml` (generated; a nested workspace file breaks the root install)
- Modify: `pnpm-workspace.yaml` (root), `pnpm-lock.yaml` (root, by `pnpm install`)
- Modify: `lingoflix-server/package.json`, `lingoflix-server/src/app/layout.tsx`, `lingoflix-server/src/app/globals.css`
- Create: `lingoflix-server/vitest.config.mts`, `lingoflix-server/src/lib/site.ts`
- Test: `lingoflix-server/tests/site.test.ts`

**Interfaces:**
- Consumes: nothing (first task). The repo root is a pnpm 11 workspace whose root `package.json` runs `pnpm -r test`, `pnpm -r compile` and `pnpm -r build`.
- Produces:
  - The `lingoflix-server` package with scripts `dev`, `build`, `start`, `lint`, `test` (`vitest run`), `test:watch` (`vitest`), `compile` (`next typegen && tsc --noEmit`).
  - The `@/*` import alias for `lingoflix-server/src/*`, in the app and in Vitest.
  - Vitest: `node` environment by default, test files `lingoflix-server/tests/**/*.test.{ts,tsx}`, DOM tests opt in with `// @vitest-environment jsdom`.
  - `src/lib/site.ts`:
    - `SITE_NAME = "LingoFlix"`, `SITE_URL = "https://lingoflix.lipsum.fun"`, `SUPPORT_EMAIL = "support@lingoflix.lipsum.fun"`
    - `PRICE_MONTHLY = "$7.99"`, `PRICE_YEARLY = "$59.99"`, `TRIAL_DAYS = 7`
    - `chromeStoreUrl(env?: Record<string, string | undefined>): string | null`

Notes for the implementer:
- `create-next-app` 16.4.0 turns Cache Components on by default. This plan turns it off with `--no-cache-components`: with it on, Next.js rejects route segment config such as `export const runtime`, and prerenders GET handlers at build time.
- `AGENTS.md` is generated by the CLI. Keep it exactly as generated: its em dashes are the CLI's text, not ours. It tells agents to read the Next.js docs bundled in `node_modules/next/dist/docs/`, which is worth doing before writing Next.js code in later tasks.
- Code in `lingoflix-server` follows the generated style: double quotes and semicolons.

- [ ] **Step 1: Generate the app with the CLI**

Run from the repo root:

```bash
cd /Users/jay/Codes/jaycho1214/lingoflix
pnpm dlx create-next-app@16.4.0 lingoflix-server --ts --app --src-dir --tailwind --eslint --import-alias "@/*" --use-pnpm --disable-git --skip-install --no-react-compiler --agents-md --no-agent-feedback --no-cache-components --yes
```

Expected: output includes `Creating a new Next.js app in /Users/jay/Codes/jaycho1214/lingoflix/lingoflix-server.`, `Using pnpm.`, `Initializing project with template: app-tw`, `Skipping git initialization.` and `Success! Created lingoflix-server at /Users/jay/Codes/jaycho1214/lingoflix/lingoflix-server`. No `node_modules` and no lockfile inside `lingoflix-server/`.

Run: `ls -a lingoflix-server && cat lingoflix-server/next.config.ts`
Expected:
- the listing has `AGENTS.md`, `README.md`, `eslint.config.mjs`, `next-env.d.ts`, `next.config.ts`, `package.json`, `pnpm-workspace.yaml`, `public`, `src`, `tsconfig.json`, `.gitignore`, and no `pnpm-lock.yaml`;
- `next.config.ts` has a `turbopack.rules` block for `@tailwindcss/turbopack` and no `cacheComponents` line.

- [ ] **Step 2: Join the root workspace**

The CLI wrote `lingoflix-server/pnpm-workspace.yaml` (with `allowBuilds`). pnpm reads `allowBuilds` only from the root workspace file, and a nested workspace file makes installs run from inside the folder (Vercel's install) write a second lockfile. Delete it:

```bash
rm lingoflix-server/pnpm-workspace.yaml
```

Replace the root `pnpm-workspace.yaml` with:

```yaml
packages:
  - lingoflix-extension
  - lingoflix-server

allowBuilds:
  sharp: false
  unrs-resolver: false
```

- [ ] **Step 3: Set the package's scripts and pinned versions**

Replace `lingoflix-server/package.json` with the following. It is the generated file with three kinds of change: `packageManager` removed (the root `package.json` already pins pnpm), versions pinned per the Global Constraints, and the `test`, `test:watch` and `compile` scripts and their dev dependencies added.

```json
{
  "name": "lingoflix-server",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "compile": "next typegen && tsc --noEmit"
  },
  "dependencies": {
    "@fontsource-variable/nunito": "5.3.0",
    "next": "16.4.0",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@tailwindcss/turbopack": "^4",
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@types/node": "^24",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "6.1.2",
    "eslint": "^9",
    "eslint-config-next": "16.4.0",
    "jsdom": "30.1.2",
    "tailwindcss": "^4",
    "typescript": "6.0.3",
    "vitest": "5.0.3"
  }
}
```

Why these versions:
- `@types/node` `^24`: Vitest 5's peer range is `^22 || >=24`, so the generated `^20` warns. Vercel also runs Node 24.
- `typescript` 6.0.3: matches the extension, and works with Next 16.4.0's `next build` and `tsc`.
- `eslint` stays `^9`: the plugins `eslint-config-next` 16.4.0 pulls in only support up to `^9`.

- [ ] **Step 4: Use the bundled Nunito font instead of Google Fonts**

The generated layout loads Geist through `next/font/google`, so `next build` would download fonts over the network. The site uses the extension's font, bundled locally. Task 5 rewrites the layout; this step only removes the network dependency.

Replace `lingoflix-server/src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/nunito";
import "./globals.css";

export const metadata: Metadata = {
  title: "LingoFlix",
  description: "Understand every line on Netflix.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
```

Replace `lingoflix-server/src/app/globals.css` with:

```css
@import "tailwindcss";

@theme {
  --font-sans: "Nunito Variable", ui-rounded, system-ui, sans-serif;
}

body {
  font-family: var(--font-sans);
}
```

- [ ] **Step 5: Install from the root**

Run: `pnpm install`
Expected:
- ends with `Done in ... using pnpm v11.20.0`;
- no `ERR_PNPM_IGNORED_BUILDS`;
- the `lingoflix-extension postinstall$ wxt prepare` lines still appear.

Run: `ls lingoflix-server/pnpm-lock.yaml lingoflix-server/pnpm-workspace.yaml`
Expected: both report `No such file or directory` (the root `pnpm-lock.yaml` is the only lockfile).

- [ ] **Step 6: Configure Vitest**

Create `lingoflix-server/vitest.config.mts`. Vite 8 resolves the tsconfig `paths` (`@/*`) natively, so the `vite-tsconfig-paths` plugin the Next.js docs mention is not needed; Vite prints a warning when it is used.

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    // Server code by default; DOM tests start with `// @vitest-environment jsdom`.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    unstubEnvs: true,
  },
});
```

- [ ] **Step 7: Write the failing test for the site constants**

Create `lingoflix-server/tests/site.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  PRICE_MONTHLY,
  PRICE_YEARLY,
  SITE_NAME,
  SITE_URL,
  SUPPORT_EMAIL,
  TRIAL_DAYS,
  chromeStoreUrl,
} from "@/lib/site";

const STORE_URL = "https://chromewebstore.google.com/detail/lingoflix/abcdefghijklmnopabcdefghijklmnop";

describe("site constants", () => {
  it("names the product, its address, its support email and its prices", () => {
    expect(SITE_NAME).toBe("LingoFlix");
    expect(SITE_URL).toBe("https://lingoflix.lipsum.fun");
    expect(SUPPORT_EMAIL).toBe("support@lingoflix.lipsum.fun");
    expect(PRICE_MONTHLY).toBe("$7.99");
    expect(PRICE_YEARLY).toBe("$59.99");
    expect(TRIAL_DAYS).toBe(7);
  });
});

describe("chromeStoreUrl", () => {
  it("is null until the store URL is set", () => {
    expect(chromeStoreUrl({})).toBeNull();
    expect(chromeStoreUrl({ NEXT_PUBLIC_CHROME_STORE_URL: "" })).toBeNull();
    expect(chromeStoreUrl({ NEXT_PUBLIC_CHROME_STORE_URL: "   " })).toBeNull();
  });

  it("is null for anything but an https Chrome Web Store link", () => {
    for (const value of [
      "http://chromewebstore.google.com/detail/lingoflix/x",
      "https://evil.example/detail/lingoflix/x",
      "https://chromewebstore.google.com.evil.example/detail/x",
      "javascript:alert(1)",
      "chromewebstore.google.com/detail/lingoflix/x",
    ]) {
      expect(chromeStoreUrl({ NEXT_PUBLIC_CHROME_STORE_URL: value })).toBeNull();
    }
  });

  it("returns a Chrome Web Store link as given", () => {
    expect(chromeStoreUrl({ NEXT_PUBLIC_CHROME_STORE_URL: STORE_URL })).toBe(STORE_URL);
  });

  it("reads NEXT_PUBLIC_CHROME_STORE_URL from the environment by default", () => {
    vi.stubEnv("NEXT_PUBLIC_CHROME_STORE_URL", STORE_URL);
    expect(chromeStoreUrl()).toBe(STORE_URL);
  });
});
```

- [ ] **Step 8: Run the test and watch it fail**

Run: `pnpm --filter lingoflix-server test`
Expected: FAIL. `tests/site.test.ts` cannot be loaded: Vite reports it cannot resolve `@/lib/site` ("Failed to resolve import \"@/lib/site\"" or "Cannot find module").

- [ ] **Step 9: Write `src/lib/site.ts`**

Create `lingoflix-server/src/lib/site.ts`:

```ts
/** Fixed facts about the LingoFlix site (spec §1, §5.3, §10). */
export const SITE_NAME = "LingoFlix";
export const SITE_URL = "https://lingoflix.lipsum.fun";
export const SUPPORT_EMAIL = "support@lingoflix.lipsum.fun";
export const PRICE_MONTHLY = "$7.99";
export const PRICE_YEARLY = "$59.99";
export const TRIAL_DAYS = 7;

const STORE_PREFIX = "https://chromewebstore.google.com/";

/**
 * The extension's Chrome Web Store page from `NEXT_PUBLIC_CHROME_STORE_URL`, or null until it is published.
 * Only an https chromewebstore.google.com link is accepted, so a typo can't send people somewhere else.
 * The default reads the variable by its full name, which Next.js also inlines into browser code.
 */
export function chromeStoreUrl(
  env: Record<string, string | undefined> = {
    NEXT_PUBLIC_CHROME_STORE_URL: process.env.NEXT_PUBLIC_CHROME_STORE_URL,
  },
): string | null {
  const value = env.NEXT_PUBLIC_CHROME_STORE_URL?.trim();
  return value && value.startsWith(STORE_PREFIX) ? value : null;
}
```

- [ ] **Step 10: Run the test and watch it pass**

Run: `pnpm --filter lingoflix-server test`
Expected: PASS, `Test Files  1 passed (1)`, `Tests  5 passed (5)`, no warnings.

- [ ] **Step 11: Type-check, lint and build with no environment**

Run: `pnpm --filter lingoflix-server compile`
Expected: `next typegen` prints that it generated route types, then `tsc --noEmit` exits 0 with no output.

Run: `pnpm --filter lingoflix-server lint`
Expected: exit 0, no errors.

Run: `env -i PATH="$PATH" HOME="$HOME" pnpm --filter lingoflix-server build`
Expected:
- `✓ Compiled successfully` and a route table listing `/`;
- exit 0;
- no network font download, because the layout no longer uses `next/font/google`.

(`env -i` runs the build with no other environment variables, the way a fresh clone without `.env` would.)

- [ ] **Step 12: Run the whole workspace**

Run: `pnpm test`
Expected:
- the extension: `Test Files  47 passed (47)`, `Tests  570 passed (570)`;
- the server: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

Run: `pnpm compile && pnpm build`
Expected: both packages type-check and build; exit 0.

- [ ] **Step 13: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml lingoflix-server
git status --short
git commit -m "feat(server): scaffold lingoflix-server with create-next-app

Generated with create-next-app 16.4.0 (App Router, src/, Tailwind,
ESLint, Cache Components off) and joined to the root pnpm workspace.
Adds Vitest, the bundled Nunito font and the site constants.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected:
- `git status --short` lists only the root `pnpm-workspace.yaml`, the root `pnpm-lock.yaml` and files under `lingoflix-server/`;
- no `node_modules`, `.next` or `next-env.d.ts`: the generated `lingoflix-server/.gitignore` ignores them.

---

### Task 2: Database: Kysely, kysely-ctl migrations and a PGlite test database

**Files:**
- Modify: `lingoflix-server/package.json` (dependencies and `db:*` scripts), `pnpm-lock.yaml`
- Create: `lingoflix-server/kysely.config.ts`
- Create: `lingoflix-server/src/db/types.ts`, `lingoflix-server/src/db/client.ts`
- Create (with `kysely migrate make`, then filled in): `lingoflix-server/src/db/migrations/<prefix>_better_auth.ts`, `lingoflix-server/src/db/migrations/<prefix>_uninstall_feedback.ts`. The `<prefix>` is the millisecond timestamp kysely-ctl generates; the plan refers to the files by suffix.
- Create: `lingoflix-server/tests/support/test-db.ts`
- Test: `lingoflix-server/tests/db.test.ts`, `lingoflix-server/tests/db-client.test.ts`

**Interfaces:**
- Consumes (Task 1): the `lingoflix-server` package, the `@/*` alias, and the Vitest config (`node` environment, `tests/**/*.test.{ts,tsx}`, `unstubEnvs: true`).
- Produces:
  - `src/db/types.ts`:
    - `export interface UninstallFeedbackTable { id: ColumnType<string, never, never>; created_at: ColumnType<Date, never, never>; reason: string; comment: string | null }`
    - `export interface Database { uninstall_feedback: UninstallFeedbackTable }`
  - `src/db/client.ts`: `export function getDb(): Kysely<Database>`. Memoized. It throws `Error("DATABASE_URL is not set")` when the variable is missing, and never connects until a query runs.
  - Migrations (applied in this order):
    - Better Auth's tables `"user"`, `"session"`, `"account"`, `"verification"`, with camelCase quoted columns, exactly what better-auth 1.7.6 expects for Google, magic link and bearer;
    - then `uninstall_feedback`.
  - `tests/support/test-db.ts`:
    - `export async function createTestDb(): Promise<Kysely<Database>>`: a fresh in-memory PGlite with every migration applied; `db.destroy()` closes it;
    - `export function createMigrator(db: Kysely<Database>): Migrator`;
    - `export const MIGRATION_FOLDER: string`.
  - Scripts `db:make` (`kysely migrate make`), `db:migrate` (`kysely migrate latest`), `db:list` (`kysely migrate list`). kysely-ctl connects through `DATABASE_URL_UNPOOLED`, falling back to `DATABASE_URL`.

Notes for the implementer:
- **Kysely 0.29 import path.** `Migrator`, `FileMigrationProvider` and `NO_MIGRATIONS` come from `kysely/migration`. Importing them from `kysely` is a type error, and they are `undefined` at runtime.
- **One statement per `sql` call.** PGlite and `pg` with parameters use the extended protocol, which rejects strings holding several statements.
- **Quoting.** `"user"` is a reserved word, and Better Auth's columns are camelCase, so both are quoted in raw SQL.
- **Bigint ids.** node-postgres returns `bigint` and `count(*)` as strings, while PGlite returns numbers. The test database installs an INT8 parser so both behave the same, and the types say `string`.
- **Direct connection for migrations.** Kysely's migration lock is a session-level advisory lock, which Neon's pooled connection can't hold. kysely-ctl therefore uses Neon's direct connection (`DATABASE_URL_UNPOOLED`), and the app uses the pooled `DATABASE_URL`.
- **Better Auth checks the live schema.** It does this at startup and keeps the result. Its tables must match exactly what it expects, so the Better Auth migration below is its own CLI's output, copied verbatim. Never change a Better Auth column here. Any column we add to its tables later must be nullable or have a default.

- [ ] **Step 1: Add the database packages**

Run:

```bash
pnpm --filter lingoflix-server add -E kysely@0.29.6 pg@8.23.0 @vercel/functions@3.9.11
pnpm --filter lingoflix-server add -D -E kysely-ctl@0.21.0 @types/pg@8.23.1 @electric-sql/pglite@0.5.8
```

Expected:
- both commands finish with `Done in ...`;
- `lingoflix-server/package.json` lists `kysely`, `pg` and `@vercel/functions` under `dependencies`, and `kysely-ctl`, `@types/pg` and `@electric-sql/pglite` under `devDependencies`;
- every version is exact (no `^`);
- no `ERR_PNPM_IGNORED_BUILDS`.

- [ ] **Step 2: Write the failing tests**

Create `lingoflix-server/tests/db.test.ts`:

```ts
import { sql, type Kysely } from "kysely";
import { NO_MIGRATIONS } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/types";
import { createMigrator, createTestDb } from "./support/test-db";

let db: Kysely<Database>;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.destroy();
});

async function tableNames(): Promise<string[]> {
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name not like 'kysely_%'
    order by table_name
  `.execute(db);
  return rows.map((row) => row.table_name);
}

async function columnNames(table: string): Promise<string[]> {
  const { rows } = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table}
    order by ordinal_position
  `.execute(db);
  return rows.map((row) => row.column_name);
}

describe("migrations", () => {
  it("create Better Auth's tables and uninstall_feedback", async () => {
    expect(await tableNames()).toEqual(["account", "session", "uninstall_feedback", "user", "verification"]);
  });

  it("give Better Auth the exact camelCase columns it checks for", async () => {
    expect(await columnNames("user")).toEqual(["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"]);
    expect(await columnNames("session")).toEqual([
      "id",
      "expiresAt",
      "token",
      "createdAt",
      "updatedAt",
      "ipAddress",
      "userAgent",
      "userId",
    ]);
    expect(await columnNames("verification")).toEqual(["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"]);
  });

  it("roll back to an empty database", async () => {
    const { error } = await createMigrator(db).migrateTo(NO_MIGRATIONS);
    expect(error).toBeUndefined();
    expect(await tableNames()).toEqual([]);
  });
});

describe("uninstall_feedback", () => {
  it("stores a reason with a generated id and time, and an optional comment", async () => {
    const bare = await db
      .insertInto("uninstall_feedback")
      .values({ reason: "not-using", comment: null })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(typeof bare.id).toBe("string");
    expect(bare.created_at).toBeInstanceOf(Date);
    expect(bare.comment).toBeNull();

    const commented = await db
      .insertInto("uninstall_feedback")
      .values({ reason: "other", comment: "Too many keys to learn." })
      .returning(["id", "comment"])
      .executeTakeFirstOrThrow();
    expect(commented.comment).toBe("Too many keys to learn.");
    expect(BigInt(commented.id)).toBeGreaterThan(BigInt(bare.id));
  });

  it("requires a reason", async () => {
    await expect(sql`insert into uninstall_feedback (comment) values ('no reason')`.execute(db)).rejects.toThrow(
      /null value in column "reason"/,
    );
  });
});
```

Create `lingoflix-server/tests/db-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

describe("getDb", () => {
  it("can be imported with no DATABASE_URL and says so only when used", async () => {
    const { getDb } = await import("@/db/client");
    expect(() => getDb()).toThrow("DATABASE_URL is not set");
  });

  it("creates the database once and reuses it, without connecting", async () => {
    // Nothing listens on port 1: creating the pool must not connect.
    process.env.DATABASE_URL = "postgres://lingoflix:secret@127.0.0.1:1/none";
    const { getDb } = await import("@/db/client");
    const db = getDb();
    expect(getDb()).toBe(db);
    await db.destroy();
  });

  it("works once DATABASE_URL is set after a failed call", async () => {
    const { getDb } = await import("@/db/client");
    expect(() => getDb()).toThrow("DATABASE_URL is not set");
    process.env.DATABASE_URL = "postgres://lingoflix:secret@127.0.0.1:1/none";
    const db = getDb();
    expect(db).toBeDefined();
    await db.destroy();
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `pnpm --filter lingoflix-server test`
Expected: FAIL.
- `tests/db.test.ts` can't load `./support/test-db` (module not found);
- `tests/db-client.test.ts` fails because `@/db/client` can't be resolved;
- `tests/site.test.ts` still passes (5 tests).

- [ ] **Step 4: Write the table types and the lazy client**

Create `lingoflix-server/src/db/types.ts`:

```ts
import type { ColumnType } from "kysely";

/** One answer from the goodbye page (spec §5.5). It holds no user id, IP or anything else. */
export interface UninstallFeedbackTable {
  /** `bigint` identity: node-postgres returns int8 as a string. */
  id: ColumnType<string, never, never>;
  created_at: ColumnType<Date, never, never>;
  reason: string;
  comment: string | null;
}

/**
 * Our tables. Better Auth's tables ("user", "session", "account", "verification") are created by our migrations
 * but read and written only by Better Auth, so they are not listed here.
 */
export interface Database {
  uninstall_feedback: UninstallFeedbackTable;
}
```

Create `lingoflix-server/src/db/client.ts`:

```ts
import { attachDatabasePool } from "@vercel/functions";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types";

let db: Kysely<Database> | null = null;

/**
 * The app's database: Neon through node-postgres, on the pooled `DATABASE_URL`.
 * Created on first use, so importing this module needs no environment (builds and tests run without one).
 */
export function getDb(): Kysely<Database> {
  if (db) return db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 5000 });
  // On Vercel (Fluid compute) idle clients are released before the function suspends; elsewhere a no-op.
  attachDatabasePool(pool);
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return db;
}
```

- [ ] **Step 5: Configure kysely-ctl**

Create `lingoflix-server/kysely.config.ts`:

```ts
import { defineConfig } from "kysely-ctl";
import { Pool } from "pg";

export default defineConfig({
  dialect: "pg",
  // A factory, so commands that need no database (`migrate make`) work without one.
  // Migrations use Neon's direct connection: its pooler can't hold Kysely's migration lock.
  dialectConfig: () => {
    const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");
    return { pool: new Pool({ connectionString }) };
  },
  migrations: {
    migrationFolder: "src/db/migrations",
  },
});
```

kysely-ctl reads `lingoflix-server/.env` automatically, but not `.env.local`. Variables exported in the shell take precedence.

Add the `db:*` scripts to `lingoflix-server/package.json`. The `scripts` block becomes:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "compile": "next typegen && tsc --noEmit",
    "db:make": "kysely migrate make",
    "db:migrate": "kysely migrate latest",
    "db:list": "kysely migrate list"
  },
```

- [ ] **Step 6: Create the two migration files with kysely-ctl**

Run, in this order:

```bash
pnpm --filter lingoflix-server db:make better_auth
pnpm --filter lingoflix-server db:make uninstall_feedback
```

Expected:
- each command prints `✔ Created migration file at .../lingoflix-server/src/db/migrations/<digits>_better_auth.ts`, then the same for `_uninstall_feedback.ts`;
- `ls lingoflix-server/src/db/migrations` lists the two files. The `better_auth` prefix is the smaller one, because migrations run in file-name order.

No database is needed for `migrate make`.

- [ ] **Step 7: Fill in the Better Auth migration**

Replace the whole content of `lingoflix-server/src/db/migrations/<prefix>_better_auth.ts`. The `up` statements are the exact output of better-auth 1.7.6's `auth generate` for the Kysely adapter on Postgres with Google, magic link and bearer (magic link and bearer add no columns):

```ts
/* eslint-disable @typescript-eslint/no-explicit-any -- migrations are frozen in time, so they don't use the app's Database type */
import { sql, type Kysely } from "kysely";

// Better Auth 1.7.6's schema for Google, magic link and bearer, as generated by its CLI (`auth generate`).
// Better Auth checks the live schema at startup, so never edit these statements: add a new migration instead.
// One statement per `sql` call: the extended query protocol rejects multi-statement strings.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`.execute(db);
  await sql`create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade)`.execute(db);
  await sql`create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null)`.execute(db);
  await sql`create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`.execute(db);
  await sql`create index "session_userId_idx" on "session" ("userId")`.execute(db);
  await sql`create index "account_userId_idx" on "account" ("userId")`.execute(db);
  await sql`create index "verification_identifier_idx" on "verification" ("identifier")`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop table if exists "verification"`.execute(db);
  await sql`drop table if exists "account"`.execute(db);
  await sql`drop table if exists "session"`.execute(db);
  await sql`drop table if exists "user"`.execute(db);
}
```

- [ ] **Step 8: Fill in the `uninstall_feedback` migration**

Replace the whole content of `lingoflix-server/src/db/migrations/<prefix>_uninstall_feedback.ts`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any -- migrations are frozen in time, so they don't use the app's Database type */
import { sql, type Kysely } from "kysely";

// Spec §5.5: the goodbye page's optional answer. Only a reason, an optional comment and when it was sent.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`create table uninstall_feedback (id bigint generated always as identity primary key, created_at timestamptz not null default now(), reason text not null, comment text)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop table if exists uninstall_feedback`.execute(db);
}
```

- [ ] **Step 9: Write the PGlite test database helper**

Create `lingoflix-server/tests/support/test-db.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import type { Database } from "@/db/types";

/** The real migrations folder (absolute, as FileMigrationProvider requires). */
export const MIGRATION_FOLDER = path.resolve(import.meta.dirname, "../../src/db/migrations");

export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: MIGRATION_FOLDER,
      // Load migrations through Vitest's transformer, not Node's strip-only TypeScript loader.
      import: (file) => import(file),
    }),
  });
}

/**
 * A fresh in-memory Postgres (PGlite) with every migration applied. `db.destroy()` also closes PGlite.
 * int8 values come back as strings, as they do through node-postgres in production.
 */
export async function createTestDb(): Promise<Kysely<Database>> {
  const pglite = await PGlite.create({ parsers: { [types.INT8]: (value: string) => value } });
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) {
    const failed = results?.find((result) => result.status === "Error");
    await db.destroy();
    throw new Error(`Migration failed: ${failed?.migrationName ?? "unknown"}`, { cause: error });
  }
  return db;
}
```

- [ ] **Step 10: Run the tests and watch them pass**

Run: `pnpm --filter lingoflix-server test`
Expected: PASS: `Test Files  3 passed (3)`, `Tests  13 passed (13)` (5 site, 5 db, 3 db-client). No warnings or stderr output.

- [ ] **Step 11: Type-check, lint, build and run the workspace**

Run: `pnpm --filter lingoflix-server compile`
Expected: exit 0, no output from `tsc`.

Run: `pnpm --filter lingoflix-server lint`
Expected: exit 0, no errors. The `no-explicit-any` rule is turned off only at the top of the two migration files.

Run: `env -i PATH="$PATH" HOME="$HOME" pnpm --filter lingoflix-server build`
Expected: `✓ Compiled successfully`, exit 0. No database or environment is needed.

Run: `pnpm test`
Expected:
- the extension: `Tests  570 passed (570)`;
- the server: `Test Files  3 passed (3)`, `Tests  13 passed (13)`.

Optional check against a real database: only if you have a Postgres URL. Never use production.

Run: `DATABASE_URL_UNPOOLED="<a scratch Postgres URL>" pnpm --filter lingoflix-server db:migrate`
Expected: `✔ Migration complete`, then `Ran 2 migrations:` listing `<prefix>_better_auth` and `<prefix>_uninstall_feedback`.

Skip it if you don't have one: the first real run happens in the deployment checklist (Task 8).

- [ ] **Step 12: Commit**

```bash
git add pnpm-lock.yaml lingoflix-server/package.json lingoflix-server/kysely.config.ts lingoflix-server/src/db lingoflix-server/tests/db.test.ts lingoflix-server/tests/db-client.test.ts lingoflix-server/tests/support/test-db.ts
git commit -m "feat(server): Kysely database, kysely-ctl migrations and a PGlite test database

Better Auth's tables (its CLI's SQL for Google, magic link and bearer) and
uninstall_feedback, applied by kysely-ctl; getDb() connects lazily so
builds and tests need no DATABASE_URL.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit; `git status --short` is clean afterwards.
### Task 3: Sign-in email (Cloudflare Email Service REST sender and the sign-in email)

**Files:**
- Create: `lingoflix-server/src/lib/email/cloudflare.ts`
- Create: `lingoflix-server/src/lib/email/sign-in-email.ts`
- Test: `lingoflix-server/tests/email/cloudflare.test.ts`
- Test: `lingoflix-server/tests/email/sign-in-email.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (Task 1's Vitest setup and the `@/` alias only).
- Produces:
  - `src/lib/email/cloudflare.ts`: `export type EmailAddress = string | { address: string; name?: string | null }`, `export interface SendEmailInput { from: EmailAddress; to: EmailAddress | EmailAddress[]; subject: string; html?: string; text?: string; reply_to?: EmailAddress; headers?: Record<string, string> }`, `export interface SendEmailResult { delivered: string[]; permanent_bounces: string[]; queued: string[]; message_id?: string; suppressed_recipients?: string[] }`, `export class CloudflareEmailError extends Error { readonly status: number; readonly errors: { code: number; message: string }[] }`, `export async function sendEmail(input: SendEmailInput, opts: { accountId: string; apiToken: string; fetch?: typeof fetch }): Promise<SendEmailResult>`.
  - `src/lib/email/sign-in-email.ts`: `export function signInEmailContent(url: string): { subject: string; text: string; html: string }`, `export function parseFrom(value: string | undefined): EmailAddress`, `export async function sendSignInEmail(to: string, url: string, deps?: { env?: Record<string, string | undefined>; fetch?: typeof fetch; log?: (message: string) => void }): Promise<void>`. Task 4 passes `sendSignInEmail` to Better Auth's magic-link plugin.

Cloudflare Email Service facts (from its docs; the service is in public beta):
- **Endpoint:** `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send` with `Authorization: Bearer <token>`. The token needs the "Email Sending: Edit" permission.
- **Body:** `from` and `subject` are required, plus `html` or `text`. A named address is `{ address, name }`.
- **Success:** `{ success: true, errors: [], messages: [], result: { delivered, permanent_bounces, queued, message_id, suppressed_recipients } }`.
- **Errors:** `{ success: false, errors: [{ code, message }], result: null }` with an HTTP 4xx/5xx status. For example, 403 with code 10102 means the token lacks permission.
- **When an email counts as sent:** only when its address appears in `delivered` or `queued`.
- **Why not the SDK:** the official `cloudflare` npm package is 69.5 MB for this one call, so we use a small `fetch` wrapper instead.

In local development the sign-in link is printed to the server console, so sign-in works without email. That happens only when there are no Cloudflare credentials and `NODE_ENV` is not `production`. The printed link is a one-time sign-in link, not a session token, and this path never runs in production, where missing credentials are an error.

- [ ] **Step 1: Write the failing test for the Cloudflare sender**

Create `lingoflix-server/tests/email/cloudflare.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter lingoflix-server exec vitest run tests/email/cloudflare.test.ts`
Expected: FAIL: `Failed to resolve import "@/lib/email/cloudflare"` (the module doesn't exist yet).

- [ ] **Step 3: Write the Cloudflare sender**

Create `lingoflix-server/src/lib/email/cloudflare.ts`:

```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter lingoflix-server exec vitest run tests/email/cloudflare.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for the sign-in email**

Create `lingoflix-server/tests/email/sign-in-email.test.ts`:

```ts
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
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter lingoflix-server exec vitest run tests/email/sign-in-email.test.ts`
Expected: FAIL: `Failed to resolve import "@/lib/email/sign-in-email"`.

- [ ] **Step 7: Write the sign-in email**

Create `lingoflix-server/src/lib/email/sign-in-email.ts`:

```ts
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
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm --filter lingoflix-server exec vitest run tests/email/sign-in-email.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 9: Run the whole server suite, the type check and lint**

Run: `pnpm --filter lingoflix-server test && pnpm --filter lingoflix-server compile && pnpm --filter lingoflix-server lint`
Expected: every test file passes, tsc exits 0, ESLint reports no problems, no warnings printed.

- [ ] **Step 10: Commit**

```bash
git add lingoflix-server/src/lib/email lingoflix-server/tests/email
git commit -m "feat(server): send sign-in emails through Cloudflare Email Service

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Better Auth (server, session helper, browser client, route, test harness)

**Files:**
- Modify: `lingoflix-server/package.json` (dependencies, `auth:check` script)
- Create: `lingoflix-server/src/lib/auth.ts`
- Create: `lingoflix-server/src/lib/auth-cli.ts`
- Create: `lingoflix-server/src/lib/session.ts`
- Create: `lingoflix-server/src/lib/auth-client.ts`
- Create: `lingoflix-server/src/app/api/auth/[...all]/route.ts`
- Create: `lingoflix-server/tests/support/test-auth.ts`
- Test: `lingoflix-server/tests/auth/auth.test.ts`
- Test: `lingoflix-server/tests/auth/env.test.ts`
- Test: `lingoflix-server/tests/auth/session.test.ts`
- Test: `lingoflix-server/tests/auth/auth-client.test.tsx`

**Interfaces:**
- Consumes: Task 2: `getDb(): Kysely<Database>` from `src/db/client.ts` (throws `DATABASE_URL is not set`), `Database` from `src/db/types.ts`, `createTestDb(): Promise<Kysely<Database>>` from `tests/support/test-db.ts` (applies every migration, including Better Auth's tables). Task 3: `sendSignInEmail(to, url)` from `src/lib/email/sign-in-email.ts`.
- Produces:
  - `src/lib/auth.ts`:
    - `export const MAGIC_LINK_EXPIRES_IN = 60 * 15`
    - `export interface AuthDeps { db: Kysely<Database>; secret: string; baseURL: string; googleClientId: string; googleClientSecret: string; extensionId: string | null; sendSignInEmail: (to: string, url: string) => Promise<void>; magicLinkExpiresIn?: number; disableOriginCheck?: boolean }`. The last two fields are for tests only. This narrows the skeleton's `Kysely<any>`, because lint forbids `any`; Better Auth accepts a typed Kysely.
    - `export function createAuth(deps: AuthDeps)`
    - `export type Auth = ReturnType<typeof createAuth>`
    - `export function getAuth(): Auth`: memoized. It throws `Missing environment variables: ...`, naming each missing one of `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
  - `src/lib/session.ts`: `export interface CurrentSession { user: { id: string; email: string; name: string }; token: string }`, `export async function getCurrentSession(): Promise<CurrentSession | null>`. Tasks 6 and 7 use it in server components.
  - `src/lib/auth-client.ts`: `export const authClient` (browser client with the magic-link plugin). Task 6 uses `authClient.signIn.magicLink`, `authClient.signIn.social` and `authClient.signOut`.
  - `src/app/api/auth/[...all]/route.ts`: `GET`, `POST`, each `getAuth().handler(request)`.
  - `tests/support/test-auth.ts`:
    - `TEST_BASE_URL = "http://localhost:3000"`
    - `TEST_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop"`
    - `TEST_EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"`
    - `interface TestAuth { auth: Auth; db: Kysely<Database>; sent: { to: string; url: string }[]; close(): Promise<void> }`
    - `createTestAuth(opts?: { magicLinkExpiresIn?: number; enforceOriginCheck?: boolean }): Promise<TestAuth>`
    - `requestMagicLink(t: TestAuth, email: string): Promise<{ to: string; url: string }>`
    - `signInWithMagicLink(t: TestAuth, email: string): Promise<{ res: Response; bearer: string | null }>`
    - `sessionCookie(res: Response): string`: the `better-auth.session_token=...` pair from `set-cookie`.

Better Auth 1.7.6 facts this task relies on (verified in a scratch project):
- **Database:** the built-in Kysely adapter takes an existing Kysely instance: `database: { db, type: "postgres" }`.
- **Schema check:** on its first request Better Auth checks the live schema. A missing table or column makes every auth request reject with `SCHEMA_MISMATCH`. The test harness runs Task 2's migrations, so it also proves the migration SQL matches what Better Auth expects.
- **Magic link:**
  - The callback is `sendMagicLink({ email, url, token, metadata }, ctx)`.
  - Links work once. Unknown, expired and already-used links all redirect to `errorCallbackURL` with `error=INVALID_TOKEN`.
  - `storeToken: "hashed"` keeps only a hash of the token in `verification`.
- **Bearer:**
  - Responses that set the session cookie also carry `set-auth-token: <token>.<signature>`.
  - `Authorization: Bearer <signed or raw session token>` authenticates; a forged signature does not.
  - `POST /api/auth/sign-out` with the bearer token deletes the session.
- **Origin check:** it only applies to requests that carry a Cookie header. Under Vitest (`NODE_ENV=test`) it is off unless `advanced.disableOriginCheck` is `false`.
- **Plugin order:** `nextCookies()` must be the last plugin.
- **CLI:** the CLI is the `auth` package at the same version (`auth check schema --config <file>`). It needs a file exporting `auth`, which is why `src/lib/auth-cli.ts` exists. Never import that file from app code.

- [ ] **Step 1: Install Better Auth and its CLI**

Run from the repo root:

```bash
pnpm --filter lingoflix-server add --save-exact better-auth@1.7.6
pnpm --filter lingoflix-server add --save-dev --save-exact auth@1.7.6
```

Expected: `lingoflix-server/package.json` lists `"better-auth": "1.7.6"` under `dependencies` and `"auth": "1.7.6"` under `devDependencies`. If pnpm stops with `ERR_PNPM_IGNORED_BUILDS` naming a package, add `<that package>: false` under `allowBuilds` in the root `pnpm-workspace.yaml` (next to `sharp` and `unrs-resolver`) and run the same command again.

Then add this script to `lingoflix-server/package.json` `scripts` (keep the others):

```json
"auth:check": "auth check schema --config src/lib/auth-cli.ts"
```

- [ ] **Step 2: Write the test harness and the failing auth tests**

Create `lingoflix-server/tests/support/test-auth.ts`:

```ts
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

/** Better Auth on a fresh in-memory Postgres with every migration applied. */
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
    disableOriginCheck: opts.enforceOriginCheck ? false : undefined,
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
```

Create `lingoflix-server/tests/auth/auth.test.ts`:

```ts
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/auth/auth.test.ts`
Expected: FAIL: `Failed to resolve import "@/lib/auth"`.

- [ ] **Step 4: Write the Better Auth server**

Create `lingoflix-server/src/lib/auth.ts`. It imports its neighbors with relative paths so the Better Auth CLI (Step 8's `auth-cli.ts`) can load it without the `@/` alias.

```ts
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
  /** Tests only: Better Auth skips its Origin check under Vitest; false turns it back on. Unset in the app. */
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

let cached: Auth | null = null;

/** The app's Better Auth, built on first use (never at import, so builds and tests need no secrets). */
export function getAuth(): Auth {
  if (cached) return cached;
  const env = process.env;
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  cached = createAuth({
    db: getDb(),
    secret: env.BETTER_AUTH_SECRET!,
    baseURL: env.BETTER_AUTH_URL!,
    googleClientId: env.GOOGLE_CLIENT_ID!,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET!,
    extensionId: env.EXTENSION_ID || null,
    sendSignInEmail: (to, url) => sendSignInEmail(to, url),
  });
  return cached;
}
```

If `tsc` rejects `db: deps.db` (`Kysely<Database>` where Better Auth's option wants its own Kysely type), keep `AuthDeps.db` as `Kysely<Database>` and widen only at that call: `database: { db: deps.db as unknown as Kysely<Record<string, never>>, type: "postgres" }`. Don't introduce `any`.

- [ ] **Step 5: Run the auth tests to verify they pass**

Run: `pnpm --filter lingoflix-server exec vitest run tests/auth/auth.test.ts`
Expected: PASS (9 tests). The expired-link test takes about 1.5 s. A `SCHEMA_MISMATCH` error here means Task 2's Better Auth migration differs from what Better Auth 1.7.6 expects: compare it with the SQL in Task 2, do not change `createAuth`.

- [ ] **Step 6: Write the failing tests for the environment, the session helper, the route and the browser client**

Create `lingoflix-server/tests/auth/env.test.ts` (Task 1's `vitest.config.mts` sets `unstubEnvs: true`, so stubbed variables reset after each test):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const VARIABLES = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "EXTENSION_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_EMAIL_TOKEN",
] as const;

function withoutEnvironment() {
  for (const name of VARIABLES) vi.stubEnv(name, "");
}

afterEach(() => {
  vi.resetModules();
});

describe("no environment", () => {
  it("importing the auth module and the auth route touches neither secrets nor the database", async () => {
    withoutEnvironment();
    // getDb() and getAuth() both throw without their variables, so any call at import would fail here.
    await expect(import("@/lib/auth")).resolves.toHaveProperty("getAuth");
    await expect(import("@/app/api/auth/[...all]/route")).resolves.toHaveProperty("POST");
    await expect(import("@/lib/session")).resolves.toHaveProperty("getCurrentSession");
  });

  it("getAuth() names every missing variable", async () => {
    withoutEnvironment();
    const { getAuth } = await import("@/lib/auth");
    expect(() => getAuth()).toThrow(
      "Missing environment variables: BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET",
    );
  });
});
```

Create `lingoflix-server/tests/auth/session.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "@/lib/auth";
import { TEST_BASE_URL, createTestAuth, signInWithMagicLink, type TestAuth } from "../support/test-auth";

const state = vi.hoisted(() => ({ auth: null as Auth | null, headers: new Headers() }));

vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAuth: () => state.auth!,
}));

const { getCurrentSession } = await import("@/lib/session");
const route = await import("@/app/api/auth/[...all]/route");

let t: TestAuth;
async function setUp() {
  t = await createTestAuth();
  state.auth = t.auth;
  state.headers = new Headers();
}
afterEach(async () => {
  await t.close();
});

describe("getCurrentSession", () => {
  it("is null when nobody is signed in", async () => {
    await setUp();
    expect(await getCurrentSession()).toBeNull();
  });

  it("returns the user and the raw session token for a signed-in request", async () => {
    await setUp();
    const { bearer } = await signInWithMagicLink(t, "learner@example.com");
    state.headers = new Headers({ authorization: `Bearer ${bearer}` });
    const session = await getCurrentSession();
    expect(session?.user.email).toBe("learner@example.com");
    expect(session?.user.id).toEqual(expect.any(String));
    expect(session?.user.name).toBe("");
    expect(bearer!.startsWith(`${session!.token}.`)).toBe(true);
  });
});

describe("the /api/auth route", () => {
  it("hands requests to Better Auth", async () => {
    await setUp();
    const { bearer } = await signInWithMagicLink(t, "learner@example.com");
    const res = await route.GET(
      new Request(`${TEST_BASE_URL}/api/auth/get-session`, { headers: { authorization: `Bearer ${bearer}` } }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { email: string } }).user.email).toBe("learner@example.com");
  });
});
```

Create `lingoflix-server/tests/auth/auth-client.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { authClient } from "@/lib/auth-client";

describe("authClient", () => {
  it("offers the sign-in methods and sign-out the pages use", () => {
    expect(typeof authClient.signIn.magicLink).toBe("function");
    expect(typeof authClient.signIn.social).toBe("function");
    expect(typeof authClient.signOut).toBe("function");
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/auth/env.test.ts tests/auth/session.test.ts tests/auth/auth-client.test.tsx`
Expected: FAIL. `env.test.ts` and `session.test.ts` fail to resolve `@/app/api/auth/[...all]/route` and `@/lib/session`, and `auth-client.test.tsx` fails to resolve `@/lib/auth-client`.

- [ ] **Step 8: Write the session helper, the route, the browser client and the CLI entry**

Create `lingoflix-server/src/lib/session.ts`:

```ts
import { headers } from "next/headers";
import { getAuth } from "./auth";

export interface CurrentSession {
  user: { id: string; email: string; name: string };
  /** The raw session token: what /connect hands to the extension (spec §7.3). Never log it. */
  token: string;
}

/** The signed-in learner for this request (server components and route handlers), or null. */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  // headers() first: it marks the page dynamic before Better Auth (and its environment) is touched.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  return {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    token: session.session.token,
  };
}
```

Create `lingoflix-server/src/app/api/auth/[...all]/route.ts`:

```ts
import { getAuth } from "@/lib/auth";

// Better Auth's endpoints (spec §5.4). getAuth() runs per request, never at import, so builds need no secrets.

export async function GET(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export async function POST(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
```

Create `lingoflix-server/src/lib/auth-client.ts`:

```ts
"use client";

import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Sign-in from the site's pages; same origin as /api/auth, so no baseURL is needed. */
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
```

Create `lingoflix-server/src/lib/auth-cli.ts`:

```ts
import { getAuth } from "./auth";

// Only for the Better Auth CLI (`pnpm --filter lingoflix-server auth:check`), which needs a module exporting
// `auth`. It builds the real auth from the environment at import, so never import this file from app code.
export const auth = getAuth();
```

- [ ] **Step 9: Run them to verify they pass**

Run: `pnpm --filter lingoflix-server exec vitest run tests/auth`
Expected: PASS (4 files, 15 tests).

- [ ] **Step 10: Run the whole server suite, the type check, lint and a build with no environment**

Run: `pnpm --filter lingoflix-server test && pnpm --filter lingoflix-server compile && pnpm --filter lingoflix-server lint && pnpm --filter lingoflix-server build`
Expected:
- Every test file passes, with no warnings in the test output.
- tsc exits 0.
- ESLint reports no problems.
- `next build` succeeds with no `.env` file and no exported variables, and lists `ƒ /api/auth/[...all]`.

- [ ] **Step 11: Commit**

```bash
git add lingoflix-server/package.json pnpm-lock.yaml pnpm-workspace.yaml lingoflix-server/src/lib/auth.ts lingoflix-server/src/lib/auth-cli.ts lingoflix-server/src/lib/session.ts lingoflix-server/src/lib/auth-client.ts "lingoflix-server/src/app/api/auth/[...all]/route.ts" lingoflix-server/tests/support/test-auth.ts lingoflix-server/tests/auth
git commit -m "feat(server): Better Auth with Google, sign-in links and bearer tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 5: Site shell and public pages

**Files:**
- Create: `lingoflix-server/public/icon.svg` (copied from `lingoflix-extension/src/assets/icon.svg`)
- Create: `lingoflix-server/src/components/LogoMark.tsx`, `lingoflix-server/src/components/styles.ts`, `lingoflix-server/src/components/SiteHeader.tsx`, `lingoflix-server/src/components/SiteFooter.tsx`, `lingoflix-server/src/components/Pricing.tsx`, `lingoflix-server/src/components/AddToChrome.tsx`
- Create: `lingoflix-server/src/app/welcome/page.tsx`, `lingoflix-server/src/app/privacy/page.tsx`, `lingoflix-server/src/app/terms/page.tsx`
- Modify (replace whole file): `lingoflix-server/src/app/layout.tsx`, `lingoflix-server/src/app/globals.css`, `lingoflix-server/src/app/page.tsx`
- Delete: `lingoflix-server/public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`, `lingoflix-server/src/app/favicon.ico`
- Test: `lingoflix-server/tests/pages/site-shell.test.tsx`, `lingoflix-server/tests/pages/public-pages.test.tsx`

**Interfaces:**
- Consumes (Task 1): `SITE_URL`, `SUPPORT_EMAIL`, `PRICE_MONTHLY`, `PRICE_YEARLY`, `TRIAL_DAYS` and `chromeStoreUrl(env?)` from `@/lib/site`. Its default reads `process.env.NEXT_PUBLIC_CHROME_STORE_URL` at call time. `@fontsource-variable/nunito` 5.3.0 is already a dependency.
- Produces:
  - `SiteHeader()`, `SiteFooter()`, `Pricing()`: no props, from `@/components/SiteHeader`, `@/components/SiteFooter` and `@/components/Pricing`.
  - `AddToChrome(props: { storeUrl: string | null })` from `@/components/AddToChrome`.
  - `LogoMark(props: { className?: string })` from `@/components/LogoMark`: the logo drawn inline. `public/icon.svg` is the favicon.
  - `primaryButton`, `secondaryButton`: class strings from `@/components/styles`. Tasks 6 and 7 use them for buttons and button-like links.
  - Pages `/`, `/welcome`, `/privacy` and `/terms`: synchronous default exports with no data fetching, so they render in Vitest. The pricing section on `/` has the id `pricing`.

Code style is the scaffold's: double quotes and semicolons. Page copy is a first draft for the learner to review before release (spec §10), and must not contain em dashes. `vitest.config.mts` has `unstubEnvs: true`, so `vi.stubEnv` is undone after each test.

- [ ] **Step 1: Swap the scaffold's demo assets for the LingoFlix icon**

```bash
cd /Users/jay/Codes/jaycho1214/lingoflix
cp lingoflix-extension/src/assets/icon.svg lingoflix-server/public/icon.svg
rm -f lingoflix-server/public/file.svg lingoflix-server/public/globe.svg lingoflix-server/public/next.svg \
  lingoflix-server/public/vercel.svg lingoflix-server/public/window.svg lingoflix-server/src/app/favicon.ico
ls lingoflix-server/public
```
Expected: `icon.svg` is the only file listed.

- [ ] **Step 2: Write the failing shell test**

Create `lingoflix-server/tests/pages/site-shell.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AddToChrome } from "@/components/AddToChrome";
import { Pricing } from "@/components/Pricing";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

afterEach(cleanup);

const EM_DASH = /\u2014/;
const STORE_URL = "https://chromewebstore.google.com/detail/lingoflix/abcdefghijklmnopabcdefghijklmnop";

describe("SiteHeader", () => {
  it("links home, pricing and the account page", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "LingoFlix" }).getAttribute("href")).toBe("/");
    expect(within(nav).getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/#pricing");
    expect(within(nav).getByRole("link", { name: "Account" }).getAttribute("href")).toBe("/account");
  });
});

describe("SiteFooter", () => {
  it("has the legal links, the Netflix disclaimer and the copyright line", () => {
    render(<SiteFooter />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    expect(within(nav).getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
    expect(within(nav).getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
    expect(within(nav).getByRole("link", { name: "Account" }).getAttribute("href")).toBe("/account");
    expect(screen.getByText("Not affiliated with or endorsed by Netflix.")).toBeTruthy();
    expect(screen.getByText("© 2026 LingoFlix")).toBeTruthy();
  });
});

describe("Pricing", () => {
  it("shows both prices, the trial, what Premium includes and the trial button", () => {
    render(<Pricing />);
    const section = screen.getByRole("region", { name: "LingoFlix Premium" });
    expect(section.id).toBe("pricing");
    expect(within(section).getByText("7 days free, then $7.99/month or $59.99/year.")).toBeTruthy();
    for (const item of [
      "Hover any line for an explanation that fits the scene",
      "Ask follow-up questions about any line",
      "Save suggestions for words, phrases, idioms and whole lines",
      "Anki and CSV export of your Study Log",
    ]) {
      expect(within(section).getByText(item)).toBeTruthy();
    }
    const trial = within(section).getByRole("link", { name: "Start your 7-day free trial" });
    expect(trial.getAttribute("href")).toBe("/upgrade");
    expect(within(section).getByText("Cancel any time before the trial ends and you won't be charged.")).toBeTruthy();
  });
});

describe("AddToChrome", () => {
  it("links to the Chrome Web Store listing when there is one", () => {
    render(<AddToChrome storeUrl={STORE_URL} />);
    expect(screen.getByRole("link", { name: "Add to Chrome" }).getAttribute("href")).toBe(STORE_URL);
  });

  it("says it is coming soon when there is no listing yet", () => {
    render(<AddToChrome storeUrl={null} />);
    expect(screen.queryByRole("link", { name: "Add to Chrome" })).toBeNull();
    expect(screen.getByText("Coming soon to the Chrome Web Store")).toBeTruthy();
  });
});

describe("copy", () => {
  it("has no em dashes", () => {
    render(
      <>
        <SiteHeader />
        <Pricing />
        <AddToChrome storeUrl={null} />
        <SiteFooter />
      </>,
    );
    expect(document.body.textContent).not.toMatch(EM_DASH);
  });
});
```

- [ ] **Step 3: Write the failing pages test**

Create `lingoflix-server/tests/pages/public-pages.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import WelcomePage from "@/app/welcome/page";

afterEach(cleanup);

const EM_DASH = /\u2014/;
const STORE_URL = "https://chromewebstore.google.com/detail/lingoflix/abcdefghijklmnopabcdefghijklmnop";

const cellsOf = (rowName: RegExp) =>
  within(screen.getByRole("row", { name: rowName }))
    .getAllByRole("cell")
    .map((cell) => cell.textContent);

describe("home page", () => {
  it("leads with what LingoFlix does", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Understand every line on Netflix" })).toBeTruthy();
    for (const feature of ["Explain any line", "Save what you learn", "Line by line", "Voice shadowing", "Study reminders"]) {
      expect(screen.getByRole("heading", { level: 3, name: feature })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "See pricing" }).getAttribute("href")).toBe("#pricing");
  });

  it("compares Free and Premium as spec §3 does", () => {
    render(<HomePage />);
    expect(screen.getByRole("table", { name: "Free and Premium" })).toBeTruthy();
    expect(cellsOf(/Shortcuts, line navigation and the subtitle toggle/)).toEqual(["Yes", "Yes"]);
    expect(cellsOf(/Voice shadowing/)).toEqual(["Yes", "Yes"]);
    expect(cellsOf(/Study reminders/)).toEqual(["Yes", "Yes"]);
    expect(cellsOf(/Study Log: browse, search, open and delete/)).toEqual(["Yes", "Yes"]);
    expect(cellsOf(/Save this line/)).toEqual(["Yes", "Yes"]);
    expect(cellsOf(/Full backup and import/)).toEqual(["Yes", "Yes"]);
    expect(cellsOf(/AI explanations, follow-ups and save suggestions/)).toEqual(["No", "Yes"]);
    expect(cellsOf(/Anki and CSV export/)).toEqual(["No", "Yes"]);
  });

  it("includes the pricing section", () => {
    render(<HomePage />);
    expect(screen.getByRole("region", { name: "LingoFlix Premium" })).toBeTruthy();
  });

  it("shows Add to Chrome when the store listing URL is set", () => {
    vi.stubEnv("NEXT_PUBLIC_CHROME_STORE_URL", STORE_URL);
    render(<HomePage />);
    expect(screen.getByRole("link", { name: "Add to Chrome" }).getAttribute("href")).toBe(STORE_URL);
  });

  it.each(["", "https://evil.example/lingoflix"])("shows the coming-soon label when the store URL is %j", (value) => {
    vi.stubEnv("NEXT_PUBLIC_CHROME_STORE_URL", value);
    render(<HomePage />);
    expect(screen.queryByRole("link", { name: "Add to Chrome" })).toBeNull();
    expect(screen.getByText("Coming soon to the Chrome Web Store")).toBeTruthy();
  });
});

describe("welcome page", () => {
  it("thanks the learner and lists the main shortcuts", () => {
    render(<WelcomePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Thanks for installing LingoFlix" })).toBeTruthy();
    const table = screen.getByRole("table", { name: "Main shortcuts" });
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => [within(row).getByRole("rowheader").textContent, within(row).getByRole("cell").textContent]);
    expect(rows).toEqual([
      ["Explain the current line", "E"],
      ["Go to the previous or next line", "A / D"],
      ["Replay the current line", "R"],
      ["Hide or show subtitles", "C"],
      ["Save the line to your Study Log", "B"],
    ]);
  });

  it("offers the trial and sign-in", () => {
    render(<WelcomePage />);
    expect(screen.getByRole("link", { name: "Start your 7-day free trial" }).getAttribute("href")).toBe("/upgrade");
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in?next=%2Fconnect");
  });
});

describe("privacy policy", () => {
  it("says what the server receives, that it keeps none of the text, and who helps run it", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeTruthy();
    expect(screen.getByText("Last updated: October 10, 2026")).toBeTruthy();
    expect(screen.getByText(/Our server passes this to Anthropic to write the answer and does not keep it\./)).toBeTruthy();
    expect(screen.getByText(/Never the subtitle text, your questions or the answers\./)).toBeTruthy();
    for (const service of ["Anthropic", "Stripe", "Vercel", "Neon", "Cloudflare"]) {
      expect(screen.getByText(service, { selector: "strong" })).toBeTruthy();
    }
    expect(screen.getByText(/we store your answer with the time and nothing else/)).toBeTruthy();
    const contact = screen.getByRole("link", { name: "support@lingoflix.lipsum.fun" });
    expect(contact.getAttribute("href")).toBe("mailto:support@lingoflix.lipsum.fun");
  });
});

describe("terms of service", () => {
  it("states the plan, the trial, cancellation, refunds and fair use", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Terms of service" })).toBeTruthy();
    expect(screen.getByText(/\$7\.99\/month or \$59\.99\/year/)).toBeTruthy();
    expect(screen.getByText(/Unless you cancel before the trial ends, your subscription starts and you're charged\./)).toBeTruthy();
    expect(screen.getByText("Uninstalling the extension doesn't cancel your subscription.")).toBeTruthy();
    expect(screen.getByText("If you were charged and didn't use Premium, email us within 14 days and we'll refund you.")).toBeTruthy();
    expect(
      screen.getByText("After heavy use in a billing period, answers may come from a faster model until your next billing date."),
    ).toBeTruthy();
    expect(screen.getByText("LingoFlix is not affiliated with or endorsed by Netflix.")).toBeTruthy();
  });
});

describe("copy", () => {
  it.each([
    ["home", HomePage],
    ["welcome", WelcomePage],
    ["privacy", PrivacyPage],
    ["terms", TermsPage],
  ])("the %s page has no em dashes", (_name, Page) => {
    render(<Page />);
    expect(document.body.textContent).not.toMatch(EM_DASH);
  });
});
```

- [ ] **Step 4: Run both tests to verify they fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/pages`
Expected: FAIL. Both files error with `Failed to resolve import "@/components/AddToChrome"` (and `"@/app/privacy/page"`), and no tests run.

- [ ] **Step 5: Replace the global styles**

Replace `lingoflix-server/src/app/globals.css` with:

```css
@import "tailwindcss";

/* LingoFlix look (matches the extension): Popcorn yellow, Nunito, 2px borders. Light only for now. */
:root {
  --lf-page: #ffffff;
  --lf-card: #ffffff;
  --lf-soft: #f7f7f7;
  --lf-line: #e5e5e5;
  --lf-ink: #3c3c3c;
  --lf-mute: #6b6b6b;
  --lf-tint: #fff7d6;
  --lf-tint-line: #ffd84d;
  --lf-brand: #ffc800;
  --lf-brand-edge: #e0a800;
  --lf-on-brand: #3a2e00;
  --lf-danger: #c62828;
  --lf-focus: #3a2e00;
}

@theme inline {
  --color-page: var(--lf-page);
  --color-card: var(--lf-card);
  --color-soft: var(--lf-soft);
  --color-line: var(--lf-line);
  --color-ink: var(--lf-ink);
  --color-mute: var(--lf-mute);
  --color-tint: var(--lf-tint);
  --color-tint-line: var(--lf-tint-line);
  --color-brand: var(--lf-brand);
  --color-brand-edge: var(--lf-brand-edge);
  --color-on-brand: var(--lf-on-brand);
  --color-danger: var(--lf-danger);
  --font-sans: "Nunito Variable", ui-rounded, system-ui, sans-serif;
}

@layer base {
  body {
    @apply bg-page font-sans text-ink antialiased;
  }
  :focus-visible {
    outline: 2px solid var(--lf-focus);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 6: Write the shared components**

Create `lingoflix-server/src/components/styles.ts`:

```ts
/** Button looks shared by links and buttons (the extension's pressable Popcorn style). */
export const primaryButton =
  "inline-flex items-center justify-center rounded-2xl bg-brand px-5 py-3 font-extrabold text-on-brand shadow-[0_4px_0_var(--lf-brand-edge)] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButton =
  "inline-flex items-center justify-center rounded-2xl border-2 border-line bg-card px-5 py-3 font-extrabold text-ink shadow-[0_3px_0_var(--lf-line)] hover:bg-soft disabled:cursor-not-allowed disabled:opacity-60";
```

Create `lingoflix-server/src/components/LogoMark.tsx`:

```tsx
/** The LingoFlix mark (same paths as public/icon.svg), drawn inline so it needs no image request. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path d="M7 4h18a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H15l-6 5v-5H7a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5z" fill="#ffc800" />
      <path d="M13.5 9.5v9l7.5-4.5z" fill="#3a2e00" />
    </svg>
  );
}
```

Create `lingoflix-server/src/components/SiteHeader.tsx`:

```tsx
import Link from "next/link";
import { LogoMark } from "./LogoMark";

export function SiteHeader() {
  return (
    <header className="border-b-2 border-line">
      <nav aria-label="Main" className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-xl font-black">
          <LogoMark className="size-8" />
          LingoFlix
        </Link>
        <div className="flex items-center gap-5 text-sm font-extrabold">
          <Link href="/#pricing" className="hover:underline">
            Pricing
          </Link>
          <Link href="/account" className="hover:underline">
            Account
          </Link>
        </div>
      </nav>
    </header>
  );
}
```

Create `lingoflix-server/src/components/SiteFooter.tsx`:

```tsx
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t-2 border-line">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <nav aria-label="Footer" className="flex gap-4 font-bold">
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
          <Link href="/account" className="hover:underline">
            Account
          </Link>
        </nav>
        <p>Not affiliated with or endorsed by Netflix.</p>
        <p>© 2026 LingoFlix</p>
      </div>
    </footer>
  );
}
```

Create `lingoflix-server/src/components/AddToChrome.tsx`:

```tsx
import { primaryButton } from "./styles";

/** The store button. Until the listing exists (no URL), a plain "coming soon" label instead of a dead link. */
export function AddToChrome({ storeUrl }: { storeUrl: string | null }) {
  if (!storeUrl) {
    return (
      <span className="inline-flex items-center rounded-2xl border-2 border-line px-5 py-3 font-extrabold text-mute">
        Coming soon to the Chrome Web Store
      </span>
    );
  }
  return (
    <a href={storeUrl} className={primaryButton}>
      Add to Chrome
    </a>
  );
}
```

Create `lingoflix-server/src/components/Pricing.tsx`:

```tsx
import Link from "next/link";
import { PRICE_MONTHLY, PRICE_YEARLY, TRIAL_DAYS } from "@/lib/site";
import { primaryButton } from "./styles";

const PREMIUM_INCLUDES = [
  "Hover any line for an explanation that fits the scene",
  "Ask follow-up questions about any line",
  "Save suggestions for words, phrases, idioms and whole lines",
  "Anki and CSV export of your Study Log",
];

export function Pricing() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="rounded-3xl border-2 border-tint-line bg-tint px-6 py-8 sm:px-10"
    >
      <h2 id="pricing-heading" className="text-3xl font-black">
        LingoFlix Premium
      </h2>
      <p className="mt-2 text-lg font-bold">{`${TRIAL_DAYS} days free, then ${PRICE_MONTHLY}/month or ${PRICE_YEARLY}/year.`}</p>
      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {PREMIUM_INCLUDES.map((item) => (
          <li key={item} className="rounded-xl bg-card px-4 py-3 font-semibold">
            {item}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link href="/upgrade" className={primaryButton}>
          {`Start your ${TRIAL_DAYS}-day free trial`}
        </Link>
        <p className="text-sm text-mute">{"Cancel any time before the trial ends and you won't be charged."}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Replace the layout**

Replace `lingoflix-server/src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/nunito";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "LingoFlix: Understand every line on Netflix", template: "%s · LingoFlix" },
  description: "Hover any Netflix subtitle to understand it, save what you learn, and practice line by line.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
```

- [ ] **Step 8: Write the four public pages**

Replace `lingoflix-server/src/app/page.tsx` with:

```tsx
import { AddToChrome } from "@/components/AddToChrome";
import { Pricing } from "@/components/Pricing";
import { secondaryButton } from "@/components/styles";
import { chromeStoreUrl } from "@/lib/site";

const FEATURES = [
  {
    title: "Explain any line",
    body: "Hover a subtitle or press E. LingoFlix explains what it means in this scene, the key expressions, and how to use them.",
  },
  {
    title: "Save what you learn",
    body: "Keep words, phrases, idioms and whole lines in your Study Log, organized by show, season and episode.",
  },
  {
    title: "Line by line",
    body: "Jump to the previous or next line, replay the current one, or hide subtitles to test your ears.",
  },
  {
    title: "Voice shadowing",
    body: "Coming soon: record yourself saying a line and compare it with the original. Your recording never leaves your computer.",
  },
  {
    title: "Study reminders",
    body: "Pick the days and a time, and LingoFlix reminds you to study with Netflix.",
  },
];

/** Spec §3, row by row: [feature, Free, Premium]. */
const PLAN_ROWS: [string, string, string][] = [
  ["Shortcuts, line navigation and the subtitle toggle", "Yes", "Yes"],
  ["Voice shadowing (coming soon)", "Yes", "Yes"],
  ["Study reminders", "Yes", "Yes"],
  ["Study Log: browse, search, open and delete", "Yes", "Yes"],
  ["Save this line", "Yes", "Yes"],
  ["Full backup and import", "Yes", "Yes"],
  ["AI explanations, follow-ups and save suggestions", "No", "Yes"],
  ["Anki and CSV export", "No", "Yes"],
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-14">
      <section className="flex flex-col items-start gap-5">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Understand every line on Netflix</h1>
        <p className="max-w-2xl text-lg text-mute">
          LingoFlix is a Chrome extension for learning languages with the shows you already watch.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <AddToChrome storeUrl={chromeStoreUrl()} />
          <a href="#pricing" className={secondaryButton}>
            See pricing
          </a>
        </div>
      </section>

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="text-2xl font-black">
          What LingoFlix does
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="rounded-2xl border-2 border-line px-5 py-4">
              <h3 className="text-lg font-extrabold">{feature.title}</h3>
              <p className="mt-1 text-mute">{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="text-2xl font-black">
          Free and Premium
        </h2>
        <table className="mt-5 w-full border-collapse text-left">
          <caption className="sr-only">Free and Premium</caption>
          <thead>
            <tr className="border-b-2 border-line">
              <th scope="col" className="py-2 pr-4">
                Feature
              </th>
              <th scope="col" className="py-2 pr-4">
                Free
              </th>
              <th scope="col" className="py-2">
                Premium
              </th>
            </tr>
          </thead>
          <tbody>
            {PLAN_ROWS.map(([feature, free, premium]) => (
              <tr key={feature} className="border-b border-line">
                <th scope="row" className="py-2 pr-4 font-semibold">
                  {feature}
                </th>
                <td className="py-2 pr-4">{free}</td>
                <td className="py-2">{premium}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Pricing />
    </div>
  );
}
```

Create `lingoflix-server/src/app/welcome/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { primaryButton, secondaryButton } from "@/components/styles";
import { TRIAL_DAYS } from "@/lib/site";

export const metadata: Metadata = { title: "Welcome" };

const SHORTCUTS: [string, string][] = [
  ["Explain the current line", "E"],
  ["Go to the previous or next line", "A / D"],
  ["Replay the current line", "R"],
  ["Hide or show subtitles", "C"],
  ["Save the line to your Study Log", "B"],
];

export default function WelcomePage() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-4xl font-black tracking-tight">Thanks for installing LingoFlix</h1>
        <p className="max-w-2xl text-lg text-mute">Open any show on Netflix, turn on subtitles, and try these keys.</p>
      </section>

      <section aria-labelledby="shortcuts-heading">
        <h2 id="shortcuts-heading" className="text-2xl font-black">
          Main shortcuts
        </h2>
        <table className="mt-4 w-full max-w-xl border-collapse text-left">
          <caption className="sr-only">Main shortcuts</caption>
          <thead>
            <tr className="border-b-2 border-line">
              <th scope="col" className="py-2 pr-4">
                Action
              </th>
              <th scope="col" className="py-2">
                Key
              </th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map(([action, key]) => (
              <tr key={action} className="border-b border-line">
                <th scope="row" className="py-2 pr-4 font-semibold">
                  {action}
                </th>
                <td className="py-2">
                  <kbd className="rounded-lg border-2 border-b-4 border-line px-2 py-0.5 font-black">{key}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-mute">{"You can change every key in LingoFlix's settings."}</p>
      </section>

      <section aria-labelledby="premium-heading" className="rounded-3xl border-2 border-tint-line bg-tint px-6 py-8">
        <h2 id="premium-heading" className="text-2xl font-black">
          Explanations are part of Premium
        </h2>
        <p className="mt-2 font-semibold">{`Try every Premium feature free for ${TRIAL_DAYS} days.`}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/upgrade" className={primaryButton}>
            {`Start your ${TRIAL_DAYS}-day free trial`}
          </Link>
          <Link href="/sign-in?next=%2Fconnect" className={secondaryButton}>
            Sign in
          </Link>
        </div>
      </section>
    </div>
  );
}
```

Create `lingoflix-server/src/app/privacy/page.tsx`:

```tsx
import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy policy" };

const SERVICES: [string, string][] = [
  ["Anthropic", "writes the explanations and answers."],
  ["Stripe", "handles payments. We never see your card number."],
  ["Vercel", "runs our website and server."],
  ["Neon", "hosts our database."],
  ["Cloudflare", "sends the sign-in emails."],
];

export default function PrivacyPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6 leading-relaxed">
      <header>
        <h1 className="text-4xl font-black tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-sm text-mute">Last updated: October 10, 2026</p>
      </header>

      <p>LingoFlix keeps as little as it can. Your Study Log, settings and reminders stay on your computer.</p>

      <section>
        <h2 className="text-2xl font-black">What stays on your computer</h2>
        <ul className="mt-2 list-disc pl-6">
          <li>Your Study Log: saved words, phrases, idioms and lines, and the explanations you asked for.</li>
          <li>Your settings, including your shortcuts.</li>
          <li>Your reminder settings and, while reminders are on, the date you last watched and that show.</li>
        </ul>
        <p className="mt-2">{"The free features work without an account and don't send anything to our server."}</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">What our server receives</h2>
        <p className="mt-2">
          Only when you use a Premium feature (asking for an explanation or a follow-up), the extension sends our server
          the subtitle line, the dialogue around it, the show and episode, the earlier lines of the episode if &quot;Send
          the story so far&quot; is on, and a list of your recent saved items and explained lines. Our server passes this
          to Anthropic to write the answer and does not keep it.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">What we keep</h2>
        <ul className="mt-2 list-disc pl-6">
          <li>Your account: your email address and how you sign in (Google or an email link).</li>
          <li>
            While you're signed in: the IP address and browser of each sign-in, to keep your account secure. Signing out
            removes them.
          </li>
          <li>If you sign in with Google: your name, profile picture and the sign-in tokens Google gives us.</li>
          <li>Your subscription status, which Stripe sends us.</li>
          <li>
            For each AI answer: when it was made, what kind it was, which AI model wrote it, and how many tokens it used.
            Never the subtitle text, your questions or the answers.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-black">Services we use</h2>
        <ul className="mt-2 list-disc pl-6">
          {SERVICES.map(([name, role]) => (
            <li key={name}>
              <strong>{name}</strong> {role}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-black">When you uninstall</h2>
        <p className="mt-2">
          {
            "If you answer the optional question on the goodbye page, we store your answer with the time and nothing else: no account, no IP address. Uninstalling doesn't delete your account; email us and we will."
          }
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Contact</h2>
        <p className="mt-2">
          Questions, or want your account deleted? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </article>
  );
}
```

Create `lingoflix-server/src/app/terms/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PRICE_MONTHLY, PRICE_YEARLY, SUPPORT_EMAIL, TRIAL_DAYS } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6 leading-relaxed">
      <header>
        <h1 className="text-4xl font-black tracking-tight">Terms of service</h1>
        <p className="mt-2 text-sm text-mute">Last updated: October 10, 2026</p>
      </header>

      <section>
        <h2 className="text-2xl font-black">LingoFlix Premium</h2>
        <p className="mt-2">
          {`Premium costs ${PRICE_MONTHLY}/month or ${PRICE_YEARLY}/year, billed by Stripe in US dollars. It includes AI explanations, follow-up questions, save suggestions, and Anki and CSV export.`}
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Free trial</h2>
        <p className="mt-2">
          {`New accounts can try Premium free for ${TRIAL_DAYS} days, once per account. You enter a card when the trial starts. Unless you cancel before the trial ends, your subscription starts and you're charged.`}
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Renewal and cancellation</h2>
        <p className="mt-2">
          Your plan renews automatically each month or year. You can cancel any time from your account page (Manage
          subscription), and Premium stays on until the end of the period you paid for.
        </p>
        <p className="mt-2">{"Uninstalling the extension doesn't cancel your subscription."}</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Refunds</h2>
        <p className="mt-2">{"If you were charged and didn't use Premium, email us within 14 days and we'll refund you."}</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Fair use</h2>
        <p className="mt-2">
          After heavy use in a billing period, answers may come from a faster model until your next billing date.
        </p>
        <p className="mt-2">To keep LingoFlix working for everyone, there is also a daily limit on AI answers.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">AI answers</h2>
        <p className="mt-2">
          Explanations are written by AI and can be wrong. Use them to learn, not as a professional translation.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Netflix</h2>
        <p className="mt-2">LingoFlix is not affiliated with or endorsed by Netflix.</p>
        <p className="mt-2">You need your own Netflix subscription to use LingoFlix.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Changes and contact</h2>
        <p className="mt-2">We may update these terms. The new version will be posted here with its date.</p>
        <p className="mt-2">
          Questions? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </article>
  );
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter lingoflix-server exec vitest run tests/pages`
Expected: PASS. 2 files, 20 tests (site-shell 6, public-pages 14), with no warnings.

- [ ] **Step 10: Lint, type-check, build and run the whole suite**

Run: `pnpm --filter lingoflix-server lint`
Expected: exits 0 with no errors or warnings.

Run: `pnpm --filter lingoflix-server compile && pnpm --filter lingoflix-server build`
Expected:
- tsc exits 0;
- `next build` succeeds with no environment variables set;
- the route list shows `○ /`, `○ /privacy`, `○ /terms` and `○ /welcome` (static).

Run: `pnpm --filter lingoflix-server test`
Expected: every test file passes.

- [ ] **Step 11: Commit**

```bash
cd /Users/jay/Codes/jaycho1214/lingoflix
git add -A lingoflix-server/public lingoflix-server/src lingoflix-server/tests/pages
git commit -m "feat(server): site shell and the home, welcome, privacy and terms pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sign-in, account and upgrade

**Files:**
- Create: `lingoflix-server/src/lib/safe-next.ts`, `lingoflix-server/src/lib/upgrade.ts`
- Create: `lingoflix-server/src/app/sign-in/page.tsx`, `lingoflix-server/src/app/sign-in/SignInForm.tsx`
- Create: `lingoflix-server/src/app/account/page.tsx`, `lingoflix-server/src/app/account/AccountSummary.tsx`, `lingoflix-server/src/app/account/SignOutButton.tsx`
- Create: `lingoflix-server/src/app/upgrade/page.tsx`
- Test: `lingoflix-server/tests/lib/safe-next.test.ts`, `lingoflix-server/tests/lib/upgrade.test.ts`, `lingoflix-server/tests/sign-in/sign-in-form.test.tsx`, `lingoflix-server/tests/account/account.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1: `SITE_URL` from `@/lib/site`.
  - Task 4: `getCurrentSession(): Promise<CurrentSession | null>` and `type CurrentSession` from `@/lib/session`; `authClient` from `@/lib/auth-client` (`authClient.signIn.magicLink`, `authClient.signIn.social`, `authClient.signOut`).
  - Task 5: `primaryButton` and `secondaryButton` from `@/components/styles`.
- Produces (as fixed in the plan's Interfaces):
  - `safeNextPath(value: string | null | undefined, fallback = "/account"): string` and `upgradeDestination(session: CurrentSession | null): string`.
  - `SignInForm(props: { next: string; initialError: string | null; client?: SignInClient })` and `interface SignInClient`.
  - `SignOutButton(props: { signOut?: () => Promise<unknown>; navigate?: (url: string) => void })`. `navigate` is an optional addition so tests don't have to replace `window.location`; it defaults to `window.location.assign`.
  - `AccountSummary(props: { email: string })`: the account details. Plan 2 extends it with the real plan status.
  - Pages `/sign-in`, `/account` and `/upgrade`, all with `export const dynamic = "force-dynamic"` (allowed because Cache Components is off). That keeps `next build` from trying to prerender a page that reads the session.

For now `/upgrade` sends signed-in learners to `/account`. Plan 2 changes `upgradeDestination` so free accounts go to Stripe Checkout.

- [ ] **Step 1: Write the failing tests for the two helpers**

Create `lingoflix-server/tests/lib/safe-next.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next";
import { SITE_URL } from "@/lib/site";

describe("safeNextPath", () => {
  it.each(["/connect", "/account", "/upgrade", "/account?tab=billing", "/sign-in?next=%2Fupgrade", "/"])(
    "keeps the same-site path %s",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    ["a protocol-relative URL", "//evil.com"],
    ["an absolute URL", "https://evil.com"],
    ["a backslash right after the slash", "/\\evil.com"],
    ["a backslash later in the path", "/account\\..\\evil"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a tab that browsers strip into //", "/\t/evil.com"],
    ["a newline", "/account\nSet-Cookie: x=1"],
    ["an empty string", ""],
    ["a path without a leading slash", "account"],
  ])("falls back to /account for %s", (_label, value) => {
    expect(safeNextPath(value)).toBe("/account");
  });

  it("falls back for null and undefined", () => {
    expect(safeNextPath(null)).toBe("/account");
    expect(safeNextPath(undefined)).toBe("/account");
  });

  it("uses the fallback it is given", () => {
    expect(safeNextPath("//evil.com", "/connect")).toBe("/connect");
  });

  it("keeps an encoded double slash on this site", () => {
    const result = safeNextPath("/%2F%2Fevil.com");
    expect(new URL(result, SITE_URL).origin).toBe(new URL(SITE_URL).origin);
  });
});
```

Create `lingoflix-server/tests/lib/upgrade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { upgradeDestination } from "@/lib/upgrade";

const SESSION = { user: { id: "user-1", email: "learner@example.com", name: "" }, token: "token-1" };

describe("upgradeDestination", () => {
  it("sends signed-out visitors to sign in, then back to /upgrade", () => {
    expect(upgradeDestination(null)).toBe("/sign-in?next=%2Fupgrade");
  });

  it("sends signed-in learners to their account until billing exists", () => {
    expect(upgradeDestination(SESSION)).toBe("/account");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/lib/safe-next.test.ts tests/lib/upgrade.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/safe-next"` and `Failed to resolve import "@/lib/upgrade"`.

- [ ] **Step 3: Implement the helpers**

Create `lingoflix-server/src/lib/safe-next.ts`:

```ts
import { SITE_URL } from "./site";

const SITE_ORIGIN = new URL(SITE_URL).origin;

/** Tabs, newlines and other control characters: browsers drop some of them, which can turn "/\t/x" into "//x". */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Where to go after signing in. Only a path on this site is kept. Anything else becomes `fallback`:
 * another site, a protocol-relative URL, a backslash or control-character trick, or junk (Review Focus 1).
 */
export function safeNextPath(value: string | null | undefined, fallback = "/account"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.includes("\\") || hasControlCharacter(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, SITE_ORIGIN);
  } catch {
    return fallback;
  }
  return url.origin === SITE_ORIGIN ? value : fallback;
}
```

Create `lingoflix-server/src/lib/upgrade.ts`:

```ts
import type { CurrentSession } from "./session";

/**
 * Where "Start your free trial" leads. Signed out: sign in first, then come back here.
 * Signed in: the account page, until billing (Plan 2) sends free accounts to Stripe Checkout.
 */
export function upgradeDestination(session: CurrentSession | null): string {
  if (!session) return "/sign-in?next=%2Fupgrade";
  return "/account";
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter lingoflix-server exec vitest run tests/lib/safe-next.test.ts tests/lib/upgrade.test.ts`
Expected: PASS. 2 files, 20 tests.

- [ ] **Step 5: Write the failing component tests**

Create `lingoflix-server/tests/sign-in/sign-in-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInForm, type SignInClient } from "@/app/sign-in/SignInForm";

afterEach(cleanup);

const EXPIRED = "That link has expired or was already used. We can send you a new one.";
const SEND_FAILED = "Couldn't send the email. Try again or use Google.";
const GENERIC = "Sign-in didn't work. Please try again.";

function fakeClient(over: Partial<SignInClient> = {}) {
  return {
    magicLink: vi.fn<SignInClient["magicLink"]>(async () => ({ error: null })),
    google: vi.fn<SignInClient["google"]>(async () => ({ error: null })),
    ...over,
  };
}

const emailBox = () => screen.getByLabelText("Email") as HTMLInputElement;
const emailForm = () => screen.getByRole("form", { name: "Email sign-in" });

describe("SignInForm", () => {
  it("emails a link that returns to the next page, with errors coming back to sign-in", async () => {
    const client = fakeClient();
    render(<SignInForm next="/connect" initialError={null} client={client} />);
    fireEvent.change(emailBox(), { target: { value: "  learner@example.com " } });
    fireEvent.submit(emailForm());
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(
      screen.getByText("We sent a link to learner@example.com. It works once and expires in 15 minutes."),
    ).toBeTruthy();
    expect(client.magicLink).toHaveBeenCalledWith({
      email: "learner@example.com",
      callbackURL: "/connect",
      errorCallbackURL: "/sign-in?next=%2Fconnect",
    });
  });

  it("shows Sending... and disables both buttons while the link is on its way", async () => {
    let finish!: (value: { error: null }) => void;
    const client = fakeClient({
      magicLink: vi.fn<SignInClient["magicLink"]>(() => new Promise((resolve) => (finish = resolve))),
    });
    render(<SignInForm next="/account" initialError={null} client={client} />);
    fireEvent.change(emailBox(), { target: { value: "learner@example.com" } });
    fireEvent.submit(emailForm());
    const sending = (await screen.findByRole("button", { name: "Sending..." })) as HTMLButtonElement;
    expect(sending.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Continue with Google" }) as HTMLButtonElement).disabled).toBe(true);
    finish({ error: null });
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
  });

  it("lets the learner go back and use a different email", async () => {
    render(<SignInForm next="/account" initialError={null} client={fakeClient()} />);
    fireEvent.change(emailBox(), { target: { value: "learner@example.com" } });
    fireEvent.submit(emailForm());
    fireEvent.click(await screen.findByRole("button", { name: "Use a different email" }));
    expect(emailBox()).toBeTruthy();
  });

  it("explains an expired or used link and keeps the email field ready (Review Focus 2)", () => {
    render(<SignInForm next="/account" initialError="INVALID_TOKEN" client={fakeClient()} />);
    expect(screen.getByRole("alert").textContent).toBe(EXPIRED);
    expect(emailBox()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeTruthy();
  });

  it("shows a general message for any other sign-in error", () => {
    render(<SignInForm next="/account" initialError="failed_to_create_user" client={fakeClient()} />);
    expect(screen.getByRole("alert").textContent).toBe(GENERIC);
  });

  it.each([
    ["answers with an error", vi.fn<SignInClient["magicLink"]>(async () => ({ error: { message: "Email failed" } }))],
    ["throws", vi.fn<SignInClient["magicLink"]>(async () => Promise.reject(new Error("offline")))],
  ])("says the email could not be sent when the server %s", async (_label, magicLink) => {
    render(<SignInForm next="/account" initialError={null} client={fakeClient({ magicLink })} />);
    fireEvent.change(emailBox(), { target: { value: "learner@example.com" } });
    fireEvent.submit(emailForm());
    expect((await screen.findByRole("alert")).textContent).toBe(SEND_FAILED);
    expect(emailBox().value).toBe("learner@example.com");
  });

  it("continues with Google to the next page", () => {
    const client = fakeClient();
    render(<SignInForm next="/account" initialError={null} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(client.google).toHaveBeenCalledWith({ callbackURL: "/account", errorCallbackURL: "/sign-in?next=%2Faccount" });
  });

  it("shows the general message when Google sign-in fails to start", async () => {
    const client = fakeClient({ google: vi.fn<SignInClient["google"]>(async () => ({ error: { message: "nope" } })) });
    render(<SignInForm next="/account" initialError={null} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect((await screen.findByRole("alert")).textContent).toBe(GENERIC);
  });

  it("asks the browser to check the email address", () => {
    render(<SignInForm next="/account" initialError={null} client={fakeClient()} />);
    expect(emailBox().type).toBe("email");
    expect(emailBox().required).toBe(true);
  });

  it("has no em dashes", () => {
    render(<SignInForm next="/account" initialError="INVALID_TOKEN" client={fakeClient()} />);
    expect(document.body.textContent).not.toMatch(/\u2014/);
  });
});
```

Create `lingoflix-server/tests/account/account.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSummary } from "@/app/account/AccountSummary";
import { SignOutButton } from "@/app/account/SignOutButton";

afterEach(cleanup);

describe("AccountSummary", () => {
  it("shows the email and the Free plan", () => {
    render(<AccountSummary email="learner@example.com" />);
    expect(screen.getByText("learner@example.com")).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("Free")).toBeTruthy();
  });
});

describe("SignOutButton", () => {
  it("signs out, then goes to the home page", async () => {
    const signOut = vi.fn(async () => {});
    const navigate = vi.fn();
    render(<SignOutButton signOut={signOut} navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("button", { name: "Signing out..." })).toBeTruthy();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("says so when sign-out fails and lets the learner try again", async () => {
    const navigate = vi.fn();
    render(<SignOutButton signOut={vi.fn(async () => Promise.reject(new Error("offline")))} navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't sign out. Please try again.");
    expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/sign-in tests/account`
Expected: FAIL with `Failed to resolve import "@/app/sign-in/SignInForm"` and `Failed to resolve import "@/app/account/AccountSummary"`.

- [ ] **Step 7: Write the sign-in form and page**

Create `lingoflix-server/src/app/sign-in/SignInForm.tsx`:

```tsx
"use client";

import { useId, useState, type FormEvent } from "react";
import { primaryButton, secondaryButton } from "@/components/styles";
import { authClient } from "@/lib/auth-client";

type ClientResult = Promise<{ error: { message?: string } | null }>;

export interface SignInClient {
  magicLink(input: { email: string; callbackURL: string; errorCallbackURL: string }): ClientResult;
  google(input: { callbackURL: string; errorCallbackURL: string }): ClientResult;
}

const defaultClient: SignInClient = {
  magicLink: (input) => authClient.signIn.magicLink(input),
  google: (input) => authClient.signIn.social({ provider: "google", ...input }),
};

const MESSAGES = {
  expired: "That link has expired or was already used. We can send you a new one.",
  sendFailed: "Couldn't send the email. Try again or use Google.",
  generic: "Sign-in didn't work. Please try again.",
};

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

/** Better Auth sends `?error=INVALID_TOKEN` for unknown, expired and already-used links alike. */
function initialStatus(code: string | null): Status {
  if (!code) return { kind: "idle" };
  return { kind: "error", message: code === "INVALID_TOKEN" ? MESSAGES.expired : MESSAGES.generic };
}

export function SignInForm({
  next,
  initialError,
  client = defaultClient,
}: {
  next: string;
  initialError: string | null;
  client?: SignInClient;
}) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(() => initialStatus(initialError));
  const errorCallbackURL = `/sign-in?next=${encodeURIComponent(next)}`;
  const sending = status.kind === "sending";

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    setStatus({ kind: "sending" });
    try {
      const { error } = await client.magicLink({ email: address, callbackURL: next, errorCallbackURL });
      setStatus(error ? { kind: "error", message: MESSAGES.sendFailed } : { kind: "sent", email: address });
    } catch {
      setStatus({ kind: "error", message: MESSAGES.sendFailed });
    }
  }

  async function continueWithGoogle() {
    setStatus({ kind: "sending" });
    try {
      // On success the browser leaves for Google, so only a failure comes back here.
      const { error } = await client.google({ callbackURL: next, errorCallbackURL });
      if (error) setStatus({ kind: "error", message: MESSAGES.generic });
    } catch {
      setStatus({ kind: "error", message: MESSAGES.generic });
    }
  }

  if (status.kind === "sent") {
    return (
      <div role="status" className="flex flex-col gap-3">
        <h2 className="text-2xl font-black">Check your email</h2>
        <p>{`We sent a link to ${status.email}. It works once and expires in 15 minutes.`}</p>
        <button type="button" className={secondaryButton} onClick={() => setStatus({ kind: "idle" })}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {status.kind === "error" && (
        <p role="alert" className="rounded-xl border-2 border-danger px-4 py-3 font-semibold text-danger">
          {status.message}
        </p>
      )}
      <button type="button" className={secondaryButton} onClick={continueWithGoogle} disabled={sending}>
        Continue with Google
      </button>
      <p className="text-center text-sm font-bold text-mute">or</p>
      <form aria-label="Email sign-in" onSubmit={sendLink} className="flex flex-col gap-3">
        <label htmlFor={emailId} className="font-extrabold">
          Email
        </label>
        <input
          id={emailId}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-xl border-2 border-line px-3 py-2 font-semibold outline-none focus:border-brand"
        />
        <button type="submit" className={primaryButton} disabled={sending}>
          {sending ? "Sending..." : "Email me a sign-in link"}
        </button>
      </form>
    </div>
  );
}
```

Create `lingoflix-server/src/app/sign-in/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/safe-next";
import { getCurrentSession } from "@/lib/session";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  if (await getCurrentSession()) redirect(next);

  return (
    <section aria-labelledby="sign-in-heading" className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div>
        <h1 id="sign-in-heading" className="text-3xl font-black">
          Sign in to LingoFlix
        </h1>
        <p className="mt-2 text-mute">Use Google, or get a one-time link by email. No password needed.</p>
      </div>
      <SignInForm next={next} initialError={first(params.error) ?? null} />
    </section>
  );
}
```

- [ ] **Step 8: Write the account and upgrade pages**

Create `lingoflix-server/src/app/account/AccountSummary.tsx`:

```tsx
/** Who is signed in and their plan. Plan 2 replaces "Free" with the real plan status. */
export function AccountSummary({ email }: { email: string }) {
  return (
    <dl className="grid gap-3 rounded-2xl border-2 border-line px-5 py-4">
      <div>
        <dt className="text-sm font-bold text-mute">Email</dt>
        <dd className="font-extrabold">{email}</dd>
      </div>
      <div>
        <dt className="text-sm font-bold text-mute">Plan</dt>
        <dd className="font-extrabold">Free</dd>
      </div>
    </dl>
  );
}
```

Create `lingoflix-server/src/app/account/SignOutButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { secondaryButton } from "@/components/styles";
import { authClient } from "@/lib/auth-client";

async function signOutOfBetterAuth(): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "Sign-out failed");
}

export function SignOutButton({
  signOut = signOutOfBetterAuth,
  navigate = (url: string) => window.location.assign(url),
}: {
  signOut?: () => Promise<unknown>;
  navigate?: (url: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick() {
    setPending(true);
    setFailed(false);
    try {
      await signOut();
      navigate("/");
    } catch {
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" className={secondaryButton} onClick={handleClick} disabled={pending}>
        {pending ? "Signing out..." : "Sign out"}
      </button>
      {failed && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {"Couldn't sign out. Please try again."}
        </p>
      )}
    </div>
  );
}
```

Create `lingoflix-server/src/app/account/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";
import { AccountSummary } from "./AccountSummary";
import { SignOutButton } from "./SignOutButton";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in?next=%2Faccount");

  return (
    <section aria-labelledby="account-heading" className="mx-auto flex w-full max-w-md flex-col gap-6">
      <h1 id="account-heading" className="text-3xl font-black">
        Your account
      </h1>
      <AccountSummary email={session.user.email} />
      <SignOutButton />
    </section>
  );
}
```

Create `lingoflix-server/src/app/upgrade/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";
import { upgradeDestination } from "@/lib/upgrade";

export const dynamic = "force-dynamic";

export default async function UpgradePage() {
  redirect(upgradeDestination(await getCurrentSession()));
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter lingoflix-server exec vitest run tests/lib/safe-next.test.ts tests/lib/upgrade.test.ts tests/sign-in tests/account`
Expected: PASS. 4 files, 34 tests (safe-next 18, upgrade 2, sign-in form 11, account 3), with no React act() warnings.

- [ ] **Step 10: Lint, type-check, build and run the whole suite**

Run: `pnpm --filter lingoflix-server lint`
Expected: exits 0 with no errors or warnings.

Run: `pnpm --filter lingoflix-server compile && pnpm --filter lingoflix-server build`
Expected:
- tsc exits 0;
- `next build` succeeds with no environment variables set;
- the route list shows `ƒ /account`, `ƒ /sign-in` and `ƒ /upgrade` (dynamic) next to Task 5's static pages.

Run: `pnpm --filter lingoflix-server test`
Expected: every test file passes.

- [ ] **Step 11: Commit**

```bash
cd /Users/jay/Codes/jaycho1214/lingoflix
git add lingoflix-server/src/lib/safe-next.ts lingoflix-server/src/lib/upgrade.ts lingoflix-server/src/app/sign-in \
  lingoflix-server/src/app/account lingoflix-server/src/app/upgrade lingoflix-server/tests/lib/safe-next.test.ts \
  lingoflix-server/tests/lib/upgrade.test.ts lingoflix-server/tests/sign-in lingoflix-server/tests/account
git commit -m "feat(server): sign-in with Google or an email link, account page and upgrade redirect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 7: Goodbye page and endpoint; `/connect` hand-off to the extension

**Files:**
- Create: `lingoflix-server/src/lib/goodbye.ts`
- Create: `lingoflix-server/src/app/api/goodbye/route.ts`
- Create: `lingoflix-server/src/app/goodbye/GoodbyeForm.tsx`
- Create: `lingoflix-server/src/app/goodbye/page.tsx`
- Create: `lingoflix-server/src/app/connect/ConnectClient.tsx`
- Create: `lingoflix-server/src/app/connect/page.tsx`
- Test: `lingoflix-server/tests/goodbye.test.ts`, `lingoflix-server/tests/goodbye-form.test.tsx`, `lingoflix-server/tests/connect-client.test.tsx`, `lingoflix-server/tests/connect-page.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1 `@/lib/site`: `chromeStoreUrl(env?)`.
  - Task 2 `@/db/client`: `getDb(): Kysely<Database>`, which throws `Error('DATABASE_URL is not set')`.
  - Task 2 `@/db/types`: `Database` with `uninstall_feedback` (`id`, `created_at` generated; `reason: string`, `comment: string | null`).
  - Task 2 `tests/support/test-db.ts`: `createTestDb(): Promise<Kysely<Database>>`.
  - Task 4 `@/lib/session`: `getCurrentSession(): Promise<CurrentSession | null>`, with `CurrentSession = { user: { id; email; name }; token }`.
  - Task 5 `src/app/layout.tsx`, which supplies the header, footer and `<main>`. Pages here render only their content.
- Produces (as fixed in the plan's Interfaces, with one location change):
  - `@/lib/goodbye`: `GOODBYE_REASONS`, `GoodbyeReason`, `GOODBYE_REASON_LABELS`, `GOODBYE_COMMENT_MAX = 500`, `GOODBYE_BODY_MAX_BYTES = 4096`, `interface GoodbyeFeedback { reason: GoodbyeReason; comment: string | null }`, `parseGoodbye(body: unknown): GoodbyeFeedback | null`, `createGoodbyeHandler(openDb: () => Kysely<Database>): (request: Request) => Promise<Response>`.
  - **Location change:** `createGoodbyeHandler` lives in `src/lib/goodbye.ts`, not in the route file. Next.js type-checks route files during `next build` and rejects any export other than the HTTP methods and route segment config ("is not a valid Route export field"). The route file exports only `POST = createGoodbyeHandler(getDb)`.
  - `src/app/connect/ConnectClient.tsx`: `ExtensionRuntime`, `ConnectClient(props: { extensionId: string | null; token: string; storeUrl: string | null; runtime?: ExtensionRuntime | null; timeoutMs?: number })`. Message `{ type: 'lingoflix:session', token }`; success reply `{ ok: true }`.
  - `src/app/goodbye/GoodbyeForm.tsx`: `GoodbyeForm(props: { submit?: (feedback: GoodbyeFeedback) => Promise<boolean> })`.

**`/connect` hands over the web session's own token (spec §7.3, option A).** The extension and the website share one Better Auth session, so signing out on either side signs out both. That is the documented, supported path in Better Auth 1.7.6. Plan 3 may switch to a separate extension session.

- [ ] **Step 1: Write the failing goodbye tests (parsing, endpoint, route module)**

Create `lingoflix-server/tests/goodbye.test.ts`:

```ts
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/types";
import {
  GOODBYE_COMMENT_MAX,
  GOODBYE_REASONS,
  GOODBYE_REASON_LABELS,
  createGoodbyeHandler,
  parseGoodbye,
} from "@/lib/goodbye";
import { createTestDb } from "./support/test-db";

describe("parseGoodbye", () => {
  it("accepts a known reason with an optional comment, trimmed; an empty comment is null", () => {
    expect(parseGoodbye({ reason: "too-expensive" })).toEqual({ reason: "too-expensive", comment: null });
    expect(parseGoodbye({ reason: "other", comment: "  Needs more shows  " })).toEqual({
      reason: "other",
      comment: "Needs more shows",
    });
    expect(parseGoodbye({ reason: "not-using", comment: null })).toEqual({ reason: "not-using", comment: null });
    expect(parseGoodbye({ reason: "not-using", comment: "   " })).toEqual({ reason: "not-using", comment: null });
  });

  it("allows a comment of 500 characters after trimming, not 501", () => {
    expect(parseGoodbye({ reason: "other", comment: ` ${"x".repeat(500)} ` })?.comment).toHaveLength(500);
    expect(parseGoodbye({ reason: "other", comment: "x".repeat(501) })).toBeNull();
  });

  it.each([
    ["an unknown reason", { reason: "hates-netflix" }],
    ["no reason", { comment: "hi" }],
    ["a reason that is not a string", { reason: 1 }],
    ["a comment that is not a string", { reason: "other", comment: 42 }],
    ["an extra field", { reason: "other", email: "a@example.com" }],
    ["an array", ["other"]],
    ["null", null],
    ["a string", "other"],
  ])("rejects %s", (_label, body) => {
    expect(parseGoodbye(body)).toBeNull();
  });

  it("has a label for every reason", () => {
    expect(GOODBYE_REASONS.map((reason) => GOODBYE_REASON_LABELS[reason])).toEqual([
      "It costs too much",
      "I don't use it enough",
      "It's missing something I need",
      "It didn't work well",
      "Something else",
    ]);
    expect(GOODBYE_COMMENT_MAX).toBe(500);
  });
});

describe("POST /api/goodbye", () => {
  let db: Kysely<Database>;

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.destroy();
  });
  beforeEach(async () => {
    await db.deleteFrom("uninstall_feedback").execute();
  });

  const post = (body: string) =>
    createGoodbyeHandler(() => db)(
      new Request("http://localhost:3000/api/goodbye", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    );
  const stored = () => db.selectFrom("uninstall_feedback").selectAll().execute();

  it("stores the reason, the comment and the time, and nothing else", async () => {
    const before = Date.now();
    const res = await post(JSON.stringify({ reason: "not-working", comment: "  Subtitles froze  " }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["comment", "created_at", "id", "reason"]);
    expect(rows[0]).toMatchObject({ reason: "not-working", comment: "Subtitles froze" });
    expect(rows[0]!.created_at).toBeInstanceOf(Date);
    expect(rows[0]!.created_at.getTime()).toBeGreaterThanOrEqual(before - 60_000);
  });

  it("stores a missing comment as null", async () => {
    expect((await post(JSON.stringify({ reason: "other" }))).status).toBe(201);
    expect((await stored())[0]?.comment).toBeNull();
  });

  it.each([
    ["an unknown reason", JSON.stringify({ reason: "hates-netflix" })],
    ["a 501-character comment", JSON.stringify({ reason: "other", comment: "x".repeat(501) })],
    ["a body that is not JSON", "reason=other"],
    ["an empty body", ""],
    // Valid JSON (trailing spaces are allowed), so only the size limit can reject it.
    ["a body over 4096 bytes", `{"reason":"other"}${" ".repeat(5000)}`],
  ])("rejects %s with 400 and stores nothing", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad-request" });
    expect(await stored()).toEqual([]);
  });
});

describe("the goodbye route module", () => {
  it("loads with no environment and needs the database only when a request comes in", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { POST } = await import("@/app/api/goodbye/route");
      const request = new Request("http://localhost:3000/api/goodbye", {
        method: "POST",
        body: JSON.stringify({ reason: "other" }),
      });
      await expect(POST(request)).rejects.toThrow("DATABASE_URL is not set");
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter lingoflix-server exec vitest run tests/goodbye.test.ts`
Expected: FAIL, because Vite cannot resolve the import `@/lib/goodbye` (the file doesn't exist yet).

- [ ] **Step 3: Write `src/lib/goodbye.ts`**

```ts
import type { Kysely } from "kysely";
import type { Database } from "@/db/types";

/** Spec §5.4: the uninstall page's one optional question. */
export const GOODBYE_REASONS = ["too-expensive", "not-using", "missing-feature", "not-working", "other"] as const;
export type GoodbyeReason = (typeof GOODBYE_REASONS)[number];

export const GOODBYE_REASON_LABELS: Record<GoodbyeReason, string> = {
  "too-expensive": "It costs too much",
  "not-using": "I don't use it enough",
  "missing-feature": "It's missing something I need",
  "not-working": "It didn't work well",
  other: "Something else",
};

export const GOODBYE_COMMENT_MAX = 500;
/** Request bodies larger than this are rejected before they are parsed. */
export const GOODBYE_BODY_MAX_BYTES = 4096;

export interface GoodbyeFeedback {
  reason: GoodbyeReason;
  comment: string | null;
}

const isReason = (value: unknown): value is GoodbyeReason =>
  typeof value === "string" && (GOODBYE_REASONS as readonly string[]).includes(value);

/** `{ reason, comment? }` and nothing else: a known reason and an optional comment of at most 500 characters. */
export function parseGoodbye(body: unknown): GoodbyeFeedback | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "reason" && key !== "comment")) return null;
  const { reason, comment } = record;
  if (!isReason(reason)) return null;
  if (comment === undefined || comment === null) return { reason, comment: null };
  if (typeof comment !== "string") return null;
  const trimmed = comment.trim();
  if (trimmed.length > GOODBYE_COMMENT_MAX) return null;
  return { reason, comment: trimmed === "" ? null : trimmed };
}

const badRequest = () => Response.json({ error: "bad-request" }, { status: 400 });

/**
 * POST /api/goodbye (spec §5.4). No sign-in. Stores only the reason, the comment and the time:
 * never a user, an IP address or request headers. `openDb` is called per request, so importing
 * the route needs no environment.
 */
export function createGoodbyeHandler(openDb: () => Kysely<Database>): (request: Request) => Promise<Response> {
  return async (request) => {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > GOODBYE_BODY_MAX_BYTES) return badRequest();

    let text: string;
    try {
      text = await request.text();
    } catch {
      return badRequest();
    }
    if (new TextEncoder().encode(text).byteLength > GOODBYE_BODY_MAX_BYTES) return badRequest();

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return badRequest();
    }
    const feedback = parseGoodbye(body);
    if (!feedback) return badRequest();

    await openDb()
      .insertInto("uninstall_feedback")
      .values({ reason: feedback.reason, comment: feedback.comment })
      .execute();
    return Response.json({ ok: true }, { status: 201 });
  };
}
```

- [ ] **Step 4: Write the route `src/app/api/goodbye/route.ts`**

```ts
import { getDb } from "@/db/client";
import { createGoodbyeHandler } from "@/lib/goodbye";

export const POST = createGoodbyeHandler(getDb);
```

- [ ] **Step 5: Run the goodbye tests to verify they pass**

Run: `pnpm --filter lingoflix-server exec vitest run tests/goodbye.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 6: Commit**

```bash
git add lingoflix-server/src/lib/goodbye.ts lingoflix-server/src/app/api/goodbye/route.ts lingoflix-server/tests/goodbye.test.ts
git commit -m "feat(server): goodbye feedback endpoint (reason and comment only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Write the failing goodbye form and page tests**

Create `lingoflix-server/tests/goodbye-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoodbyeForm } from "@/app/goodbye/GoodbyeForm";
import GoodbyePage from "@/app/goodbye/page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const choose = (label: string) => fireEvent.click(screen.getByRole("radio", { name: label }));
const send = () => fireEvent.click(screen.getByRole("button", { name: "Send" }));

describe("GoodbyeForm", () => {
  it("posts the chosen reason and the trimmed comment as JSON, then thanks the learner", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<GoodbyeForm />);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);

    choose("It didn't work well");
    fireEvent.change(screen.getByLabelText("Anything else? (optional)"), { target: { value: "  Subtitles froze  " } });
    send();

    expect(await screen.findByText("Thanks for telling us.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/goodbye");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "not-working", comment: "Subtitles froze" });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("sends a null comment when none was written", async () => {
    const submit = vi.fn(async () => true);
    render(<GoodbyeForm submit={submit} />);
    choose("Something else");
    send();
    expect(await screen.findByText("Thanks for telling us.")).toBeTruthy();
    expect(submit).toHaveBeenCalledWith({ reason: "other", comment: null });
  });

  it.each([
    ["the server refuses it", () => vi.fn(async () => ({ ok: false }) as Response)],
    [
      "the network fails",
      () =>
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
    ],
  ])("says so when %s", async (_label, makeFetch) => {
    vi.stubGlobal("fetch", makeFetch());
    render(<GoodbyeForm />);
    choose("It costs too much");
    send();
    expect(await screen.findByText("Couldn't send that. You can close this page.")).toBeTruthy();
  });

  it("limits the comment to 500 characters and counts them", () => {
    render(<GoodbyeForm submit={vi.fn(async () => true)} />);
    const comment = screen.getByLabelText("Anything else? (optional)") as HTMLTextAreaElement;
    expect(comment.maxLength).toBe(500);
    fireEvent.change(comment, { target: { value: "Too pricey" } });
    expect(screen.getByText("10/500")).toBeTruthy();
  });
});

describe("the goodbye page", () => {
  it("asks why, and says that uninstalling does not cancel Premium", () => {
    render(<GoodbyePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Sorry to see you go" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByText(/Uninstalling LingoFlix doesn't cancel Premium\./)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Manage or cancel it from your account." }).getAttribute("href"),
    ).toBe("/account");
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter lingoflix-server exec vitest run tests/goodbye-form.test.tsx`
Expected: FAIL, because Vite cannot resolve the import `@/app/goodbye/GoodbyeForm`.

- [ ] **Step 9: Write `src/app/goodbye/GoodbyeForm.tsx`**

```tsx
"use client";

import { useId, useState, type FormEvent } from "react";
import {
  GOODBYE_COMMENT_MAX,
  GOODBYE_REASONS,
  GOODBYE_REASON_LABELS,
  type GoodbyeFeedback,
  type GoodbyeReason,
} from "@/lib/goodbye";

async function postGoodbye(feedback: GoodbyeFeedback): Promise<boolean> {
  try {
    const res = await fetch("/api/goodbye", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(feedback),
    });
    return res.ok;
  } catch {
    return false;
  }
}

type FormState = "idle" | "sending" | "sent" | "failed";

/** Spec §4 journey 5: one optional question. Nothing about the learner is sent, only the answer. */
export function GoodbyeForm({ submit = postGoodbye }: { submit?: (feedback: GoodbyeFeedback) => Promise<boolean> }) {
  const commentId = useId();
  const countId = useId();
  const [reason, setReason] = useState<GoodbyeReason | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<FormState>("idle");

  if (state === "sent") {
    return (
      <p role="status" className="text-lg font-bold">
        Thanks for telling us.
      </p>
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason || state === "sending") return;
    setState("sending");
    const trimmed = comment.trim();
    const ok = await submit({ reason, comment: trimmed === "" ? null : trimmed });
    setState(ok ? "sent" : "failed");
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-lg font-bold">Why are you leaving?</legend>
        {GOODBYE_REASONS.map((value) => (
          <label key={value} className="flex items-center gap-3">
            <input
              type="radio"
              name="reason"
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
            />
            {GOODBYE_REASON_LABELS[value]}
          </label>
        ))}
      </fieldset>

      <div>
        <label htmlFor={commentId} className="block font-bold">
          Anything else? (optional)
        </label>
        <textarea
          id={commentId}
          value={comment}
          maxLength={GOODBYE_COMMENT_MAX}
          rows={4}
          aria-describedby={countId}
          onChange={(event) => setComment(event.target.value)}
          className="mt-2 w-full rounded-xl border-2 p-3"
        />
        <p id={countId} className="text-sm">
          {comment.length}/{GOODBYE_COMMENT_MAX}
        </p>
      </div>

      <button
        type="submit"
        disabled={!reason || state === "sending"}
        className="rounded-xl border-2 px-5 py-2 font-bold disabled:opacity-50"
      >
        Send
      </button>

      {state === "failed" && (
        <p role="alert" className="font-bold">
          {"Couldn't send that. You can close this page."}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 10: Write `src/app/goodbye/page.tsx`**

The layout (Task 5) supplies `<main>`, the header and the footer, so this page renders only its content.

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { GoodbyeForm } from "./GoodbyeForm";

export const metadata: Metadata = { title: "Sorry to see you go" };

/** Opened by Chrome when LingoFlix is uninstalled (spec §7.7). */
export default function GoodbyePage() {
  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="text-3xl font-black tracking-tight">Sorry to see you go</h1>
      <p className="mt-2">If you have a moment, tell us why. It helps us make LingoFlix better.</p>

      <div className="mt-8">
        <GoodbyeForm />
      </div>

      <p className="mt-10">
        {"Uninstalling LingoFlix doesn't cancel Premium. "}
        <Link href="/account" className="font-bold underline">
          Manage or cancel it from your account.
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 11: Run the form and page tests to verify they pass**

Run: `pnpm --filter lingoflix-server exec vitest run tests/goodbye-form.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 12: Commit**

```bash
git add lingoflix-server/src/app/goodbye lingoflix-server/tests/goodbye-form.test.tsx
git commit -m "feat(server): goodbye page with one optional question

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 13: Write the failing `/connect` tests**

Create `lingoflix-server/tests/connect-client.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectClient, type ExtensionRuntime } from "@/app/connect/ConnectClient";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const TOKEN = "session-token-1234567890";
const STORE_URL = "https://chromewebstore.google.com/detail/lingoflix/abcdefghijklmnopabcdefghijklmnop";
const CONNECTED = "You're all set. LingoFlix is signed in. You can close this tab and go back to Netflix.";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeRuntime() {
  const calls: { extensionId: string; message: unknown; callback: (response: unknown) => void }[] = [];
  const runtime: ExtensionRuntime = {
    sendMessage(extensionId, message, callback) {
      calls.push({ extensionId, message, callback });
    },
  };
  /** Answers the latest message the way Chrome does: lastError is set only while the callback runs. */
  const answer = (response: unknown, lastError?: string) => {
    const call = calls.at(-1);
    if (!call) throw new Error("nothing was sent");
    act(() => {
      runtime.lastError = lastError === undefined ? undefined : { message: lastError };
      call.callback(response);
      runtime.lastError = undefined;
    });
  };
  return { runtime, calls, answer };
}

describe("ConnectClient", () => {
  it("sends the session to the extension and says when it is connected", () => {
    const { runtime, calls, answer } = fakeRuntime();
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} />);
    expect(screen.getByText("Connecting LingoFlix...")).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.extensionId).toBe(EXTENSION_ID);
    expect(calls[0]!.message).toEqual({ type: "lingoflix:session", token: TOKEN });

    answer({ ok: true });
    expect(screen.getByText(CONNECTED)).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("asks to install LingoFlix when Chrome cannot reach it", () => {
    const { runtime, answer } = fakeRuntime();
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} />);
    answer(undefined, "Could not establish connection. Receiving end does not exist.");
    expect(screen.getByText("Install LingoFlix first")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Get LingoFlix from the Chrome Web Store" }).getAttribute("href"),
    ).toBe(STORE_URL);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("treats any answer other than { ok: true } as not connected", () => {
    const { runtime, answer } = fakeRuntime();
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} />);
    answer({ ok: false });
    expect(screen.getByText("Install LingoFlix first")).toBeTruthy();
  });

  it("sends nothing without an extension ID, and says the store listing is coming", () => {
    const { runtime, calls } = fakeRuntime();
    render(<ConnectClient extensionId={null} token={TOKEN} storeUrl={null} runtime={runtime} />);
    expect(calls).toHaveLength(0);
    expect(screen.getByText("Install LingoFlix first")).toBeTruthy();
    expect(screen.getByText("LingoFlix will be in the Chrome Web Store soon.")).toBeTruthy();
  });

  it("asks to install LingoFlix when the page has no extension messaging at all", () => {
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={null} />);
    expect(screen.getByText("Install LingoFlix first")).toBeTruthy();
  });

  it("uses the page's chrome.runtime when no runtime is given", () => {
    const sendMessage = vi.fn();
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} />);
    expect(sendMessage).toHaveBeenCalledWith(
      EXTENSION_ID,
      { type: "lingoflix:session", token: TOKEN },
      expect.any(Function),
    );
  });

  it("says LingoFlix did not answer after the timeout, and Try again sends once more", () => {
    vi.useFakeTimers();
    const { runtime, calls, answer } = fakeRuntime();
    render(
      <ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} timeoutMs={5000} />,
    );
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText("Connecting LingoFlix...")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(/LingoFlix didn't answer\. Make sure it's turned on, then/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(calls).toHaveLength(2);
    expect(screen.getByText("Connecting LingoFlix...")).toBeTruthy();
    answer({ ok: true });
    expect(screen.getByText(CONNECTED)).toBeTruthy();
  });

  it("ignores a late answer to an attempt that already timed out", () => {
    vi.useFakeTimers();
    const { runtime, calls } = fakeRuntime();
    render(
      <ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} timeoutMs={5000} />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    act(() => {
      calls[0]!.callback({ ok: true });
    });
    expect(screen.getByText(/LingoFlix didn't answer/)).toBeTruthy();
  });
});
```

Create `lingoflix-server/tests/connect-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentSession: vi.fn() }));

import ConnectPage from "@/app/connect/page";
import { getCurrentSession } from "@/lib/session";

const SESSION = { user: { id: "u1", email: "learner@example.com", name: "" }, token: "session-token-abc" };

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(getCurrentSession).mockReset();
});

describe("/connect", () => {
  it("sends signed-out visitors to sign in first, then back here", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    const error = await ConnectPage().catch((err: unknown) => err);
    expect(String((error as { digest?: string }).digest)).toContain("/sign-in?next=%2Fconnect");
  });

  it("hands the signed-in session to the extension named by EXTENSION_ID, read when the page renders", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SESSION);
    vi.stubEnv("EXTENSION_ID", "abcdefghijklmnopabcdefghijklmnop");
    const sendMessage = vi.fn();
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    render(await ConnectPage());
    expect(screen.getByRole("heading", { level: 1, name: "Connect LingoFlix" })).toBeTruthy();
    expect(sendMessage).toHaveBeenCalledWith(
      "abcdefghijklmnopabcdefghijklmnop",
      { type: "lingoflix:session", token: "session-token-abc" },
      expect.any(Function),
    );
    expect(document.body.innerHTML).not.toContain("session-token-abc");
  });

  it("asks to install LingoFlix when EXTENSION_ID is not set", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SESSION);
    vi.stubEnv("EXTENSION_ID", "");
    render(await ConnectPage());
    expect(screen.getByText("Install LingoFlix first")).toBeTruthy();
  });
});
```

- [ ] **Step 14: Run them to verify they fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/connect-client.test.tsx tests/connect-page.test.tsx`
Expected: FAIL, because Vite cannot resolve the imports `@/app/connect/ConnectClient` and `@/app/connect/page`.

- [ ] **Step 15: Write `src/app/connect/ConnectClient.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The part of `chrome.runtime` a web page can use to message an extension (spec §7.3). */
export interface ExtensionRuntime {
  sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void;
  lastError?: { message?: string };
}

type ConnectState = "connecting" | "connected" | "missing" | "failed";

interface ConnectClientProps {
  extensionId: string | null;
  token: string;
  storeUrl: string | null;
  /** Defaults to the page's `chrome.runtime`; null means the page has none. */
  runtime?: ExtensionRuntime | null;
  timeoutMs?: number;
}

/** A page only has `chrome.runtime` when an installed extension lists the site in `externally_connectable`. */
function pageRuntime(): ExtensionRuntime | null {
  const runtime = (globalThis as { chrome?: { runtime?: Partial<ExtensionRuntime> } }).chrome?.runtime;
  return runtime && typeof runtime.sendMessage === "function" ? (runtime as ExtensionRuntime) : null;
}

const isConnected = (response: unknown) =>
  typeof response === "object" && response !== null && (response as { ok?: unknown }).ok === true;

/**
 * Hands the session token to the extension with `chrome.runtime.sendMessage`. The token is never shown on screen,
 * logged or put in a URL. (Like any client-component prop it travels in the page's server-rendered data; the page is
 * dynamic and never cached.)
 */
export function ConnectClient({ extensionId, token, storeUrl, runtime, timeoutMs = 5000 }: ConnectClientProps) {
  const [state, setState] = useState<ConnectState>("connecting");
  // Each attempt gets a number. An answer or a timeout for an older attempt (or after unmount) is ignored.
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    clearTimeout(timer.current);
    const current = ++attempt.current;
    const target = runtime === undefined ? pageRuntime() : runtime;
    if (!extensionId || !target) {
      setState("missing");
      return;
    }
    const settle = (next: ConnectState) => {
      if (current !== attempt.current) return;
      attempt.current += 1;
      clearTimeout(timer.current);
      setState(next);
    };
    setState("connecting");
    timer.current = setTimeout(() => settle("failed"), timeoutMs);
    try {
      target.sendMessage(extensionId, { type: "lingoflix:session", token }, (response) => {
        // Chrome sets lastError only while this callback runs, e.g. when LingoFlix isn't installed.
        settle(target.lastError || !isConnected(response) ? "missing" : "connected");
      });
    } catch {
      settle("missing");
    }
  }, [extensionId, runtime, timeoutMs, token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starting the hand-off on mount is this effect's purpose
    connect();
    return () => {
      attempt.current += 1;
      clearTimeout(timer.current);
    };
  }, [connect]);

  if (state === "connecting") {
    return (
      <p role="status" className="mt-6 text-lg">
        Connecting LingoFlix...
      </p>
    );
  }
  if (state === "connected") {
    return (
      <p role="status" className="mt-6 text-lg font-bold">
        {"You're all set. LingoFlix is signed in. You can close this tab and go back to Netflix."}
      </p>
    );
  }
  if (state === "missing") {
    return (
      <div role="status" className="mt-6 space-y-2">
        <p className="text-lg font-bold">Install LingoFlix first</p>
        {storeUrl ? (
          <>
            <p>
              <a href={storeUrl} className="font-bold underline">
                Get LingoFlix from the Chrome Web Store
              </a>
            </p>
            <p>Then come back and reload this page.</p>
          </>
        ) : (
          <p>LingoFlix will be in the Chrome Web Store soon.</p>
        )}
      </div>
    );
  }
  return (
    <p role="alert" className="mt-6 text-lg">
      {"LingoFlix didn't answer. Make sure it's turned on, then "}
      <button type="button" onClick={connect} className="font-bold underline">
        Try again
      </button>
    </p>
  );
}
```

- [ ] **Step 16: Write `src/app/connect/page.tsx`**

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";
import { chromeStoreUrl } from "@/lib/site";
import { ConnectClient } from "./ConnectClient";

export const metadata: Metadata = { title: "Connect LingoFlix" };

/**
 * Spec §7.3: hands the signed-in web session's token to the extension. The extension and the website share
 * this one session, so signing out on either side signs out both. EXTENSION_ID is read while rendering,
 * never at module load.
 */
export default async function ConnectPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in?next=%2Fconnect");

  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="text-3xl font-black tracking-tight">Connect LingoFlix</h1>
      <p className="mt-2">{`Signed in as ${session.user.email}.`}</p>
      <ConnectClient
        extensionId={process.env.EXTENSION_ID || null}
        token={session.token}
        storeUrl={chromeStoreUrl()}
      />
    </div>
  );
}
```

- [ ] **Step 17: Run the `/connect` tests to verify they pass**

Run: `pnpm --filter lingoflix-server exec vitest run tests/connect-client.test.tsx tests/connect-page.test.tsx`
Expected: PASS (8 + 3 = 11 tests).

- [ ] **Step 18: Run the whole server suite, lint, the type check and the build**

Run: `pnpm --filter lingoflix-server test && pnpm --filter lingoflix-server lint && pnpm --filter lingoflix-server compile && pnpm --filter lingoflix-server build`
Expected:
- Every test file passes, with no warnings in the output.
- `eslint` reports no errors and no warnings.
- `tsc` prints nothing.
- `next build` succeeds, and its route list includes `/goodbye`, `/connect` and `/api/goodbye`.

The `eslint-disable-next-line react-hooks/set-state-in-effect` comment in `ConnectClient` is required (eslint-config-next 16.4.0 always reports that rule there). Starting the hand-off on mount, including showing "Install LingoFlix first" right away, is the effect's purpose. Moving it out of the effect would make the server-rendered HTML disagree with the browser's, because only the browser has `chrome.runtime`.

- [ ] **Step 19: Commit**

```bash
git add lingoflix-server/src/app/connect lingoflix-server/tests/connect-client.test.tsx lingoflix-server/tests/connect-page.test.tsx
git commit -m "feat(server): /connect hands the signed-in session to the extension

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, environment template, full verification and the deployment checklist

**Files:**
- Modify: `lingoflix-server/.gitignore` (track `.env.example`)
- Create: `lingoflix-server/.env.example`
- Modify: `lingoflix-server/package.json` (database scripts)
- Modify: `lingoflix-server/README.md` (replace the generated README)
- Modify: `README.md` (repository root)

**Interfaces:**
- Consumes:
  - every earlier task;
  - the env variable names in Global Constraints;
  - Task 2's `kysely.config.ts`, whose migrations use `DATABASE_URL_UNPOOLED`.
- Produces: no code.

**Script names:** Task 2 may already have added some of the `db:*` scripts. If its names differ from Step 2's, use the names below and update Task 2's README mentions to match.

- [ ] **Step 1: Write `lingoflix-server/.env.example` and make it trackable**

The generated `lingoflix-server/.gitignore` ignores `.env*`. Directly below the line `.env*`, add:

```gitignore
!.env.example
```

Then create `lingoflix-server/.env.example`. Both files go in this task's commit (Step 7).

```dotenv
# Copy to .env.local for `pnpm dev`. Never commit real values.

# Postgres (Neon). Pooled connection string used by the app.
DATABASE_URL=postgres://lingoflix:lingoflix@localhost:5432/lingoflix
# Direct (unpooled) connection string used by kysely-ctl migrations.
DATABASE_URL_UNPOOLED=postgres://lingoflix:lingoflix@localhost:5432/lingoflix

# Better Auth: at least 32 random characters. Generate one with: pnpm --filter lingoflix-server exec auth secret
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
# This site's origin.
BETTER_AUTH_URL=http://localhost:3000

# Google OAuth client (type: Web application). Required; for email-link-only development any placeholder works.
GOOGLE_CLIENT_ID=placeholder
GOOGLE_CLIENT_SECRET=placeholder

# The LingoFlix extension's ID, from the Chrome Web Store draft. Empty until then.
EXTENSION_ID=

# Cloudflare Email Service. Leave empty in development: sign-in links are printed to the terminal.
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_EMAIL_TOKEN=
EMAIL_FROM=LingoFlix <login@lipsum.fun>

# The Chrome Web Store listing URL. Empty until the extension is published.
NEXT_PUBLIC_CHROME_STORE_URL=
```

- [ ] **Step 2: Make sure the database scripts exist**

In `lingoflix-server/package.json`, the `scripts` block must contain these entries (add any that are missing, keep the rest):

```json
"db:make": "kysely migrate make",
"db:migrate": "kysely migrate latest",
"db:migrate:local": "kysely migrate latest -e local",
"db:list": "kysely migrate list"
```

kysely-ctl loads `.env` on its own but not `.env.local`. `-e local` makes it load `.env` and then `.env.local`.

- [ ] **Step 3: Replace `lingoflix-server/README.md`**

````markdown
# LingoFlix server

The LingoFlix website and API at `https://lingoflix.lipsum.fun`, built with Next.js:

- **Pages:** the landing page and pricing, the welcome page opened after install, sign-in (Google or an emailed link),
  the account page, the extension hand-off (`/connect`), the uninstall page (`/goodbye`), privacy and terms.
- **Auth:** Better Auth on Postgres (Neon), through Kysely. The extension authenticates with a bearer token.
- **Schema:** every change, including Better Auth's tables, is a kysely-ctl migration in `src/db/migrations/`.

Design: `docs/superpowers/specs/2026-10-10-lingoflix-subscription-design.md`.

## Scripts

Run from the repository root with `pnpm --filter lingoflix-server <script>`, or from this folder with `pnpm <script>`.

| Script | What it does |
|---|---|
| `dev` | Development server at http://localhost:3000 |
| `test` | Unit tests (Vitest). Uses an in-process Postgres (PGlite): no database or `.env` needed |
| `compile` | Generates Next.js route types, then type-checks |
| `build` | Production build. Needs no environment variables |
| `db:make <name>` | Creates an empty migration file in `src/db/migrations/` |
| `db:migrate` | Applies pending migrations, connecting with `DATABASE_URL_UNPOOLED` from the shell or `.env` |
| `db:migrate:local` | Same, also reading `.env.local` |
| `db:list` | Shows which migrations have run |

## Local development

1. Copy `.env.example` to `.env.local` and fill in what you have. Only the database, `BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL` and the Google values (placeholders are fine) are needed to sign in by email link.
2. Without Cloudflare credentials (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_TOKEN`), sign-in links are printed to the
   terminal running `pnpm dev` instead of being emailed. This only happens outside production.
3. Point `DATABASE_URL` and `DATABASE_URL_UNPOOLED` at a local Postgres or a Neon branch, then run
   `pnpm --filter lingoflix-server db:migrate:local`.
4. `pnpm --filter lingoflix-server dev`.

## Migrations and Better Auth's schema check

Better Auth checks the live database schema and rejects every auth request while it doesn't match. A running instance
also remembers a failed check until it restarts.

- Run migrations **before** deploying code that needs them.
- After migrating a database that running instances already use, redeploy.
- New columns on Better Auth's tables (`user`, `session`, `account`, `verification`) must be nullable or have a default.
- Migrations use the direct connection (`DATABASE_URL_UNPOOLED`): Neon's pooler doesn't support the lock kysely-ctl
  takes while migrating.
- Use `sslmode=verify-full` in Neon connection strings.

## Deploying

Vercel project with Root Directory `lingoflix-server` and Node.js 24.x, Neon from the Vercel Marketplace, and the
environment variables listed in `.env.example`. Run `db:migrate` against Neon before the first deploy.
````

- [ ] **Step 4: Update the root `README.md`**

In the Repository table, replace the row

```markdown
| `lingoflix-server/` | The website and API (Next.js), coming with the subscription |
```

with

```markdown
| [`lingoflix-server/`](./lingoflix-server) | The website and API (Next.js): sign-in, Premium, the AI endpoint |
```

In the Development section, replace the line

```markdown
pnpm build       # production builds (extension → lingoflix-extension/.output/chrome-mv3)
```

with

```markdown
pnpm build       # production builds (extension → lingoflix-extension/.output/chrome-mv3, server → lingoflix-server/.next)
```

and under the existing line that points to `lingoflix-extension/README.md`, add a blank line and then:

```markdown
See [`lingoflix-server/README.md`](./lingoflix-server/README.md) for running the website and API locally.
```

- [ ] **Step 5: Verify everything from the repository root with no environment**

First make sure no local env file is picked up.

Run: `cd /Users/jay/Codes/jaycho1214/lingoflix && ls -a lingoflix-server | grep '^\.env'`
Expected: only `.env.example`. If `.env.local` or `.env` exists, rename it to `.env.local.bak` for this step and rename it back afterwards.

Run: `git check-ignore -q lingoflix-server/.env.example; echo $?`
Expected: `1` (the file is not ignored).

Run:

```bash
cd /Users/jay/Codes/jaycho1214/lingoflix
# An array works in both bash and zsh (zsh doesn't split an unquoted string variable).
UNSET=(-u DATABASE_URL -u DATABASE_URL_UNPOOLED -u BETTER_AUTH_SECRET -u BETTER_AUTH_URL -u GOOGLE_CLIENT_ID -u GOOGLE_CLIENT_SECRET -u EXTENSION_ID -u CLOUDFLARE_ACCOUNT_ID -u CLOUDFLARE_EMAIL_TOKEN -u EMAIL_FROM -u NEXT_PUBLIC_CHROME_STORE_URL)
env "${UNSET[@]}" pnpm install \
  && env "${UNSET[@]}" pnpm test \
  && env "${UNSET[@]}" pnpm --filter lingoflix-server lint \
  && env "${UNSET[@]}" pnpm compile \
  && env "${UNSET[@]}" pnpm build
```

Expected:
- `pnpm install` reports the lockfile is up to date, with no `ERR_PNPM_IGNORED_BUILDS`.
- `pnpm test`: both packages run, and every test file passes in `lingoflix-extension` and in `lingoflix-server`.
- `lint`: no errors.
- `pnpm compile`: both type checks print no errors.
- `pnpm build`: the extension builds to `lingoflix-extension/.output/chrome-mv3`, and `next build` succeeds. Its route list includes `/`, `/welcome`, `/sign-in`, `/account`, `/upgrade`, `/connect`, `/goodbye`, `/privacy`, `/terms`, `/api/auth/[...all]` and `/api/goodbye`.
- No test or build output contains a warning.

- [ ] **Step 6: Check for em dashes in everything this plan wrote**

Run:

```bash
cd /Users/jay/Codes/jaycho1214/lingoflix
grep -rn "—" lingoflix-server README.md pnpm-workspace.yaml \
  --exclude-dir=node_modules --exclude-dir=.next --exclude=AGENTS.md --exclude=pnpm-lock.yaml \
  || echo "no em dashes"
git log --format=%B "$(git merge-base main HEAD)..HEAD" | grep -c "—"
```

Expected: `no em dashes`, then `0`.

- [ ] **Step 7: Commit**

```bash
git add lingoflix-server/.gitignore lingoflix-server/.env.example lingoflix-server/package.json lingoflix-server/README.md README.md
git commit -m "docs(server): README, environment template and database scripts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Deployment checklist (run with the user after the final whole-branch review; not the implementer's work)**

These steps create accounts and change outside services, so each one needs the user. The controller walks through them with the user in order.

1. **Make the code reachable by Vercel.** The repository has no remote yet. Either:
   - push it to a new private GitHub repository (the user's choice and approval) and import it in Vercel; or
   - deploy from this computer with the Vercel CLI (`pnpm dlx vercel link`, then `pnpm dlx vercel deploy`).

   GitHub is the better path: preview deployments and redeploys on push.
2. **Create the Vercel project:**
   - Root Directory `lingoflix-server`, framework Next.js.
   - Keep "Include files outside the Root Directory in the Build Step" on.
   - Settings → General → Node.js Version **24.x**.
3. **Add Neon:** Vercel → Storage (Marketplace) → Neon → create a database and connect it to the project. Check that `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) appear in the project's environment variables.
4. **Better Auth secrets:**
   - Generate a secret with `pnpm --filter lingoflix-server exec auth secret` and set it as `BETTER_AUTH_SECRET` (Production and Preview).
   - Set `BETTER_AUTH_URL=https://lingoflix.lipsum.fun` for Production. Sign-in works on a Preview deployment only if `BETTER_AUTH_URL` is also set for Preview (`getAuth()` requires it) and that host is added to the Google client; otherwise test sign-in locally.
5. **Google sign-in:**
   1. Google Cloud Console → APIs & Services → OAuth consent screen: External, app name LingoFlix, support email, scopes `openid`, `email`, `profile`. While it is in Testing mode, add yourself as a test user.
   2. Credentials → Create OAuth client ID → Web application.
      - Authorized JavaScript origins: `https://lingoflix.lipsum.fun` and `http://localhost:3000`.
      - Authorized redirect URIs: `https://lingoflix.lipsum.fun/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`.
   3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel and in `lingoflix-server/.env.local`.
6. **Cloudflare email:**
   1. Make sure the Cloudflare account is on Workers Paid.
   2. Compute → Email Service → Email Sending → Onboard Domain `lipsum.fun`. Wait until its DNS records show as verified (usually 5 to 15 minutes).
   3. Create an API token with the account permission "Email Sending: Edit".
   4. In Vercel, set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_TOKEN` and `EMAIL_FROM=LingoFlix <login@lipsum.fun>`.
7. **Support address:** Cloudflare → Email Routing for `lingoflix.lipsum.fun`. Create `support@lingoflix.lipsum.fun` and forward it to the user's inbox. The site and the legal pages show this address.
8. **Migrate Neon before the first deploy:** run `DATABASE_URL_UNPOOLED='<Neon direct URL, with sslmode=verify-full>' pnpm --filter lingoflix-server db:migrate` from the repository root. Expected: `Migration complete` with both migrations ticked (Better Auth's tables, then `uninstall_feedback`).
9. **Domain:** Vercel project → Settings → Domains → add `lingoflix.lipsum.fun`. In Cloudflare DNS, add the CNAME record Vercel shows for `lingoflix`, set to **DNS only** (grey cloud) so Vercel can issue the certificate.
10. **First deploy:** deploy Production and read the build log's install step.
    - If it fails on the pnpm version (Vercel doesn't officially support pnpm 11 yet), add `lingoflix-server/vercel.json`, commit and redeploy:

      ```json
      {
        "installCommand": "npx --yes pnpm@11.20.0 install --frozen-lockfile"
      }
      ```
11. **Live checks on `https://lingoflix.lipsum.fun`:**
    - Sign in with Google; `/account` shows the Google account's email.
    - Sign out, then sign in with an emailed link; the email arrives from `login@lipsum.fun`.
    - Open the same email link a second time: it lands on `/sign-in` with "That link has expired or was already used. We can send you a new one."
    - On `/account`, Sign out works and `/account` then asks you to sign in.
    - Submit `/goodbye` once. In Neon's SQL editor, `select reason, comment, created_at from uninstall_feedback` shows exactly that row.
    - Open `/connect` (signed in) in a browser without LingoFlix: it shows "Install LingoFlix first".
12. **`EXTENSION_ID` comes later:** it is set once the Chrome Web Store draft exists (spec §7.8), and the extension's side of `/connect` is built in Plan 3.
