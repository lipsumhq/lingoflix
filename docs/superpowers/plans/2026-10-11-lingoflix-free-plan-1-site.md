# LingoFlix Free Site Implementation Plan (Plan 1 of 2: the site)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim `lingoflix.lipsum.fun` to suit the free extension: no sign-in, accounts or Premium; the landing, welcome, goodbye, privacy and terms pages describe free use with the learner's own Claude or OpenAI key, and donations.

**Architecture:** The Next.js site in `lingoflix-server/` keeps five pages and one API route. Pages are rewritten in place; Better Auth, the sign-in email code and the Premium pages are deleted. Neon stays only for the goodbye answers: a kysely-ctl migration drops the sign-in tables, and `POST /api/goodbye` stores at most 100 answers an hour.

**Tech Stack:** Next.js 16 (App Router), React, Tailwind CSS, Kysely with kysely-ctl, PGlite in tests, Vitest with Testing Library, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-11-lingoflix-free-own-key-design.md`: §5 (the site), §5.8's two "Abandoned" lines, and the root README's site row. The extension (§3, §4) and the root README's AI and key lines are Plan 2.

## Global Constraints

- Kept routes, exactly: `/`, `/welcome`, `/goodbye`, `POST /api/goodbye`, `/privacy`, `/terms`. Everything for sign-in, accounts and Premium goes.
- Environment variables, exactly: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEXT_PUBLIC_CHROME_STORE_URL`. Nothing reads environment variables or opens a database at module load; `pnpm build`, `pnpm compile` and `pnpm test` pass with no environment variables set.
- Copy: the spec's exact strings (§5.5). Privacy and terms say the spec's points (§5.6, §5.7) and nothing more, dated `October 11, 2026`. No em dashes anywhere (use a colon).
- Donation links: the same ids, labels and URLs as `lingoflix-extension/src/lib/config.ts` (Buy Me a Coffee `https://buymeacoffee.com/jaycho1214`, GitHub Sponsors `https://github.com/sponsors/jaycho1214`).
- Goodbye: at most 100 stored answers an hour in total, counted and inserted in one statement; past the cap the same `201 {"ok":true}` and nothing stored; no IP address read or stored. The stored reason value `too-expensive` stays.
- Migrations: new ones only with `pnpm --filter lingoflix-server db:make <name>`. Never run `db:migrate`, `db:migrate:local` or `db:list`: Neon is shared by development and the live site. `drop_sign_in`'s `down` is a verbatim copy of `better_auth`'s `up`.
- The security headers (`frame-ancestors 'none'`, `X-Frame-Options: DENY`) stay.
- Never read or print any `.env*` file; the one exception is editing the tracked placeholder template `lingoflix-server/.env.example` in Task 7.
- Tests live in `lingoflix-server/tests/`; DOM tests start with `// @vitest-environment jsdom`. Write each test first and watch it fail. In an agent session (`CLAUDECODE` or `AI_AGENT` set), Vitest hides console output from passing tests: whenever a step checks for "no warnings", run Vitest with `--reporter=default`.
- Use `pnpm --filter lingoflix-server compile` (it runs `next typegen` first), not bare `tsc`.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands run from the repo root: `pnpm --filter lingoflix-server <script>`. The extension (`lingoflix-extension/`) is not touched.

## Review Focus

1. Old links to removed pages (bookmarks, sign-in emails already sent, `/upgrade` from an older extension build) land on the site's 404 page, never a server error. (Task 5: the routes inventory test; Task 7: the build's route list.)
2. A flood of fake uninstall answers stops being stored at 100 an hour while every visitor still sees the thank-you. (Task 3: the cap tests at 99, 100 and older rows.)
3. The sign-in tables are dropped only after no deployed code uses them, and can be restored exactly. (Task 6: the rollback test; "After merge" step order.)
4. A deploy with only the three variables builds and serves every page. (Task 7: the full no-environment check.)
5. The site describes OpenAI keys before the extension accepts them (Plan 2). Learners aren't affected (the extension isn't published yet), but the owner decides when to deploy. ("After merge" step 1.)

## File Structure

| Path (under `lingoflix-server/`) | Change | Task |
|---|---|---|
| `src/lib/site.ts`, `src/components/SiteHeader.tsx`, `src/components/SiteFooter.tsx`, `src/app/page.tsx`, `src/components/Pricing.tsx` (deleted) | Landing page and shell: free with your own key, Support | 1 |
| `src/app/welcome/page.tsx` | Add your key, no `B` shortcut | 2 |
| `src/lib/goodbye.ts`, `src/app/goodbye/*` | Copy, and the 100-an-hour cap | 3 |
| `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/lib/site.ts` | Rewritten; prices and trial removed | 4 |
| `src/app/{sign-in,account,connect,upgrade,api/auth}`, `src/lib/{auth,auth-client,auth-cli,session,safe-next,upgrade}.ts`, `src/lib/email/`, `package.json` | Deleted; `better-auth` and `auth` removed | 5 |
| `src/db/migrations/<prefix>_drop_sign_in.ts` | Drops the sign-in tables | 6 |
| `README.md`, `.env.example`, root `README.md`, the abandoned spec and plan | Docs | 7 |

---

### Task 1: Landing page and site shell

**Files:**
- Modify: `lingoflix-server/src/lib/site.ts`, `lingoflix-server/tests/site.test.ts`, `lingoflix-server/tests/pages/public-pages.test.tsx`
- Modify (whole file replaced): `lingoflix-server/src/components/SiteHeader.tsx`, `lingoflix-server/src/components/SiteFooter.tsx`, `lingoflix-server/src/app/page.tsx`, `lingoflix-server/tests/pages/site-shell.test.tsx`
- Delete: `lingoflix-server/src/components/Pricing.tsx`

**Interfaces:**
- Consumes: `SUPPORT_EMAIL` and `chromeStoreUrl(): string | null` (`@/lib/site`), `secondaryButton` (`@/components/styles`), `AddToChrome({ storeUrl }: { storeUrl: string | null })` (`@/components/AddToChrome`).
- Produces:
  - `src/lib/site.ts`: `export const DONATION_LINKS = [{ id: "buymeacoffee", label: "Buy Me a Coffee", url: "https://buymeacoffee.com/jaycho1214" }, { id: "github-sponsors", label: "GitHub Sponsors", url: "https://github.com/sponsors/jaycho1214" }] as const` (the same ids, labels and URLs as the extension's `DONATION_LINKS` in `lingoflix-extension/src/lib/config.ts`, without its `shortLabel`). This task's footer and landing page use it.
  - `/`: a section with `id="support"`, labelled by its heading `Support LingoFlix`. The header's `Support` link (`/#support`) points to it.
  - `Pricing` (`@/components/Pricing`) is gone.

`PRICE_MONTHLY`, `PRICE_YEARLY` and `TRIAL_DAYS` stay in `site.ts` for now: the terms page still uses all three, and the welcome page uses `TRIAL_DAYS`. Task 4 removes them with the terms rewrite. The hero's `See pricing` link goes (there is no pricing section to point at). Spec §5.1 puts the support email next to Privacy and Terms in the footer; the old footer didn't have it, so it is added here.

Copy (exact, spec §5.5):
- The "Explain any line" feature: `Hover a subtitle or press E. LingoFlix explains what it means in this scene, the key expressions, and how to use them, with your own Claude or OpenAI key.`
- Section heading `Free, with your own key`, text `LingoFlix is free. Explanations use your own Claude or OpenAI API key, so they're billed by Anthropic or OpenAI at their prices. Everything else costs nothing.`
- Section heading `Support LingoFlix`, text `If LingoFlix helps you learn, you can support it.`, then the two donation links (`Buy Me a Coffee`, `GitHub Sponsors`).
- Header: `Support`. Footer links, in order: `Privacy`, `Terms`, `support@lingoflix.lipsum.fun`, `Buy Me a Coffee`, `GitHub Sponsors`.

- [ ] **Step 1: Write the failing tests**

In `lingoflix-server/tests/site.test.ts`, add `DONATION_LINKS,` as the first name in the `@/lib/site` import list (before `PRICE_MONTHLY,`), and add this test at the end of `describe("site constants", ...)`:

```ts
  it("links the same two donation pages as the extension", () => {
    expect(DONATION_LINKS).toEqual([
      { id: "buymeacoffee", label: "Buy Me a Coffee", url: "https://buymeacoffee.com/jaycho1214" },
      { id: "github-sponsors", label: "GitHub Sponsors", url: "https://github.com/sponsors/jaycho1214" },
    ]);
  });
```

Replace the whole content of `lingoflix-server/tests/pages/site-shell.test.tsx` with (the `Pricing` tests go with the component):

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AddToChrome } from "@/components/AddToChrome";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

afterEach(cleanup);

const EM_DASH = /\u2014/;
const STORE_URL = "https://chromewebstore.google.com/detail/lingoflix/abcdefghijklmnopabcdefghijklmnop";

/** Every link in `container` as [text, href], in page order. */
const linksIn = (container: HTMLElement) =>
  within(container)
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);

describe("SiteHeader", () => {
  it("links home and the Support section, and nothing else", () => {
    render(<SiteHeader />);
    expect(linksIn(screen.getByRole("navigation", { name: "Main" }))).toEqual([
      ["LingoFlix", "/"],
      ["Support", "/#support"],
    ]);
  });
});

describe("SiteFooter", () => {
  it("links privacy, terms, the support email and both donation pages, with the disclaimer and copyright", () => {
    render(<SiteFooter />);
    expect(linksIn(screen.getByRole("navigation", { name: "Footer" }))).toEqual([
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["support@lingoflix.lipsum.fun", "mailto:support@lingoflix.lipsum.fun"],
      ["Buy Me a Coffee", "https://buymeacoffee.com/jaycho1214"],
      ["GitHub Sponsors", "https://github.com/sponsors/jaycho1214"],
    ]);
    expect(screen.getByText("Not affiliated with or endorsed by Netflix.")).toBeTruthy();
    expect(screen.getByText("© 2026 LingoFlix")).toBeTruthy();
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
        <AddToChrome storeUrl={null} />
        <SiteFooter />
      </>,
    );
    expect(document.body.textContent).not.toMatch(EM_DASH);
  });
});
```

In `lingoflix-server/tests/pages/public-pages.test.tsx`, replace the `cellsOf` helper:

```tsx
const cellsOf = (rowName: RegExp) =>
  within(screen.getByRole("row", { name: rowName }))
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
```

with:

```tsx
/** Every link in `container` as [text, href], in page order. */
const linksIn = (container: HTMLElement) =>
  within(container)
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);
```

In the same file, inside `describe("home page", ...)`, replace this line at the end of `it("leads with what LingoFlix does", ...)`:

```tsx
    expect(screen.getByRole("link", { name: "See pricing" }).getAttribute("href")).toBe("#pricing");
```

with:

```tsx
    expect(
      screen.getByText(
        "Hover a subtitle or press E. LingoFlix explains what it means in this scene, the key expressions, and how to use them, with your own Claude or OpenAI key.",
      ),
    ).toBeTruthy();
```

and replace the two tests `it("compares Free and Premium as spec §3 does", ...)` and `it("includes the pricing section", ...)` (all of both) with:

```tsx
  it("says it is free with your own key, with no plans or prices", () => {
    render(<HomePage />);
    const free = screen.getByRole("region", { name: "Free, with your own key" });
    expect(
      within(free).getByText(
        "LingoFlix is free. Explanations use your own Claude or OpenAI API key, so they're billed by Anthropic or OpenAI at their prices. Everything else costs nothing.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Premium|pricing|trial|\$/i);
  });

  it("asks for support, with both donation links, in the section the header links to", () => {
    render(<HomePage />);
    const support = screen.getByRole("region", { name: "Support LingoFlix" });
    expect(support.id).toBe("support");
    expect(within(support).getByText("If LingoFlix helps you learn, you can support it.")).toBeTruthy();
    expect(linksIn(support)).toEqual([
      ["Buy Me a Coffee", "https://buymeacoffee.com/jaycho1214"],
      ["GitHub Sponsors", "https://github.com/sponsors/jaycho1214"],
    ]);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/site.test.ts tests/pages/site-shell.test.tsx tests/pages/public-pages.test.tsx`
Expected: FAIL, 6 failed | 19 passed (25):
- `site constants > links the same two donation pages as the extension`: `AssertionError: expected undefined to deeply equal [ { id: 'buymeacoffee', …(2) }, …(1) ]`
- `SiteHeader > links home and the Support section, and nothing else`: `AssertionError: expected [ [ 'LingoFlix', '/' ], …(2) ] to deeply equal [ [ 'LingoFlix', '/' ], …(1) ]`
- `SiteFooter > links privacy, terms, the support email and both donation pages, ...`: `AssertionError: expected [ [ 'Privacy', '/privacy' ], …(2) ] to deeply equal [ [ 'Privacy', '/privacy' ], …(4) ]`
- `home page > leads with what LingoFlix does`: `TestingLibraryElementError: Unable to find an element with the text: Hover a subtitle or press E. LingoFlix explains what it means in this scene, the key expressions, and how to use them, with your own Claude or OpenAI key..`
- `home page > says it is free with your own key, ...`: `TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Free, with your own key"`
- `home page > asks for support, ...`: `TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Support LingoFlix"`

- [ ] **Step 3: Add the donation links, the new header, footer and landing page; delete Pricing**

In `lingoflix-server/src/lib/site.ts`, directly below `export const TRIAL_DAYS = 7;`, add:

```ts

/** Where to donate: the same two pages as the extension's `DONATION_LINKS` (lingoflix-extension/src/lib/config.ts). */
export const DONATION_LINKS = [
  { id: "buymeacoffee", label: "Buy Me a Coffee", url: "https://buymeacoffee.com/jaycho1214" },
  { id: "github-sponsors", label: "GitHub Sponsors", url: "https://github.com/sponsors/jaycho1214" },
] as const;
```

Replace the whole content of `lingoflix-server/src/components/SiteHeader.tsx` with:

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
          <Link href="/#support" className="hover:underline">
            Support
          </Link>
        </div>
      </nav>
    </header>
  );
}
```

Replace the whole content of `lingoflix-server/src/components/SiteFooter.tsx` with:

```tsx
import Link from "next/link";
import { DONATION_LINKS, SUPPORT_EMAIL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t-2 border-line">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2 font-bold">
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:underline">
            {SUPPORT_EMAIL}
          </a>
          {DONATION_LINKS.map((link) => (
            <a key={link.id} href={link.url} className="hover:underline">
              {link.label}
            </a>
          ))}
        </nav>
        <p>Not affiliated with or endorsed by Netflix.</p>
        <p>© 2026 LingoFlix</p>
      </div>
    </footer>
  );
}
```

Replace the whole content of `lingoflix-server/src/app/page.tsx` with:

```tsx
import { AddToChrome } from "@/components/AddToChrome";
import { secondaryButton } from "@/components/styles";
import { DONATION_LINKS, chromeStoreUrl } from "@/lib/site";

const FEATURES = [
  {
    title: "Explain any line",
    body: "Hover a subtitle or press E. LingoFlix explains what it means in this scene, the key expressions, and how to use them, with your own Claude or OpenAI key.",
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

export default function HomePage() {
  return (
    <div className="flex flex-col gap-14">
      <section className="flex flex-col items-start gap-5">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Understand every line on Netflix</h1>
        <p className="max-w-2xl text-lg text-mute">
          LingoFlix is a Chrome extension for learning languages with the shows you already watch.
        </p>
        <AddToChrome storeUrl={chromeStoreUrl()} />
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

      <section
        aria-labelledby="free-heading"
        className="rounded-3xl border-2 border-tint-line bg-tint px-6 py-8 sm:px-10"
      >
        <h2 id="free-heading" className="text-2xl font-black">
          Free, with your own key
        </h2>
        <p className="mt-2 max-w-2xl text-lg">
          {
            "LingoFlix is free. Explanations use your own Claude or OpenAI API key, so they're billed by Anthropic or OpenAI at their prices. Everything else costs nothing."
          }
        </p>
      </section>

      <section id="support" aria-labelledby="support-heading">
        <h2 id="support-heading" className="text-2xl font-black">
          Support LingoFlix
        </h2>
        <p className="mt-2 text-mute">If LingoFlix helps you learn, you can support it.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {DONATION_LINKS.map((link) => (
            <a key={link.id} href={link.url} className={secondaryButton}>
              {link.label}
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
```

Delete the pricing component (nothing imports it any more):

```bash
git rm lingoflix-server/src/components/Pricing.tsx
```

- [ ] **Step 4: Run the tests again**

Run: `pnpm --filter lingoflix-server exec vitest run tests/site.test.ts tests/pages/site-shell.test.tsx tests/pages/public-pages.test.tsx`
Expected: PASS (3 files, 25 tests).

- [ ] **Step 5: Run everything**

Run: `pnpm --filter lingoflix-server test`
Expected: PASS (22 files, 176 tests).

Run: `pnpm --filter lingoflix-server compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-server lint`
Expected: exit 0 with no warnings.

- [ ] **Step 6: Commit**

```bash
git add lingoflix-server/src/lib/site.ts lingoflix-server/src/components lingoflix-server/src/app/page.tsx lingoflix-server/tests/site.test.ts lingoflix-server/tests/pages
git commit -m "feat(server): landing page is free with your own key, with a Support section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Welcome page

**Files:**
- Modify: `lingoflix-server/tests/pages/public-pages.test.tsx`
- Modify (whole file replaced): `lingoflix-server/src/app/welcome/page.tsx`

**Interfaces:**
- Consumes: Task 1's `linksIn(container: HTMLElement)` helper in `tests/pages/public-pages.test.tsx`.
- Produces: `/welcome` with no `/upgrade` or `/sign-in` link and no Premium copy. The page no longer imports `TRIAL_DAYS`, `primaryButton`, `secondaryButton` or `Link`. `TRIAL_DAYS` itself stays in `site.ts` until Task 4 (the terms page still uses it).

The shortcut table loses the `B` row (Save this line was Premium work and doesn't exist). The Premium box becomes `Add your key`. The two addresses in step 1 link to the same key pages as the extension's Settings card (spec §3.3); the copy itself is unchanged.

Copy (exact, spec §5.5):
- Heading `Add your key`, then a numbered list:
  1. `Get an API key from Anthropic (console.anthropic.com) or OpenAI (platform.openai.com).` (`console.anthropic.com` links to `https://console.anthropic.com/settings/keys`, `platform.openai.com` to `https://platform.openai.com/api-keys`)
  2. `Click the LingoFlix icon in Chrome's toolbar, then Add your API key.`
  3. `Paste the key, press Save, then Test key.`
- Below the list: `Usage is billed by Anthropic or OpenAI. Your key stays on this computer.`

- [ ] **Step 1: Write the failing tests**

In `lingoflix-server/tests/pages/public-pages.test.tsx`, inside `it("thanks the learner and lists the main shortcuts", ...)`, delete this row from the expected shortcuts:

```tsx
      ["Save the line to your Study Log", "B"],
```

and replace the whole `it("offers the trial and sign-in", ...)` test with:

```tsx
  it("says how to add a Claude or OpenAI key, with no trial or sign-in", () => {
    render(<WelcomePage />);
    const key = screen.getByRole("region", { name: "Add your key" });
    expect(
      within(key)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual([
      "Get an API key from Anthropic (console.anthropic.com) or OpenAI (platform.openai.com).",
      "Click the LingoFlix icon in Chrome's toolbar, then Add your API key.",
      "Paste the key, press Save, then Test key.",
    ]);
    expect(within(key).getByText("Usage is billed by Anthropic or OpenAI. Your key stays on this computer.")).toBeTruthy();
    // The only links on the page are the two key pages: nothing to /upgrade or /sign-in.
    expect(linksIn(document.body)).toEqual([
      ["console.anthropic.com", "https://console.anthropic.com/settings/keys"],
      ["platform.openai.com", "https://platform.openai.com/api-keys"],
    ]);
    expect(document.body.textContent).not.toMatch(/Premium|trial|sign in/i);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/pages/public-pages.test.tsx`
Expected: FAIL, 2 failed | 12 passed (14):
- `welcome page > thanks the learner and lists the main shortcuts`: `AssertionError: expected [ [ …(2) ], [ …(2) ], [ …(2) ], …(2) ] to deeply equal [ [ …(2) ], [ …(2) ], [ …(2) ], …(1) ]` (the diff shows the extra `"Save the line to your Study Log", "B"` row)
- `welcome page > says how to add a Claude or OpenAI key, with no trial or sign-in`: `TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Add your key"`

- [ ] **Step 3: Write the page**

Replace the whole content of `lingoflix-server/src/app/welcome/page.tsx` with:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Welcome" };

const SHORTCUTS: [string, string][] = [
  ["Explain the current line", "E"],
  ["Go to the previous or next line", "A / D"],
  ["Replay the current line", "R"],
  ["Hide or show subtitles", "C"],
];

/** Where each provider makes API keys (the same pages the extension's Settings card links to). */
const ANTHROPIC_KEYS_URL = "https://console.anthropic.com/settings/keys";
const OPENAI_KEYS_URL = "https://platform.openai.com/api-keys";

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

      <section aria-labelledby="key-heading" className="rounded-3xl border-2 border-tint-line bg-tint px-6 py-8">
        <h2 id="key-heading" className="text-2xl font-black">
          Add your key
        </h2>
        <ol className="mt-3 list-decimal space-y-1 pl-6 font-semibold">
          <li>
            Get an API key from Anthropic (
            <a href={ANTHROPIC_KEYS_URL} className="underline">
              console.anthropic.com
            </a>
            ) or OpenAI (
            <a href={OPENAI_KEYS_URL} className="underline">
              platform.openai.com
            </a>
            ).
          </li>
          <li>{"Click the LingoFlix icon in Chrome's toolbar, then Add your API key."}</li>
          <li>Paste the key, press Save, then Test key.</li>
        </ol>
        <p className="mt-4">Usage is billed by Anthropic or OpenAI. Your key stays on this computer.</p>
      </section>
    </div>
  );
}
```

JSX trims the line breaks around the two links in step 1, so its text reads exactly `...Anthropic (console.anthropic.com) or OpenAI (platform.openai.com).` with no stray spaces; the test checks it.

- [ ] **Step 4: Run the tests again**

Run: `pnpm --filter lingoflix-server exec vitest run tests/pages/public-pages.test.tsx`
Expected: PASS (14 tests).

- [ ] **Step 5: Run everything**

Run: `pnpm --filter lingoflix-server test`
Expected: PASS (22 files, 176 tests).

Run: `pnpm --filter lingoflix-server compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-server lint`
Expected: exit 0 with no warnings.

- [ ] **Step 6: Commit**

```bash
git add lingoflix-server/src/app/welcome/page.tsx lingoflix-server/tests/pages/public-pages.test.tsx
git commit -m "feat(server): welcome page says how to add a Claude or OpenAI key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Goodbye: the copy and the cap

**Files:**
- Modify: `lingoflix-server/src/lib/goodbye.ts`, `lingoflix-server/tests/goodbye.test.ts`, `lingoflix-server/tests/goodbye-form.test.tsx`
- Modify (whole file replaced): `lingoflix-server/src/app/goodbye/page.tsx`

**Interfaces:**
- Consumes: `createTestDb()` (`tests/support/test-db.ts`), `createGoodbyeHandler(openDb: () => Kysely<Database>)`, `GOODBYE_REASONS`, `GOODBYE_REASON_LABELS` (`@/lib/goodbye`), `sql` (`kysely`).
- Produces:
  - `src/lib/goodbye.ts`: `export const GOODBYE_ANSWERS_PER_HOUR = 100`. `GOODBYE_REASON_LABELS["too-expensive"]` is `"The AI costs too much on my key"` (the stored value stays `too-expensive`).
  - `POST /api/goodbye` (spec §5.4): stores at most 100 answers in any rolling hour, in total. Past that it answers `201 { ok: true }` exactly as for a stored answer and stores nothing. The count and the insert are one statement; no IP address is read or stored.

The handler's insert becomes one `insert ... select ... where (count of the last hour) < 100` statement. Kysely compiles it to:

```sql
insert into "uninstall_feedback" ("reason", "comment") select $1 as "reason", $2 as "comment" where (select count(*) as "recent" from "uninstall_feedback" where "created_at" > now() - interval '1 hour') < $3
```

Postgres types `$1` and `$2` from the target columns, so a `null` comment needs no cast; the tests run the statement on PGlite (Postgres compiled to WebAssembly). Under concurrent requests the cap is soft (two statements can both see 99), which is fine for a spam guard.

Copy (exact, spec §5.5): the `too-expensive` label is `The AI costs too much on my key`. The paragraph `Uninstalling LingoFlix doesn't cancel Premium. Manage or cancel it from your account.` and its `/account` link go.

- [ ] **Step 1: Write the failing tests**

In `lingoflix-server/tests/goodbye.test.ts`:

Replace `import type { Kysely } from "kysely";` with:

```ts
import { sql, type Kysely } from "kysely";
```

Add `GOODBYE_ANSWERS_PER_HOUR,` as the first name in the `@/lib/goodbye` import list (before `GOODBYE_COMMENT_MAX,`).

In `it("has a label for every reason", ...)`, replace `"It costs too much",` with:

```ts
      "The AI costs too much on my key",
```

In `describe("POST /api/goodbye", ...)`, directly below the `stored` helper (`const stored = () => db.selectFrom("uninstall_feedback").selectAll().execute();`), add:

```ts
  /** Puts `count` answers sent `minutesAgo` minutes ago straight into the table. */
  const seed = (count: number, minutesAgo: number) =>
    sql`insert into uninstall_feedback (reason, created_at) select 'other', now() - make_interval(mins => ${minutesAgo}) from generate_series(1, ${count})`.execute(
      db,
    );
```

and add these tests at the end of the same `describe("POST /api/goodbye", ...)` (after the `it.each(...)("rejects %s with 400 and stores nothing", ...)` test):

```ts
  it("stores at most 100 answers an hour", () => {
    expect(GOODBYE_ANSWERS_PER_HOUR).toBe(100);
  });

  it("stores the 100th answer of the hour", async () => {
    await seed(99, 0);
    expect((await post(JSON.stringify({ reason: "other" }))).status).toBe(201);
    expect(await stored()).toHaveLength(100);
  });

  it("past 100 answers in the last hour, says thanks and stores nothing", async () => {
    await seed(100, 0);
    const res = await post(JSON.stringify({ reason: "not-working", comment: "One too many" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await stored();
    expect(rows).toHaveLength(100);
    expect(rows.map((row) => row.comment)).not.toContain("One too many");
  });

  it("doesn't count answers older than an hour", async () => {
    await seed(100, 61);
    expect((await post(JSON.stringify({ reason: "other" }))).status).toBe(201);
    expect(await stored()).toHaveLength(101);
  });

  it("answers the 101st exactly as the 100th, which it stored", async () => {
    await seed(99, 0);
    const storedRes = await post(JSON.stringify({ reason: "other" }));
    const cappedRes = await post(JSON.stringify({ reason: "other" }));
    expect(await stored()).toHaveLength(100);
    expect(cappedRes.status).toBe(storedRes.status);
    expect([...cappedRes.headers]).toEqual([...storedRes.headers]);
    expect(await cappedRes.text()).toBe(await storedRes.text());
  });
```

In `lingoflix-server/tests/goodbye-form.test.tsx`, replace both `choose("It costs too much");` lines (in `it("moves focus to the thank-you message, ...")` and in the `it.each(...)("says so when %s, ...")` test) with:

```tsx
    choose("The AI costs too much on my key");
```

and replace the whole `describe("the goodbye page", ...)` block with:

```tsx
describe("the goodbye page", () => {
  it("asks why, with nothing about Premium or an account", () => {
    render(<GoodbyePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Sorry to see you go" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect((screen.getByRole("radio", { name: "The AI costs too much on my key" }) as HTMLInputElement).value).toBe(
      "too-expensive",
    );
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(document.body.textContent).not.toMatch(/Premium|account/i);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/goodbye.test.ts tests/goodbye-form.test.tsx`
Expected: FAIL, 8 failed | 29 passed (37):
- `parseGoodbye > has a label for every reason`: `AssertionError: expected [ 'It costs too much', …(4) ] to deeply equal [ …(5) ]`
- `POST /api/goodbye > stores at most 100 answers an hour`: `AssertionError: expected undefined to be 100 // Object.is equality`
- `POST /api/goodbye > past 100 answers in the last hour, says thanks and stores nothing` and `POST /api/goodbye > answers the 101st exactly as the 100th, which it stored`: `AssertionError: expected [ { id: '…', …(3) }, …(100) ] to have a length of 100 but got 101` (the id varies)
- the 3 `GoodbyeForm` tests that choose the relabelled reason, and `the goodbye page > asks why, with nothing about Premium or an account`: `TestingLibraryElementError: Unable to find an accessible element with the role "radio" and name "The AI costs too much on my key"`

`stores the 100th answer of the hour` and `doesn't count answers older than an hour` already pass (nothing is capped yet); they guard the boundary once the cap exists.

- [ ] **Step 3: Relabel the reason and cap the insert**

In `lingoflix-server/src/lib/goodbye.ts`:

Replace `import type { Kysely } from "kysely";` with:

```ts
import { sql, type Kysely } from "kysely";
```

Replace `  "too-expensive": "It costs too much",` with:

```ts
  "too-expensive": "The AI costs too much on my key",
```

Directly below `export const GOODBYE_COMMENT_MAX = 500;`, add:

```ts
/** At most this many answers are stored per hour, in total (free-own-key spec §5.4). */
export const GOODBYE_ANSWERS_PER_HOUR = 100;
```

Replace the doc comment of `createGoodbyeHandler`:

```ts
/**
 * POST /api/goodbye (spec §5.4). No sign-in. Stores only the reason, the comment and the time:
 * never a user, an IP address or request headers. `openDb` is called per request, so importing
 * the route needs no environment.
 */
```

with:

```ts
/**
 * POST /api/goodbye (spec §5.4). No sign-in. Stores only the reason, the comment and the time:
 * never a user, an IP address or request headers. Past GOODBYE_ANSWERS_PER_HOUR answers in the last hour it
 * stores nothing but answers the same, so the page still says thanks. `openDb` is called per request, so
 * importing the route needs no environment.
 */
```

and replace the insert:

```ts
    await openDb()
      .insertInto("uninstall_feedback")
      .values({ reason: feedback.reason, comment: feedback.comment })
      .execute();
```

with:

```ts
    // One statement counts the last hour's answers and inserts only below the cap.
    const db = openDb();
    await db
      .insertInto("uninstall_feedback")
      .columns(["reason", "comment"])
      .expression(
        db
          .selectNoFrom((eb) => [eb.val(feedback.reason).as("reason"), eb.val(feedback.comment).as("comment")])
          .where(
            (eb) =>
              eb
                .selectFrom("uninstall_feedback")
                .select(eb.fn.countAll().as("recent"))
                .where("created_at", ">", sql<Date>`now() - interval '1 hour'`),
            "<",
            GOODBYE_ANSWERS_PER_HOUR,
          ),
      )
      .execute();
```

(`return Response.json({ ok: true }, { status: 201 });` below it is unchanged, so a capped answer gets the same response.)

- [ ] **Step 4: Remove the Premium note from the page**

Replace the whole content of `lingoflix-server/src/app/goodbye/page.tsx` with:

```tsx
import type { Metadata } from "next";
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
    </div>
  );
}
```

- [ ] **Step 5: Run the tests again**

Run: `pnpm --filter lingoflix-server exec vitest run tests/goodbye.test.ts tests/goodbye-form.test.tsx`
Expected: PASS (37 tests).

- [ ] **Step 6: Run everything**

Run: `pnpm --filter lingoflix-server test`
Expected: PASS (22 files, 181 tests).

Run: `pnpm --filter lingoflix-server compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-server lint`
Expected: exit 0 with no warnings.

- [ ] **Step 7: Commit**

```bash
git add lingoflix-server/src/app/goodbye/page.tsx lingoflix-server/src/lib/goodbye.ts lingoflix-server/tests/goodbye-form.test.tsx lingoflix-server/tests/goodbye.test.ts
git commit -m "feat(server): goodbye page drops Premium, and stores at most 100 answers an hour

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Privacy and terms

**Files:**
- Modify: `lingoflix-server/src/lib/site.ts`, `lingoflix-server/tests/site.test.ts`, `lingoflix-server/tests/pages/public-pages.test.tsx`
- Modify (whole file replaced): `lingoflix-server/src/app/privacy/page.tsx`, `lingoflix-server/src/app/terms/page.tsx`

**Interfaces:**
- Consumes: `SUPPORT_EMAIL` (`@/lib/site`).
- Produces:
  - `/privacy` and `/terms` rewritten per spec §5.6 and §5.7, dated `October 11, 2026`.
  - `src/lib/site.ts` loses `PRICE_MONTHLY`, `PRICE_YEARLY` and `TRIAL_DAYS` (spec §5.2): the terms page was their last user. After this task `site.ts` exports `SITE_NAME`, `SITE_URL`, `SUPPORT_EMAIL`, `DONATION_LINKS` and `chromeStoreUrl`.

The privacy page's sections are labelled by their headings (`aria-labelledby`), so the tests find the lists through the `When you ask for an explanation` and `Services` regions. The providers' privacy policies are linked at `https://www.anthropic.com/legal/privacy` and `https://openai.com/policies/privacy-policy/`.

The word "account" can't simply be banned from the privacy page: the spec's own points say LingoFlix has no accounts, the site keeps no account, and the AI runs on your own account. The test pins the only three places it may appear instead.

Copy (exact):
- Privacy (`Last updated: October 11, 2026`):
  - `On your computer only`: `Your Study Log, settings, reminders (including the show you last watched) and your API key stay on your computer.` / `LingoFlix has no accounts, and this site sets no cookies.`
  - `When you ask for an explanation`: `When you ask for an explanation or a follow-up, the extension sends these straight from your browser to Anthropic or OpenAI (whichever your key belongs to), with your key and never through LingoFlix's server:` then the list `The line and the dialogue around it.`, `The show and episode.`, `The story so far, if "Send the story so far" is on.`, `Your recent saved items and explained lines.`, then `Requests to OpenAI ask it not to store them.` and `Anthropic's privacy policy and OpenAI's privacy policy apply.` (each policy name a link).
  - `What this site keeps`: `Only your optional answer on the uninstall page: the reason, the comment and the time, with no IP address or account.`
  - `Services`: `Anthropic or OpenAI (your own account) write the explanations and answers.`, `Vercel hosts this site.`, `Neon hosts its database.`, `Cloudflare forwards email sent to support.` (service names in bold)
  - `Contact`: `Questions? Email support@lingoflix.lipsum.fun.`
- Terms (`Last updated: October 11, 2026`), one section each:
  - `Free, as is`: `LingoFlix is free and provided as is, without warranty.`
  - `What you need`: `You need your own Netflix subscription and your own Claude or OpenAI API key.` / `Anthropic or OpenAI bills you for what your key uses, under its own terms.`
  - `AI answers`: `AI answers can be wrong.`
  - `Not affiliated`: `LingoFlix isn't affiliated with Netflix, Anthropic or OpenAI.`
  - `Donations`: `Donations are voluntary and unlock nothing.`
  - `Changes and contact`: `These terms may change. The date at the top shows when they last did.` / `Questions? Email support@lingoflix.lipsum.fun.`

- [ ] **Step 1: Write the failing tests**

In `lingoflix-server/tests/site.test.ts`, replace the `@/lib/site` import (the multi-line `import { DONATION_LINKS, PRICE_MONTHLY, ... chromeStoreUrl } from "@/lib/site";`) with:

```ts
import * as site from "@/lib/site";
import { DONATION_LINKS, SITE_NAME, SITE_URL, SUPPORT_EMAIL, chromeStoreUrl } from "@/lib/site";
```

and replace the test `it("names the product, its address, its support email and its prices", ...)` with:

```ts
  it("names the product, its address and its support email", () => {
    expect(SITE_NAME).toBe("LingoFlix");
    expect(SITE_URL).toBe("https://lingoflix.lipsum.fun");
    expect(SUPPORT_EMAIL).toBe("support@lingoflix.lipsum.fun");
  });

  it("has no prices or trial: LingoFlix is free", () => {
    expect(Object.keys(site).filter((name) => /PRICE|TRIAL/.test(name))).toEqual([]);
  });
```

In `lingoflix-server/tests/pages/public-pages.test.tsx`, replace the whole `describe("privacy policy", ...)` and `describe("terms of service", ...)` blocks (everything between the `welcome page` block and `describe("copy", ...)`) with:

```tsx
describe("privacy policy", () => {
  it("is dated the day the free site ships", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeTruthy();
    expect(screen.getByText("Last updated: October 11, 2026")).toBeTruthy();
  });

  it("says everything stays on the computer, with no accounts or cookies", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText(
        "Your Study Log, settings, reminders (including the show you last watched) and your API key stay on your computer.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("LingoFlix has no accounts, and this site sets no cookies.")).toBeTruthy();
  });

  it("says what an explanation sends, straight to Anthropic or OpenAI and never through LingoFlix's server", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText(
        "When you ask for an explanation or a follow-up, the extension sends these straight from your browser to Anthropic or OpenAI (whichever your key belongs to), with your key and never through LingoFlix's server:",
      ),
    ).toBeTruthy();
    const sent = within(screen.getByRole("region", { name: "When you ask for an explanation" })).getByRole("list");
    expect(
      within(sent)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "The line and the dialogue around it.",
      "The show and episode.",
      'The story so far, if "Send the story so far" is on.',
      "Your recent saved items and explained lines.",
    ]);
    expect(screen.getByText("Requests to OpenAI ask it not to store them.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Anthropic's privacy policy" }).getAttribute("href")).toBe(
      "https://www.anthropic.com/legal/privacy",
    );
    expect(screen.getByRole("link", { name: "OpenAI's privacy policy" }).getAttribute("href")).toBe(
      "https://openai.com/policies/privacy-policy/",
    );
  });

  it("says the site keeps only the optional uninstall answer", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText(
        "Only your optional answer on the uninstall page: the reason, the comment and the time, with no IP address or account.",
      ),
    ).toBeTruthy();
  });

  it("lists the services and the contact email", () => {
    render(<PrivacyPage />);
    const services = within(screen.getByRole("region", { name: "Services" })).getByRole("list");
    expect(
      within(services)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Anthropic or OpenAI (your own account) write the explanations and answers.",
      "Vercel hosts this site.",
      "Neon hosts its database.",
      "Cloudflare forwards email sent to support.",
    ]);
    const contact = screen.getByRole("link", { name: "support@lingoflix.lipsum.fun" });
    expect(contact.getAttribute("href")).toBe("mailto:support@lingoflix.lipsum.fun");
  });

  it("says nothing about Stripe, Premium, sign-in or our server, and mentions accounts only to say there are none", () => {
    render(<PrivacyPage />);
    expect(document.body.textContent).not.toMatch(/Stripe|Premium|our server|sign in|sign-in|subscription/i);
    expect(screen.getAllByText(/account/i).map((element) => element.textContent)).toEqual([
      "LingoFlix has no accounts, and this site sets no cookies.",
      "Only your optional answer on the uninstall page: the reason, the comment and the time, with no IP address or account.",
      "Anthropic or OpenAI (your own account) write the explanations and answers.",
    ]);
  });
});

describe("terms of service", () => {
  it("states the free terms, dated the day the free site ships", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Terms of service" })).toBeTruthy();
    expect(screen.getByText("Last updated: October 11, 2026")).toBeTruthy();
    for (const sentence of [
      "LingoFlix is free and provided as is, without warranty.",
      "You need your own Netflix subscription and your own Claude or OpenAI API key.",
      "Anthropic or OpenAI bills you for what your key uses, under its own terms.",
      "AI answers can be wrong.",
      "LingoFlix isn't affiliated with Netflix, Anthropic or OpenAI.",
      "Donations are voluntary and unlock nothing.",
      "These terms may change. The date at the top shows when they last did.",
    ]) {
      expect(screen.getByText(sentence)).toBeTruthy();
    }
    const contact = screen.getByRole("link", { name: "support@lingoflix.lipsum.fun" });
    expect(contact.getAttribute("href")).toBe("mailto:support@lingoflix.lipsum.fun");
  });

  it("says nothing about Premium, Stripe, prices, trials, refunds or accounts", () => {
    render(<TermsPage />);
    expect(document.body.textContent).not.toMatch(/Premium|Stripe|\$|trial|refund|account/i);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/site.test.ts tests/pages/public-pages.test.tsx`
Expected: FAIL, 9 failed | 18 passed (27):
- `site constants > has no prices or trial: LingoFlix is free`: `AssertionError: expected [ 'PRICE_MONTHLY', …(2) ] to deeply equal []`
- `privacy policy > is dated the day the free site ships` and `terms of service > states the free terms, ...`: `TestingLibraryElementError: Unable to find an element with the text: Last updated: October 11, 2026. ...`
- `privacy policy > says everything stays on the computer, ...`: `TestingLibraryElementError: Unable to find an element with the text: Your Study Log, settings, reminders (including the show you last watched) and your API key stay on your computer.. ...`
- `privacy policy > says what an explanation sends, ...`: `TestingLibraryElementError: Unable to find an element with the text: When you ask for an explanation or a follow-up, the extension sends these straight from your browser ...`
- `privacy policy > says the site keeps only the optional uninstall answer`: `TestingLibraryElementError: Unable to find an element with the text: Only your optional answer on the uninstall page: ...`
- `privacy policy > lists the services and the contact email`: `TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Services"`
- `privacy policy > says nothing about Stripe, Premium, sign-in or our server, ...`: `AssertionError: expected 'Privacy policyLast updated: October 1…' not to match /Stripe|Premium|our server|sign in|si…/i`
- `terms of service > says nothing about Premium, Stripe, prices, trials, refunds or accounts`: `AssertionError: expected 'Terms of serviceLast updated: October…' not to match /Premium|Stripe|\$|trial|refund|accou…/i`

- [ ] **Step 3: Rewrite both pages and drop the price constants**

Replace the whole content of `lingoflix-server/src/app/privacy/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy policy" };

const ANTHROPIC_PRIVACY_URL = "https://www.anthropic.com/legal/privacy";
const OPENAI_PRIVACY_URL = "https://openai.com/policies/privacy-policy/";

/** What the extension sends with each explanation or follow-up (free-own-key spec §5.6). */
const SENT = [
  "The line and the dialogue around it.",
  "The show and episode.",
  'The story so far, if "Send the story so far" is on.',
  "Your recent saved items and explained lines.",
];

const SERVICES: [string, string][] = [
  ["Anthropic or OpenAI", "(your own account) write the explanations and answers."],
  ["Vercel", "hosts this site."],
  ["Neon", "hosts its database."],
  ["Cloudflare", "forwards email sent to support."],
];

export default function PrivacyPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6 leading-relaxed">
      <header>
        <h1 className="text-4xl font-black tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-sm text-mute">Last updated: October 11, 2026</p>
      </header>

      <section aria-labelledby="computer-heading">
        <h2 id="computer-heading" className="text-2xl font-black">
          On your computer only
        </h2>
        <p className="mt-2">
          Your Study Log, settings, reminders (including the show you last watched) and your API key stay on your
          computer.
        </p>
        <p className="mt-2">LingoFlix has no accounts, and this site sets no cookies.</p>
      </section>

      <section aria-labelledby="explanations-heading">
        <h2 id="explanations-heading" className="text-2xl font-black">
          When you ask for an explanation
        </h2>
        <p className="mt-2">
          {
            "When you ask for an explanation or a follow-up, the extension sends these straight from your browser to Anthropic or OpenAI (whichever your key belongs to), with your key and never through LingoFlix's server:"
          }
        </p>
        <ul className="mt-2 list-disc pl-6">
          {SENT.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-2">Requests to OpenAI ask it not to store them.</p>
        <p className="mt-2">
          <a href={ANTHROPIC_PRIVACY_URL} className="font-bold underline">
            {"Anthropic's privacy policy"}
          </a>{" "}
          and{" "}
          <a href={OPENAI_PRIVACY_URL} className="font-bold underline">
            {"OpenAI's privacy policy"}
          </a>{" "}
          apply.
        </p>
      </section>

      <section aria-labelledby="keeps-heading">
        <h2 id="keeps-heading" className="text-2xl font-black">
          What this site keeps
        </h2>
        <p className="mt-2">
          Only your optional answer on the uninstall page: the reason, the comment and the time, with no IP address or
          account.
        </p>
      </section>

      <section aria-labelledby="services-heading">
        <h2 id="services-heading" className="text-2xl font-black">
          Services
        </h2>
        <ul className="mt-2 list-disc pl-6">
          {SERVICES.map(([name, role]) => (
            <li key={name}>
              <strong>{name}</strong> {role}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="contact-heading">
        <h2 id="contact-heading" className="text-2xl font-black">
          Contact
        </h2>
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

Replace the whole content of `lingoflix-server/src/app/terms/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6 leading-relaxed">
      <header>
        <h1 className="text-4xl font-black tracking-tight">Terms of service</h1>
        <p className="mt-2 text-sm text-mute">Last updated: October 11, 2026</p>
      </header>

      <section>
        <h2 className="text-2xl font-black">Free, as is</h2>
        <p className="mt-2">LingoFlix is free and provided as is, without warranty.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">What you need</h2>
        <p className="mt-2">You need your own Netflix subscription and your own Claude or OpenAI API key.</p>
        <p className="mt-2">Anthropic or OpenAI bills you for what your key uses, under its own terms.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">AI answers</h2>
        <p className="mt-2">AI answers can be wrong.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Not affiliated</h2>
        <p className="mt-2">{"LingoFlix isn't affiliated with Netflix, Anthropic or OpenAI."}</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Donations</h2>
        <p className="mt-2">Donations are voluntary and unlock nothing.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Changes and contact</h2>
        <p className="mt-2">These terms may change. The date at the top shows when they last did.</p>
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

In `lingoflix-server/src/lib/site.ts`, replace the first seven lines:

```ts
/** Fixed facts about the LingoFlix site (spec §1, §5.3, §10). */
export const SITE_NAME = "LingoFlix";
export const SITE_URL = "https://lingoflix.lipsum.fun";
export const SUPPORT_EMAIL = "support@lingoflix.lipsum.fun";
export const PRICE_MONTHLY = "$7.99";
export const PRICE_YEARLY = "$59.99";
export const TRIAL_DAYS = 7;
```

with:

```ts
/** Fixed facts about the LingoFlix site (free-own-key spec §5). LingoFlix is free: no prices, no trial. */
export const SITE_NAME = "LingoFlix";
export const SITE_URL = "https://lingoflix.lipsum.fun";
export const SUPPORT_EMAIL = "support@lingoflix.lipsum.fun";
```

Check nothing else used them: `git grep -n "PRICE_\|TRIAL_DAYS" -- lingoflix-server/src lingoflix-server/tests` prints nothing.

- [ ] **Step 4: Run the tests again**

Run: `pnpm --filter lingoflix-server exec vitest run tests/site.test.ts tests/pages/public-pages.test.tsx`
Expected: PASS (27 tests).

- [ ] **Step 5: Run everything**

Run: `pnpm --filter lingoflix-server test`
Expected: PASS (22 files, 188 tests).

Run: `pnpm --filter lingoflix-server compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-server lint`
Expected: exit 0 with no warnings.

- [ ] **Step 6: Commit**

```bash
git add lingoflix-server/src/app/privacy/page.tsx lingoflix-server/src/app/terms/page.tsx lingoflix-server/src/lib/site.ts lingoflix-server/tests/pages/public-pages.test.tsx lingoflix-server/tests/site.test.ts
git commit -m "feat(server): privacy and terms for the free extension with your own key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Remove sign-in

**Files:**
- Create: `lingoflix-server/tests/routes.test.ts`
- Modify: `lingoflix-server/package.json`, `pnpm-lock.yaml` (both through `pnpm remove`, plus the script edit), `lingoflix-server/next.config.ts`, `lingoflix-server/tests/next-config.test.ts`
- Delete:
  - Pages and the auth route: `lingoflix-server/src/app/sign-in/` (`page.tsx`, `SignInForm.tsx`), `lingoflix-server/src/app/account/` (`page.tsx`, `AccountSummary.tsx`, `SignOutButton.tsx`), `lingoflix-server/src/app/connect/` (`page.tsx`, `ConnectClient.tsx`), `lingoflix-server/src/app/upgrade/page.tsx`, `lingoflix-server/src/app/api/auth/[...all]/route.ts`
  - Libraries: `lingoflix-server/src/lib/auth.ts`, `auth-client.ts`, `auth-cli.ts` (the Better Auth CLI's config file), `session.ts`, `safe-next.ts`, `upgrade.ts`, and `lingoflix-server/src/lib/email/` (`cloudflare.ts`, `sign-in-email.ts`)
  - Their tests and test support: `lingoflix-server/tests/account/`, `lingoflix-server/tests/auth/` (`auth-client`, `auth`, `env`, `get-auth`, `session`), `lingoflix-server/tests/connect-client.test.tsx`, `lingoflix-server/tests/connect-page.test.tsx`, `lingoflix-server/tests/email/`, `lingoflix-server/tests/lib/` (`safe-next`, `upgrade`), `lingoflix-server/tests/sign-in/`, `lingoflix-server/tests/support/test-auth.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3 (nothing kept links to `/sign-in`, `/account`, `/connect` or `/upgrade` any more). `tests/support/test-db.ts` stays: the goodbye and database tests use it.
- Produces: the server's routes are exactly `/`, `/welcome`, `/goodbye`, `/privacy`, `/terms` and `POST /api/goodbye` (spec §5.1). Packages `better-auth` and `auth` and the `auth:check` script are gone (spec §5.2).

Dependencies: only `better-auth` and `auth` go. Every other package is still used: `@vercel/functions` by `src/db/client.ts` (`attachDatabasePool`, for the goodbye endpoint's pool), `pg` and `kysely` by the database, `@electric-sql/pglite` by the tests, the rest by Next.js, Tailwind, ESLint and Vitest.

The routes test imports each `route.ts` to read which HTTP methods it exports. Importing the old auth route is safe with no environment (its `getAuth()` runs per request), so the RED run needs no variables.

- [ ] **Step 1: Write the failing routes test**

Create `lingoflix-server/tests/routes.test.ts`:

```ts
import { globSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_FOLDER = path.resolve(import.meta.dirname, "../src/app");
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** `welcome/page.tsx` is served at `/welcome`, `page.tsx` at `/`. */
function urlPathOf(file: string): string {
  const folder = path.dirname(file);
  return folder === "." ? "/" : `/${folder.split(path.sep).join("/")}`;
}

/** Every page as its path, and every route handler as `METHOD /path`, sorted. */
async function appRoutes(): Promise<string[]> {
  const routes: string[] = [];
  for (const file of globSync("**/{page,route}.{ts,tsx}", { cwd: APP_FOLDER })) {
    if (path.basename(file).startsWith("page.")) {
      routes.push(urlPathOf(file));
      continue;
    }
    const handlers: Record<string, unknown> = await import(path.join(APP_FOLDER, file));
    for (const method of HTTP_METHODS) {
      if (typeof handlers[method] === "function") routes.push(`${method} ${urlPathOf(file)}`);
    }
  }
  return routes.sort();
}

describe("the site's routes", () => {
  it("are the landing, welcome, goodbye, privacy and terms pages and the goodbye endpoint: no sign-in", async () => {
    expect(await appRoutes()).toEqual(["/", "/goodbye", "/privacy", "/terms", "/welcome", "POST /api/goodbye"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/routes.test.ts`
Expected: FAIL: `AssertionError: expected [ '/', '/account', '/connect', …(9) ] to deeply equal [ '/', '/goodbye', '/privacy', …(3) ]`. The diff lists the extra `/account`, `/connect`, `/sign-in`, `/upgrade`, `GET /api/auth/[...all]` and `POST /api/auth/[...all]`.

- [ ] **Step 3: Delete the sign-in pages, libraries and their tests**

```bash
git rm -r lingoflix-server/src/app/sign-in lingoflix-server/src/app/account lingoflix-server/src/app/connect lingoflix-server/src/app/upgrade lingoflix-server/src/app/api/auth
git rm -r lingoflix-server/src/lib/auth.ts lingoflix-server/src/lib/auth-client.ts lingoflix-server/src/lib/auth-cli.ts lingoflix-server/src/lib/session.ts lingoflix-server/src/lib/safe-next.ts lingoflix-server/src/lib/upgrade.ts lingoflix-server/src/lib/email
git rm -r lingoflix-server/tests/account lingoflix-server/tests/auth lingoflix-server/tests/connect-client.test.tsx lingoflix-server/tests/connect-page.test.tsx lingoflix-server/tests/email lingoflix-server/tests/lib lingoflix-server/tests/sign-in lingoflix-server/tests/support/test-auth.ts
```

- [ ] **Step 4: Remove the packages and the `auth:check` script**

Run: `pnpm --filter lingoflix-server remove better-auth auth`
Expected: exit 0; `better-auth` leaves `dependencies`, `auth` leaves `devDependencies`, and the lockfile loses their packages (`grep -c better-auth pnpm-lock.yaml` prints `0`).

In `lingoflix-server/package.json`, replace:

```json
    "db:list": "kysely migrate list",
    "auth:check": "auth check schema --config src/lib/auth-cli.ts"
  },
```

with:

```json
    "db:list": "kysely migrate list"
  },
```

- [ ] **Step 5: Drop the sign-in wording from the framing rule**

The headers stay (spec §5.2); only the reason changes. In `lingoflix-server/next.config.ts`, replace:

```ts
  // No page may be shown inside another site's frame (clickjacking on sign-in, /connect and the account page).
```

with:

```ts
  // No page may be shown inside another site's frame (clickjacking).
```

In `lingoflix-server/tests/next-config.test.ts`, replace:

```ts
  it("forbids framing on every page, so no other site can overlay the sign-in or account pages", async () => {
```

with:

```ts
  it("forbids framing on every page, so no other site can overlay them", async () => {
```

- [ ] **Step 6: Run the routes test again**

Run: `pnpm --filter lingoflix-server exec vitest run tests/routes.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Run everything, including the build**

Run: `pnpm --filter lingoflix-server test`
Expected: PASS (10 files, 88 tests).

Run: `pnpm --filter lingoflix-server compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-server lint`
Expected: exit 0 with no warnings.

Run: `pnpm --filter lingoflix-server build`
Expected: exit 0, with this route list:

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/goodbye
├ ○ /goodbye
├ ○ /privacy
├ ○ /terms
└ ○ /welcome
```

Check nothing in the kept code still names the removed pieces: `git grep -n -i "better.auth\|/sign-in\|/account\|/connect\|/upgrade" -- lingoflix-server/src lingoflix-server/next.config.ts` prints only `src/db/types.ts` (its comment about Better Auth's tables, which Task 6 rewrites with the migration) and the frozen `src/db/migrations/1791690386107_better_auth.ts`.

- [ ] **Step 8: Commit**

```bash
git add lingoflix-server/tests/routes.test.ts lingoflix-server/next.config.ts lingoflix-server/tests/next-config.test.ts lingoflix-server/package.json pnpm-lock.yaml
git commit -m "feat(server): remove sign-in, accounts and the Premium pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The deletions are already staged by `git rm`.)

### Task 6: Drop the sign-in tables

**Files:**
- Create: `lingoflix-server/src/db/migrations/<timestamp>_drop_sign_in.ts` (made by `db:make`; the lab's was `1791740085106_drop_sign_in.ts`, yours will have the current time)
- Modify: `lingoflix-server/tests/db.test.ts`, `lingoflix-server/src/db/types.ts`

**Interfaces:**
- Consumes: `createTestDb()` and `createMigrator(db)` (`tests/support/test-db.ts`), `NO_MIGRATIONS` (`kysely/migration`), the frozen migration `1791690386107_better_auth` (its `up` statements are copied, not imported).
- Produces: migration `drop_sign_in` (spec §5.3). `up` drops `"session"`, `"account"`, `"verification"` and `"user"`, in that order (the first two reference `"user"`). `down` recreates them exactly as `1791690386107_better_auth`'s `up` does (the same seven statements). After all migrations, the database holds only `uninstall_feedback`. The `better_auth` migration file stays, as history.

`db:make` only writes a file: `kysely.config.ts` builds its pool in a factory, so the command connects to nothing and needs no environment. Running the migration on Neon is a separate, owner-approved step after the trimmed site is deployed (spec §6 item 1): not part of this task.

The rollback test compares every column, index and constraint of the four tables after `drop_sign_in` is rolled back with what `better_auth` itself created on the same database. (In the lab, deleting one `create index` line from `down`, or dropping one `not null`, makes it fail.)

- [ ] **Step 1: Write the failing tests**

In `lingoflix-server/tests/db.test.ts`, replace everything from `async function columnNames(table: string): Promise<string[]> {` down to (not including) `  it("roll back to an empty database", async () => {`, that is the `columnNames` helper, the `describe("migrations", () => {` line, and the tests `create Better Auth's tables and uninstall_feedback` and `give Better Auth the exact camelCase columns it checks for`, with:

```ts
const SIGN_IN_TABLES = ["account", "session", "user", "verification"];

/** Every column, index and constraint of Better Auth's four tables, to compare two schemas. */
async function signInSchema() {
  const tables = sql.join(SIGN_IN_TABLES);
  const columns = await sql`
    select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name in (${tables})
    order by table_name, ordinal_position
  `.execute(db);
  const indexes = await sql`
    select tablename, indexname, indexdef from pg_indexes
    where schemaname = 'public' and tablename in (${tables})
    order by tablename, indexname
  `.execute(db);
  const constraints = await sql`
    select cl.relname as table_name, co.conname, pg_get_constraintdef(co.oid) as definition
    from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname = 'public' and cl.relname in (${tables})
    order by cl.relname, co.conname
  `.execute(db);
  return { columns: columns.rows, indexes: indexes.rows, constraints: constraints.rows };
}

describe("migrations", () => {
  it("leave only uninstall_feedback: the sign-in tables are dropped", async () => {
    expect(await tableNames()).toEqual(["uninstall_feedback"]);
  });

  it("bring the sign-in tables back, exactly as better_auth made them, when drop_sign_in is rolled back", async () => {
    const migrator = createMigrator(db);
    expect((await migrator.migrateTo(NO_MIGRATIONS)).error).toBeUndefined();
    expect((await migrator.migrateTo("1791690386107_better_auth")).error).toBeUndefined();
    const created = await signInSchema();
    expect(created.columns).not.toEqual([]);

    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    expect((await migrator.migrateDown()).error).toBeUndefined();
    expect(await tableNames()).toEqual(["account", "session", "uninstall_feedback", "user", "verification"]);
    expect(await signInSchema()).toEqual(created);
  });
```

(`roll back to an empty database` and the `uninstall_feedback` tests stay as they are; they now run on the database without the sign-in tables.)

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter lingoflix-server exec vitest run tests/db.test.ts`
Expected: FAIL, 2 failed | 3 passed (5):
- `migrations > leave only uninstall_feedback: the sign-in tables are dropped`: `AssertionError: expected [ 'account', 'session', …(3) ] to deeply equal [ 'uninstall_feedback' ]`
- `migrations > bring the sign-in tables back, exactly as better_auth made them, when drop_sign_in is rolled back`: `AssertionError: expected [ 'account', 'session', 'user', …(1) ] to deeply equal [ 'account', 'session', …(3) ]` (with no new migration, `migrateDown` rolls back `uninstall_feedback` instead)

- [ ] **Step 3: Make the migration file**

Run: `pnpm --filter lingoflix-server db:make drop_sign_in`
Expected: `✔ Created migration file at .../lingoflix-server/src/db/migrations/<timestamp>_drop_sign_in.ts`. Its timestamp is later than `1791690386974_uninstall_feedback`, so it runs last.

- [ ] **Step 4: Fill it**

Replace the whole content of the new `lingoflix-server/src/db/migrations/<timestamp>_drop_sign_in.ts` (kysely-ctl's template) with:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any -- migrations are frozen in time, so they don't use the app's Database type */
import { sql, type Kysely } from "kysely";

// Free-own-key spec §5.3: sign-in is gone, so Better Auth's tables go. "session" and "account" reference "user",
// so they are dropped first. `down` recreates them exactly as 1791690386107_better_auth's `up` does.
// One statement per `sql` call: the extended query protocol rejects multi-statement strings.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`drop table "session"`.execute(db);
  await sql`drop table "account"`.execute(db);
  await sql`drop table "verification"`.execute(db);
  await sql`drop table "user"`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`.execute(db);
  await sql`create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade)`.execute(db);
  await sql`create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null)`.execute(db);
  await sql`create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`.execute(db);
  await sql`create index "session_userId_idx" on "session" ("userId")`.execute(db);
  await sql`create index "account_userId_idx" on "account" ("userId")`.execute(db);
  await sql`create index "verification_identifier_idx" on "verification" ("identifier")`.execute(db);
}
```

Check `down` is a verbatim copy of `better_auth`'s `up`:

```bash
diff <(grep 'await sql`create' lingoflix-server/src/db/migrations/1791690386107_better_auth.ts) <(grep 'await sql`create' lingoflix-server/src/db/migrations/*_drop_sign_in.ts)
```

Expected: no output, exit 0.

- [ ] **Step 5: Update the `Database` comment**

In `lingoflix-server/src/db/types.ts`, replace:

```ts
/**
 * Our tables. Better Auth's tables ("user", "session", "account", "verification") are created by our migrations
 * but read and written only by Better Auth, so they are not listed here.
 */
```

with:

```ts
/** Our tables: only the goodbye answers. The sign-in tables are gone (migration `drop_sign_in`). */
```

- [ ] **Step 6: Run the tests again**

Run: `pnpm --filter lingoflix-server exec vitest run tests/db.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Run everything**

Run: `pnpm --filter lingoflix-server test`
Expected: PASS (10 files, 88 tests).

Run: `pnpm --filter lingoflix-server compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-server lint`
Expected: exit 0 with no warnings.

- [ ] **Step 8: Commit**

```bash
git add lingoflix-server/src/db/migrations lingoflix-server/src/db/types.ts lingoflix-server/tests/db.test.ts
git commit -m "feat(server): drop_sign_in migration drops Better Auth's tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Docs and the full check

**Files:**
- Modify (whole file replaced): `lingoflix-server/README.md`, `lingoflix-server/.env.example`
- Modify: `README.md`, `docs/superpowers/specs/2026-10-10-lingoflix-subscription-design.md`, `docs/superpowers/plans/2026-10-10-lingoflix-premium-plan-1-server-foundation.md`

**Interfaces:**
- Consumes: the trimmed site from Tasks 1 to 6 (its pages, `POST /api/goodbye` with its cap, the `drop_sign_in` migration).
- Produces: docs only (spec §5.8). The environment template lists exactly the three variables the site still reads: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEXT_PUBLIC_CHROME_STORE_URL` (spec §5.2).

The root README changes only its site line. Its AI and key lines ("Claude explains", "your own Claude API key") stay until Plan 2, when the extension supports OpenAI. This task has no test: it changes no code. It ends with the full no-environment check of the whole repository.

- [ ] **Step 1: Rewrite the server README**

Replace the whole content of `lingoflix-server/README.md` with:

```markdown
# LingoFlix server

The LingoFlix website at `https://lingoflix.lipsum.fun`, built with Next.js. LingoFlix is free, so the site has no
sign-in, accounts or payments:

- **Pages:** the landing page (`/`), the welcome page the extension opens after install (`/welcome`), the uninstall
  page (`/goodbye`), privacy (`/privacy`) and terms (`/terms`).
- **API:** `POST /api/goodbye` stores the uninstall page's optional answer (a reason, a comment and the time), at most
  100 answers an hour in total.
- **Database:** Postgres (Neon) through Kysely, only for those answers (`uninstall_feedback`). Every schema change is a
  kysely-ctl migration in `src/db/migrations/`.

Design: `docs/superpowers/specs/2026-10-11-lingoflix-free-own-key-design.md` (§5).

## Scripts

Run from the repository root with `pnpm --filter lingoflix-server <script>`, or from this folder with `pnpm <script>`.

| Script | What it does |
|---|---|
| `dev` | Development server at http://localhost:3000 |
| `test` | Unit tests (Vitest). Uses an in-process Postgres (PGlite): no database or `.env` needed |
| `compile` | Generates Next.js route types, then type-checks |
| `build` | Production build. Needs no environment variables |
| `lint` | ESLint |
| `db:make <name>` | Creates an empty migration file in `src/db/migrations/` |
| `db:migrate` | Applies pending migrations, connecting with `DATABASE_URL_UNPOOLED` from the shell or `.env` |
| `db:migrate:local` | Same, also reading `.env.local` |
| `db:list` | Shows which migrations have run |

## Environment variables

| Variable | What it is |
|---|---|
| `DATABASE_URL` | The pooled Postgres connection string the app uses to store goodbye answers |
| `DATABASE_URL_UNPOOLED` | The direct connection string migrations use |
| `NEXT_PUBLIC_CHROME_STORE_URL` | The Chrome Web Store listing. Empty until the extension is published: the pages then say it's coming soon |

Tests and builds need none of them. `.env.example` lists them with local placeholders.

## Local development

1. Copy `.env.example` to `.env.local` and point `DATABASE_URL` and `DATABASE_URL_UNPOOLED` at a local Postgres or a
   Neon branch.
2. `pnpm --filter lingoflix-server db:migrate:local`.
3. `pnpm --filter lingoflix-server dev`.

Every page but the goodbye answer works without a database.

## Migrations

- Run a migration that adds something **before** deploying the code that needs it, and one that removes something
  (such as `drop_sign_in`, which drops the old sign-in tables) **after** deploying the code that stops using it.
- Migrations use the direct connection (`DATABASE_URL_UNPOOLED`): Neon's pooler doesn't support the lock kysely-ctl
  takes while migrating.
- Use `sslmode=verify-full` in Neon connection strings.
- Never edit a migration that has run: add a new one. `better_auth` stays as history; `drop_sign_in` undoes it.

## Deploying

Vercel project with Root Directory `lingoflix-server` and Node.js 24.x, Neon from the Vercel Marketplace, and the three
environment variables above. `NEXT_PUBLIC_CHROME_STORE_URL` is read at build time, so changing it takes effect after a
redeploy.
```

- [ ] **Step 2: Trim the environment template**

Replace the whole content of `lingoflix-server/.env.example` with (the Better Auth, Google, extension ID and Cloudflare entries go; the three kept entries keep their comments):

```bash
# Copy to .env.local for `pnpm dev`. Never commit real values.

# Postgres (Neon). Pooled connection string used by the app.
DATABASE_URL=postgres://lingoflix:lingoflix@localhost:5432/lingoflix
# Direct (unpooled) connection string used by kysely-ctl migrations.
DATABASE_URL_UNPOOLED=postgres://lingoflix:lingoflix@localhost:5432/lingoflix

# The Chrome Web Store listing URL. Empty until the extension is published.
NEXT_PUBLIC_CHROME_STORE_URL=
```

- [ ] **Step 3: The root README's site line**

In `README.md`, replace:

```markdown
| [`lingoflix-server/`](./lingoflix-server) | The website and API (Next.js): sign-in, Premium, the AI endpoint |
```

with:

```markdown
| [`lingoflix-server/`](./lingoflix-server) | The website (Next.js): the landing page, the install and uninstall pages, privacy and terms |
```

- [ ] **Step 4: Mark the Premium spec and plan abandoned**

In `docs/superpowers/specs/2026-10-10-lingoflix-subscription-design.md`, directly below the H1 (`# LingoFlix Premium: subscription, server and AI through LingoFlix`) and its blank line, add this line followed by a blank line:

```markdown
Abandoned 2026-10-11: LingoFlix stays free with the learner's own key. See docs/superpowers/specs/2026-10-11-lingoflix-free-own-key-design.md.
```

Do the same in `docs/superpowers/plans/2026-10-10-lingoflix-premium-plan-1-server-foundation.md`, below its H1 (`# LingoFlix Premium Plan 1: Server Foundation Implementation Plan`). Both files stay in `docs/`; nothing else in them changes.

- [ ] **Step 5: The full check, with no environment variables**

Prefix each command with `env -i PATH="$PATH" HOME="$HOME"` so nothing is exported. `next build` still reads a
gitignored `lingoflix-server/.env.local` if your checkout has one, so run these four in a temporary worktree, which
has none (never open, copy or print `.env.local`):

```bash
git worktree add ../lingoflix-noenv HEAD
cd ../lingoflix-noenv && pnpm install --frozen-lockfile
```

and afterwards, from the main checkout: `git worktree remove ../lingoflix-noenv`.

Run: `pnpm test`
Expected: exit 0. `lingoflix-extension`: 47 files, 570 tests passed. `lingoflix-server`: 10 files, 88 tests passed.

Run: `pnpm compile`
Expected: exit 0 (both packages).

Run: `pnpm --filter lingoflix-server lint`
Expected: exit 0 with no warnings.

Run: `pnpm build`
Expected: exit 0. The extension builds to `lingoflix-extension/.output/chrome-mv3`; the server's route list is:

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/goodbye
├ ○ /goodbye
├ ○ /privacy
├ ○ /terms
└ ○ /welcome
```

- [ ] **Step 6: Commit**

```bash
git add README.md lingoflix-server/README.md lingoflix-server/.env.example docs/superpowers/specs/2026-10-10-lingoflix-subscription-design.md docs/superpowers/plans/2026-10-10-lingoflix-premium-plan-1-server-foundation.md
git commit -m "docs(server): README and environment template for the trimmed site; Premium marked abandoned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After merge: deployment and cleanup (ask the owner before each step)

These steps change shared systems (the live site, the Neon database shared by development and production, Vercel, Google, Cloudflare, Stripe), so the controller asks first and never runs them as part of the tasks.

1. **Deploy the trimmed site.** Push `main`; Vercel's Git-triggered build deploys `lingoflix-server` (if it is skipped, redeploy through the API as in Premium Plan 1). Wait for READY. The site then mentions OpenAI keys a little before the extension accepts them (Plan 2); no learner has the extension yet.
2. **Smoke checks on https://lingoflix.lipsum.fun:** `/`, `/welcome`, `/goodbye`, `/privacy` and `/terms` answer 200 with no Premium, price, sign-in or account text; `/sign-in`, `/account`, `/connect`, `/upgrade` and `/api/auth/get-session` answer 404; answering the goodbye question shows the thank-you.
3. **Drop the sign-in tables on Neon** (only after step 1 is live): `pnpm --filter lingoflix-server db:migrate:local`, then `pnpm --filter lingoflix-server db:list` shows `drop_sign_in` applied. This deletes the test sign-ins.
4. **Vercel environment:** remove `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EXTENSION_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_TOKEN` and `EMAIL_FROM`; redeploy.
5. **The owner's dashboards:** delete the Google OAuth client; revoke the Cloudflare email-sending token (Email Routing for `support@lingoflix.lipsum.fun` stays); delete the Stripe sandbox key, product and prices; rotate the secrets pasted in chat during the Premium work, the Neon password first (then update Vercel and `lingoflix-server/.env.local`).
6. **Local `lingoflix-server/.env.local`:** the same eight variables can go (the owner edits it; nobody prints it).
