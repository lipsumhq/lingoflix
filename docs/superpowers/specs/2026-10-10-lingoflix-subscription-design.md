# LingoFlix Premium: subscription, server and AI through LingoFlix

Date: 2026-10-10 · Status: approved in conversation, pending written review
Builds on: `docs/superpowers/specs/2026-10-09-lingoflix-design.md` (main spec),
`docs/superpowers/specs/2026-10-10-lingoflix-study-log-v2-design.md` (Study Log v2) and
`docs/superpowers/specs/2026-10-10-lingoflix-study-reminders-design.md` (reminders), all merged to `main`.
Where this document and those disagree, this document wins; §13 lists what it amends.

## 1. Summary

LingoFlix's first Chrome Web Store release ships with a paid plan, **LingoFlix Premium**. The AI moves from the
learner's own Anthropic API key to a LingoFlix server at `lingoflix.lipsum.fun`: the server holds the Anthropic key,
checks the learner's plan, chooses the model, builds the prompt from the learning data the extension sends, and
streams a structured answer back. Everything that costs nothing to run stays free.

- **Free, no account:** shortcuts, line navigation, subtitle toggle, voice shadowing (when built), reminders, the Study
  Log, the full backup and import, and a new **Save this line** shortcut.
- **Premium:** every AI feature, and Anki and CSV export. $7.99 a month or $59.99 a year, with a 7-day free trial.

## 2. Decisions (from the brainstorm, 2026-10-10)

| Topic | Decision |
|---|---|
| When | The first store release includes the subscription (no free-only launch). |
| Premium | All AI features (explanations, Regenerate, follow-ups, save suggestions, story and history context) and Anki/CSV export. |
| Free | Everything else, including line navigation, voice shadowing, reminders and the full backup. |
| Own API key | Removed. AI only through the subscription. |
| Price | $7.99/month, $59.99/year. |
| Trial | 7 days of full Premium, card required up front (Stripe Checkout), once per account. |
| Model | Sonnet 5.5 for the first 300 AI answers of each billing period, then Haiku 5.5 until the period resets. |
| Counting | Every AI answer counts (explanation, Regenerate, follow-up). The count is internal: never shown in the app. |
| Disclosure | The Haiku switch is disclosed only in the terms. |
| Safety limits | 10 answers a minute and 200 in any 24 hours, on any model. |
| Sign-in | Google and an emailed sign-in link (passwordless), with Better Auth. A subscription always needs an account. |
| Server | Next.js, created with `create-next-app`, in `lingoflix-server/`; Vercel; Neon Postgres; Kysely with kysely-ctl migrations. |
| Email | Cloudflare Email Service (REST API). |
| Domain | `lingoflix.lipsum.fun` (site, API, sign-in emails, legal pages). |
| Prompt | Built on the server from structured learning data (the extension never sends a prompt). |
| Claude output | Structured outputs (JSON schema), explicit effort level, prompt rewritten from Anthropic's current prompting guide. |
| Install / uninstall | A welcome page opens on install; the uninstall URL is a goodbye page. |
| Donations | The Buy Me a Coffee and GitHub Sponsors links are removed from the extension and the README; Premium replaces them. |

## 3. Plans

| | Free | Premium (trial or paid) |
|---|---|---|
| Shortcuts, line navigation, subtitle toggle | ✓ | ✓ |
| Voice shadowing (main spec §5.6, when built) | ✓ | ✓ |
| Study reminders | ✓ | ✓ |
| Study Log: browse, search, detail, delete | ✓ | ✓ |
| Save this line (§7.6) | ✓ | ✓ |
| Full backup and import | ✓ | ✓ |
| AI: explanations, Regenerate, follow-ups, save suggestions | | ✓ |
| Anki and CSV export | | ✓ |

**Plan state** comes from the Stripe subscription that Better Auth stores:

| Stripe status | Plan |
|---|---|
| `trialing` | `trial` |
| `active` | `premium` |
| `past_due` (a renewal payment failed; Stripe is retrying, about 2 weeks by default, set in Stripe) | `premium` |
| `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, none | `free` |

A subscription cancelled in the portal stays `active` with `cancel_at_period_end` until the period ends.

## 4. Journeys

1. **Install.** The extension opens `https://lingoflix.lipsum.fun/welcome`: what LingoFlix does, the main shortcuts,
   and **Start your 7-day free trial**. That leads to sign-in (Google or email link), then Stripe Checkout, then
   `/connect`, which hands the session to the extension (§7.3).
2. **A free learner asks for an explanation** (hover or Explain). No server call: the card shows the Premium invitation
   (§7.5).
3. **A Premium learner** uses LingoFlix as today, with no API key setup. The only limit they can see is the daily safety
   cap: "You've reached today's limit. Back tomorrow."
4. **Account.** Options → Settings → **Account** card: signed-in email; plan status ("Free", "Trial · ends Oct 17",
   "Premium · renews Nov 10", "Premium · ends Nov 10" when cancelled); **Start free trial** (free), **Manage
   subscription** (Stripe's billing portal: change plan, cancel, invoices), **Sign out**.
5. **Uninstall.** Chrome opens `https://lingoflix.lipsum.fun/goodbye`: an optional one-question form ("Why are you
   leaving?") and a note that uninstalling doesn't cancel billing, with a link to `/account`.

Study Log, settings and reminders on the learner's computer are unchanged.

## 5. The server (`lingoflix-server/`)

### 5.1 Stack and setup

- Created with `create-next-app` (TypeScript, App Router, pnpm) inside the repo's pnpm workspace; added to
  `pnpm-workspace.yaml`. Its current flags are checked in its docs before running it. No hand-written framework
  boilerplate.
- Deployed on Vercel. Postgres on Neon (pooled connection string).
- Database access with **Kysely**; all schema changes, including Better Auth's tables, are **kysely-ctl** migrations.
  Better Auth's table SQL comes from its CLI (`generate` for the Kysely adapter) and goes into the first migration.
- Secrets live only in Vercel's environment settings: Anthropic key, Better Auth secret, Google OAuth client, Stripe
  secret and webhook secret, Cloudflare API token, database URL. Never in the repo or the extension.

### 5.2 Better Auth

- Database: the Kysely Postgres dialect on the Neon pool.
- Sign-in: Google (social provider) and the magic-link plugin. The magic link is sent by one function,
  `sendSignInEmail(to, url)`, which calls Cloudflare Email Service's REST API; changing providers touches only that
  function.
- `bearer()` plugin, so the extension authenticates with `Authorization: Bearer <session token>`.
- `trustedOrigins`: the site and `chrome-extension://<LingoFlix extension id>` (the store ID, §7.8).
- Stripe plugin (`@better-auth/stripe`): `createCustomerOnSignUp: true`; one plan `premium` with the monthly price as
  `priceId`, the yearly price as `annualDiscountPriceId`, and `freeTrial: { days: 7 }`; Checkout for sign-up, the
  billing portal for changes; webhook signature checked by the plugin. One trial per account.

### 5.3 Pages

| Path | Purpose |
|---|---|
| `/` | Landing page with pricing |
| `/welcome` | Opened after install: what it does, main shortcuts, Start your 7-day free trial |
| `/sign-in` | Google or email link; an expired link says so and offers a new one |
| `/upgrade` | Signed out: sign in first. Free: Stripe Checkout for `premium` (monthly or yearly). Premium: `/account` |
| `/account` | Plan status, Manage subscription (billing portal), Sign out |
| `/connect` | Hands the session to the extension (§7.3), after checking the plan has reached Premium after Checkout |
| `/goodbye` | Uninstall page: one optional question, billing note, link to `/account` |
| `/privacy`, `/terms` | Legal (§10) |

### 5.4 API

| Route | Auth | Purpose |
|---|---|---|
| `/api/auth/*` | | Better Auth, including `/api/auth/stripe/webhook` |
| `GET /api/me` | bearer | `{ email, plan: 'free' \| 'trial' \| 'premium', trialEndsAt, periodEndsAt, cancelAtPeriodEnd }` (dates ISO 8601 or null) |
| `POST /api/explain` | bearer, Premium | Explanation or Regenerate (§6) |
| `POST /api/follow-up` | bearer, Premium | Follow-up question (§6) |

`POST /api/goodbye` (no auth) stores the optional uninstall answer: one of a fixed list of reasons plus up to 500
characters of text, with a timestamp and nothing else.

### 5.5 Database (our tables)

`ai_usage`: one row per finished AI answer.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | |
| `user_id` | text | Better Auth user id |
| `created_at` | timestamptz | default now() |
| `kind` | text | `explain`, `regenerate` or `follow-up` |
| `model` | text | the model that answered |
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` | integer | from Anthropic's `usage` |

Index on `(user_id, created_at)`. It never stores subtitle text, questions or answers.

`uninstall_feedback`: `id`, `created_at`, `reason`, `comment` (≤ 500 characters). No user id, IP or other data.

## 6. AI through the server

### 6.1 Requests (learning data, never a prompt)

`POST /api/explain` body:

| Field | Type | Limits |
|---|---|---|
| `kind` | `'explain' \| 'regenerate'` | |
| `line` | string | 1 to 2000 characters |
| `context` | `{ before: string[]; after: string[] }` | up to 6 lines each, each up to 2000 characters |
| `title` | the existing `TitleInfo` shape, or null | shape-checked as today |
| `videoTimeMs` | number | finite, ≥ 0 |
| `language` | an explanation language code | from the existing list |
| `sections` | `{ meaning; keyExpressions; howToUse }` booleans | |
| `storySoFar` | story lines (existing shape) or null | null when "Send the story so far" is off; today's limits (v2 spec §5.2) |
| `history` | saved items and explained lines | today's limits (v2 spec §5.2: up to 100 items and 30 lines) |

`POST /api/follow-up` body: `line`, `context`, `title`, `language`, `storySoFar`, `history` as above, plus
`explanation` (the earlier answer as stored, Markdown, up to 20 000 characters), `followUps` (earlier questions and
answers, up to 20, each question up to 2000 characters), and `question` (1 to 2000 characters).

The extension builds these from what it builds today (the content script's line, context and story; the background's
history from local storage). The request size checks that live in `src/lib/claude/protocol.ts` move to the server.

### 6.2 The server's steps

1. Bearer token → user, else `401 not-signed-in`.
2. Plan (§3) is `trial` or `premium`, else `402 needs-premium`.
3. Limits: more than 10 answers in the last minute or 200 in the last 24 hours (from `ai_usage`) → `429 rate-limited`.
4. Body checks (§6.1), else `413 too-large` or `400 bad-request`.
5. Model: Sonnet 5.5 (`claude-sonnet-5-5`) while the user's `ai_usage` rows on Sonnet since the start of the current
   billing period (Stripe's period start; for a trial, the trial start) number fewer than 300; otherwise Haiku 5.5
   (`claude-haiku-5-5`). The allowance (300), the limits and the effort level are server settings, not code changes.
6. Prompt: built from the body (§6.3) with prompt caching on the stable parts, as v2 does today.
7. Anthropic request: streaming, structured output (§6.4), `output_config.effort` set explicitly, `max_tokens` 1536
   for explanations and 1024 for follow-ups. If a model rejects the effort parameter, the server omits it for that
   model.
8. Stream to the extension (§6.5). When the client disconnects, the Anthropic request is aborted.
9. When the answer finished, insert one `ai_usage` row. Failed or cancelled answers are not counted.

### 6.3 The prompt

The prompt is rewritten on the server, not ported verbatim. Before writing it, the implementer fetches Anthropic's
current prompting best-practices guide and the structured-outputs and effort docs, and follows them. It keeps every
behavior the current prompt has: the explanation language, the enabled sections, the story so far and the learning
history as context (never anything after the 6 lines shown after the target line), and suggestions taken from the
line.

### 6.4 Structured output

Explanations use `output_config.format` `json_schema`:

| Field | Type | Present when |
|---|---|---|
| `meaning` | string (Markdown, short) | Meaning section on |
| `keyExpressions` | `{ expression: string; meaning: string }[]` | Key expressions on |
| `howToUse` | `{ example: string; translation: string }[]` | How to use it on |
| `suggestions` | `{ type: 'word' \| 'phrase' \| 'idiom' \| 'line'; text: string; meaning: string }[]` | always |

The fields of the enabled sections and `suggestions` are required; `additionalProperties: false`. After the answer
finishes, `suggestions` goes through today's validation rules (v2 spec §5.4: types, text appears in the line, the
`line` replacement, lengths, duplicates, at most 6). Follow-ups use `{ answer: string }` (Markdown).

### 6.5 The stream (newline-delimited JSON)

Errors found before streaming are plain HTTP errors with `{ "error": code }`. Once streaming starts (HTTP 200,
`application/x-ndjson`), each line is one of:

- `{ "type": "partial", "answer": { ...the fields so far } }`: sent as the JSON fills, at most every 100 ms.
- `{ "type": "done", "answer": { ...complete, suggestions checked }, "model": "claude-sonnet-5-5" }`
- `{ "type": "error", "code": "unavailable" }`

The extension renders the card from `partial` and `done`. When an explanation is done, the extension saves it locally as
today, with `response` set to Markdown built from the answer (`## Meaning`, `## Key expressions`, `## How to use it`,
the headings the card and Study Log already use), `suggestions` from the answer and `model` from the stream. Existing
saved explanations, the detail view and exports keep working unchanged.

## 7. Extension changes (`lingoflix-extension/`)

### 7.1 Removed

The API key card, `src/lib/api-key.ts` and the `api-key:*` messages, `@anthropic-ai/sdk`, the Claude client, and the
prompt, context-block and suggestion modules (they move to the server). On update (`runtime.onInstalled` reason
`update`), the stored `apiKey` is deleted.

### 7.2 Manifest

- Host permissions: `https://www.netflix.com/*` and `https://lingoflix.lipsum.fun/*`; `https://api.anthropic.com/*` is
  removed. Chrome's install prompt names netflix.com and lingoflix.lipsum.fun.
- `externally_connectable: { matches: ["https://lingoflix.lipsum.fun/*"] }`.
- `key`: the store item's public key (§7.8), so every build has the store's extension ID.

### 7.3 Session hand-off and account

- `/connect` sends `{ type: 'lingoflix:session', token }` with `chrome.runtime.sendMessage(<extension id>, …)`. The
  background's `runtime.onMessageExternal` accepts it only when the sender's URL origin is exactly
  `https://lingoflix.lipsum.fun` and the token is a non-empty string up to 512 characters; it stores the token, answers
  `{ ok: true }`, then refreshes the account.
- The token lives in `chrome.storage.local` key `session`. The API key's rules carry over: only the background reads it;
  it is never sent to a content script, shown, logged, or included in exports or backups.
- The background calls `GET /api/me` at worker start, after a hand-off, when the options page opens and at most every 6
  hours, and caches the answer (never the token) in `chrome.storage.local` key `account` with `checkedAt`. A `401`
  clears `session` and `account`. The UI reads `account`; the server remains the gatekeeper.
- **Sign out:** the background calls Better Auth's sign-out with the token, then clears `session` and `account`, even if
  the call fails.

### 7.4 AI requests

The background's explain service sends §6.1 bodies to the server over `fetch` with the bearer token and reads the
stream (§6.5); closing the card aborts the fetch. The `explain` port protocol between the card and the background keeps
its shape (`delta` becomes structured partials; `done` still carries the saved explanation). Error mapping:

| Server answer | Card |
|---|---|
| `401 not-signed-in` | "Sign in to use AI" + Sign in |
| `402 needs-premium` | Premium invitation (§7.5) |
| `429 rate-limited` | "You've reached today's limit. Back tomorrow." |
| `413`, `400` | "This line is too long to explain." |
| network error, `5xx`, stream `error` | "Couldn't reach LingoFlix" + Retry |

### 7.5 Premium checks in the UI

- **Card:** when `account.plan` is `free` or there is no session, Explain and hover show the invitation instead of
  calling the server: "Understand this line with Premium" / "7 days free, then $7.99 a month." with **Start free
  trial** (opens `/upgrade`) and, when signed out, **Sign in** (opens `/connect`). "Explained before" lines still open
  their saved explanation for everyone (no AI call).
- **Export menu:** Anki and CSV show a **Premium** badge for free accounts and open `/upgrade` instead of exporting.
  Full backup and import stay free.
- **Account card** (Settings, replacing the API key card) and **popup** status ("Free · Start trial", "Trial · ends Oct
  17", "Premium") as in §4.

### 7.6 Save this line (free)

A new shortcut action `saveLine`, label "Save line", default `KeyB`, remappable like the others. It saves the line on
screen as a whole-line Study Log item (`type: 'line'`, `meaning: ''`, `explanationId: null`, with the line's context,
title and time), through a new background message that writes it with today's item store (deduplicated by the item
index). A notice confirms it: "Saved to your Study Log" or "Already in your Study Log". With no line on screen: "No line
to save".

### 7.7 Install and uninstall pages

`runtime.onInstalled` with reason `install` opens `https://lingoflix.lipsum.fun/welcome` in a new tab. At every worker
start, `runtime.setUninstallURL('https://lingoflix.lipsum.fun/goodbye')`.

### 7.8 Stable extension ID

A draft item is uploaded to the Chrome Web Store once to get the permanent extension ID and its public key. The key goes
into the manifest (§7.2), so unpacked builds share the store ID; the ID goes into the server's settings
(`trustedOrigins`, `/connect`).

## 8. Errors

| Situation | Behavior |
|---|---|
| Session expired or revoked | Server `401`; extension clears the session; card and Account card offer Sign in |
| Webhook slow after Checkout | `/connect` re-checks `/api/me` (every 2 s, up to 30 s) before handing off; then says "Still setting up. Refresh in a minute." |
| Expired email link | `/sign-in` says so and offers a new link |
| Payment fails at renewal | `past_due` stays Premium while Stripe retries; then Free |
| Anthropic overloaded or down | Stream `error` / `5xx`; "Couldn't reach LingoFlix" + Retry; not counted |
| Cloudflare email fails | Sign-in page: "Couldn't send the email. Try again or use Google." |
| `/connect` opened without the extension | Page says "Install LingoFlix first" with the store link |

## 9. What changes for existing data

None of the learner's local data changes. The extension stops using the stored API key and deletes it on update.

## 10. Privacy and legal

- **Privacy policy** (`/privacy`, also the store listing's policy). It says:
  - Only when a Premium learner asks for an explanation or a follow-up does the server receive the line, the dialogue
    around it, the show and episode, the story so far (if that setting is on) and the learning history.
  - The server passes that to Anthropic to produce the answer and keeps none of it. It keeps only the account (email,
    sign-in method; with Google, the name, picture and Google's sign-in tokens), each signed-in session's IP address
    and browser (removed on sign-out), the subscription state from Stripe, and per-answer usage (time, kind, model,
    token counts).
  - The services involved: Anthropic (AI), Stripe (payments), Vercel (hosting), Neon (database), Cloudflare (email).
  - Local-only data, as today: the Study Log, settings and reminders, including the watch record.
- **Terms** (`/terms`): the plan, the trial, renewals and cancellation, a refund policy, and the fair-use line: "After
  heavy use in a billing period, answers may come from a faster model until your next billing date."
- The store listing says the extension has paid features. Both pages exist in a first draft for the learner to review
  before release.

## 11. Testing

- **Server (Vitest):**
  - the schema for every section combination;
  - the prompt (no line after the 6 shown after the target);
  - reading the streamed JSON into partials;
  - model choice at 299/300/301;
  - the 10/minute and 200/24 hours limits;
  - plan mapping for each Stripe status;
  - usage rows only for finished answers, with no text columns;
  - request size checks;
  - the bearer-token gate.

  Route tests use a fake Anthropic client and a real Postgres in the test process (PGlite through Kysely); migrations
  run against it.
- **Stripe:** test mode; the Stripe CLI forwards webhooks during manual testing.
- **Extension:**
  - the existing explain-flow, card and Study Log tests, updated for the server;
  - new tests for:
    - the Premium invitation and export badges;
    - the Account card and popup status;
    - the hand-off checks (wrong origin, bad token);
    - the `/api/me` cache and `401` clearing;
    - Save this line;
    - deleting `apiKey` on update;
    - the welcome and uninstall URLs.
- **Live checklist:**
  - sign-in: Google, then email link;
  - a trial with Stripe's test card;
  - streaming explanation, Regenerate and follow-up;
  - the Haiku switch, with the allowance set to 2 on a staging deployment;
  - the daily limit, set low on staging;
  - cancel in the portal;
  - free-plan invitation and export badges;
  - Save this line;
  - the welcome page on install and the goodbye page on uninstall.

## 12. Build order and setup

Three plans, each with its own review:

1. **Server foundation:**
   - `create-next-app` in `lingoflix-server/`;
   - Vercel and Neon;
   - Kysely and kysely-ctl;
   - Better Auth (Google, email link, bearer);
   - pages `/`, `/welcome`, `/sign-in`, `/account`, `/connect`, `/goodbye`, `/privacy`, `/terms` with first-draft text.
2. **Billing:**
   - the Stripe plugin, the plan and trial, `/upgrade`, the portal;
   - webhooks;
   - `GET /api/me`.
3. **AI and the extension switch-over:**
   - `ai_usage`;
   - `/api/explain` and `/api/follow-up` with the new prompt, structured streaming, model choice and limits;
   - all of §7.

Accounts the learner sets up when each plan needs them:
- a Vercel project;
- a Neon database;
- a Google OAuth client;
- Stripe products and prices (test mode first);
- Cloudflare Email Service on the Workers Paid plan, with the sending domain verified;
- an Anthropic API key for the server;
- the Chrome Web Store developer account (for §7.8).

## 13. Out of scope

Several plan tiers, team plans and coupons; syncing the Study Log or settings to the server; a web version of the Study
Log; showing usage to learners; automatic refunds; other browsers; localizing the site.

## 14. Sections this amends

- Main spec §1, §2 (success criteria no longer "only Netflix and an Anthropic API key"), §3 (a hosted backend is no
  longer a non-goal), §4 (Premium, no own key), §5.7 (popup status), §5.8 (Account card replaces the API key card),
  §5.9 (donations removed), §6.2 to §6.4 (the server; `session` and `account` keys; `apiKey` removed), §7 (Claude calls
  move to the server: §6 here), §10 (permissions and privacy: §7.2 and §10 here).
- v2 spec §5 (the prompt, context blocks and `suggest_saves` tool are replaced by §6 here; suggestion validation rules
  stay), §7 (Anki and CSV export are Premium).
- Reminders spec: unchanged (free).
