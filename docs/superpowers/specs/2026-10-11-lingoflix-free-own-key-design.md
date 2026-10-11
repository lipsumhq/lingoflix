# LingoFlix free: your own Claude or OpenAI key, and a site to match

Date: 2026-10-11 · Status: approved in conversation, pending written review
Builds on: `docs/superpowers/specs/2026-10-09-lingoflix-design.md` (main spec),
`docs/superpowers/specs/2026-10-10-lingoflix-study-log-v2-design.md` (Study Log v2) and
`docs/superpowers/specs/2026-10-10-lingoflix-study-reminders-design.md` (reminders).
Replaces: `docs/superpowers/specs/2026-10-10-lingoflix-subscription-design.md` (LingoFlix Premium), abandoned on
2026-10-11. Where this document and the main or v2 spec disagree, this document wins; §10 lists what it amends.

## 1. Summary

LingoFlix stays free. There is no subscription, no account and no LingoFlix AI server. Each learner uses their own
API key, now from **Anthropic (Claude) or OpenAI**, and LingoFlix is funded by donations (Buy Me a Coffee, GitHub
Sponsors), as before the Premium work.

Two parts:

1. **The extension** works with either provider. The learner pastes one key; LingoFlix tells the provider from the key.
   Explanations, Regenerate, follow-ups and save suggestions work the same with both.
2. **The site** `lingoflix.lipsum.fun` (`lingoflix-server/`, built in Premium's Plan 1 and live) is trimmed to suit the
   free extension: a landing page, the install and uninstall pages, privacy and terms. Sign-in, accounts and every
   Premium page go.

## 2. Decisions (from the brainstorm, 2026-10-11)

| Topic | Decision |
|---|---|
| Business | Free; donations only. No subscription, trial or accounts. |
| Providers | Anthropic (Claude) or OpenAI, with the learner's own key. |
| Choosing | One key field. The provider is detected from the key: `sk-ant-` is Claude, any other `sk-` is OpenAI. |
| Models | One per provider, no setting: Claude Sonnet 5.5 (`claude-sonnet-5-5`, as today) and GPT-6.1 Sol (`gpt-6.1-sol`). |
| Code shape | One provider-neutral client interface with two small adapters (Anthropic SDK, OpenAI SDK). |
| OpenAI API | The Responses API, `store: false`, reasoning effort `low`, verbosity `low`, 8,000 output tokens. |
| Learning history | Still sent with explanations, to the learner's own provider, as today (v2 spec §5.2). |
| Site | Kept and trimmed: `/`, `/welcome`, `/goodbye`, `/privacy`, `/terms`. Sign-in and Premium pages removed. |
| Database | Neon stays only for the goodbye answers. A migration drops the sign-in tables. |
| Install pages | The extension opens `/welcome` on first install and sets `/goodbye` as its uninstall page. |
| Extension ID | The pinned `manifest.key` stays (the Study Log is stored under that ID). |
| Repo layout | `lingoflix-extension/` and `lingoflix-server/` stay. |

## 3. Extension: the key

### 3.1 Detection

`providerOf(key: string): 'claude' | 'openai' | null`, on the trimmed key:

- starts with `sk-ant-`: `claude`;
- otherwise starts with `sk-`: `openai`;
- anything else: `null`.

OpenAI doesn't document its key formats (`sk-proj-`, `sk-svcacct-`, legacy `sk-` are all in use), so only the `sk-`
prefix is checked; Test key is the real check. Admin keys of either provider can't call the models and fail Test key.

### 3.2 Storage and messages

- The key stays in `local:apiKey` as a string. The provider is never stored: it is read from the key each time.
  Existing Claude keys keep working with no migration.
- Save keeps today's checks (printable ASCII, 1 to 300 characters) and adds `providerOf(key) !== null`. A refused key
  shows `This doesn't look like a Claude or OpenAI key.`
- `api-key:status` also returns `provider: 'claude' | 'openai' | null` (null when no key is saved).
- `api-key:test` calls the provider's model list (§4.6). Its messages name the company:
  - `Your key works.`
  - `Anthropic rejected this key.` / `OpenAI rejected this key.`
  - `Couldn't reach Anthropic. Check your connection.` / `Couldn't reach OpenAI. Check your connection.`
  - anything else: the provider's own message.

### 3.3 Settings card (`ApiKeyCard`)

- Title: `API key` (was `Claude API key`).
- Text: `LingoFlix explains lines with your own Claude or OpenAI key. Get one at console.anthropic.com or
  platform.openai.com. Usage is billed to that account. The key stays on this computer and is sent only to Anthropic
  or OpenAI.` The two addresses link to `https://console.anthropic.com/settings/keys` and
  `https://platform.openai.com/api-keys`.
- With a key saved, the status line shows the provider before the masked key: `Claude key` or `OpenAI key`.
- Placeholder: `sk-ant-… or sk-…` (and `Paste a new key to replace it` once one is saved, as today).
- Save, Test key, Remove and the show/hide toggle are unchanged.

### 3.4 Popup

`Claude key set` or `OpenAI key set`; with no key, the button reads `Add your API key` and opens Settings as today.

## 4. Extension: the provider layer

### 4.1 Structure

`src/lib/claude/` becomes `src/lib/ai/`:

| File | Responsibility |
|---|---|
| `provider.ts` | `Provider` (`'claude' \| 'openai'`), `providerOf`, display names (`Claude`, `OpenAI`), company names (`Anthropic`, `OpenAI`), the model per provider, key and billing URLs. No SDK imports (the content script and options page use it). |
| `client.ts` | The provider-neutral types: `SystemBlock {text, cache}`, `ToolDefinition`, `ChatMessage`, `StreamParams`, `ToolCall`, `StreamResult`, and `AiClient { stream(params, onText, signal): Promise<StreamResult>; checkKey(): Promise<void> }`. `createClient(apiKey)` picks the adapter by `providerOf`. |
| `anthropic.ts` | Today's Claude client, moved: `@anthropic-ai/sdk`, `cache_control`, the tool, `models.list` for the key check. |
| `openai.ts` | The OpenAI adapter (§4.3). |
| `errors.ts` | `toExplainError(error, provider)`, mapping each SDK's errors to the shared codes (§4.6). |
| `prompt.ts`, `context-blocks.ts`, `suggestions.ts`, `protocol.ts`, `explain-service.ts` | Moved unchanged except for provider names in copy, the max-token choice per provider, and the model saved on each explanation. |

`StreamParams` loses the model (the adapter knows it) and keeps `system`, `messages`, `tools?` and a `kind`
(`'explain' | 'follow-up'`) from which each adapter picks its output limit.

### 4.2 Claude adapter

Unchanged behaviour: `claude-sonnet-5-5`, `max_tokens` 1536 for explanations and 1024 for follow-ups, the
`suggest_saves` tool with `tool_choice: auto` on explanations only, `cache_control: { type: 'ephemeral' }` on the story
and history blocks, `dangerouslyAllowBrowser: true`, `maxRetries: 0`. Tool calls are dropped when the answer stops at
`max_tokens`, as today.

### 4.3 OpenAI adapter

`openai` 7.32.0 (pinned exactly), `dangerouslyAllowBrowser: true`, `maxRetries: 0`, one request per answer:

```ts
client.responses.stream(
  {
    model: 'gpt-6.1-sol',
    store: false,
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
    max_output_tokens: 8000,
    input: [
      { role: 'developer', content: [/* one input_text per system block, see §4.5 */] },
      /* the conversation: { role: 'user' | 'assistant', content: text } */
    ],
    tools: [/* explanations only: suggest_saves as a strict function tool */],
    tool_choice: 'auto',
    parallel_tool_calls: false,
  },
  { signal },
);
```

- **`store: false`:** OpenAI otherwise keeps every response for at least 30 days. Follow-ups replay the earlier turns as
  text, as the Claude path does.
- **Effort and limit:** `low` is the lowest effort GPT-6.1 Sol accepts. Its reasoning tokens count toward
  `max_output_tokens`, so Claude's 1536/1024 would often return a blank or cut-off answer; 8,000 leaves room, and the
  prompt still asks for a concise answer.
- **`suggest_saves`:** `{ type: 'function', name: 'suggest_saves', description, parameters, strict: true }`, with the
  same schema as the Claude tool plus `additionalProperties: false` on both objects. If strict mode rejects a keyword
  (e.g. `maxItems`), it is left out of the OpenAI copy only; the device still keeps at most 6 (v2 spec §5.4).
- **Streaming:** `response.output_text.delta` events feed the card. After the stream, `finalResponse()` gives the
  status and the output items. A `function_call` item named `suggest_saves` becomes the tool call (its `arguments` is a
  JSON string; unparseable arguments mean no suggestions).
- **Not completed:**
  - `incomplete` because of `max_output_tokens`: the text so far is kept and the tool call dropped (as with Claude);
    with no text, the card shows the `api` error `The answer was cut off. Try again.`
  - any other `incomplete` or `failed`: the `api` error with OpenAI's reason or message.
- **Idle timeout:** the existing 30 s timer resets on every stream event, not only text.

### 4.4 The prompt

The system prompt, user message, follow-up messages, story split and learning history are shared and unchanged
(v2 spec §5.1 to §5.3), except that "Claude" in learner-facing text becomes the provider's name.

### 4.5 Prompt caching

Both providers get the same block order: the instructions, then the story so far before the last 5-minute boundary,
then the learning history, then the conversation.

- **Claude:** as today: a breakpoint on the story block and on the history block, 5-minute cache.
- **OpenAI:** the three system blocks are `input_text` items of one `developer` message (the top-level `instructions`
  field can't carry a breakpoint). The story and history items carry `prompt_cache_breakpoint: { mode: 'explicit' }`.
  OpenAI's cache lasts 30 minutes and needs at least 1,024 tokens.

### 4.6 Errors and copy

`ExplainErrorCode` gains `no-credit`: `'no-key' | 'bad-key' | 'no-credit' | 'busy' | 'network' | 'api'`.

| Code | Claude (Anthropic SDK) | OpenAI (OpenAI SDK) |
|---|---|---|
| `bad-key` | 401 `authentication_error` | `AuthenticationError` (401) |
| `no-credit` | 402 `billing_error` | 429 with type `insufficient_quota`, or code `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded` or `organization_usage_limit_exceeded` |
| `busy` | `RateLimitError`, 5xx, `overloaded_error`, `rate_limit_error` (as today) | any other 429, 500, 503 |
| `network` | `APIConnectionError` | `APIConnectionError`, `APIConnectionTimeoutError` |
| `api` | anything else, with Anthropic's message | anything else (including a stream `error` event, whose `APIError` has no status), with OpenAI's message |

Card headlines, with `{Name}` the provider's display name and `{Company}` its company:

| Code | Headline | Button |
|---|---|---|
| `no-key` | `Add your API key` | Open Settings |
| `bad-key` | `Your {Name} key was rejected` | Open Settings |
| `no-credit` | `Your {Company} account is out of credit`, with `Add credit at console.anthropic.com` or `Add credit at platform.openai.com` (linking to the billing page) | Retry |
| `busy` | `{Name} is busy right now` | Retry |
| `network` | `Couldn't reach {Name}` | Retry |
| `api` | the provider's message, or `{Name} returned an error` | as today |

`Claude returned an empty answer.` becomes `{Name} returned an empty answer.` The background includes the provider in
each error it sends to the card, so the content script never needs an SDK.

For the key test (§3.2): OpenAI's `models.list` can answer 403 for a valid key restricted from listing models; a 403
counts as `Your key works.`

### 4.7 Manifest, install and uninstall

- `host_permissions` adds `https://api.openai.com/*` (the background's requests then don't depend on OpenAI's CORS).
- `SITE_URL = 'https://lingoflix.lipsum.fun'` in `src/lib/config.ts`.
- On `runtime.onInstalled` with reason `install` only, the background opens `${SITE_URL}/welcome` in a new tab.
- The background calls `runtime.setUninstallURL(`${SITE_URL}/goodbye`)` each time it starts.

### 4.8 Study Log

Each explanation's `model` is the model that wrote it (`claude-sonnet-5-5` or `gpt-6.1-sol`). Nothing else in the
Study Log, the backup or the exports changes.

## 5. The site (`lingoflix-server/`)

### 5.1 Pages

| Kept | Removed |
|---|---|
| `/`, `/welcome`, `/goodbye` and `POST /api/goodbye`, `/privacy`, `/terms` | `/upgrade`, `/sign-in`, `/account`, `/connect`, `/api/auth/[...all]` |

The header loses the Pricing and Account links and gains `Support` (to `/#support`). The footer loses Account and
gains the two donation links next to Privacy, Terms and the support email.

### 5.2 Code, packages and settings removed

- Better Auth and everything only sign-in used: `src/lib/auth.ts`, `auth-client.ts`, `auth-cli.ts`, `session.ts`,
  `safe-next.ts`, `upgrade.ts`, `src/lib/email/`, `src/components/Pricing.tsx`, the sign-in form.
- Packages `better-auth` and `auth` (the CLI); the `auth:check` script.
- `src/lib/site.ts` loses `PRICE_MONTHLY`, `PRICE_YEARLY` and `TRIAL_DAYS`, and gains the donation links (the same
  two as the extension's `src/lib/config.ts`).
- Environment variables still used: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEXT_PUBLIC_CHROME_STORE_URL`. Gone:
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EXTENSION_ID`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_TOKEN`, `EMAIL_FROM`.
- The security headers (`frame-ancestors 'none'`, `X-Frame-Options: DENY`) stay.

### 5.3 Database

- Kysely and Neon stay, only for `uninstall_feedback`.
- A new kysely-ctl migration, `drop_sign_in`, drops `"session"`, `"account"`, `"verification"` and `"user"` (in that
  order: the first two reference `"user"`). Its `down` recreates them exactly as the `better_auth` migration does. The
  `better_auth` migration file stays, as history.
- Running it on Neon deletes the test sign-ins; it is run only after the owner says so (§6).

### 5.4 The goodbye cap

`POST /api/goodbye` stores at most **100 answers an hour in total**. Past that, it answers exactly as for a stored
answer (so the page still says thanks) and stores nothing. The count and the insert are one statement. No IP address
is read or stored.

### 5.5 Page copy

- **`/`:**
  - The hero (`Understand every line on Netflix`), the Add to Chrome button and the feature list stay.
  - The "Explain any line" feature ends `…and how to use them, with your own Claude or OpenAI key.`
  - The Free vs Premium table and the pricing are replaced by a section headed `Free, with your own key`:
    `LingoFlix is free. Explanations use your own Claude or OpenAI API key, so they're billed by Anthropic or OpenAI
    at their prices. Everything else costs nothing.`
  - A section `Support LingoFlix` (id `support`): `If LingoFlix helps you learn, you can support it.` with the Buy Me a
    Coffee and GitHub Sponsors links.
- **`/welcome`:**
  - The shortcut table loses the `B` row (Save this line was Premium work and doesn't exist).
  - The Premium box becomes `Add your key`:
    1. `Get an API key from Anthropic (console.anthropic.com) or OpenAI (platform.openai.com).`
    2. `Click the LingoFlix icon in Chrome's toolbar, then Add your API key.`
    3. `Paste the key, press Save, then Test key.`

    and below: `Usage is billed by Anthropic or OpenAI. Your key stays on this computer.`
- **`/goodbye`:** the "doesn't cancel Premium" text and the account link go. The `too-expensive` reason's label becomes
  `The AI costs too much on my key` (the stored value stays `too-expensive`).

### 5.6 Privacy page

Rewritten, dated the day it ships. Points:

- **On your computer only:** the Study Log, settings, reminders (including the last-watched show) and your API key.
  LingoFlix has no accounts, and the site sets no cookies.
- **When you ask for an explanation or a follow-up**, the extension sends, straight from your browser to Anthropic or
  OpenAI (whichever your key belongs to), with your key and never through LingoFlix's server: the line and the
  dialogue around it, the show and episode, the story so far (if that setting is on), and your recent saved items
  and explained lines. Requests to OpenAI ask it not to store them. Anthropic's and OpenAI's privacy policies apply
  (linked).
- **What the site keeps:** only the optional answer on the uninstall page (the reason, the comment and the time), with
  no IP address or account.
- **Services:** Anthropic or OpenAI (your own account), Vercel (hosting), Neon (database), Cloudflare (forwarding email
  sent to support).
- **Contact:** the support email.

### 5.7 Terms page

Rewritten, dated the day it ships. Points: LingoFlix is free and provided as is, without warranty; you need your own
Netflix subscription and your own Claude or OpenAI API key, whose usage Anthropic or OpenAI bill under their own terms;
AI answers can be wrong; LingoFlix isn't affiliated with Netflix, Anthropic or OpenAI; donations are voluntary and
unlock nothing; the terms may change, with the date on the page; contact.

### 5.8 Docs

- The server README describes the trimmed site: the pages, the database for goodbye answers only, the three
  environment variables, migrations and deploying.
- The root README: "Claude explains" becomes Claude or OpenAI; the key section covers both providers and both key
  pages; the "Premium, the AI endpoint" line goes; Support and donations stays.
- The subscription spec and Premium Plan 1's plan get a line under their title: `Abandoned 2026-10-11: LingoFlix stays free with
  the learner's own key. See docs/superpowers/specs/2026-10-11-lingoflix-free-own-key-design.md.` They stay in `docs/`.

## 6. Cleanup after merge

These touch shared systems, so each is asked about first. Dashboard-only steps are the owner's.

1. Run `drop_sign_in` on Neon (`db:migrate:local`), after the site without Better Auth is deployed.
2. Vercel: remove the unused environment variables (§5.2), then redeploy.
3. Google Cloud: delete the OAuth client.
4. Cloudflare: revoke the email-sending API token. Email Routing for `support@lingoflix.lipsum.fun` stays.
5. Stripe: delete the sandbox secret key, product and prices.
6. Rotate the secrets pasted in chat during the Premium work, the Neon password first (still in use).
7. Before release: the Chrome Web Store listing and its privacy practices form say AI goes to Anthropic or OpenAI with
   the learner's key.

## 7. Testing

- **Extension (Vitest):**
  - `providerOf` for Claude, OpenAI (`sk-proj-`, `sk-svcacct-`, legacy `sk-`) and other strings; Save refusing a
    non-key; `api-key:status` returning the provider.
  - The OpenAI adapter against a fake OpenAI API (the SDK's `fetch` option): the request (`store: false`, model,
    effort, verbosity, limit, developer blocks with breakpoints, the strict tool on explanations only, replayed
    follow-up turns); streamed text; the tool call; `incomplete` with and without text; each error row of §4.6; abort.
  - The Claude adapter's existing tests, moved; Claude's 402 `billing_error` as `no-credit`.
  - The Settings card, popup and card copy for both providers; the test-key messages.
  - The welcome tab on install only, the uninstall URL, and the new host permission.
- **Site (Vitest):** the new page copy; no sign-in routes; `drop_sign_in` up and down on PGlite; the goodbye cap at
  100 and 101; `pnpm build`, `compile` and `test` with no environment variables.
- **Live checklist (the owner, real keys):** with a Claude key and then an OpenAI key: Test key, an explanation with
  suggestions, Regenerate, a follow-up; an OpenAI key with no credit shows `no-credit`; installing opens `/welcome`;
  uninstalling opens `/goodbye`; the live site shows no Premium, sign-in or account pages.

## 8. Build order

Two plans, each with its own review:

1. **The site** (§5): small, and the live site advertises a plan that no longer exists.
2. **The extension** (§3, §4): the provider layer, OpenAI, the key UI, the install and uninstall pages.

## 9. Out of scope

A model choice; other providers (Gemini, OpenRouter, local models); accounts or syncing; a LingoFlix AI server or
shared answers; Claude's 1-hour prompt cache (possible later); Anthropic keys that need an `anthropic-workspace-id`
header (they get Anthropic's own error message); voice shadowing and the other main-spec features not yet built.

## 10. Sections this amends

- Main spec §1 and §2 (Claude or OpenAI), §5.8 (the key card), §7 (the AI integration: §4 here), §10 (privacy: §5.6
  here).
- v2 spec §5.1 and §5.5 (the client interface: §4.1 here). §5.2 to §5.4 (context, caching, suggestions) still hold
  for both providers.
- The subscription spec: abandoned (§5.8).
