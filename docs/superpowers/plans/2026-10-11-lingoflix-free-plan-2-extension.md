# LingoFlix Free Extension Implementation Plan (Plan 2 of 2: Claude or OpenAI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The extension's explanations, Regenerate, follow-ups and save suggestions work with the learner's own Anthropic (Claude) or OpenAI key, told apart from the key itself; the extension opens the site's welcome page on install and its goodbye page on uninstall.

**Architecture:** `src/lib/claude/` becomes `src/lib/ai/`: one provider-neutral `AiClient` interface with two small adapters (Anthropic's SDK as today, OpenAI's SDK on the Responses API) behind `createClient(apiKey)`, which picks by `providerOf(key)`. The prompt, story and history blocks, suggestion checks and the card protocol stay shared; errors map to shared codes and name the provider; only the background imports an SDK.

**Tech Stack:** WXT (Chrome MV3), React, TypeScript, `@anthropic-ai/sdk` 0.128.0, `openai` 7.32.0, Vitest with Testing Library and WXT's fake browser, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-11-lingoflix-free-own-key-design.md`: §3 (the key), §4 (the provider layer), and the root README's AI and key lines (§5.8). The site (§5) was Plan 1 and is live.

## Global Constraints

- Providers and models, exactly: Anthropic (`claude-sonnet-5-5`, as today) and OpenAI (`gpt-6.1-sol`). No model setting.
- Detection on the trimmed key: starts with `sk-ant-` is Claude, otherwise starts with `sk-` is OpenAI, anything else is refused (`This doesn't look like a Claude or OpenAI key.`). The provider is never stored; `local:apiKey` stays a string and existing Claude keys need no migration.
- Exact versions, pinned: `openai` 7.32.0 (added with `--save-exact`); `@anthropic-ai/sdk` stays 0.128.0.
- OpenAI requests: the Responses API with `store: false`, `reasoning: { effort: 'low' }`, `text: { verbosity: 'low' }`, `max_output_tokens: 8000`, `maxRetries: 0`, `dangerouslyAllowBrowser: true`; `suggest_saves` as a strict function tool on explanations only, `tool_choice: 'auto'`, `parallel_tool_calls: false`; the story and history blocks as `developer` `input_text` items with `prompt_cache_breakpoint: { mode: 'explicit' }`.
- Claude requests are unchanged (max tokens 1536/1024, `cache_control` on the story and history blocks).
- Only the background imports an SDK. `provider.ts`, `protocol.ts` and `suggestions.ts` stay SDK-free (the content script, popup and options page use them).
- Error codes: `no-key`, `bad-key`, `no-credit`, `busy`, `network`, `api`. Copy names the provider (`Claude`, `OpenAI`) or the company (`Anthropic`, `OpenAI`) exactly as spec §4.6 and §3.2 say, plus the rulings below.
- Copy: the spec's exact strings (§3.2, §3.3, §3.4, §4.6). No em dashes anywhere (use a colon).
- The idle timeout (30 s) resets on every stream event, not only text.
- Install: `${SITE_URL}/welcome` opens only on `onInstalled` with reason `install`; `setUninstallURL(`${SITE_URL}/goodbye`)` runs every time the background starts; `SITE_URL = 'https://lingoflix.lipsum.fun'`.
- `host_permissions` adds `https://api.openai.com/*`. The pinned `manifest.key` stays.
- Never call a real AI API or use a real key in tests: the SDKs' `fetch` option serves fakes. Never read or print any `.env*` file.
- Tests live in `lingoflix-extension/tests/unit/` and are type-checked by `pnpm --filter lingoflix-extension compile`. Write each test first and watch it fail. In an agent session, use `--reporter=default` whenever a step checks for "no warnings".
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands run from the repo root: `pnpm --filter lingoflix-extension <script>`. The site (`lingoflix-server/`) is not touched.

## Rulings beyond the spec (for the owner's review)

- **When the card loses its connection to the background** (the worker restarted, the extension was reloaded), no provider is known: the card shows `Couldn't reach LingoFlix's background` with Retry, the Settings page's existing wording.
- **Four more learner-facing strings stop naming Claude:** `Ask more about the line.` and `Explanations are written in this language.` (Settings, Explanations card), `Explanation` and `The explanation isn't available for this item.` (Study Log detail).
- **Claude out of credit:** besides 402 `billing_error`, a 400 `invalid_request_error` whose message contains "credit balance" is `no-credit` (Anthropic usually reports a low balance that way). It is a text match; if Anthropic rewords it, the card shows Anthropic's own sentence, as today.
- **OpenAI answers that stop early for a reason other than the length limit:** `content_filter` shows `OpenAI declined to answer this line.`; any other reason `OpenAI didn't finish the answer.`; a failed response shows OpenAI's message, or that same sentence. Raw reason codes never become headlines.
- **The OpenAI adapter reads the raw event stream** (`responses.create({ stream: true })`) instead of the SDK's `stream()` helper: with a strict tool the helper parses the tool's arguments itself and fails the whole answer on bad JSON, where the spec wants "no suggestions". A stream that ends without a final event counts as `network`; every OpenAI 5xx counts as `busy`.
- **Billing links:** `https://console.anthropic.com/settings/billing` and `https://platform.openai.com/settings/organization/billing/overview`.
- **Bundle size:** the background script grows from about 230 kB to about 600 kB (62 kB to 141 kB gzipped) with OpenAI's SDK; the content script doesn't change.

## Review Focus

1. A learner who swaps a Claude key for an OpenAI key asks a follow-up on an explanation Claude wrote: it goes to OpenAI with the earlier answer replayed as text, and answers. (Task 4: "a follow-up replays the earlier turns as text, with the same limit and no tools".)
2. A key pasted with spaces or a line break around it (copied from a console) is trimmed and recognised. (Task 2: "trims the key first".)
3. OpenAI thinks for a while before the first word: the card keeps waiting while any stream event arrives, and only 30 s of silence shows `Couldn't reach OpenAI`. (Task 3: "any stream event keeps the request alive"; Task 4: activity on every OpenAI event; the live checklist.)
4. Updating the extension, or Chrome updating, never opens the welcome page again. (Task 6: "opens the welcome page in a new tab on first install only, not on updates".)
5. A learner out of OpenAI credit sees `Your OpenAI account is out of credit` with the billing link, never a "busy, Retry" loop. (Task 4: "429 insufficient_quota, and each spend or credit limit code, is out of credit".)

## File Structure

| Path (under `lingoflix-extension/`) | Responsibility | Task |
|---|---|---|
| `src/lib/ai/client.ts` | Provider-neutral types, `AiClient`, `createClient(apiKey)` | 1, 4 |
| `src/lib/ai/anthropic.ts` | The Claude adapter (today's client, moved) | 1 |
| `src/lib/ai/{prompt,context-blocks,suggestions,protocol,explain-service}.ts` | Shared: prompt, context, suggestions, card protocol, the explain service | 1, 3 |
| `src/lib/ai/provider.ts` | `providerOf`, names, models, key and billing pages (no SDK) | 2 |
| `src/lib/ai/errors.ts` | SDK errors to shared codes, per provider | 3, 4 |
| `src/lib/ai/openai.ts` | The OpenAI adapter (Responses API) | 4 |
| `src/entrypoints/options/ApiKeyCard.tsx`, `src/entrypoints/popup/App.tsx`, the Explanations card and Study Log detail | The key card, popup and provider-neutral copy | 5 |
| `src/lib/site-pages.ts`, `src/entrypoints/background.ts`, `wxt.config.ts` (a comment) | Welcome on install, goodbye on uninstall | 6 |
| root `README.md` | Claude or OpenAI | 7 |

---

### Task 1: Move the Claude client to `src/lib/ai/` behind a provider-neutral interface

**Files:**
- Move: `lingoflix-extension/src/lib/claude/client.ts` → `lingoflix-extension/src/lib/ai/anthropic.ts`; `lingoflix-extension/src/lib/claude/{context-blocks,errors,explain-service,prompt,protocol,suggestions}.ts` → `lingoflix-extension/src/lib/ai/`; `lingoflix-extension/tests/unit/claude-client.test.ts` → `lingoflix-extension/tests/unit/anthropic.test.ts`; `lingoflix-extension/tests/unit/claude.test.ts` → `lingoflix-extension/tests/unit/ai.test.ts`
- Create: `lingoflix-extension/src/lib/ai/client.ts`
- Modify: `lingoflix-extension/src/lib/ai/anthropic.ts`, `lingoflix-extension/src/lib/ai/explain-service.ts`, `lingoflix-extension/src/lib/ai/prompt.ts`, `lingoflix-extension/src/lib/background/message-handler.ts`, `lingoflix-extension/src/entrypoints/background.ts`
- Modify (import paths only): `lingoflix-extension/src/entrypoints/netflix.content/overlay/{Card.tsx,card-state.ts,explain-controller.ts,explain-port.ts}`, `lingoflix-extension/src/lib/study-log/items.ts`, `lingoflix-extension/tests/unit/{ai,explain-flow,suggestions,context-blocks,saved-items}.test.ts`
- Modify (tests): `lingoflix-extension/tests/unit/anthropic.test.ts`, `lingoflix-extension/tests/unit/explain-service.test.ts`, `lingoflix-extension/tests/unit/background-messages.test.ts`

**Interfaces:**
- Consumes: today's `src/lib/claude/*` (`createSdkClient`, `ClaudeClient`, `toSdkSystem`, `readToolCalls`, `ChatMessage` in `prompt.ts`), `CLAUDE_MODEL`, `CLAUDE_MAX_TOKENS`, `CLAUDE_EXPLAIN_MAX_TOKENS`, `CLAUDE_API_BASE_URL` (`@/lib/config`).
- Produces:
  - `src/lib/ai/client.ts` (spec §4.1): `interface SystemBlock { text: string; cache: boolean }`, `interface ToolDefinition { name: string; description: string; input_schema: Record<string, unknown> }`, `interface ChatMessage { role: 'user' | 'assistant'; content: string }`, `interface StreamParams { kind: 'explain' | 'follow-up'; system: string | SystemBlock[]; messages: ChatMessage[]; tools?: ToolDefinition[] }`, `interface ToolCall { name: string; input: unknown }`, `interface StreamResult { text: string; toolCalls: ToolCall[] }`, `interface AiClient { stream(params: StreamParams, onText: (delta: string) => void, signal: AbortSignal): Promise<StreamResult>; checkKey(): Promise<void> }`, `createClient(apiKey: string): AiClient` (the Claude adapter for every key until Task 4).
  - `src/lib/ai/anthropic.ts`: `createAnthropicClient(apiKey: string): AiClient`; `toSdkSystem` and `readToolCalls` unchanged. It picks the model and `max_tokens` itself: 1536 for `kind: 'explain'`, 1024 for `kind: 'follow-up'`.
  - Every other module of `src/lib/claude/` keeps its exports under `@/lib/ai/<name>`. `ClaudeClient` and `createSdkClient` are gone; `ChatMessage` moves from `prompt.ts` to `client.ts`.

This is a refactor: nothing a learner sees changes. `StreamParams` loses `model` and `maxTokens` (the adapter knows them) and gains `kind` (spec §4.1). The neutral `ToolDefinition` keeps the field name `input_schema`: it is a plain JSON Schema object, and `suggestions.ts` (bundled into the content script) declares the same shape without importing anything from `client.ts`.

- [ ] **Step 1: Move the tests and point every test at `@/lib/ai/`**

```bash
git mv lingoflix-extension/tests/unit/claude-client.test.ts lingoflix-extension/tests/unit/anthropic.test.ts
git mv lingoflix-extension/tests/unit/claude.test.ts lingoflix-extension/tests/unit/ai.test.ts
perl -pi -e 's#\@/lib/claude/#\@/lib/ai/#g' $(grep -rl '@/lib/claude/' lingoflix-extension/tests)
```

In `lingoflix-extension/tests/unit/anthropic.test.ts`:

Replace the first import from `@/lib/ai/client` (the `perl` line rewrote its path):

```ts
import { createSdkClient, readToolCalls, toSdkSystem, type ToolDefinition } from '@/lib/ai/client';
```

with:

```ts
import { createAnthropicClient, readToolCalls, toSdkSystem } from '@/lib/ai/anthropic';
import { createClient, type ToolDefinition } from '@/lib/ai/client';
```

Rename `describe('createSdkClient', () => {` to `describe('createAnthropicClient', () => {`, and replace each of the three `createSdkClient('sk-ant-test')` with `createAnthropicClient('sk-ant-test')`.

In `it('streams text and returns it with the tool calls; ...')`, replace the first two lines of the params object:

```ts
        model: 'claude-sonnet-5-5',
        maxTokens: CLAUDE_EXPLAIN_MAX_TOKENS,
```

with:

```ts
        kind: 'explain',
```

In `it('drops tool calls cut off by max_tokens ...')`, replace the params line:

```ts
      { model: 'claude-sonnet-5-5', maxTokens: CLAUDE_EXPLAIN_MAX_TOKENS, system: 'Rules', messages: [{ role: 'user', content: 'Q' }], tools: [TOOL] },
```

with:

```ts
      { kind: 'explain', system: 'Rules', messages: [{ role: 'user', content: 'Q' }], tools: [TOOL] },
```

Rename `it('without tools, sends neither tools nor tool_choice, and a plain system string', ...)` to `it('a follow-up gets 1024 tokens and, without tools, neither tools nor tool_choice; a plain system string passes through', ...)`, and in it replace the params line:

```ts
      { model: 'claude-sonnet-5-5', maxTokens: CLAUDE_MAX_TOKENS, system: 'Rules', messages: [{ role: 'user', content: 'Q' }] },
```

with:

```ts
      { kind: 'follow-up', system: 'Rules', messages: [{ role: 'user', content: 'Q' }] },
```

(Its body assertion, `max_tokens: 1024` with `model: 'claude-sonnet-5-5'`, stays: the adapter now chooses both.) Add at the end of the file:

```ts

describe('createClient', () => {
  it('hands a Claude key to the Claude adapter', async () => {
    sdk.stream.mockReturnValue(fakeStream(['A'], [{ type: 'text', text: 'A' }]));
    const result = await createClient('sk-ant-api03-key').stream(
      { kind: 'follow-up', system: 'Rules', messages: [{ role: 'user', content: 'Q' }] },
      () => {},
      new AbortController().signal,
    );
    expect(result).toEqual({ text: 'A', toolCalls: [] });
    expect(sdk.constructed.at(-1)).toMatchObject({ apiKey: 'sk-ant-api03-key', dangerouslyAllowBrowser: true });
  });
});
```

In `lingoflix-extension/tests/unit/explain-service.test.ts`:
- Replace `import type { ClaudeClient, StreamParams, SystemBlock, ToolCall } from '@/lib/ai/client';` with `import type { AiClient, StreamParams, SystemBlock, ToolCall } from '@/lib/ai/client';`.
- Replace `  const client: ClaudeClient = {` with `  const client: AiClient = {`, and `function deps(client: ClaudeClient, over` with `function deps(client: AiClient, over`.
- In `it('streams deltas, stores the explanation with its checked suggestions, ...')`, replace:

```ts
    expect(calls[0]).toMatchObject({ model: CLAUDE_MODEL, maxTokens: 1536, tools: [SUGGEST_SAVES_TOOL] });
```

with:

```ts
    expect(calls[0]).toMatchObject({ kind: 'explain', tools: [SUGGEST_SAVES_TOOL] });
    expect(calls[0]).not.toHaveProperty('model');
```

- In `it('replays the conversation with the same story and history, without tools, ...')`, replace:

```ts
    expect(calls[0]).toMatchObject({ model: CLAUDE_MODEL, maxTokens: 1024 });
```

with:

```ts
    expect(calls[0]).toMatchObject({ kind: 'follow-up' });
```

In `lingoflix-extension/tests/unit/background-messages.test.ts`, replace `import type { ClaudeClient } from '@/lib/ai/client';` with `import type { AiClient } from '@/lib/ai/client';`, and both other `ClaudeClient` with `AiClient` (in `handlerWith`'s `checkKey` parameter type and in its `createClient` mock's return type).

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/anthropic.test.ts tests/unit/ai.test.ts tests/unit/explain-service.test.ts tests/unit/background-messages.test.ts tests/unit/explain-flow.test.ts tests/unit/suggestions.test.ts tests/unit/context-blocks.test.ts tests/unit/saved-items.test.ts`
Expected: FAIL, Test Files 7 failed | 1 passed (8), Tests 18 passed (18). Each failing file stops at its first `@/lib/ai/` import:
- `Error: Cannot find package '@/lib/ai/anthropic' imported from .../tests/unit/anthropic.test.ts`
- `Error: Cannot find package '@/lib/ai/errors' imported from .../tests/unit/ai.test.ts`
- `Error: Cannot find package '@/lib/ai/explain-service' imported from .../tests/unit/explain-service.test.ts`
- `Error: Cannot find package '@/lib/ai/protocol' imported from .../tests/unit/explain-flow.test.ts`
- `Error: Cannot find package '@/lib/ai/suggestions' imported from .../tests/unit/suggestions.test.ts` (and the same from `saved-items.test.ts`)
- `Error: Cannot find package '@/lib/ai/context-blocks' imported from .../tests/unit/context-blocks.test.ts`

`background-messages.test.ts` passes: its only `@/lib/ai/` import is type-only and is erased.

- [ ] **Step 3: Move the sources and point every import at `@/lib/ai/`**

```bash
mkdir -p lingoflix-extension/src/lib/ai
git mv lingoflix-extension/src/lib/claude/client.ts lingoflix-extension/src/lib/ai/anthropic.ts
for f in context-blocks errors explain-service prompt protocol suggestions; do
  git mv lingoflix-extension/src/lib/claude/$f.ts lingoflix-extension/src/lib/ai/$f.ts
done
rmdir lingoflix-extension/src/lib/claude
perl -pi -e 's#\@/lib/claude/#\@/lib/ai/#g' $(grep -rl '@/lib/claude/' lingoflix-extension/src)
```

- [ ] **Step 4: The neutral client**

Create `lingoflix-extension/src/lib/ai/client.ts`:

```ts
import { createAnthropicClient } from './anthropic';

/** One part of the system prompt; `cache` puts a prompt-cache breakpoint after it (v2 spec §5.1). */
export interface SystemBlock {
  text: string;
  cache: boolean;
}

/** A tool the model may call. `input_schema` is a JSON Schema object; each adapter sends it in its API's shape. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamParams {
  /** Each adapter picks its model and output limit; `kind` says which limit (free-own-key spec §4.1). */
  kind: 'explain' | 'follow-up';
  system: string | SystemBlock[];
  messages: ChatMessage[];
  /** Offered with tool_choice auto, so the model still writes its explanation first. */
  tools?: ToolDefinition[];
}

export interface ToolCall {
  name: string;
  input: unknown;
}

export interface StreamResult {
  /** The answer's text, joined. */
  text: string;
  toolCalls: ToolCall[];
}

/** The provider-neutral client LingoFlix uses (free-own-key spec §4.1). Tests substitute a fake. */
export interface AiClient {
  /** Streams text deltas to `onText`; resolves with the text and tool calls; rejects with the SDK's errors. */
  stream(params: StreamParams, onText: (delta: string) => void, signal: AbortSignal): Promise<StreamResult>;
  /** The cheapest authenticated call, the provider's model list (spec §5.8 Test key). */
  checkKey(): Promise<void>;
}

/** The client for an API key. */
export function createClient(apiKey: string): AiClient {
  return createAnthropicClient(apiKey);
}
```

- [ ] **Step 5: The Claude adapter**

In `lingoflix-extension/src/lib/ai/anthropic.ts`:

Replace the imports:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_API_BASE_URL } from '@/lib/config';
import type { ChatMessage } from './prompt';
```

with:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_API_BASE_URL, CLAUDE_EXPLAIN_MAX_TOKENS, CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from '@/lib/config';
import type { AiClient, SystemBlock, ToolCall } from './client';
```

Delete everything from `/** One part of the system prompt; ...` down to (not including) `type SdkSystemBlock = ...`: the interfaces `SystemBlock`, `ToolDefinition`, `StreamParams`, `ToolCall`, `StreamResult` and `ClaudeClient` (they now live in `client.ts`).

Replace:

```ts
export function createSdkClient(apiKey: string): ClaudeClient {
```

with:

```ts
/** The Claude adapter (free-own-key spec §4.2): Anthropic's SDK, as before the move. */
export function createAnthropicClient(apiKey: string): AiClient {
```

and in its `stream`, replace:

```ts
        model: params.model,
        max_tokens: params.maxTokens,
```

with:

```ts
        model: CLAUDE_MODEL,
        max_tokens: params.kind === 'explain' ? CLAUDE_EXPLAIN_MAX_TOKENS : CLAUDE_MAX_TOKENS,
```

- [ ] **Step 6: The shared modules and their callers**

In `lingoflix-extension/src/lib/ai/prompt.ts`, delete the `ChatMessage` interface (and the blank line after it):

```ts
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
```

and replace `import { recentStoryText } from './context-blocks';` with:

```ts
import type { ChatMessage } from './client';
import { recentStoryText } from './context-blocks';
```

In `lingoflix-extension/src/lib/ai/explain-service.ts`:
- Replace `import { CLAUDE_EXPLAIN_MAX_TOKENS, CLAUDE_IDLE_TIMEOUT_MS, CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from '@/lib/config';` with `import { CLAUDE_IDLE_TIMEOUT_MS, CLAUDE_MODEL } from '@/lib/config';`.
- Replace `import type { ClaudeClient, StreamParams, StreamResult, SystemBlock, ToolCall } from './client';` with `import type { AiClient, StreamParams, StreamResult, SystemBlock, ToolCall } from './client';`, and in `ExplainServiceDeps` replace `createClient(apiKey: string): ClaudeClient;` with `createClient(apiKey: string): AiClient;`.
- In `run`, replace the explanation's

```ts
      params = {
        model: CLAUDE_MODEL,
        maxTokens: CLAUDE_EXPLAIN_MAX_TOKENS,
        system,
```

with:

```ts
      params = {
        kind: 'explain',
        system,
```

and the follow-up's

```ts
      params = {
        model: CLAUDE_MODEL,
        maxTokens: CLAUDE_MAX_TOKENS,
        system,
```

with:

```ts
      params = {
        kind: 'follow-up',
        system,
```

In `lingoflix-extension/src/lib/background/message-handler.ts`, replace `import type { ClaudeClient } from '@/lib/ai/client';` with `import type { AiClient } from '@/lib/ai/client';`, and in `MessageHandlerDeps` replace `createClient(apiKey: string): ClaudeClient;` with `createClient(apiKey: string): AiClient;`.

In `lingoflix-extension/src/entrypoints/background.ts`, replace `import { createSdkClient } from '@/lib/ai/client';` with `import { createClient } from '@/lib/ai/client';`, and both `createClient: createSdkClient,` with `createClient,`.

- [ ] **Step 7: Run the tests again**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/anthropic.test.ts tests/unit/ai.test.ts tests/unit/explain-service.test.ts tests/unit/background-messages.test.ts tests/unit/explain-flow.test.ts tests/unit/suggestions.test.ts tests/unit/context-blocks.test.ts tests/unit/saved-items.test.ts`
Expected: PASS (8 files, 130 tests).

Run: `grep -rn "lib/claude\|ClaudeClient\|createSdkClient" lingoflix-extension/src lingoflix-extension/tests`
Expected: no output.

- [ ] **Step 8: Run everything**

Run: `pnpm --filter lingoflix-extension test`
Expected: PASS (47 files, 571 tests).

Run: `pnpm --filter lingoflix-extension compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-extension build`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add -A lingoflix-extension/src lingoflix-extension/tests
git commit -m "refactor(extension): move the Claude client to src/lib/ai behind a provider-neutral interface

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Tell the provider from the key

**Files:**
- Create: `lingoflix-extension/src/lib/ai/provider.ts`, `lingoflix-extension/tests/unit/provider.test.ts`
- Modify: `lingoflix-extension/src/lib/background/message-handler.ts`, `lingoflix-extension/src/lib/messages.ts`, `lingoflix-extension/src/lib/ai/explain-service.ts`, `lingoflix-extension/src/lib/ai/anthropic.ts`, `lingoflix-extension/src/lib/config.ts`, `lingoflix-extension/src/entrypoints/options/ApiKeyCard.tsx`
- Modify (tests): `lingoflix-extension/tests/unit/background-messages.test.ts`, `lingoflix-extension/tests/unit/explain-service.test.ts`, `lingoflix-extension/tests/unit/settings-ui.test.tsx`

**Interfaces:**
- Consumes: `AiClient`, `createClient(apiKey)` (`@/lib/ai/client`, Task 1), `toExplainError(err)` (`@/lib/ai/errors`), `maskApiKey(key)` (`@/lib/api-key`).
- Produces:
  - `src/lib/ai/provider.ts` (no SDK imports: the content script, options page and popup use it): `type Provider = 'claude' | 'openai'`; `interface ProviderInfo { name: string; company: string; model: string; console: string; keysUrl: string; billingUrl: string }`; `PROVIDERS: Record<Provider, ProviderInfo>` with `claude = { name: 'Claude', company: 'Anthropic', model: 'claude-sonnet-5-5', console: 'console.anthropic.com', keysUrl: 'https://console.anthropic.com/settings/keys', billingUrl: 'https://console.anthropic.com/settings/billing' }` and `openai = { name: 'OpenAI', company: 'OpenAI', model: 'gpt-6.1-sol', console: 'platform.openai.com', keysUrl: 'https://platform.openai.com/api-keys', billingUrl: 'https://platform.openai.com/settings/organization/billing/overview' }`; `providerOf(key: string): Provider | null`; `NOT_A_KEY = "This doesn't look like a Claude or OpenAI key."`.
  - `api-key:status` answers `{ set: boolean; masked: string | null; provider: Provider | null }` (`BackgroundRequests` in `@/lib/messages`). `provider` is null when no key is saved, and for a saved key that is neither Claude's nor OpenAI's (`set` is then true).
  - `api-key:set` refuses (`{ ok: false }`) a key whose `providerOf` is null; Settings shows `NOT_A_KEY`. `api-key:test` refuses a typed key that fails the same check, and a saved one whose provider is null, with `{ result: 'rejected', message: NOT_A_KEY }`, without calling `createClient`.
  - `api-key:test` names the key's company: `{Company} rejected this key.` and `Couldn't reach {Company}. Check your connection.`
  - Each explanation saves `model: PROVIDERS[providerOf(key)].model` (spec §4.8). The explain service treats a saved key whose provider is null as no key (`no-key`, no request).
  - `CLAUDE_MODEL` leaves `@/lib/config`; the Claude adapter uses `PROVIDERS.claude.model`.

The provider is never stored: it is read from the key each time (spec §3.2), so existing Claude keys keep working. Save always accepted any printable ASCII, so a key saved before this task may be neither Claude's nor OpenAI's; such a key could never have worked with Anthropic, and is now treated as no key. Until Task 4, `createClient` still hands every key to the Claude adapter, so an OpenAI key can be saved but doesn't work yet: Test key with one answers `OpenAI rejected this key.` (Anthropic's 401).

Copy (exact, spec §3.2): `This doesn't look like a Claude or OpenAI key.`, `Your key works.`, `Anthropic rejected this key.` / `OpenAI rejected this key.`, `Couldn't reach Anthropic. Check your connection.` / `Couldn't reach OpenAI. Check your connection.`

- [ ] **Step 1: Write the failing tests**

Create `lingoflix-extension/tests/unit/provider.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NOT_A_KEY, PROVIDERS, providerOf } from '@/lib/ai/provider';

describe('providerOf (free-own-key spec §3.1)', () => {
  it('reads Claude from sk-ant- keys', () => {
    expect(providerOf('sk-ant-api03-abcdefghijklmnop-wxyz')).toBe('claude');
    expect(providerOf('sk-ant-admin01-abcdef')).toBe('claude'); // an admin key: Test key is the real check
  });

  it('reads OpenAI from every other sk- key', () => {
    expect(providerOf('sk-proj-abcdefghijklmnop')).toBe('openai');
    expect(providerOf('sk-svcacct-abcdefghijklmnop')).toBe('openai');
    expect(providerOf('sk-abcdefghijklmnop')).toBe('openai'); // a legacy user key
    expect(providerOf('sk-admin-abcdef')).toBe('openai');
  });

  it('trims the key first', () => {
    expect(providerOf('  sk-ant-api03-key \n')).toBe('claude');
    expect(providerOf('\tsk-proj-key ')).toBe('openai');
  });

  it('is null for anything else', () => {
    for (const key of ['', '   ', 'sk', 'sk_live_abc', 'SK-ANT-api03', 'ant-api03-abc', 'pk-abc', 'api-key', 'x sk-ant-api03']) {
      expect(providerOf(key)).toBeNull();
    }
  });
});

describe('PROVIDERS', () => {
  it('names, model, and key and billing pages of each provider', () => {
    expect(PROVIDERS).toEqual({
      claude: {
        name: 'Claude',
        company: 'Anthropic',
        model: 'claude-sonnet-5-5',
        console: 'console.anthropic.com',
        keysUrl: 'https://console.anthropic.com/settings/keys',
        billingUrl: 'https://console.anthropic.com/settings/billing',
      },
      openai: {
        name: 'OpenAI',
        company: 'OpenAI',
        model: 'gpt-6.1-sol',
        console: 'platform.openai.com',
        keysUrl: 'https://platform.openai.com/api-keys',
        billingUrl: 'https://platform.openai.com/settings/organization/billing/overview',
      },
    });
  });

  it('says what a refused key is', () => {
    expect(NOT_A_KEY).toBe("This doesn't look like a Claude or OpenAI key.");
  });
});
```

In `lingoflix-extension/tests/unit/background-messages.test.ts`:

Add `import { NOT_A_KEY } from '@/lib/ai/provider';` directly below `import type { AiClient } from '@/lib/ai/client';`, and directly below `const KEY = 'sk-ant-api03-abcdefghijklmnop-wxyz';` add:

```ts
const OPENAI_KEY = 'sk-proj-abcdefghijklmnop-wxyz';
```

In `it('stores, reports (masked), and removes the key, never echoing it back', ...)`, replace:

```ts
    expect(replies).toEqual([
      { set: false, masked: null },
      { ok: true },
      { set: true, masked: maskApiKey(KEY) },
    ]);
```

with:

```ts
    expect(replies).toEqual([
      { set: false, masked: null, provider: null },
      { ok: true },
      { set: true, masked: maskApiKey(KEY), provider: 'claude' },
    ]);
```

and its last line, `expect(await handle({ type: 'api-key:status' })).toEqual({ set: false, masked: null });`, with:

```ts
    expect(await handle({ type: 'api-key:status' })).toEqual({ set: false, masked: null, provider: null });
```

Directly after that test, add:

```ts

  it('saves an OpenAI key and reports its provider', async () => {
    const { handle } = handlerWith();
    expect(await handle({ type: 'api-key:set', key: OPENAI_KEY })).toEqual({ ok: true });
    expect(await handle({ type: 'api-key:status' })).toEqual({ set: true, masked: 'sk-proj…wxyz', provider: 'openai' });
  });
```

Rename `it('refuses keys that are empty or contain spaces, invisible, or non-ASCII characters', ...)` to `it('refuses keys that are empty, contain spaces, invisible, or non-ASCII characters, or are not Claude or OpenAI keys', ...)`, and in it, directly above `expect(await getApiKey()).toBeNull();`, add:

```ts
    expect(await handle({ type: 'api-key:set', key: 'ant-api03-abcdef' })).toEqual({ ok: false });
    expect(await handle({ type: 'api-key:set', key: 'AIzaSyabcdef' })).toEqual({ ok: false });
```

Replace the whole `it('Test key refuses a typed key that does not look like one, without calling Anthropic', ...)` test with:

```ts
  it('Test key refuses a typed key that does not look like one, without calling the provider', async () => {
    const { handle, createClient } = handlerWith();
    expect(await handle({ type: 'api-key:test', key: 'two words' })).toEqual({ result: 'rejected', message: NOT_A_KEY });
    expect(await handle({ type: 'api-key:test', key: 'AIzaSyabcdef' })).toEqual({ result: 'rejected', message: NOT_A_KEY });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('Test key refuses a saved key that is not a Claude or OpenAI key (saved before Save checked)', async () => {
    await fakeBrowser.storage.local.set({ apiKey: 'legacy-key-1234' });
    const { handle, createClient } = handlerWith();
    expect(await handle({ type: 'api-key:status' })).toEqual({ set: true, masked: 'legacy-…1234', provider: null });
    expect(await handle({ type: 'api-key:test' })).toEqual({ result: 'rejected', message: NOT_A_KEY });
    expect(createClient).not.toHaveBeenCalled();
  });
```

In `it('only LingoFlix pages may set, remove, or test the key; anyone may read its status', ...)`, replace its last line with:

```ts
    expect(await handle({ type: 'api-key:status' }, FROM_NETFLIX)).toEqual({ set: true, masked: maskApiKey(KEY), provider: 'claude' });
```

Directly above `it('Test key without any key says so', ...)`, add:

```ts
  it('Test key names OpenAI for an OpenAI key', async () => {
    await setApiKey(OPENAI_KEY);
    expect(await handlerWith().handle({ type: 'api-key:test' })).toEqual({ result: 'valid', message: 'Your key works.' });
    const rejected = handlerWith(async () => {
      throw APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid' } }, 'x', new Headers());
    });
    expect(await rejected.handle({ type: 'api-key:test' })).toEqual({ result: 'rejected', message: 'OpenAI rejected this key.' });
    const offline = handlerWith(async () => {
      throw new APIConnectionError({ message: 'fetch failed' });
    });
    expect(await offline.handle({ type: 'api-key:test' })).toEqual({
      result: 'network',
      message: "Couldn't reach OpenAI. Check your connection.",
    });
  });

```

(The fakes throw Anthropic's errors for now; Task 4 switches them to OpenAI's.)

In `lingoflix-extension/tests/unit/explain-service.test.ts`:

Replace:

```ts
import { SUGGEST_SAVES_TOOL } from '@/lib/ai/suggestions';
import { CLAUDE_MODEL } from '@/lib/config';
```

with:

```ts
import { PROVIDERS } from '@/lib/ai/provider';
import { SUGGEST_SAVES_TOOL } from '@/lib/ai/suggestions';
```

In `STORED` (indented 2 spaces), replace `model: CLAUDE_MODEL,` with `model: PROVIDERS.claude.model,`. In `it('streams deltas, stores the explanation with its checked suggestions, ...')` (indented 6 spaces), replace `model: CLAUDE_MODEL,` with `model: 'claude-sonnet-5-5',`. The string appears in both places, so edit each in its own context.

Directly above `it('without a suggest_saves call, the explanation is stored with no suggestions', ...)`, add:

```ts
  it('stores the model that wrote the explanation: GPT-6.1 Sol for an OpenAI key (free-own-key spec §4.8)', async () => {
    const { client } = fakeClient({ deltas: ['ok'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client, { getApiKey: async () => 'sk-proj-test-key-0000' }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(doneOf(sent).explanation.model).toBe('gpt-6.1-sol');
  });

```

Directly above `it("a background failure before the request (storage gone) shows Couldn't reach Claude", ...)`, add:

```ts
  it('a saved key that is not a Claude or OpenAI key counts as no key', async () => {
    const createClient = vi.fn();
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(fakeClient().client, { getApiKey: async () => 'legacy-key-1234', createClient }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'no-key', message: 'Add your Claude API key' }]));
    expect(createClient).not.toHaveBeenCalled();
  });

```

In `lingoflix-extension/tests/unit/settings-ui.test.tsx`, in `it('removes the key and refuses junk', ...)`, replace:

```tsx
    expect(await screen.findByText("That doesn't look like an API key.")).toBeTruthy();
```

with:

```tsx
    expect(await screen.findByText("This doesn't look like a Claude or OpenAI key.")).toBeTruthy();
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/provider.test.ts tests/unit/background-messages.test.ts tests/unit/explain-service.test.ts tests/unit/settings-ui.test.tsx`
Expected: FAIL, Test Files 4 failed (4), Tests 1 failed | 7 passed (8):
- `Error: Cannot find package '@/lib/ai/provider' imported from .../tests/unit/provider.test.ts` (and the same from `background-messages.test.ts` and `explain-service.test.ts`)
- `Claude API key card > removes the key and refuses junk`: `TestingLibraryElementError: Unable to find an element with the text: This doesn't look like a Claude or OpenAI key.. This could be because the text is broken up by multiple elements. ...`

- [ ] **Step 3: The provider module**

Create `lingoflix-extension/src/lib/ai/provider.ts`:

```ts
// The content script, options page and popup use this module: never import an SDK here.

/** Whose API a key calls (free-own-key spec §3.1). Never stored: read from the key each time. */
export type Provider = 'claude' | 'openai';

export interface ProviderInfo {
  /** The name in learner-facing copy: "Claude is busy right now". */
  name: string;
  /** The company that bills the key: "Anthropic rejected this key." */
  company: string;
  /** The one model LingoFlix uses with this provider, saved on each explanation (spec §4.8). */
  model: string;
  /** The console's address, as copy shows it. */
  console: string;
  /** Where the learner creates a key. */
  keysUrl: string;
  /** Where the learner adds credit. */
  billingUrl: string;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  claude: {
    name: 'Claude',
    company: 'Anthropic',
    model: 'claude-sonnet-5-5',
    console: 'console.anthropic.com',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    billingUrl: 'https://console.anthropic.com/settings/billing',
  },
  openai: {
    name: 'OpenAI',
    company: 'OpenAI',
    model: 'gpt-6.1-sol',
    console: 'platform.openai.com',
    keysUrl: 'https://platform.openai.com/api-keys',
    billingUrl: 'https://platform.openai.com/settings/organization/billing/overview',
  },
};

/**
 * Spec §3.1: `sk-ant-` is Claude, any other `sk-` is OpenAI, anything else neither. OpenAI doesn't document
 * its key formats, so only the prefix is checked; Test key is the real check.
 */
export function providerOf(key: string): Provider | null {
  const trimmed = key.trim();
  if (trimmed.startsWith('sk-ant-')) return 'claude';
  if (trimmed.startsWith('sk-')) return 'openai';
  return null;
}

/** Spec §3.2: what Save and Test key say about a key that is neither. */
export const NOT_A_KEY = "This doesn't look like a Claude or OpenAI key.";
```

- [ ] **Step 4: Save, status and Test key read the provider from the key**

In `lingoflix-extension/src/lib/background/message-handler.ts`:

Add `import { NOT_A_KEY, PROVIDERS, providerOf } from '@/lib/ai/provider';` directly below `import { toExplainError } from '@/lib/ai/errors';`.

Replace:

```ts
/**
 * A pasted key: printable ASCII only (no spaces, no invisible or non-ASCII characters), a sane length.
 * Anthropic's own check happens in Test key.
 */
const looksLikeKey = (key: string) => /^[\x21-\x7e]{1,300}$/.test(key);
const NOT_A_KEY = "That doesn't look like an API key.";
```

with:

```ts
/**
 * A pasted key: printable ASCII only (no spaces, no invisible or non-ASCII characters), a sane length, and a
 * Claude or OpenAI key by its prefix (free-own-key spec §3.2). The provider's own check happens in Test key.
 */
const looksLikeKey = (key: string) => /^[\x21-\x7e]{1,300}$/.test(key) && providerOf(key) !== null;
```

In `testKey`, replace:

```ts
    if (!key) return { result: 'rejected', message: 'No API key to test.' };
    try {
      await deps.createClient(key).checkKey();
      return { result: 'valid', message: 'Your key works.' };
    } catch (err) {
      const { code, message } = toExplainError(err);
      if (code === 'bad-key') return { result: 'rejected', message: 'Anthropic rejected this key.' };
      if (code === 'network') return { result: 'network', message: "Couldn't reach Anthropic. Check your connection." };
      return { result: 'error', message };
    }
```

with:

```ts
    if (!key) return { result: 'rejected', message: 'No API key to test.' };
    const provider = providerOf(key);
    if (!provider) return { result: 'rejected', message: NOT_A_KEY }; // saved before Save checked the provider
    const { company } = PROVIDERS[provider];
    try {
      await deps.createClient(key).checkKey();
      return { result: 'valid', message: 'Your key works.' };
    } catch (err) {
      const { code, message } = toExplainError(err);
      if (code === 'bad-key') return { result: 'rejected', message: `${company} rejected this key.` };
      if (code === 'network') return { result: 'network', message: `Couldn't reach ${company}. Check your connection.` };
      return { result: 'error', message };
    }
```

In `case 'api-key:status':`, replace:

```ts
        return { set: key !== null, masked: key ? maskApiKey(key) : null } satisfies BackgroundResponse<'api-key:status'>;
```

with:

```ts
        return {
          set: key !== null,
          masked: key ? maskApiKey(key) : null,
          provider: key ? providerOf(key) : null,
        } satisfies BackgroundResponse<'api-key:status'>;
```

In `lingoflix-extension/src/lib/messages.ts`, add `import type { Provider } from '@/lib/ai/provider';` directly below `import { browser } from '#imports';`, and replace:

```ts
  'api-key:status': { request: object; response: { set: boolean; masked: string | null } };
```

with:

```ts
  /** `provider` is read from the saved key: null when none is saved, or it is neither Claude's nor OpenAI's. */
  'api-key:status': { request: object; response: { set: boolean; masked: string | null; provider: Provider | null } };
```

In `lingoflix-extension/src/entrypoints/options/ApiKeyCard.tsx`, add `import { NOT_A_KEY } from '@/lib/ai/provider';` directly above `import { ANTHROPIC_KEYS_URL } from '@/lib/config';`, and replace:

```tsx
        setNote({ tone: 'bad', text: "That doesn't look like an API key." });
```

with:

```tsx
        setNote({ tone: 'bad', text: NOT_A_KEY });
```

- [ ] **Step 5: The explanation saves the model of the key's provider**

In `lingoflix-extension/src/lib/ai/explain-service.ts`:

Replace `import { CLAUDE_IDLE_TIMEOUT_MS, CLAUDE_MODEL } from '@/lib/config';` with `import { CLAUDE_IDLE_TIMEOUT_MS } from '@/lib/config';`, and add `import { PROVIDERS, providerOf } from './provider';` directly below the `./prompt` import.

Replace the signature `function explanationFields(request: ExplainRequest, response: string, suggestions: SaveSuggestion[]): NewExplanation {` with:

```ts
function explanationFields(request: ExplainRequest, response: string, suggestions: SaveSuggestion[], model: string): NewExplanation {
```

and in its body replace `    model: CLAUDE_MODEL,` with `    model,`.

In `run`, replace:

```ts
    const apiKey = await deps.getApiKey();
    if (!apiKey) return fail('no-key');
```

with:

```ts
    const apiKey = await deps.getApiKey();
    // A key saved before Save checked the provider, that is neither Claude's nor OpenAI's, counts as none.
    const provider = apiKey ? providerOf(apiKey) : null;
    if (!apiKey || !provider) return fail('no-key');
```

and replace:

```ts
      finish = (result) =>
        deps.saveExplanation(explanationFields(request, result.text, suggestionsFrom(result.toolCalls, request.phrase)));
```

with:

```ts
      finish = (result) =>
        deps.saveExplanation(
          explanationFields(request, result.text, suggestionsFrom(result.toolCalls, request.phrase), PROVIDERS[provider].model),
        );
```

In `lingoflix-extension/src/lib/ai/anthropic.ts`, replace:

```ts
import { CLAUDE_API_BASE_URL, CLAUDE_EXPLAIN_MAX_TOKENS, CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from '@/lib/config';
import type { AiClient, SystemBlock, ToolCall } from './client';
```

with:

```ts
import { CLAUDE_API_BASE_URL, CLAUDE_EXPLAIN_MAX_TOKENS, CLAUDE_MAX_TOKENS } from '@/lib/config';
import type { AiClient, SystemBlock, ToolCall } from './client';
import { PROVIDERS } from './provider';
```

and `        model: CLAUDE_MODEL,` with `        model: PROVIDERS.claude.model,`.

In `lingoflix-extension/src/lib/config.ts`, delete:

```ts
/** Spec §7.1: one constant for the model. */
export const CLAUDE_MODEL = 'claude-sonnet-5-5';
```

- [ ] **Step 6: Run the tests again**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/provider.test.ts tests/unit/background-messages.test.ts tests/unit/explain-service.test.ts tests/unit/settings-ui.test.tsx`
Expected: PASS (4 files, 55 tests).

Run: `grep -rn "CLAUDE_MODEL" lingoflix-extension/src lingoflix-extension/tests`
Expected: no output.

- [ ] **Step 7: Run everything**

Run: `pnpm --filter lingoflix-extension test`
Expected: PASS (48 files, 582 tests).

Run: `pnpm --filter lingoflix-extension compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-extension build`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add lingoflix-extension/src lingoflix-extension/tests
git commit -m "feat(extension): tell Claude and OpenAI keys apart, and name the company in Test key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Errors that name the provider, `no-credit`, and an idle timer that any stream event resets

**Files:**
- Modify: `lingoflix-extension/src/lib/ai/protocol.ts`, `lingoflix-extension/src/lib/ai/errors.ts`, `lingoflix-extension/src/lib/ai/client.ts`, `lingoflix-extension/src/lib/ai/anthropic.ts`, `lingoflix-extension/src/lib/background/message-handler.ts`, `lingoflix-extension/src/lib/config.ts`, `lingoflix-extension/src/entrypoints/netflix.content/overlay/{Card.tsx,card-state.ts,explain-controller.ts}`
- Modify (whole file replaced): `lingoflix-extension/src/lib/ai/explain-service.ts`, `lingoflix-extension/src/entrypoints/netflix.content/overlay/explain-port.ts`
- Modify (tests): `lingoflix-extension/tests/unit/{ai,anthropic,explain-service,explain-flow}.test.ts`, `lingoflix-extension/tests/unit/card.test.tsx`

**Interfaces:**
- Consumes: `Provider`, `PROVIDERS`, `providerOf` (`@/lib/ai/provider`, Task 2); `AiClient`, `StreamParams` (`@/lib/ai/client`, Task 1).
- Produces:
  - `src/lib/ai/protocol.ts` (no SDK imports): `type ExplainErrorCode = 'no-key' | 'bad-key' | 'no-credit' | 'busy' | 'network' | 'api'`; `UNREACHABLE = "Couldn't reach LingoFlix's background"`; `errorCopy(code: ExplainErrorCode, provider: Provider | null): string` (spec §4.6 headlines; `no-key` needs no provider; any other code with a null provider gives `UNREACHABLE`). The server's error message is now `{ type: 'error'; code: ExplainErrorCode; message: string; provider: Provider | null }`. `ERROR_COPY` is gone.
  - `src/lib/ai/errors.ts`: `toExplainError(err: unknown, provider: Provider): { code: ExplainErrorCode; message: string }`. Anthropic's 402 and its `billing_error` (with or without a status) are `no-credit`, and so is a 400 `invalid_request_error` whose message contains "credit balance" (any case). An `api` error keeps the provider's message, or `{Name} returned an error` when there is none.
  - `AiClient.stream(params, onText, signal, onActivity: () => void)`: the adapter calls `onActivity` on every stream event (text or not). The Claude adapter calls it on the SDK's `streamEvent`. The explain service re-arms its 30 s idle timer on each call (spec §4.3).
  - `AI_IDLE_TIMEOUT_MS` (`@/lib/config`) replaces `CLAUDE_IDLE_TIMEOUT_MS`.
  - The card: `CardState['error']` is `{ code: CardErrorCode; message: string; provider: Provider | null } | null`; `StreamHandlers.onError(code, message, provider)`. A `no-credit` card shows the headline, a link `Add credit at console.anthropic.com` or `Add credit at platform.openai.com` to `PROVIDERS[provider].billingUrl` (new tab), and Retry.

Spec §4.6, card headlines (`{Name}` is `PROVIDERS[p].name`, `{Company}` is `PROVIDERS[p].company`):

| Code | Headline | Button |
|---|---|---|
| `no-key` | `Add your API key` | Open Settings |
| `bad-key` | `Your {Name} key was rejected` | Open Settings |
| `no-credit` | `Your {Company} account is out of credit`, then the link `Add credit at {console}` | Retry |
| `busy` | `{Name} is busy right now` | Retry |
| `network` | `Couldn't reach {Name}` | Retry |
| `api` | the provider's message, or `{Name} returned an error` | none |

Anthropic usually reports a low balance as `400 invalid_request_error` with "Your credit balance is too low to access the Anthropic API.", not as a 402 `billing_error`. So a 400 `invalid_request_error` whose message contains "credit balance" (case-insensitive) is `no-credit` too (owner's ruling). It is a text match: if Anthropic rewords the sentence, the card falls back to showing Anthropic's own sentence (`api`). Any other 400 stays `api` with Anthropic's message.

`Claude returned an empty answer.` becomes `{Name} returned an empty answer.` The background sends the key's provider with every error, so the content script never needs an SDK. When the content script itself loses the Port (the worker restarted, or the extension was reloaded), no provider is known; the card then shows `Couldn't reach LingoFlix's background` with Retry. That copy is not in the spec; the owner kept it, as it matches the Settings page's existing "Couldn't reach LingoFlix's background." wording.

- [ ] **Step 1: Write the failing tests**

In `lingoflix-extension/tests/unit/ai.test.ts`, replace:

```ts
import { MAX_LINE_CHARS, MAX_STORY_CHARS, fitStory, parseClientMessage } from '@/lib/ai/protocol';
```

with:

```ts
import { MAX_LINE_CHARS, MAX_STORY_CHARS, UNREACHABLE, errorCopy, fitStory, parseClientMessage } from '@/lib/ai/protocol';
```

and replace the whole `describe('toExplainError', () => { ... });` block with:

```ts
describe('errorCopy (free-own-key spec §4.6 card headlines)', () => {
  it('names the provider, or its company for credit', () => {
    expect((['no-key', 'bad-key', 'no-credit', 'busy', 'network', 'api'] as const).map((code) => [errorCopy(code, 'claude'), errorCopy(code, 'openai')])).toEqual([
      ['Add your API key', 'Add your API key'],
      ['Your Claude key was rejected', 'Your OpenAI key was rejected'],
      ['Your Anthropic account is out of credit', 'Your OpenAI account is out of credit'],
      ['Claude is busy right now', 'OpenAI is busy right now'],
      ["Couldn't reach Claude", "Couldn't reach OpenAI"],
      ['Claude returned an error', 'OpenAI returned an error'],
    ]);
  });

  it("without a provider (no key, or the background dropped before reading it), names none", () => {
    expect(errorCopy('no-key', null)).toBe('Add your API key');
    expect(errorCopy('network', null)).toBe(UNREACHABLE);
    expect(UNREACHABLE).toBe("Couldn't reach LingoFlix's background");
  });
});

describe('toExplainError (Anthropic SDK errors)', () => {
  const headers = new Headers();
  it('maps API failures to the card states of spec §4.6, naming the provider', () => {
    expect(
      toExplainError(APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'x', headers), 'claude'),
    ).toEqual({ code: 'bad-key', message: 'Your Claude key was rejected' });
    expect(toExplainError(APIError.generate(429, { error: { type: 'rate_limit_error', message: 'slow' } }, 'x', headers), 'claude').code).toBe('busy');
    expect(toExplainError(APIError.generate(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, 'x', headers), 'claude').code).toBe('busy');
    expect(toExplainError(new APIConnectionError({ message: 'fetch failed' }), 'claude')).toEqual({ code: 'network', message: "Couldn't reach Claude" });
    expect(toExplainError(new APIConnectionTimeoutError(), 'claude').code).toBe('network');
  });

  it('a 402 billing_error, before or during the stream, is no-credit', () => {
    const billing = { error: { type: 'billing_error', message: 'Your credit balance is too low.' } };
    expect(toExplainError(APIError.generate(402, billing, 'x', headers), 'claude')).toEqual({
      code: 'no-credit',
      message: 'Your Anthropic account is out of credit',
    });
    const midStream = new APIError(undefined, { type: 'error', ...billing }, undefined, undefined, 'billing_error');
    expect(toExplainError(midStream, 'claude').code).toBe('no-credit');
  });

  it('server errors and mid-stream rate limit or overload errors are busy, never raw HTML', () => {
    expect(toExplainError(APIError.generate(500, { error: { type: 'api_error', message: 'x' } }, 'x', headers), 'claude')).toEqual({
      code: 'busy',
      message: 'Claude is busy right now',
    });
    const badGateway = toExplainError(APIError.generate(502, '<html>bad gateway</html>' as never, '502 <html>', headers), 'claude');
    expect(badGateway).toEqual({ code: 'busy', message: 'Claude is busy right now' });
    for (const type of ['rate_limit_error', 'overloaded_error'] as const) {
      const midStream = new APIError(undefined, { type: 'error', error: { type, message: 'slow' } }, undefined, undefined, type);
      expect(toExplainError(midStream, 'claude').code).toBe('busy');
    }
  });

  it("a 400 about the credit balance is no-credit too (a text match on Anthropic's sentence, any case)", () => {
    for (const message of ['Your credit balance is too low to access the Anthropic API.', 'Your CREDIT BALANCE is too low.']) {
      const credit = APIError.generate(400, { error: { type: 'invalid_request_error', message } }, 'x', headers);
      expect(toExplainError(credit, 'claude')).toEqual({ code: 'no-credit', message: 'Your Anthropic account is out of credit' });
    }
  });

  it("shows Anthropic's own message for other API errors, else names the provider", () => {
    const tooLong = APIError.generate(
      400,
      { error: { type: 'invalid_request_error', message: 'prompt is too long: 250000 tokens > 200000 maximum' } },
      'x',
      headers,
    );
    expect(toExplainError(tooLong, 'claude')).toEqual({ code: 'api', message: 'prompt is too long: 250000 tokens > 200000 maximum' });
    const notFound = APIError.generate(404, { error: { type: 'not_found_error', message: 'model: no credit balance here' } }, 'x', headers);
    expect(toExplainError(notFound, 'claude')).toEqual({ code: 'api', message: 'model: no credit balance here' });
    expect(toExplainError(new Error(''), 'claude')).toEqual({ code: 'api', message: 'Claude returned an error' });
  });
});
```

In `lingoflix-extension/tests/unit/anthropic.test.ts`, replace the `fakeStream` helper (its doc comment and the whole function) with:

```ts
/**
 * Stands in for the SDK's MessageStream: replays a stream event per text delta (each followed by its `text`
 * event) between message_start and message_stop, then resolves with the final content.
 */
function fakeStream(deltas: string[], content: unknown[], stopReason = 'end_turn') {
  const handlers = new Map<string, Array<(arg: unknown) => void>>();
  const emit = (event: string, arg: unknown) => handlers.get(event)?.forEach((handler) => handler(arg));
  return {
    on(event: string, handler: (arg: never) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler as (arg: unknown) => void]);
      return this;
    },
    async finalMessage() {
      emit('streamEvent', { type: 'message_start' });
      for (const delta of deltas) {
        emit('streamEvent', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } });
        emit('text', delta);
      }
      emit('streamEvent', { type: 'message_stop' });
      return { content, stop_reason: stopReason };
    },
  };
}
```

Every `.stream(...)` call in the file gains a fourth argument, `() => {}` (the activity callback): after `signal,` in `it('streams text and returns it with the tool calls; ...')`, and after `new AbortController().signal,` in the other three calls (two in `describe('createAnthropicClient')`, one in `describe('createClient')`). Then, directly above `it('drops tool calls cut off by max_tokens ...')`, add:

```ts
  it('reports every stream event as activity, not only text (free-own-key spec §4.3)', async () => {
    sdk.stream.mockReturnValue(fakeStream(['Hel', 'lo'], [{ type: 'text', text: 'Hello' }]));
    const activity = vi.fn();
    await createAnthropicClient('sk-ant-test').stream(
      { kind: 'follow-up', system: 'Rules', messages: [{ role: 'user', content: 'Q' }] },
      () => {},
      new AbortController().signal,
      activity,
    );
    expect(activity).toHaveBeenCalledTimes(4); // message_start, two deltas, message_stop
  });

```

In `lingoflix-extension/tests/unit/explain-service.test.ts` (`describe('explain service: failures')` unless noted):
- In `it('without a key, asks for one and makes no request', ...)` and in `it('a saved key that is not a Claude or OpenAI key counts as no key', ...)`, replace `{ type: 'error', code: 'no-key', message: 'Add your Claude API key' }` with `{ type: 'error', code: 'no-key', message: 'Add your API key', provider: null }`.
- Rename `it("a background failure before the request (storage gone) shows Couldn't reach Claude", ...)` to `it("a background failure before the key is read (storage gone) says it couldn't reach LingoFlix's background", ...)`, and replace its last line with:

```ts
    await vi.waitFor(() =>
      expect(sent).toEqual([{ type: 'error', code: 'network', message: "Couldn't reach LingoFlix's background", provider: null }]),
    );
```

  and directly after that test add:

```ts

  it("a failure after the key is read (storage gone) names the key's provider", async () => {
    const { port, sent, send } = fakePort();
    serveExplainPort(
      port,
      deps(fakeClient().client, {
        getApiKey: async () => 'sk-proj-test-key-0000',
        getExplanation: async () => {
          throw new Error('storage gone');
        },
      }),
    );
    send({ type: 'follow-up', explanationId: 'e1', question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'network', message: "Couldn't reach OpenAI", provider: 'openai' }]));
  });
```

- In `it("a silent stream times out as Couldn't reach Claude", ...)`, replace `{ type: 'error', code: 'network', message: "Couldn't reach Claude" }` with `{ type: 'error', code: 'network', message: "Couldn't reach Claude", provider: 'claude' }`, and directly after that test add:

```ts

  it('any stream event keeps the request alive, not only text (free-own-key spec §4.3)', async () => {
    vi.useFakeTimers();
    try {
      let events: { activity(): void; finish(): void } | undefined;
      const client: AiClient = {
        stream: (_params, onText, signal, onActivity) =>
          new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
            events = {
              activity: onActivity,
              finish: () => {
                onText('ok');
                resolve({ text: 'ok', toolCalls: [] });
              },
            };
          }),
        async checkKey() {},
      };
      const { port, sent, send } = fakePort();
      serveExplainPort(port, deps(client, { idleTimeoutMs: 30_000 }));
      send({ type: 'start', request: REQUEST });
      await vi.waitFor(() => expect(events).toBeDefined());
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(20_000); // 60 s in all with no text, never 30 s without an event
        events!.activity();
      }
      events!.finish();
      await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
      expect(sent.filter((m) => m.type === 'error')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
```

- In `it('maps API errors to card states and saves nothing', ...)`, replace `{ type: 'error', code: 'bad-key', message: 'Your API key was rejected' }` with `{ type: 'error', code: 'bad-key', message: 'Your Claude key was rejected', provider: 'claude' }`, and directly after that test add:

```ts

  it("names the key's provider in errors, and its company when out of credit", async () => {
    const outOfCredit = APIError.generate(402, { error: { type: 'billing_error', message: 'No credit' } }, 'x', new Headers());
    for (const [apiKey, expected] of [
      ['sk-ant-test-key-0000', { type: 'error', code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' }],
      ['sk-proj-test-key-0000', { type: 'error', code: 'no-credit', message: 'Your OpenAI account is out of credit', provider: 'openai' }],
    ] as const) {
      const { client } = fakeClient({ error: outOfCredit });
      const { port, sent, send } = fakePort();
      serveExplainPort(port, deps(client, { getApiKey: async () => apiKey }));
      send({ type: 'start', request: REQUEST });
      await vi.waitFor(() => expect(sent).toEqual([expected]));
    }
  });
```

  (Task 4 makes the OpenAI row throw OpenAI's own error.)
- In `it('an empty answer is an error, not an explanation', ...)`, replace from its `await vi.waitFor(...)` line to the end of the test with:

```ts
    await vi.waitFor(() =>
      expect(sent.at(-1)).toEqual({ type: 'error', code: 'api', message: 'Claude returned an empty answer.', provider: 'claude' }),
    );
    expect(await listExplanations()).toEqual([]);

    const openai = fakePort();
    serveExplainPort(openai.port, deps(fakeClient({ deltas: [' '] }).client, { getApiKey: async () => 'sk-proj-test-key-0000' }));
    openai.send({ type: 'start', request: REQUEST });
    await vi.waitFor(() =>
      expect(openai.sent.at(-1)).toEqual({ type: 'error', code: 'api', message: 'OpenAI returned an empty answer.', provider: 'openai' }),
    );
  });
```

- In `describe('explain service: follow-ups')`, `it('a follow-up on a deleted explanation, malformed messages, and second messages are handled', ...)`: add `, provider: 'claude'` to the `This explanation is no longer available.` error object and `, provider: null` to the `LingoFlix sent a request it could not read.` one, each wrapped as:

```ts
    await vi.waitFor(() =>
      expect(a.sent).toEqual([{ type: 'error', code: 'api', message: 'This explanation is no longer available.', provider: 'claude' }]),
    );
```

```ts
    await vi.waitFor(() =>
      expect(b.sent).toEqual([{ type: 'error', code: 'api', message: 'LingoFlix sent a request it could not read.', provider: null }]),
    );
```

In `lingoflix-extension/tests/unit/explain-flow.test.ts`:
- Replace `it("a dropped port shows Couldn't reach Claude", () => { ... })` in `describe('streamExplanation')` (the synchronous one) with:

```ts
  it("a dropped port says it couldn't reach LingoFlix's background (no provider is known)", () => {
    const fake = fakePort();
    const onError = vi.fn();
    streamExplanation(() => fake.port, { type: 'start', request: {} as never }, { onDelta: vi.fn(), onDone: vi.fn(), onError });
    fake.drop();
    expect(onError).toHaveBeenCalledWith('network', "Couldn't reach LingoFlix's background", null);
  });

  it("passes on the background's error with the provider it names", () => {
    const fake = fakePort();
    const onError = vi.fn();
    streamExplanation(() => fake.port, { type: 'start', request: {} as never }, { onDelta: vi.fn(), onDone: vi.fn(), onError });
    fake.receive({ type: 'error', code: 'no-credit', message: 'Your OpenAI account is out of credit', provider: 'openai' });
    expect(onError).toHaveBeenCalledWith('no-credit', 'Your OpenAI account is out of credit', 'openai');
    expect(fake.port.disconnect).toHaveBeenCalled();
  });
```

- In `it('a reloaded extension (connect throws) is a network error', ...)`, replace `expect(onError).toHaveBeenCalledWith('network', "Couldn't reach Claude");` with `expect(onError).toHaveBeenCalledWith('network', "Couldn't reach LingoFlix's background", null);`.
- Replace `it("a dropped port shows Couldn't reach Claude", async () => { ... })` in `describe('explain controller')` with:

```ts
  it("a dropped port says it couldn't reach LingoFlix's background", async () => {
    const { store, ports, explain } = setupExplain();
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    ports[0]!.drop();
    expect(store.get()).toMatchObject({
      status: 'error',
      error: { code: 'network', message: "Couldn't reach LingoFlix's background", provider: null },
    });
  });

  it("an error from the background keeps its provider, for the card's billing link", async () => {
    const { store, ports, explain } = setupExplain();
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    ports[0]!.receive({ type: 'error', code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' });
    expect(store.get()).toMatchObject({
      status: 'error',
      error: { code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' },
    });
  });
```

- In `it("image-based subtitles get the can't-be-read card; no line means no card", ...)`, replace the `image.store.get()` assertion with:

```ts
    expect(image.store.get()).toMatchObject({
      status: 'error',
      error: { code: 'image-subs', message: "This title's subtitles can't be read as text", provider: null },
    });
```

In `lingoflix-extension/tests/unit/card.test.tsx`, replace the whole `it('error cards follow spec §7.4', () => { ... });` test with:

```tsx
  it('error cards follow free-own-key spec §4.6', () => {
    const error = (code: NonNullable<CardState['error']>['code'], message: string, provider: 'claude' | 'openai' | null = 'claude') =>
      renderCard({ status: 'error', response: '', explanation: null, error: { code, message, provider } });
    const noKey = error('no-key', 'Add your API key', null);
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(noKey.onOpenSettings).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    cleanup();
    error('bad-key', 'Your OpenAI key was rejected', 'openai');
    expect(screen.getByRole('alert').textContent).toBe('Your OpenAI key was rejected');
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeTruthy();
    cleanup();
    const offline = error('network', "Couldn't reach Claude");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(offline.onRetry).toHaveBeenCalled();
    cleanup();
    error('busy', 'OpenAI is busy right now', 'openai');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    cleanup();
    error('api', 'prompt is too long: 250000 tokens > 200000 maximum');
    expect(screen.getByRole('alert').textContent).toBe('prompt is too long: 250000 tokens > 200000 maximum');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Save' })).toBeNull();
    cleanup();
    renderCard({
      status: 'error',
      line: '',
      response: '',
      explanation: null,
      error: { code: 'image-subs', message: "This title's subtitles can't be read as text", provider: null },
    });
    expect(screen.getByRole('alert').textContent).toBe("This title's subtitles can't be read as text");
  });

  it("out of credit: the company's headline, a link to its billing page, and Retry", () => {
    const anthropic = renderCard({
      status: 'error',
      response: '',
      explanation: null,
      error: { code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' },
    });
    expect(screen.getByRole('alert').textContent).toBe('Your Anthropic account is out of credit');
    const link = screen.getByRole('link', { name: 'Add credit at console.anthropic.com' });
    expect(link.getAttribute('href')).toBe('https://console.anthropic.com/settings/billing');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(anthropic.onRetry).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    cleanup();
    renderCard({
      status: 'error',
      response: '',
      explanation: null,
      error: { code: 'no-credit', message: 'Your OpenAI account is out of credit', provider: 'openai' },
    });
    expect(screen.getByRole('link', { name: 'Add credit at platform.openai.com' }).getAttribute('href')).toBe(
      'https://platform.openai.com/settings/organization/billing/overview',
    );
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/ai.test.ts tests/unit/anthropic.test.ts tests/unit/explain-service.test.ts tests/unit/explain-flow.test.ts tests/unit/card.test.tsx`
Expected: FAIL, Test Files 5 failed (5), Tests 24 failed | 68 passed (92):
- `errorCopy > names the provider, or its company for credit` and `errorCopy > without a provider ...`: `TypeError: errorCopy is not a function`
- `toExplainError (Anthropic SDK errors) > maps API failures ...`: `AssertionError: expected { code: 'bad-key', …(1) } to deeply equal { code: 'bad-key', …(1) }`
- `toExplainError (Anthropic SDK errors) > a 402 billing_error, ...` and `... > a 400 about the credit balance is no-credit too ...`: `AssertionError: expected { code: 'api', …(1) } to deeply equal { code: 'no-credit', …(1) }`
- `toExplainError (Anthropic SDK errors) > shows Anthropic's own message ...`: `AssertionError: expected { code: 'api', message: '' } to deeply equal { code: 'api', …(1) }`
- `createAnthropicClient > reports every stream event as activity, ...`: `AssertionError: expected "vi.fn()" to be called 4 times, but got 0 times`
- `explanation card > out of credit: ...`: `TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "Add credit at console.anthropic.com"`
- the 3 new or changed `streamExplanation` tests: `AssertionError: expected "vi.fn()" to be called with arguments: [ 'network', …(2) ]` (or `[ 'no-credit', …(2) ]`)
- the 2 new `explain controller` port tests: `AssertionError: expected { key: 1, …(13) } to match object { status: 'error', error: { …(3) } }`; the image-subtitles test: `AssertionError: expected { key: 1, line: '', …(12) } to match object { status: 'error', error: { …(3) } }`
- 10 `explain service` tests (the error message has no `provider` yet):
  - 6 tests: `AssertionError: expected [ { type: 'error', …(2) } ] to deeply equal [ { type: 'error', …(3) } ]`
  - `names the key's provider in errors, ...`: `AssertionError: expected [ Array(1) ] to deeply equal [ { type: 'error', …(3) } ]`
  - `an empty answer is an error, not an explanation`: `AssertionError: expected { type: 'error', code: 'api', …(1) } to deeply equal { type: 'error', code: 'api', …(2) }`
  - `a follow-up on a deleted explanation, ...`: `AssertionError: expected [ Array(1) ] to deeply equal [ Array(1) ]`
  - `any stream event keeps the request alive, ...`: `TypeError: events.activity is not a function`

- [ ] **Step 3: The headlines, without an SDK**

In `lingoflix-extension/src/lib/ai/protocol.ts`, add `import { PROVIDERS, type Provider } from './provider';` directly below `import type { ExplainRequest } from './prompt';`, and replace:

```ts
export type ExplainErrorCode = 'no-key' | 'bad-key' | 'busy' | 'network' | 'api';

/**
 * Spec §7.4 card headlines. For `api`, the card shows Anthropic's own message instead. Kept here, not in
 * errors.ts, so the content script can use it without bundling the Anthropic SDK.
 */
export const ERROR_COPY: Record<ExplainErrorCode, string> = {
  'no-key': 'Add your Claude API key',
  'bad-key': 'Your API key was rejected',
  busy: 'Claude is busy right now',
  network: "Couldn't reach Claude",
  api: 'Claude returned an error',
};

/** v2 spec §4.2: the stored explanation, and the index keys of its card rows that are saved. */
export type ExplainServerMessage =
  | { type: 'delta'; text: string }
  | { type: 'done'; explanation: Explanation; savedKeys: string[] }
  | { type: 'error'; code: ExplainErrorCode; message: string };
```

with:

```ts
export type ExplainErrorCode = 'no-key' | 'bad-key' | 'no-credit' | 'busy' | 'network' | 'api';

/** The `network` headline when no provider is known: the Port dropped, or the background failed before reading the key. */
export const UNREACHABLE = "Couldn't reach LingoFlix's background";

/**
 * Free-own-key spec §4.6 card headlines, naming the key's provider (its company for credit). For `api`, the card
 * shows the provider's own message when there is one. Kept here, not in errors.ts, so the content script can use
 * it without bundling an SDK.
 */
export function errorCopy(code: ExplainErrorCode, provider: Provider | null): string {
  if (code === 'no-key') return 'Add your API key';
  if (provider === null) return UNREACHABLE;
  const { name, company } = PROVIDERS[provider];
  switch (code) {
    case 'bad-key':
      return `Your ${name} key was rejected`;
    case 'no-credit':
      return `Your ${company} account is out of credit`;
    case 'busy':
      return `${name} is busy right now`;
    case 'network':
      return `Couldn't reach ${name}`;
    case 'api':
      return `${name} returned an error`;
  }
}

/**
 * v2 spec §4.2: the stored explanation, and the index keys of its card rows that are saved. An error names the
 * key's provider (null when none is known), for the card's billing link.
 */
export type ExplainServerMessage =
  | { type: 'delta'; text: string }
  | { type: 'done'; explanation: Explanation; savedKeys: string[] }
  | { type: 'error'; code: ExplainErrorCode; message: string; provider: Provider | null };
```

- [ ] **Step 4: SDK errors named for the provider; 402, and a 400 about the credit balance, as `no-credit`**

Replace the whole content of `lingoflix-extension/src/lib/ai/errors.ts` with (Task 4 replaces it again, adding OpenAI's errors):

```ts
import { APIConnectionError, APIError, AuthenticationError, RateLimitError } from '@anthropic-ai/sdk';
import type { Provider } from './provider';
import { errorCopy, type ExplainErrorCode } from './protocol';

/**
 * Anthropic usually reports a low balance as a 400 invalid_request_error ("Your credit balance is too low to access
 * the Anthropic API."), not a 402. A text match: if Anthropic rewords it, the card shows Anthropic's own sentence.
 */
const ANTHROPIC_LOW_CREDIT = /credit balance/i;

function anthropicMessage(err: APIError): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  return typeof message === 'string' && message ? message : err.message;
}

/** An SDK's error as a card state (free-own-key spec §4.6), its headline naming `provider`. */
export function toExplainError(err: unknown, provider: Provider): { code: ExplainErrorCode; message: string } {
  const failure = (code: ExplainErrorCode, message = '') => ({ code, message: message || errorCopy(code, provider) });
  if (err instanceof AuthenticationError) return failure('bad-key');
  if (err instanceof RateLimitError) return failure('busy');
  if (err instanceof APIConnectionError) return failure('network'); // includes timeouts
  if (err instanceof APIError) {
    // 402, or a billing error during the stream (no status).
    if (err.status === 402 || err.type === 'billing_error') return failure('no-credit');
    if (err.status === 400 && err.type === 'invalid_request_error' && ANTHROPIC_LOW_CREDIT.test(anthropicMessage(err))) {
      return failure('no-credit');
    }
    // 5xx (including a gateway's HTML page) and mid-stream rate limit or overload errors, which have no status.
    if (err.status !== undefined && err.status >= 500) return failure('busy');
    if (err.type === 'overloaded_error' || err.type === 'rate_limit_error') return failure('busy');
    return failure('api', anthropicMessage(err));
  }
  return failure('api', err instanceof Error ? err.message : String(err));
}
```

In `lingoflix-extension/src/lib/background/message-handler.ts`, replace `      const { code, message } = toExplainError(err);` with `      const { code, message } = toExplainError(err, provider);`.

- [ ] **Step 5: Activity on every stream event**

In `lingoflix-extension/src/lib/ai/client.ts`, replace:

```ts
  /** Streams text deltas to `onText`; resolves with the text and tool calls; rejects with the SDK's errors. */
  stream(params: StreamParams, onText: (delta: string) => void, signal: AbortSignal): Promise<StreamResult>;
```

with:

```ts
  /**
   * Streams text deltas to `onText`, and calls `onActivity` on every stream event (text or not), so the caller's
   * idle timer only fires on a silent stream (spec §4.3). Resolves with the text and tool calls; rejects with
   * the SDK's errors.
   */
  stream(params: StreamParams, onText: (delta: string) => void, signal: AbortSignal, onActivity: () => void): Promise<StreamResult>;
```

In `lingoflix-extension/src/lib/ai/anthropic.ts`, replace `    async stream(params, onText, signal) {` with `    async stream(params, onText, signal, onActivity) {`, and directly above `      stream.on('text', (delta) => onText(delta));` add:

```ts
      stream.on('streamEvent', () => onActivity());
```

In `lingoflix-extension/src/lib/config.ts`, replace:

```ts
/** Spec §7.4: a stream silent this long is treated as a network failure. */
export const CLAUDE_IDLE_TIMEOUT_MS = 30_000;
```

with:

```ts
/** Spec §7.4: a stream with no event this long is treated as a network failure (free-own-key spec §4.3). */
export const AI_IDLE_TIMEOUT_MS = 30_000;
```

- [ ] **Step 6: The explain service sends the provider with each error**

Replace the whole content of `lingoflix-extension/src/lib/ai/explain-service.ts` with:

```ts
import { AI_IDLE_TIMEOUT_MS } from '@/lib/config';
import type { Explanation, FollowUp, NewExplanation, SaveSuggestion } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';
import type { AiClient, StreamParams, StreamResult, SystemBlock, ToolCall } from './client';
import { learningHistoryBlock, splitStory, storyBlock, type HistorySources } from './context-blocks';
import { toExplainError } from './errors';
import { buildFollowUpMessages, buildSystemPrompt, buildUserMessage, type ExplainRequest } from './prompt';
import { PROVIDERS, providerOf, type Provider } from './provider';
import { errorCopy, parseClientMessage, type ExplainErrorCode, type ExplainServerMessage } from './protocol';
import { SUGGEST_SAVES_TOOL, SUGGEST_SAVES_TOOL_NAME, validateSuggestions } from './suggestions';

/** The part of `chrome.runtime.Port` the service uses. */
export interface ExplainPort {
  postMessage(message: ExplainServerMessage): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface ExplainServiceDeps {
  getApiKey(): Promise<string | null>;
  createClient(apiKey: string): AiClient;
  saveExplanation(fields: NewExplanation): Promise<Explanation>;
  getExplanation(id: string): Promise<Explanation | null>;
  appendFollowUp(id: string, followUp: FollowUp): Promise<Explanation | null>;
  /** Saved items and explanations, for the learning history block (v2 spec §5.2). */
  loadHistory(): Promise<HistorySources>;
  /** Index keys of the explanation's card rows that are saved (v2 spec §4.2). */
  savedKeysFor(explanation: Explanation): Promise<string[]>;
  idleTimeoutMs?: number;
}

const UNREADABLE = 'LingoFlix sent a request it could not read.';
const EXPLANATION_GONE = 'This explanation is no longer available.';

function explanationFields(request: ExplainRequest, response: string, suggestions: SaveSuggestion[], model: string): NewExplanation {
  const title = request.title;
  return {
    phrase: request.phrase,
    response,
    videoTimeMs: Math.round(request.videoTimeMs),
    videoId: request.videoId,
    kind: title?.kind ?? 'movie',
    seriesId: title?.seriesId ?? null,
    seriesTitle: title?.seriesTitle ?? 'Untitled video',
    seasonNumber: title?.seasonNumber ?? null,
    episodeNumber: title?.episodeNumber ?? null,
    episodeTitle: title?.episodeTitle ?? null,
    context: request.context,
    explanationLanguage: request.language,
    model,
    suggestions,
  };
}

/** v2 spec §5.4: the first suggest_saves call, checked; none when the model didn't call it. */
function suggestionsFrom(calls: readonly ToolCall[], line: string): SaveSuggestion[] {
  const call = calls.find((c) => c.name === SUGGEST_SAVES_TOOL_NAME);
  return call ? validateSuggestions(call.input, line) : [];
}

/**
 * v2 spec §5.1–5.2: the instructions, then the story before the last 5-minute boundary and the learning
 * history, both cached; empty blocks are left out. Lines at or after the explained line never go out,
 * whatever the page sent (no spoilers); the rest of the story goes into the first user message.
 */
function contextFor(
  instructions: string,
  story: readonly StoryLine[],
  lineStartMs: number,
  history: string | null,
): { system: SystemBlock[]; recent: StoryLine[] } {
  const { cached, recent } = splitStory(
    story.filter((line) => line.startMs < lineStartMs),
    lineStartMs,
  );
  const system: SystemBlock[] = [{ text: instructions, cache: false }];
  const storyText = storyBlock(cached);
  if (storyText) system.push({ text: storyText, cache: true });
  if (history) system.push({ text: history, cache: true });
  return { system, recent };
}

/**
 * Serves one explanation or follow-up over a Port (spec §6.3). Streams deltas, saves the result only when
 * the stream completed and the card is still open, and aborts when the Port disconnects or the stream is
 * silent (no event at all) for 30 s. Errors name the key's provider (free-own-key spec §4.6).
 */
export function serveExplainPort(port: ExplainPort, deps: ExplainServiceDeps): void {
  const abort = new AbortController();
  let disconnected = false;
  let received = false;
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** The saved key's provider, once read. */
  let provider: Provider | null = null;

  const post = (message: ExplainServerMessage) => {
    if (!disconnected) port.postMessage(message);
  };
  const fail = (code: ExplainErrorCode, message: string = errorCopy(code, provider)) =>
    post({ type: 'error', code, message, provider });
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, deps.idleTimeoutMs ?? AI_IDLE_TIMEOUT_MS);
  };

  port.onDisconnect.addListener(() => {
    disconnected = true;
    clearTimeout(idleTimer);
    abort.abort();
  });

  port.onMessage.addListener((raw) => {
    if (received) return; // one request per Port
    received = true;
    // A failure outside the stream (e.g. storage) must still end the card's spinner.
    run(raw).catch(() => {
      clearTimeout(idleTimer);
      fail('network');
    });
  });

  /** v2 spec §5.2: the learning history block. When it can't be read, the request goes out without it. */
  async function historyFor(line: string): Promise<string | null> {
    try {
      return learningHistoryBlock(await deps.loadHistory(), line);
    } catch {
      return null;
    }
  }

  async function run(raw: unknown): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message) return fail('api', UNREADABLE);
    const apiKey = await deps.getApiKey();
    // A key saved before Save checked the provider, that is neither Claude's nor OpenAI's, counts as none.
    const keyProvider = apiKey ? providerOf(apiKey) : null;
    if (!apiKey || !keyProvider) return fail('no-key');
    provider = keyProvider;
    if (disconnected) return;

    let params: StreamParams;
    let finish: (result: StreamResult) => Promise<Explanation | null>;
    if (message.type === 'start') {
      const { request } = message;
      const history = await historyFor(request.phrase);
      const instructions = buildSystemPrompt(request.language, request.sections);
      const { system, recent } = contextFor(instructions, request.storySoFar, request.videoTimeMs, history);
      params = {
        kind: 'explain',
        system,
        messages: [{ role: 'user', content: buildUserMessage(request, recent) }],
        tools: [SUGGEST_SAVES_TOOL],
      };
      finish = (result) =>
        deps.saveExplanation(
          explanationFields(request, result.text, suggestionsFrom(result.toolCalls, request.phrase), PROVIDERS[keyProvider].model),
        );
    } else {
      const explanation = await deps.getExplanation(message.explanationId);
      if (!explanation) return fail('api', EXPLANATION_GONE);
      const history = await historyFor(explanation.phrase);
      const instructions = buildSystemPrompt(explanation.explanationLanguage, message.sections, true);
      const { system, recent } = contextFor(instructions, message.storySoFar, explanation.videoTimeMs, history);
      params = {
        kind: 'follow-up',
        system,
        messages: buildFollowUpMessages(explanation, message.question, recent),
      };
      finish = (result) => deps.appendFollowUp(explanation.id, { question: message.question.trim(), answer: result.text });
    }

    armIdleTimer();
    try {
      const result = await deps.createClient(apiKey).stream(
        params,
        (delta) => {
          armIdleTimer();
          post({ type: 'delta', text: delta });
        },
        abort.signal,
        armIdleTimer,
      );
      clearTimeout(idleTimer);
      if (disconnected) return; // the card closed: nothing is saved
      if (!result.text.trim()) return fail('api', `${PROVIDERS[keyProvider].name} returned an empty answer.`);
      const explanation = await finish(result);
      if (!explanation) return fail('api', EXPLANATION_GONE);
      // The explanation is stored; not knowing which rows are saved only shows them as unsaved.
      const savedKeys = await deps.savedKeysFor(explanation).catch((): string[] => []);
      post({ type: 'done', explanation, savedKeys });
    } catch (err) {
      clearTimeout(idleTimer);
      if (disconnected) return;
      if (timedOut) return fail('network');
      const { code, message: text } = toExplainError(err, keyProvider);
      fail(code, text);
    }
  }
}
```

(Against Task 2's version: `ERROR_COPY` and `EMPTY_ANSWER` give way to `errorCopy` and the provider's name; the key's provider is kept in `provider` once read, so `fail` sends it with every error, including one from `run`'s `.catch`; the stream's fourth argument is `armIdleTimer`; the doc comments say "the model", not "Claude".)

- [ ] **Step 7: The card shows the provider's error, with a billing link when out of credit**

Replace the whole content of `lingoflix-extension/src/entrypoints/netflix.content/overlay/explain-port.ts` with:

```ts
import { browser } from '#imports';
import {
  EXPLAIN_PORT,
  errorCopy,
  type ExplainClientMessage,
  type ExplainErrorCode,
  type ExplainServerMessage,
} from '@/lib/ai/protocol';
import type { Provider } from '@/lib/ai/provider';
import type { Explanation } from '@/lib/study-log/types';

export interface PortLike {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export type Connect = () => PortLike;

export const connectExplainPort: Connect = () => browser.runtime.connect({ name: EXPLAIN_PORT }) as unknown as PortLike;

export interface StreamHandlers {
  onDelta(text: string): void;
  /** The stored explanation, and the index keys of its Save rows that are saved (v2 spec §4.2). */
  onDone(explanation: Explanation, savedKeys: string[]): void;
  /** `provider` is the key's, as the background named it; null when the Port dropped first. */
  onError(code: ExplainErrorCode, message: string, provider: Provider | null): void;
}

/**
 * Runs one request over its own Port (spec §6.3). Returns a cancel function; cancelling disconnects,
 * which aborts the request in the background. If the Port drops without an answer (the worker restarted
 * or the extension was reloaded), the card says it couldn't reach LingoFlix's background: only the
 * background knows the key's provider.
 */
export function streamExplanation(connect: Connect, message: ExplainClientMessage, handlers: StreamHandlers): () => void {
  let finished = false;
  let port: PortLike;
  try {
    port = connect();
  } catch {
    handlers.onError('network', errorCopy('network', null), null);
    return () => {};
  }
  port.onMessage.addListener((raw) => {
    if (finished) return;
    const m = raw as ExplainServerMessage;
    if (m.type === 'delta') {
      handlers.onDelta(m.text);
    } else if (m.type === 'done') {
      finished = true;
      handlers.onDone(m.explanation, m.savedKeys);
      port.disconnect();
    } else if (m.type === 'error') {
      finished = true;
      handlers.onError(m.code, m.message, m.provider);
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    if (finished) return;
    finished = true;
    handlers.onError('network', errorCopy('network', null), null);
  });
  port.postMessage(message);
  return () => {
    if (finished) return;
    finished = true;
    port.disconnect();
  };
}
```

In `lingoflix-extension/src/entrypoints/netflix.content/overlay/card-state.ts`, add `import type { Provider } from '@/lib/ai/provider';` directly below the `@/lib/ai/protocol` import, and replace:

```ts
  error: { code: CardErrorCode; message: string } | null;
```

with:

```ts
  /** `provider` is the key's when the background named it (for the no-credit billing link). */
  error: { code: CardErrorCode; message: string; provider: Provider | null } | null;
```

In `lingoflix-extension/src/entrypoints/netflix.content/overlay/explain-controller.ts`, replace:

```ts
      onError: (code, message) => update(key, (c) => ({ ...c, status: 'error', error: { code, message } })),
```

with:

```ts
      onError: (code, message, provider) => update(key, (c) => ({ ...c, status: 'error', error: { code, message, provider } })),
```

and:

```ts
      deps.store.set({ ...base, status: 'error', error: { code: 'image-subs', message: IMAGE_SUBTITLES_MESSAGE } });
```

with:

```ts
      deps.store.set({ ...base, status: 'error', error: { code: 'image-subs', message: IMAGE_SUBTITLES_MESSAGE, provider: null } });
```

In `lingoflix-extension/src/entrypoints/netflix.content/overlay/Card.tsx`, add `import { PROVIDERS } from '@/lib/ai/provider';` directly above `import { cardRows } from '@/lib/ai/suggestions';`, and replace the start of `ErrorBlock`:

```tsx
function ErrorBlock({ error, onRetry, onOpenSettings }: { error: NonNullable<CardState['error']>; onRetry(): void; onOpenSettings(): void }) {
  const needsSettings = error.code === 'no-key' || error.code === 'bad-key';
  const canRetry = error.code === 'busy' || error.code === 'network';
  return (
    <div className="rounded-xl border-2 border-line bg-soft px-3 py-2.5">
      <p role="alert" className="text-[14px] font-extrabold">
        {error.message}
      </p>
```

with:

```tsx
/** Free-own-key spec §4.6: the headline, then Open Settings or Retry; out of credit also links to the billing page. */
function ErrorBlock({ error, onRetry, onOpenSettings }: { error: NonNullable<CardState['error']>; onRetry(): void; onOpenSettings(): void }) {
  const needsSettings = error.code === 'no-key' || error.code === 'bad-key';
  const canRetry = error.code === 'busy' || error.code === 'network' || error.code === 'no-credit';
  const billing = error.code === 'no-credit' && error.provider ? PROVIDERS[error.provider] : null;
  return (
    <div className="rounded-xl border-2 border-line bg-soft px-3 py-2.5">
      <p role="alert" className="text-[14px] font-extrabold">
        {error.message}
      </p>
      {billing && (
        <a
          href={billing.billingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-[13px] font-bold text-tint-ink underline underline-offset-2"
        >
          Add credit at {billing.console}
        </a>
      )}
```

- [ ] **Step 8: Run the tests again**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/ai.test.ts tests/unit/anthropic.test.ts tests/unit/explain-service.test.ts tests/unit/explain-flow.test.ts tests/unit/card.test.tsx`
Expected: PASS (5 files, 92 tests).

Run: `grep -rnw "ERROR_COPY\|CLAUDE_IDLE_TIMEOUT_MS" lingoflix-extension/src lingoflix-extension/tests`
Expected: no output.

- [ ] **Step 9: Run everything**

Run: `pnpm --filter lingoflix-extension test`
Expected: PASS (48 files, 593 tests).

Run: `pnpm --filter lingoflix-extension compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-extension build`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add lingoflix-extension/src lingoflix-extension/tests
git commit -m "feat(extension): errors name the provider, out of credit gets a billing link, any stream event resets the idle timer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The OpenAI adapter

**Files:**
- Create: `lingoflix-extension/src/lib/ai/openai.ts`, `lingoflix-extension/tests/unit/openai.test.ts`, `lingoflix-extension/tests/unit/wxt-config.test.ts`
- Modify (whole file replaced): `lingoflix-extension/src/lib/ai/errors.ts`, `lingoflix-extension/src/lib/ai/client.ts`
- Modify: `lingoflix-extension/src/lib/config.ts`, `lingoflix-extension/src/lib/ai/suggestions.ts` (a comment), `lingoflix-extension/wxt.config.ts`, `lingoflix-extension/package.json`, `pnpm-lock.yaml`
- Modify (tests): `lingoflix-extension/tests/unit/background-messages.test.ts`, `lingoflix-extension/tests/unit/explain-service.test.ts`

**Interfaces:**
- Consumes: `AiClient`, `StreamResult`, `SystemBlock`, `ToolCall`, `ToolDefinition` (`@/lib/ai/client`, with Task 3's `onActivity`); `PROVIDERS`, `providerOf`, `NOT_A_KEY` (`@/lib/ai/provider`); `errorCopy`, `ExplainErrorCode` (`@/lib/ai/protocol`); `SUGGEST_SAVES_TOOL` (`@/lib/ai/suggestions`).
- Produces:
  - `src/lib/ai/openai.ts`: `createOpenAIClient(apiKey: string, options?: { fetch?: typeof fetch }): AiClient` (`fetch` is for tests; the extension passes none); `toDeveloperContent(system: string | readonly SystemBlock[]): ResponseInputText[]`; `toFunctionTool(tool: ToolDefinition): FunctionTool`.
  - `createClient(apiKey)` (`@/lib/ai/client`): the Claude adapter for `sk-ant-` keys, the OpenAI adapter for other `sk-` keys, and it throws `Error(NOT_A_KEY)` for anything else (callers check `providerOf` first).
  - `toExplainError(err, provider)` (`@/lib/ai/errors`) also maps the OpenAI SDK's errors (spec §4.6).
  - `@/lib/config`: `OPENAI_MAX_OUTPUT_TOKENS = 8000`, `OPENAI_API_BASE_URL = 'https://api.openai.com/v1'`.
  - The manifest's `host_permissions` gains `https://api.openai.com/*` (spec §4.7).

Background (spec §4.3, §4.5, §4.6), with the names checked against `openai` 7.32.0's types:
- **The request:** `model: 'gpt-6.1-sol'`, `store: false`, `reasoning: { effort: 'low' }`, `text: { verbosity: 'low' }` and `max_output_tokens: 8000` for both kinds. The system blocks become `input_text` items of one `developer` message, and a `cache` block carries `prompt_cache_breakpoint: { mode: 'explicit' }`. All of these are typed in 7.32.0 (`ResponseInputText.prompt_cache_breakpoint`, `ResponseTextConfig.verbosity`, `ReasoningEffort` includes `'low'`, `'gpt-6.1-sol'` is in `ChatModel`); no cast is needed. Then the conversation as `{ role, content }` text messages.
- **The tool:** explanations only get `suggest_saves`, as a strict function tool with `tool_choice: 'auto'` and `parallel_tool_calls: false`. Its schema is the Claude tool's, plus `additionalProperties: false` on both objects. `maxItems: 6` stays: the SDK's own strict-schema normalizer (`toStrictJsonSchema` in `openai/lib/transform`) keeps it and lists only other array keywords as unsupported. Follow-ups send no tools, and neither `tool_choice` nor `parallel_tool_calls`, as the Claude adapter does.
- **Reading the stream:** the adapter iterates `client.responses.create({ ...body, stream: true }, { signal })`, not `client.responses.stream()`. With a strict function tool, the helper's `finalResponse()` JSON-parses the tool's arguments itself and rejects the whole answer (`OpenAIError: Error reading response: invalid structured output JSON.`) when they don't parse. The spec wants no suggestions then, not a failed answer. Every event calls `onActivity`, `response.output_text.delta` feeds `onText`, and the terminal event (`response.completed`, `response.incomplete` or `response.failed`) carries the final response. The SDK's raw stream ends quietly when the request is aborted, so the adapter checks `signal.aborted` after the loop and throws `APIUserAbortError`. A stream that ends with no terminal event is a dropped connection (`APIConnectionError`, so `network`).
- **Not completed** (all `api`; the thrown message is the card's headline, and never a raw reason code):
  - `incomplete` because of `max_output_tokens`: the text is kept and tool calls dropped; with no text, `The answer was cut off. Try again.`
  - `incomplete` because of `content_filter`: `OpenAI declined to answer this line.`
  - `incomplete` for any other reason, or none: `OpenAI didn't finish the answer.`
  - `failed`: OpenAI's error message if it has one, else `OpenAI didn't finish the answer.`
- **Errors:** Task 3's Anthropic mapping is kept as is, including the 400 about the credit balance. For OpenAI: `AuthenticationError` → `bad-key`; type `insufficient_quota`, or code `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded` or `organization_usage_limit_exceeded` → `no-credit`; any other `RateLimitError`, and `InternalServerError` (every 5xx, as for Claude) → `busy`; `APIConnectionError` (and its subclass `APIConnectionTimeoutError`) → `network`; anything else, including a stream `error` event (an `APIError` with no status) → `api` with OpenAI's own message. That message is `err.error.message`: the SDK's `err.message` starts with the status (`429 You exceeded...`).
- **Test key:** `client.models.list()`; a `PermissionDeniedError` (403, a key restricted from listing models) counts as working (spec §4.6).
- `dangerouslyAllowBrowser: true`, `maxRetries: 0` on the client, `baseURL` pinned to `https://api.openai.com/v1` (so `OPENAI_BASE_URL` in a developer's shell can't redirect tests).

- [ ] **Step 1: Add the OpenAI SDK**

Run: `pnpm --filter lingoflix-extension add --save-exact openai@7.32.0`
Expected: `lingoflix-extension/package.json` gains `"openai": "7.32.0"` in `dependencies`, and `pnpm-lock.yaml` gains `openai@7.32.0` (its optional peers `undici`, `ws` and `zod` resolve to versions already in the workspace; nothing imports them).

- [ ] **Step 2: Write the failing tests**

Create `lingoflix-extension/tests/unit/openai.test.ts`:

```ts
import { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type StreamParams } from '@/lib/ai/client';
import { toExplainError } from '@/lib/ai/errors';
import { createOpenAIClient } from '@/lib/ai/openai';
import { SUGGEST_SAVES_TOOL } from '@/lib/ai/suggestions';

afterEach(() => vi.unstubAllGlobals());

const KEY = 'sk-proj-test-key-0000';

interface SentRequest {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

/** A fake OpenAI API behind the SDK's `fetch` option: records each request and answers with `reply`. */
function fakeOpenAI(reply: (request: SentRequest, signal: AbortSignal | undefined) => Response) {
  const requests: SentRequest[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const request: SentRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return reply(request, init.signal ?? undefined);
  };
  return { fetch, requests };
}

/** Server-sent events as the Responses API streams them: `event:` is the event's type. */
const sse = (events: readonly { type: string }[]) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
const streamOf = (events: readonly { type: string }[]) =>
  new Response(sse(events), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const errorOf = (status: number, error: object) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

const message = (text: string) => ({
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});
const functionCall = (name: string, args: string) => ({ type: 'function_call', id: 'fc_1', call_id: 'call_1', name, arguments: args, status: 'completed' });
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [] };

/** One answer's events: created, a text delta per `deltas`, then the terminal event for `status` with the final response. */
function answer(deltas: string[], output: object[], status: 'completed' | 'incomplete' | 'failed' = 'completed', extra: object = {}) {
  const response = (state: string, items: object[], more: object = {}) => ({
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    model: 'gpt-6.1-sol',
    status: state,
    output: items,
    incomplete_details: null,
    error: null,
    ...more,
  });
  return [
    { type: 'response.created', sequence_number: 0, response: response('in_progress', []) },
    ...deltas.map((delta, i) => ({
      type: 'response.output_text.delta',
      sequence_number: i + 1,
      item_id: 'msg_1',
      output_index: 1,
      content_index: 0,
      delta,
      logprobs: [],
    })),
    { type: `response.${status}`, sequence_number: deltas.length + 1, response: response(status, output, extra) },
  ];
}

const EXPLAIN: StreamParams = {
  kind: 'explain',
  system: [
    { text: 'Rules', cache: false },
    { text: 'Story so far', cache: true },
    { text: 'History', cache: true },
  ],
  messages: [{ role: 'user', content: 'Explain >>> Hi' }],
  tools: [SUGGEST_SAVES_TOOL],
};

async function run(fetch: ReturnType<typeof fakeOpenAI>['fetch'], params: StreamParams = EXPLAIN, signal = new AbortController().signal) {
  const deltas: string[] = [];
  const activity = vi.fn();
  const result = await createOpenAIClient(KEY, { fetch }).stream(params, (delta) => deltas.push(delta), signal, activity);
  return { result, deltas, activity };
}

/** What a failed request becomes on the card. */
async function failureOf(fetch: ReturnType<typeof fakeOpenAI>['fetch'], params: StreamParams = EXPLAIN) {
  const error = await createOpenAIClient(KEY, { fetch })
    .stream(params, () => {}, new AbortController().signal, () => {})
    .then(
      () => null,
      (err: unknown) => err,
    );
  expect(error).not.toBeNull();
  return toExplainError(error, 'openai');
}

describe('OpenAI adapter: the request (free-own-key spec §4.3, §4.5)', () => {
  it('an explanation: GPT-6.1 Sol, not stored, low effort and verbosity, 8,000 tokens, cached developer blocks, the strict tool', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['ok'], [message('ok')])));
    await run(api.fetch);
    expect(api.requests).toHaveLength(1);
    const [request] = api.requests;
    expect(request!.url).toBe('https://api.openai.com/v1/responses');
    expect(request!.method).toBe('POST');
    expect(request!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(request!.body).toEqual({
      model: 'gpt-6.1-sol',
      store: false,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 8000,
      input: [
        {
          role: 'developer',
          content: [
            { type: 'input_text', text: 'Rules' },
            { type: 'input_text', text: 'Story so far', prompt_cache_breakpoint: { mode: 'explicit' } },
            { type: 'input_text', text: 'History', prompt_cache_breakpoint: { mode: 'explicit' } },
          ],
        },
        { role: 'user', content: 'Explain >>> Hi' },
      ],
      tools: [
        {
          type: 'function',
          name: 'suggest_saves',
          description: SUGGEST_SAVES_TOOL.description,
          parameters: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                maxItems: 6,
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['word', 'phrase', 'idiom', 'line'] },
                    text: { type: 'string' },
                    meaning: { type: 'string' },
                  },
                  required: ['type', 'text', 'meaning'],
                  additionalProperties: false,
                },
              },
            },
            required: ['items'],
            additionalProperties: false,
          },
          strict: true,
        },
      ],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      stream: true,
    });
  });

  it('a follow-up replays the earlier turns as text, with the same limit and no tools', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['No.'], [message('No.')])));
    await run(api.fetch, {
      kind: 'follow-up',
      system: [{ text: 'Follow-up rules', cache: false }],
      messages: [
        { role: 'user', content: 'Explain >>> Hi' },
        { role: 'assistant', content: 'Explanation' },
        { role: 'user', content: 'Is it rude?' },
      ],
    });
    expect(api.requests[0]!.body).toEqual({
      model: 'gpt-6.1-sol',
      store: false,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 8000,
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: 'Follow-up rules' }] },
        { role: 'user', content: 'Explain >>> Hi' },
        { role: 'assistant', content: 'Explanation' },
        { role: 'user', content: 'Is it rude?' },
      ],
      stream: true,
    });
  });

  it('leaves out empty system blocks, and sends a plain system string as one block', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['ok'], [message('ok')])));
    await run(api.fetch, { kind: 'follow-up', system: [{ text: 'Rules', cache: false }, { text: '  ', cache: true }], messages: [] });
    await run(api.fetch, { kind: 'follow-up', system: 'Plain rules', messages: [] });
    expect(api.requests.map((r) => (r.body as { input: unknown[] }).input)).toEqual([
      [{ role: 'developer', content: [{ type: 'input_text', text: 'Rules' }] }],
      [{ role: 'developer', content: [{ type: 'input_text', text: 'Plain rules' }] }],
    ]);
  });
});

describe('OpenAI adapter: the answer', () => {
  it('streams text deltas and reports every stream event as activity', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['Hel', 'lo'], [reasoning, message('Hello')])));
    const { result, deltas, activity } = await run(api.fetch, { ...EXPLAIN, tools: [] });
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result).toEqual({ text: 'Hello', toolCalls: [] });
    expect(activity).toHaveBeenCalledTimes(4); // created, two deltas, completed
  });

  it('a suggest_saves function call becomes the tool call, its JSON arguments parsed', async () => {
    const items = { items: [{ type: 'word', text: 'Hi', meaning: 'hello' }] };
    const api = fakeOpenAI(() => streamOf(answer(['Hi.'], [reasoning, message('Hi.'), functionCall('suggest_saves', JSON.stringify(items))])));
    expect((await run(api.fetch)).result).toEqual({ text: 'Hi.', toolCalls: [{ name: 'suggest_saves', input: items }] });
  });

  it('unparseable arguments give a tool call with no input (so no suggestions), and keep the answer', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['Hi.'], [message('Hi.'), functionCall('suggest_saves', '{"items": [')])));
    expect((await run(api.fetch)).result).toEqual({ text: 'Hi.', toolCalls: [{ name: 'suggest_saves', input: null }] });
  });

  it('cut off by max_output_tokens: keeps the text and drops the tool call', async () => {
    const api = fakeOpenAI(() =>
      streamOf(
        answer(['Long'], [message('Long'), functionCall('suggest_saves', '{"items": []}')], 'incomplete', {
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      ),
    );
    expect((await run(api.fetch)).result).toEqual({ text: 'Long', toolCalls: [] });
  });

  it('cut off by max_output_tokens with no text (all reasoning): the answer was cut off', async () => {
    const api = fakeOpenAI(() => streamOf(answer([], [reasoning], 'incomplete', { incomplete_details: { reason: 'max_output_tokens' } })));
    expect(await failureOf(api.fetch)).toEqual({ code: 'api', message: 'The answer was cut off. Try again.' });
  });

  it('stopped by the content filter: OpenAI declined to answer this line', async () => {
    const filtered = fakeOpenAI(() =>
      streamOf(answer(['Partial'], [message('Partial')], 'incomplete', { incomplete_details: { reason: 'content_filter' } })),
    );
    expect(await failureOf(filtered.fetch)).toEqual({ code: 'api', message: 'OpenAI declined to answer this line.' });
  });

  it("incomplete for any other reason, or with none: OpenAI didn't finish the answer", async () => {
    for (const details of [{ reason: 'max_messages' }, { reason: 'steered' }, null]) {
      const api = fakeOpenAI(() => streamOf(answer(['Partial'], [message('Partial')], 'incomplete', { incomplete_details: details })));
      expect(await failureOf(api.fetch)).toEqual({ code: 'api', message: "OpenAI didn't finish the answer." });
    }
  });

  it("failed: OpenAI's message, else OpenAI didn't finish the answer", async () => {
    const failed = fakeOpenAI(() =>
      streamOf(answer([], [], 'failed', { error: { code: 'server_error', message: 'The model failed to answer.' } })),
    );
    expect(await failureOf(failed.fetch)).toEqual({ code: 'api', message: 'The model failed to answer.' });
    const silent = fakeOpenAI(() => streamOf(answer([], [], 'failed')));
    expect(await failureOf(silent.fetch)).toEqual({ code: 'api', message: "OpenAI didn't finish the answer." });
  });

  it('a stream that ends without a final event is a dropped connection', async () => {
    const api = fakeOpenAI(() => streamOf(answer(['Hel'], []).slice(0, -1)));
    expect(await failureOf(api.fetch)).toEqual({ code: 'network', message: "Couldn't reach OpenAI" });
  });
});

describe('OpenAI adapter: errors (free-own-key spec §4.6)', () => {
  const rejectsWith = (status: number, error: object) => fakeOpenAI(() => errorOf(status, error)).fetch;

  it('401 is a rejected key', async () => {
    expect(await failureOf(rejectsWith(401, { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key.' }))).toEqual({
      code: 'bad-key',
      message: 'Your OpenAI key was rejected',
    });
  });

  it('429 insufficient_quota, and each spend or credit limit code, is out of credit', async () => {
    const outOfCredit = { code: 'no-credit', message: 'Your OpenAI account is out of credit' };
    expect(await failureOf(rejectsWith(429, { type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota.' }))).toEqual(
      outOfCredit,
    );
    for (const code of [
      'credit_balance_exhausted',
      'organization_spend_limit_exceeded',
      'project_spend_limit_exceeded',
      'organization_usage_limit_exceeded',
    ]) {
      expect(await failureOf(rejectsWith(429, { type: 'requests', code, message: 'Limit reached.' }))).toEqual(outOfCredit);
    }
  });

  it('any other 429, and 500 or 503, is busy', async () => {
    const busy = { code: 'busy', message: 'OpenAI is busy right now' };
    expect(await failureOf(rejectsWith(429, { type: 'requests', code: 'rate_limit_exceeded', message: 'Slow down.' }))).toEqual(busy);
    expect(await failureOf(rejectsWith(500, { type: 'server_error', code: null, message: 'Oops.' }))).toEqual(busy);
    expect(await failureOf(rejectsWith(503, { type: 'server_error', code: 'server_is_overloaded', message: 'Overloaded.' }))).toEqual(busy);
  });

  it("can't connect, or timed out, is a network error", async () => {
    const offline = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await failureOf(offline)).toEqual({ code: 'network', message: "Couldn't reach OpenAI" });
    expect(toExplainError(new APIConnectionTimeoutError(), 'openai')).toEqual({ code: 'network', message: "Couldn't reach OpenAI" });
  });

  it("anything else shows OpenAI's own message, including an error event during the stream", async () => {
    expect(await failureOf(rejectsWith(400, { type: 'invalid_request_error', code: 'model_not_found', message: 'The model does not exist.' }))).toEqual({
      code: 'api',
      message: 'The model does not exist.',
    });
    const midStream = fakeOpenAI(() =>
      streamOf([
        ...answer(['Hel'], []).slice(0, -1),
        { type: 'error', code: 'rate_limit_exceeded', message: 'Too many tokens in flight.', param: null, sequence_number: 2 } as { type: string },
      ]),
    );
    expect(await failureOf(midStream.fetch)).toEqual({ code: 'api', message: 'Too many tokens in flight.' });
  });
});

describe('OpenAI adapter: abort', () => {
  it('aborting mid-stream rejects, so nothing is saved', async () => {
    const abort = new AbortController();
    const api = fakeOpenAI((_request, signal) => {
      const [created, delta] = answer(['Hel'], []);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse([created!, delta!])));
          signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const deltas: string[] = [];
    const pending = createOpenAIClient(KEY, { fetch: api.fetch }).stream(EXPLAIN, (d) => deltas.push(d), abort.signal, () => {});
    await vi.waitFor(() => expect(deltas).toEqual(['Hel']));
    abort.abort();
    await expect(pending).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it('aborting before the answer starts rejects too', async () => {
    const abort = new AbortController();
    abort.abort();
    const api = fakeOpenAI(() => streamOf(answer(['ok'], [message('ok')])));
    await expect(createOpenAIClient(KEY, { fetch: api.fetch }).stream(EXPLAIN, () => {}, abort.signal, () => {})).rejects.toBeInstanceOf(
      APIUserAbortError,
    );
  });
});

describe('OpenAI adapter: Test key', () => {
  it('lists the models with the key', async () => {
    const api = fakeOpenAI(() => Response.json({ object: 'list', data: [] }));
    await createOpenAIClient(KEY, { fetch: api.fetch }).checkKey();
    expect(api.requests.map((r) => [r.method, r.url, r.headers.get('authorization')])).toEqual([
      ['GET', 'https://api.openai.com/v1/models', `Bearer ${KEY}`],
    ]);
  });

  it('a 403 (a key not allowed to list models) counts as working; a 401 does not', async () => {
    const restricted = fakeOpenAI(() => errorOf(403, { type: 'invalid_request_error', code: 'missing_scope', message: 'Missing scopes: api.model.read' }));
    await expect(createOpenAIClient(KEY, { fetch: restricted.fetch }).checkKey()).resolves.toBeUndefined();
    const rejected = fakeOpenAI(() => errorOf(401, { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key.' }));
    const error = await createOpenAIClient(KEY, { fetch: rejected.fetch }).checkKey().catch((err: unknown) => err);
    expect(toExplainError(error, 'openai').code).toBe('bad-key');
  });
});

describe('createClient', () => {
  it('hands an OpenAI key to the OpenAI adapter, and refuses a key that is neither', async () => {
    const api = fakeOpenAI(() => Response.json({ object: 'list', data: [] }));
    vi.stubGlobal('fetch', api.fetch);
    await createClient('sk-svcacct-key').checkKey();
    expect(api.requests.map((r) => r.url)).toEqual(['https://api.openai.com/v1/models']);
    expect(() => createClient('AIzaSy-key')).toThrow("This doesn't look like a Claude or OpenAI key.");
  });
});
```

Create `lingoflix-extension/tests/unit/wxt-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import config from '../../wxt.config';

describe('the extension manifest', () => {
  it('may call Netflix, Anthropic and OpenAI (free-own-key spec §4.7), and nothing else', () => {
    const manifest = config.manifest as { host_permissions?: string[] };
    expect(manifest.host_permissions).toEqual(['https://www.netflix.com/*', 'https://api.anthropic.com/*', 'https://api.openai.com/*']);
  });
});
```

In `lingoflix-extension/tests/unit/background-messages.test.ts`, add directly below `import { APIConnectionError, APIError } from '@anthropic-ai/sdk';`:

```ts
import { APIConnectionError as OpenAIConnectionError, APIError as OpenAIError } from 'openai';
```

and in `it('Test key names OpenAI for an OpenAI key', ...)` make the fakes throw OpenAI's errors: replace

```ts
      throw APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid' } }, 'x', new Headers());
```

with:

```ts
      throw OpenAIError.generate(401, { error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key.' } }, 'x', new Headers());
```

and `      throw new APIConnectionError({ message: 'fetch failed' });` (the one in this test) with `      throw new OpenAIConnectionError({ message: 'fetch failed' });`.

In `lingoflix-extension/tests/unit/explain-service.test.ts`, add `import { RateLimitError as OpenAIRateLimitError } from 'openai';` directly below `import { APIError } from '@anthropic-ai/sdk';`, and in `it("names the key's provider in errors, and its company when out of credit", ...)` replace:

```ts
    const outOfCredit = APIError.generate(402, { error: { type: 'billing_error', message: 'No credit' } }, 'x', new Headers());
    for (const [apiKey, expected] of [
      ['sk-ant-test-key-0000', { type: 'error', code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' }],
      ['sk-proj-test-key-0000', { type: 'error', code: 'no-credit', message: 'Your OpenAI account is out of credit', provider: 'openai' }],
    ] as const) {
      const { client } = fakeClient({ error: outOfCredit });
```

with:

```ts
    for (const [apiKey, error, expected] of [
      [
        'sk-ant-test-key-0000',
        APIError.generate(402, { error: { type: 'billing_error', message: 'No credit' } }, 'x', new Headers()),
        { type: 'error', code: 'no-credit', message: 'Your Anthropic account is out of credit', provider: 'claude' },
      ],
      [
        'sk-proj-test-key-0000',
        new OpenAIRateLimitError(429, { type: 'insufficient_quota', code: 'insufficient_quota', message: 'No quota' }, 'x', new Headers()),
        { type: 'error', code: 'no-credit', message: 'Your OpenAI account is out of credit', provider: 'openai' },
      ],
    ] as const) {
      const { client } = fakeClient({ error });
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/openai.test.ts tests/unit/wxt-config.test.ts tests/unit/background-messages.test.ts tests/unit/explain-service.test.ts`
Expected: FAIL, Test Files 4 failed (4), Tests 3 failed | 42 passed (45):
- `Error: Cannot find package '@/lib/ai/openai' imported from .../tests/unit/openai.test.ts`
- `API key requests > Test key names OpenAI for an OpenAI key`: `AssertionError: expected { result: 'error', …(1) } to deeply equal { result: 'rejected', …(1) }` (received `"message": "401 Incorrect API key."`: OpenAI's errors aren't mapped yet)
- `explain service: failures > names the key's provider in errors, ...`: `AssertionError: expected [ Array(1) ] to deeply equal [ { type: 'error', …(3) } ]` (received `"code": "api"`, `"message": "429 No quota"`)
- `the extension manifest > may call Netflix, Anthropic and OpenAI ...`: `AssertionError: expected [ 'https://www.netflix.com/*', …(1) ] to deeply equal [ 'https://www.netflix.com/*', …(2) ]`

- [ ] **Step 4: The adapter**

In `lingoflix-extension/src/lib/config.ts`, directly below `export const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';`, add:

```ts
/** OpenAI: one limit for explanations and follow-ups; reasoning tokens count toward it (free-own-key spec §4.3). */
export const OPENAI_MAX_OUTPUT_TOKENS = 8000;
export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
```

Create `lingoflix-extension/src/lib/ai/openai.ts`:

```ts
import OpenAI, { APIConnectionError, APIUserAbortError, OpenAIError, PermissionDeniedError } from 'openai';
import type {
  EasyInputMessage,
  FunctionTool,
  Response,
  ResponseCreateParamsStreaming,
  ResponseInputText,
} from 'openai/resources/responses/responses';
import { OPENAI_API_BASE_URL, OPENAI_MAX_OUTPUT_TOKENS } from '@/lib/config';
import type { AiClient, StreamResult, SystemBlock, ToolCall, ToolDefinition } from './client';
import { PROVIDERS } from './provider';

const KEY_CHECK_TIMEOUT_MS = 15_000;
/** Free-own-key spec §4.3: the output limit cut the answer off before any text (all of it went to reasoning). */
const CUT_OFF = 'The answer was cut off. Try again.';
/** Stopped by OpenAI's content filter. */
const DECLINED = 'OpenAI declined to answer this line.';
/** Incomplete for any other reason, or failed without a message. Never a raw reason code. */
const UNFINISHED = "OpenAI didn't finish the answer.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The system prompt as one developer message's text items (spec §4.5): `cache` puts an explicit prompt-cache
 * breakpoint on the item (the top-level `instructions` field can't carry one). Empty blocks are left out.
 */
export function toDeveloperContent(system: string | readonly SystemBlock[]): ResponseInputText[] {
  const blocks = typeof system === 'string' ? [{ text: system, cache: false }] : system;
  return blocks
    .filter((block) => block.text.trim())
    .map((block): ResponseInputText =>
      block.cache
        ? { type: 'input_text', text: block.text, prompt_cache_breakpoint: { mode: 'explicit' } }
        : { type: 'input_text', text: block.text },
    );
}

/** A JSON Schema for strict mode: every object closed with `additionalProperties: false`. */
function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const strict: Record<string, unknown> = { ...schema };
  if (isRecord(schema.properties)) {
    strict.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, value]) => [name, isRecord(value) ? strictSchema(value) : value]),
    );
  }
  if (isRecord(schema.items)) strict.items = strictSchema(schema.items);
  if (schema.type === 'object') strict.additionalProperties = false;
  return strict;
}

/** Spec §4.3: the tool as a strict function tool, with the same schema as the Claude tool. */
export function toFunctionTool(tool: ToolDefinition): FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: strictSchema({ ...tool.input_schema, type: 'object' }),
    strict: true,
  };
}

function parseArguments(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null; // unparseable arguments mean no suggestions (spec §4.3)
  }
}

/** The text of the answer's messages, joined. */
function textOf(response: Response): string {
  return response.output
    .flatMap((item) => (item.type === 'message' ? item.content : []))
    .map((part) => (part.type === 'output_text' ? part.text : ''))
    .join('');
}

function toolCallsOf(response: Response): ToolCall[] {
  return response.output.flatMap((item) => (item.type === 'function_call' ? [{ name: item.name, input: parseArguments(item.arguments) }] : []));
}

/**
 * Spec §4.3: a completed answer, or one cut off by the output limit that has text. Anything else is an `api` error
 * whose message is the card's headline: never a raw reason code.
 */
function resultOf(response: Response): StreamResult {
  const text = textOf(response);
  if (response.status === 'completed') return { text, toolCalls: toolCallsOf(response) };
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    if (reason === 'max_output_tokens') {
      // As with Claude, the text so far is kept and a tool call cut off with it dropped (v2 spec §5.4).
      if (text.trim()) return { text, toolCalls: [] };
      throw new OpenAIError(CUT_OFF);
    }
    throw new OpenAIError(reason === 'content_filter' ? DECLINED : UNFINISHED);
  }
  // Failed: OpenAI's own message when it gave one.
  throw new OpenAIError(response.error?.message || UNFINISHED);
}

/** The OpenAI adapter (free-own-key spec §4.3): the Responses API, one request per answer. `fetch` is for tests. */
export function createOpenAIClient(apiKey: string, options: { fetch?: typeof fetch } = {}): AiClient {
  // Runs in the extension's service worker; the key only ever goes to api.openai.com. No SDK retries, as for
  // Claude: a retried 429 would outlast the idle timer.
  const client = new OpenAI({ apiKey, baseURL: OPENAI_API_BASE_URL, dangerouslyAllowBrowser: true, maxRetries: 0, fetch: options.fetch });
  return {
    async stream(params, onText, signal, onActivity) {
      const tools = params.tools ?? [];
      const developer = toDeveloperContent(params.system);
      const body: ResponseCreateParamsStreaming = {
        model: PROVIDERS.openai.model,
        // Otherwise OpenAI keeps every response for at least 30 days; follow-ups replay earlier turns as text.
        store: false,
        reasoning: { effort: 'low' },
        text: { verbosity: 'low' },
        // Reasoning counts toward the limit, so both kinds get room for it; the prompt still asks for brevity.
        max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
        input: [
          ...(developer.length > 0 ? [{ role: 'developer' as const, content: developer }] : []),
          ...params.messages.map((message): EasyInputMessage => ({ role: message.role, content: message.content })),
        ],
        ...(tools.length > 0 ? { tools: tools.map(toFunctionTool), tool_choice: 'auto' as const, parallel_tool_calls: false } : {}),
        stream: true,
      };
      // The raw event stream, not `responses.stream()`: its finalResponse() parses a strict tool's arguments
      // itself and rejects the whole answer when they aren't JSON (spec §4.3 wants no suggestions instead).
      const events = await client.responses.create(body, { signal });
      let response: Response | null = null;
      for await (const event of events) {
        onActivity();
        if (event.type === 'response.output_text.delta') onText(event.delta);
        else if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
          response = event.response;
        }
      }
      // An aborted request ends the SDK's iteration quietly: reject, so nothing is saved.
      if (signal.aborted) throw new APIUserAbortError();
      if (!response) throw new APIConnectionError({ message: 'The answer stopped before it finished.' });
      return resultOf(response);
    },
    async checkKey() {
      try {
        await client.models.list({ timeout: KEY_CHECK_TIMEOUT_MS });
      } catch (err) {
        // A key restricted from listing models answers 403 but can still be used (spec §4.6).
        if (err instanceof PermissionDeniedError) return;
        throw err;
      }
    },
  };
}
```

- [ ] **Step 5: OpenAI's errors, and the client for each key**

Replace the whole content of `lingoflix-extension/src/lib/ai/errors.ts` with:

```ts
import * as Anthropic from '@anthropic-ai/sdk';
import * as OpenAI from 'openai';
import type { Provider } from './provider';
import { errorCopy, type ExplainErrorCode } from './protocol';

/** OpenAI's codes for an account out of credit or over a spend limit (free-own-key spec §4.6). */
const OPENAI_NO_CREDIT_CODES: ReadonlySet<unknown> = new Set([
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

/**
 * Anthropic usually reports a low balance as a 400 invalid_request_error ("Your credit balance is too low to access
 * the Anthropic API."), not a 402. A text match: if Anthropic rewords it, the card shows Anthropic's own sentence.
 */
const ANTHROPIC_LOW_CREDIT = /credit balance/i;

function anthropicCode(err: Anthropic.APIError): ExplainErrorCode {
  if (err instanceof Anthropic.AuthenticationError) return 'bad-key';
  if (err instanceof Anthropic.RateLimitError) return 'busy';
  if (err instanceof Anthropic.APIConnectionError) return 'network'; // includes timeouts
  // 402, or a billing error during the stream (no status).
  if (err.status === 402 || err.type === 'billing_error') return 'no-credit';
  if (err.status === 400 && err.type === 'invalid_request_error' && ANTHROPIC_LOW_CREDIT.test(providerMessage(err))) {
    return 'no-credit';
  }
  // 5xx (including a gateway's HTML page) and mid-stream rate limit or overload errors, which have no status.
  if (err.status !== undefined && err.status >= 500) return 'busy';
  if (err.type === 'overloaded_error' || err.type === 'rate_limit_error') return 'busy';
  return 'api';
}

function openAICode(err: OpenAI.APIError): ExplainErrorCode {
  if (err instanceof OpenAI.AuthenticationError) return 'bad-key';
  if (err instanceof OpenAI.APIConnectionError) return 'network'; // includes timeouts
  if (err.type === 'insufficient_quota' || OPENAI_NO_CREDIT_CODES.has(err.code)) return 'no-credit';
  // Any other 429, and 5xx. A stream `error` event has no status and stays `api`.
  if (err instanceof OpenAI.RateLimitError || err instanceof OpenAI.InternalServerError) return 'busy';
  return 'api';
}

/** The provider's own message: Anthropic's SDK keeps the whole body, OpenAI's the `error` object in it. */
function providerMessage(err: Anthropic.APIError | OpenAI.APIError): string {
  const body = err.error as { message?: unknown; error?: { message?: unknown } } | undefined;
  const message = err instanceof Anthropic.APIError ? body?.error?.message : body?.message;
  return typeof message === 'string' && message ? message : err.message;
}

/** An SDK's error as a card state (free-own-key spec §4.6), its headline naming `provider`. */
export function toExplainError(err: unknown, provider: Provider): { code: ExplainErrorCode; message: string } {
  const failure = (code: ExplainErrorCode, message = '') => ({ code, message: message || errorCopy(code, provider) });
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    const code = err instanceof Anthropic.APIError ? anthropicCode(err) : openAICode(err);
    return failure(code, code === 'api' ? providerMessage(err) : '');
  }
  return failure('api', err instanceof Error ? err.message : String(err));
}
```

(Both SDKs name their classes alike, so each is imported as a namespace. Each SDK's `APIConnectionError` extends its `APIError`, so the connection check comes before the generic ones. OpenAI's `APIUserAbortError` also extends `APIError`; it only reaches `toExplainError` if the service didn't abort the request itself, which it never does.)

Replace the whole content of `lingoflix-extension/src/lib/ai/client.ts` with:

```ts
import { createAnthropicClient } from './anthropic';
import { createOpenAIClient } from './openai';
import { NOT_A_KEY, providerOf } from './provider';

/** One part of the system prompt; `cache` puts a prompt-cache breakpoint after it (v2 spec §5.1). */
export interface SystemBlock {
  text: string;
  cache: boolean;
}

/** A tool the model may call. `input_schema` is a JSON Schema object; each adapter sends it in its API's shape. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamParams {
  /** Each adapter picks its model and output limit; `kind` says which limit (free-own-key spec §4.1). */
  kind: 'explain' | 'follow-up';
  system: string | SystemBlock[];
  messages: ChatMessage[];
  /** Offered with tool_choice auto, so the model still writes its explanation first. */
  tools?: ToolDefinition[];
}

export interface ToolCall {
  name: string;
  input: unknown;
}

export interface StreamResult {
  /** The answer's text, joined. */
  text: string;
  toolCalls: ToolCall[];
}

/** The provider-neutral client LingoFlix uses (free-own-key spec §4.1). Tests substitute a fake. */
export interface AiClient {
  /**
   * Streams text deltas to `onText`, and calls `onActivity` on every stream event (text or not), so the caller's
   * idle timer only fires on a silent stream (spec §4.3). Resolves with the text and tool calls; rejects with
   * the SDK's errors.
   */
  stream(params: StreamParams, onText: (delta: string) => void, signal: AbortSignal, onActivity: () => void): Promise<StreamResult>;
  /** The cheapest authenticated call, the provider's model list (spec §5.8 Test key). */
  checkKey(): Promise<void>;
}

/** The client for an API key's provider (free-own-key spec §3.1). */
export function createClient(apiKey: string): AiClient {
  const provider = providerOf(apiKey);
  if (provider === 'claude') return createAnthropicClient(apiKey);
  if (provider === 'openai') return createOpenAIClient(apiKey);
  throw new Error(NOT_A_KEY);
}
```

In `lingoflix-extension/src/lib/ai/suggestions.ts`, replace the comment `// Bundled into the Netflix content script (the card uses cardRows): never import the Anthropic SDK here.` with:

```ts
// Bundled into the Netflix content script (the card uses cardRows): never import an SDK here.
```

- [ ] **Step 6: The host permission**

In `lingoflix-extension/wxt.config.ts`, replace:

```ts
    host_permissions: ['https://www.netflix.com/*', 'https://api.anthropic.com/*'],
```

with:

```ts
    // Free-own-key spec §4.7: the AI providers too, so the background's requests don't depend on their CORS.
    host_permissions: ['https://www.netflix.com/*', 'https://api.anthropic.com/*', 'https://api.openai.com/*'],
```

- [ ] **Step 7: Run the tests again**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/openai.test.ts tests/unit/wxt-config.test.ts tests/unit/background-messages.test.ts tests/unit/explain-service.test.ts`
Expected: PASS (4 files, 67 tests).

- [ ] **Step 8: Run everything, and check that no page or content script bundles an SDK**

Run: `pnpm --filter lingoflix-extension test`
Expected: PASS (50 files, 616 tests).

Run: `pnpm --filter lingoflix-extension compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-extension build`
Expected: exit 0. `background.js` grows from about 230 kB to about 598 kB (the OpenAI SDK, about 79 kB more gzipped); `content-scripts/netflix.js` stays about 402 kB.

Run: `grep -rlE --include='*.js' 'x-stainless|anthropic-version|api\.openai\.com|api\.anthropic\.com|dangerouslyAllowBrowser' lingoflix-extension/.output/chrome-mv3`
Expected: only `lingoflix-extension/.output/chrome-mv3/background.js`. (Both SDKs set `x-stainless-*` headers and the `dangerouslyAllowBrowser` option; `anthropic-version` and the API hosts are theirs too. None of them may appear in `content-scripts/` or in `chunks/`, which hold the options page and popup.)

- [ ] **Step 9: Commit**

```bash
git add pnpm-lock.yaml lingoflix-extension/package.json lingoflix-extension/wxt.config.ts lingoflix-extension/src lingoflix-extension/tests
git commit -m "feat(extension): OpenAI adapter on the Responses API, chosen for OpenAI keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The Settings card, the popup, and copy that names no provider

**Files:**
- Modify (whole file replaced): `lingoflix-extension/src/entrypoints/options/ApiKeyCard.tsx`
- Modify: `lingoflix-extension/src/entrypoints/popup/App.tsx`, `lingoflix-extension/src/entrypoints/options/ExplanationsCard.tsx`, `lingoflix-extension/src/entrypoints/options/StudyLogDetail.tsx`, `lingoflix-extension/src/lib/config.ts`
- Modify (tests): `lingoflix-extension/tests/unit/settings-ui.test.tsx`, `lingoflix-extension/tests/unit/popup.test.tsx`, `lingoflix-extension/tests/unit/study-log-detail.test.tsx`

**Interfaces:**
- Consumes: `api-key:status` → `{ set, masked, provider: Provider | null }`, `NOT_A_KEY` (Task 2); `PROVIDERS`, `Provider` (`@/lib/ai/provider`).
- Produces: the Settings card `API key` and the popup's key line (spec §3.3, §3.4). `ANTHROPIC_KEYS_URL` leaves `@/lib/config` (the card uses `PROVIDERS[p].keysUrl`). After this task, the only learner-facing "Claude" in the extension's pages is the spec's own copy (the key card's text, `Claude key`, `Claude key set`) and the card errors that name the key's provider.

Copy (exact, spec §3.3 and §3.4):
- Card title `API key`. Text: `LingoFlix explains lines with your own Claude or OpenAI key. Get one at console.anthropic.com or platform.openai.com. Usage is billed to that account. The key stays on this computer and is sent only to Anthropic or OpenAI.` The two addresses link to `https://console.anthropic.com/settings/keys` and `https://platform.openai.com/api-keys` (new tab).
- With a key saved, the status line is `Claude key: <masked>` or `OpenAI key: <masked>`. For a saved key that is neither (saved before Task 2), it stays `Saved key: <masked>`, as today.
- Placeholder `sk-ant-… or sk-…`, and `Paste a new key to replace it` once one is saved. The input's accessible name becomes `API key` (it was `Claude API key`).
- Popup: `Claude key set` or `OpenAI key set`; with no key, or a key that is neither, the button `Add your API key`, which opens Settings as today.

Four more strings named Claude although OpenAI may write the answer. They now name no provider (owner's ruling, exact):
- Settings, Explanations card, the Follow-up box switch's description: `Ask Claude more about the line.` becomes `Ask more about the line.`
- Settings, Explanations card, the `Explain in` hint: `Claude answers in this language.` becomes `Explanations are written in this language.`
- Study Log detail, the collapsible section's label: `Claude's explanation` becomes `Explanation`.
- Study Log detail, when the explanation is missing: `Claude's explanation isn't available for this item.` becomes `The explanation isn't available for this item.`

Save, Test key, Remove and the show/hide toggle are unchanged.

- [ ] **Step 1: Write the failing tests**

In `lingoflix-extension/tests/unit/settings-ui.test.tsx`:

In `fakeBackground`, replace the `api-key:status` answer:

```tsx
      case 'api-key:status':
        return { set: key !== null, masked: key ? `sk-ant-…${key.slice(-4)}` : null };
```

with:

```tsx
      case 'api-key:status':
        return {
          set: key !== null,
          masked: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null,
          provider: key?.startsWith('sk-ant-') ? 'claude' : key?.startsWith('sk-') ? 'openai' : null,
        };
```

Replace the start of the card's tests, from `describe('Claude API key card', () => {` through the end of its first test (`it('explains where to get a key and saves one without ever showing it again', ...)`), with:

```tsx
describe('API key card (free-own-key spec §3.3)', () => {
  it('explains where to get a Claude or OpenAI key and saves one without ever showing it again', async () => {
    const { send } = fakeBackground();
    render(<ApiKeyCard send={send} />);
    expect(await screen.findByText('No key saved yet.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'API key' })).toBeTruthy();
    expect(screen.getByText(/LingoFlix explains lines/).textContent).toBe(
      'LingoFlix explains lines with your own Claude or OpenAI key. Get one at console.anthropic.com or platform.openai.com. ' +
        'Usage is billed to that account. The key stays on this computer and is sent only to Anthropic or OpenAI.',
    );
    expect(screen.getByRole('link', { name: 'console.anthropic.com' }).getAttribute('href')).toBe('https://console.anthropic.com/settings/keys');
    expect(screen.getByRole('link', { name: 'platform.openai.com' }).getAttribute('href')).toBe('https://platform.openai.com/api-keys');
    const input = screen.getByLabelText('API key') as HTMLInputElement;
    expect(input.placeholder).toBe('sk-ant-… or sk-…');
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(input.type).toBe('text');
    fireEvent.change(input, { target: { value: 'sk-ant-good-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Key saved.')).toBeTruthy();
    expect((await screen.findByText(/^Claude key:/)).textContent).toBe('Claude key: sk-ant-…1234');
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Paste a new key to replace it');
  });

  it('shows a saved OpenAI key as an OpenAI key', async () => {
    const { send } = fakeBackground('sk-proj-good-5678');
    render(<ApiKeyCard send={send} />);
    expect((await screen.findByText(/^OpenAI key:/)).textContent).toBe('OpenAI key: sk-proj…5678');
  });
```

and in the rest of the file replace `getByLabelText('Claude API key')` with `getByLabelText('API key')` (in `it('removes the key and refuses junk', ...)`) and `findByLabelText('Claude API key')` with `findByLabelText('API key')` (in `it("says so when the background can't be reached ...")`).

(The matchers anchor on `^Claude key:` and `^OpenAI key:` because the card's description also contains "OpenAI key".)

In the same file, in `describe('explanation and line settings')`, directly above `it('Rewind can jump by one line; the seconds stepper hides in that mode', ...)`, add:

```tsx
  it('describes the explanation language and the follow-up box without naming a provider', async () => {
    render(<SettingsTab send={fakeBackground().send} />);
    const language = await screen.findByLabelText('Explain in');
    expect(document.getElementById(language.getAttribute('aria-describedby')!)?.textContent).toBe('Explanations are written in this language.');
    expect(screen.getByRole('switch', { name: 'Follow-up box' }).textContent).toContain('Ask more about the line.');
  });

```

In `lingoflix-extension/tests/unit/study-log-detail.test.tsx`:
- Rename `it("loads Claude's explanation, collapsed when the item has a meaning", ...)` to `it('loads the explanation, collapsed when the item has a meaning', ...)`, and `it("opens Claude's explanation by default when there is no meaning, and says when it isn't available", ...)` to `it("opens the explanation by default when there is no meaning, and says when it isn't available", ...)`.
- Replace both `screen.getByRole('button', { name: "Claude's explanation" })` with `screen.getByRole('button', { name: 'Explanation' })`.
- Replace both `screen.findByText("Claude's explanation isn't available for this item.")` with `screen.findByText("The explanation isn't available for this item.")`.

In `lingoflix-extension/tests/unit/popup.test.tsx`, replace the `send` helper:

```tsx
const send = (set: boolean) =>
  vi.fn(async () => ({ set, masked: set ? 'sk-ant-…1234' : null })) as unknown as typeof sendToBackground;
```

with:

```tsx
const send = (provider: 'claude' | 'openai' | null) =>
  vi.fn(async () => ({ set: provider !== null, masked: provider ? 'sk-…1234' : null, provider })) as unknown as typeof sendToBackground;
```

replace every `send(true)` with `send('claude')` (five of them: four in the other tests, and one in the test replaced next), and replace the whole `it('shows the key status and links to Settings when the key is missing', ...)` test with:

```tsx
  it("shows which provider's key is set, and links to Settings when no key is (free-own-key spec §3.4)", async () => {
    const open = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue();
    render(<App send={send(null)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add your API key' }));
    expect(open).toHaveBeenCalled();
    cleanup();
    render(<App send={send('claude')} />);
    expect(await screen.findByText('Claude key set')).toBeTruthy();
    cleanup();
    render(<App send={send('openai')} />);
    expect(await screen.findByText('OpenAI key set')).toBeTruthy();
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/settings-ui.test.tsx tests/unit/popup.test.tsx tests/unit/study-log-detail.test.tsx`
Expected: FAIL, Test Files 3 failed (3), Tests 8 failed | 19 passed (27):
- `popup > shows which provider's key is set, ...`: `TestingLibraryElementError: Unable to find role="button" and name "Add your API key"`
- `API key card ... > explains where to get a Claude or OpenAI key ...`: `TestingLibraryElementError: Unable to find an accessible element with the role "heading" and name "API key"`
- `API key card ... > shows a saved OpenAI key as an OpenAI key`: `TestingLibraryElementError: Unable to find an element with the text: /^OpenAI key:/. ...`
- `API key card ... > removes the key and refuses junk` and `... > says so when the background can't be reached ...`: `TestingLibraryElementError: Unable to find a label with the text of: API key`
- `explanation and line settings > describes the explanation language and the follow-up box without naming a provider`: `AssertionError: expected 'Claude answers in this language.' to be 'Explanations are written in this lang…' // Object.is equality`
- `StudyLogDetail > loads the explanation, ...` and `StudyLogDetail > opens the explanation by default ...`: `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Explanation"`

- [ ] **Step 3: The Settings card**

Replace the whole content of `lingoflix-extension/src/entrypoints/options/ApiKeyCard.tsx` with:

```tsx
import { Eye, EyeOff, KeyRound, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { buttonSecondary, card, focusRing, iconTile } from '@/components/styles';
import { NOT_A_KEY, PROVIDERS, type Provider } from '@/lib/ai/provider';
import { sendToBackground } from '@/lib/messages';

export type Send = typeof sendToBackground;

type KeyStatus = { set: boolean; masked: string | null; provider: Provider | null } | 'unknown' | null;
type Note = { tone: 'good' | 'bad' | 'info'; text: string };

const NOTE_COLOR: Record<Note['tone'], string> = { good: 'text-tint-ink', bad: 'text-danger', info: 'text-mute' };
const UNREACHABLE: Note = { tone: 'bad', text: "Couldn't reach LingoFlix's background. Try again." };

/**
 * Free-own-key spec §3.3: the key goes to the background worker; this page only ever sees whether one is set
 * (masked) and whose it is.
 */
export function ApiKeyCard({ send = sendToBackground }: { send?: Send }) {
  const [status, setStatus] = useState<KeyStatus>(null);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await send({ type: 'api-key:status' }));
    } catch {
      setStatus('unknown');
    }
  }, [send]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    try {
      const res = await send({ type: 'api-key:set', key: draft });
      if (!res.ok) {
        setNote({ tone: 'bad', text: NOT_A_KEY });
        return;
      }
    } catch {
      setNote(UNREACHABLE);
      return;
    }
    setDraft('');
    setShow(false);
    setNote({ tone: 'good', text: 'Key saved.' });
    await refresh();
  };

  const test = async () => {
    setTesting(true);
    setNote({ tone: 'info', text: 'Testing…' });
    try {
      const res = await send({ type: 'api-key:test', ...(draft.trim() ? { key: draft.trim() } : {}) });
      setNote({ tone: res.result === 'valid' ? 'good' : 'bad', text: res.message });
    } catch {
      setNote(UNREACHABLE);
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    try {
      await send({ type: 'api-key:remove' });
    } catch {
      setNote(UNREACHABLE);
      return;
    }
    setNote({ tone: 'info', text: 'Key removed.' });
    await refresh();
  };

  const saved = typeof status === 'object' && status?.set === true;
  const keyLink = (provider: Provider) => (
    <a href={PROVIDERS[provider].keysUrl} target="_blank" rel="noopener noreferrer" className={`underline ${focusRing}`}>
      {PROVIDERS[provider].console}
    </a>
  );

  return (
    <section className={`${card} px-5 py-4`}>
      <div className="flex items-start gap-3.5">
        <span className={iconTile}>
          <KeyRound size={20} strokeWidth={2.5} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-black">
            API key
          </h2>
          <p className="mt-0.5 text-sm font-semibold text-mute">
            LingoFlix explains lines with your own Claude or OpenAI key. Get one at {keyLink('claude')} or {keyLink('openai')}. Usage
            is billed to that account. The key stays on this computer and is sent only to Anthropic or OpenAI.
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm font-bold">
        {status === null && 'Checking…'}
        {status === 'unknown' && "Couldn't check the saved key."}
        {typeof status === 'object' && status !== null && !status.set && 'No key saved yet.'}
        {saved && (
          <>
            {status.provider ? `${PROVIDERS[status.provider].name} key` : 'Saved key'}:{' '}
            <code className="rounded bg-soft px-1.5 py-0.5 text-[13px]">{status.masked}</code>
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <input
            type={show ? 'text' : 'password'}
            aria-label="API key"
            placeholder={saved ? 'Paste a new key to replace it' : 'sk-ant-… or sk-…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border-2 border-line bg-card px-3 py-2 pr-10 font-mono text-sm text-ink outline-none focus:border-brand"
          />
          <button
            type="button"
            aria-label={show ? 'Hide key' : 'Show key'}
            onClick={() => setShow(!show)}
            className={`absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-mute hover:text-ink ${focusRing}`}
          >
            {show ? <EyeOff size={16} strokeWidth={2.5} aria-hidden /> : <Eye size={16} strokeWidth={2.5} aria-hidden />}
          </button>
        </div>
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={() => void save()}
          className={`inline-flex items-center rounded-xl bg-brand px-4 py-2 text-xs font-extrabold tracking-wider text-on-brand uppercase shadow-[0_3px_0_var(--lf-brand-edge)] active:translate-y-[3px] active:shadow-none disabled:opacity-40 ${focusRing}`}
        >
          Save
        </button>
        <button type="button" disabled={testing || (!draft.trim() && !saved)} onClick={() => void test()} className={`${buttonSecondary} disabled:opacity-40`}>
          <Zap size={14} strokeWidth={3} aria-hidden />
          Test key
        </button>
        {saved && (
          <button type="button" onClick={() => void remove()} className={buttonSecondary}>
            <Trash2 size={14} strokeWidth={3} aria-hidden />
            Remove
          </button>
        )}
      </div>
      {note && (
        <p role="status" className={`mt-2 text-sm font-bold ${NOTE_COLOR[note.tone]}`}>
          {note.text}
        </p>
      )}
    </section>
  );
}
```

In `lingoflix-extension/src/lib/config.ts`, delete:

```ts
/** Where users create an API key. */
export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';
```

- [ ] **Step 4: The popup**

In `lingoflix-extension/src/entrypoints/popup/App.tsx`, add `import { PROVIDERS, type Provider } from '@/lib/ai/provider';` directly above `import { sendToBackground } from '@/lib/messages';`, and replace:

```tsx
function KeyStatus({ send }: { send: Send }) {
  const [set, setSet] = useState<boolean | null>(null);
  useEffect(() => {
    send({ type: 'api-key:status' }).then(
      (s) => setSet(s.set),
      () => setSet(null),
    );
  }, [send]);
  if (set === null) return null;
  return set ? (
    <p className="flex items-center gap-1.5 text-[13px] font-bold text-mute">
      <CheckCircle2 size={16} strokeWidth={2.5} className="text-tint-ink" aria-hidden />
      Claude key set
    </p>
```

with:

```tsx
/** Free-own-key spec §3.4: whose key is set; a key that is neither Claude's nor OpenAI's counts as none. */
function KeyStatus({ send }: { send: Send }) {
  const [status, setStatus] = useState<{ provider: Provider | null } | null>(null);
  useEffect(() => {
    send({ type: 'api-key:status' }).then(
      (s) => setStatus({ provider: s.provider }),
      () => setStatus(null),
    );
  }, [send]);
  if (status === null) return null;
  return status.provider ? (
    <p className="flex items-center gap-1.5 text-[13px] font-bold text-mute">
      <CheckCircle2 size={16} strokeWidth={2.5} className="text-tint-ink" aria-hidden />
      {PROVIDERS[status.provider].name} key set
    </p>
```

and the button's text `      Add your Claude API key` with `      Add your API key`.

- [ ] **Step 5: Copy that names no provider**

In `lingoflix-extension/src/entrypoints/options/ExplanationsCard.tsx`, replace:

```tsx
  followUp: { label: 'Follow-up box', description: 'Ask Claude more about the line.' },
```

with:

```tsx
  followUp: { label: 'Follow-up box', description: 'Ask more about the line.' },
```

and the hint's text `            Claude answers in this language.` with:

```tsx
            Explanations are written in this language.
```

In `lingoflix-extension/src/entrypoints/options/StudyLogDetail.tsx`, replace:

```tsx
      <Collapsible label="Claude's explanation" defaultOpen={item.meaning === ''}>
```

with:

```tsx
      <Collapsible label="Explanation" defaultOpen={item.meaning === ''}>
```

and:

```tsx
        {explanation === null && <p className="text-sm font-semibold text-mute">Claude's explanation isn't available for this item.</p>}
```

with:

```tsx
        {explanation === null && <p className="text-sm font-semibold text-mute">The explanation isn't available for this item.</p>}
```

- [ ] **Step 6: Run the tests again**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/settings-ui.test.tsx tests/unit/popup.test.tsx tests/unit/study-log-detail.test.tsx`
Expected: PASS (3 files, 27 tests).

Run: `grep -rn "Claude" lingoflix-extension/src/entrypoints | grep -vE '^[^:]*:[0-9]+: *(//|/\*|\*)'`
Expected: only `lingoflix-extension/src/entrypoints/options/ApiKeyCard.tsx`, the spec's `LingoFlix explains lines with your own Claude or OpenAI key.` line.

- [ ] **Step 7: Run everything**

Run: `pnpm --filter lingoflix-extension test`
Expected: PASS (50 files, 618 tests).

Run: `pnpm --filter lingoflix-extension compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-extension build`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add lingoflix-extension/src lingoflix-extension/tests
git commit -m "feat(extension): Settings and popup show whose key is saved, and other copy names no provider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The install and uninstall pages

**Files:**
- Create: `lingoflix-extension/src/lib/site-pages.ts`, `lingoflix-extension/tests/unit/site-pages.test.ts`
- Modify: `lingoflix-extension/src/lib/config.ts`, `lingoflix-extension/src/entrypoints/background.ts`, `lingoflix-extension/wxt.config.ts` (a comment)

**Interfaces:**
- Consumes: WXT's `browser` (`#imports`) in the background; `fakeBrowser` (`wxt/testing/fake-browser`) in tests.
- Produces:
  - `SITE_URL = 'https://lingoflix.lipsum.fun'` (`@/lib/config`).
  - `src/lib/site-pages.ts`: `interface SitePagesBrowser { runtime: { onInstalled: { addListener(callback: (details: { reason: string }) => void): void }; setUninstallURL(url: string): Promise<void> }; tabs: { create(properties: { url: string }): Promise<unknown> } }` and `installSitePages(browser: SitePagesBrowser): void`.

Spec §4.7: on `runtime.onInstalled` with reason `install` only (not `update`, `chrome_update` or `shared_module_update`), the background opens `${SITE_URL}/welcome` in a new tab; and each time the background starts it calls `runtime.setUninstallURL(`${SITE_URL}/goodbye`)`. Plan 1 put both pages on the live site. Like the reminders, the listener is added synchronously when the worker starts, so the worker that installation wakes hears `onInstalled`. Both calls are best effort: a failure is swallowed, not left as an unhandled rejection in the worker.

The manifest's `key` comment still says the website hands sessions to the extension ID, which was Premium's sign-in. The key itself stays (spec §2): it pins the store's extension ID, and the Study Log is stored under that ID. Only the comment changes.

Test notes: WXT's `fakeBrowser.runtime.setUninstallURL` isn't implemented (it throws `MockNotImplementedError`), so the tests spy on it. `fakeBrowser.tabs.query({})` includes a default tab with no URL, hence the `filter(Boolean)`. `runtime.onInstalled.trigger` takes the typed details: `update` needs `previousVersion`, `shared_module_update` needs `id`.

- [ ] **Step 1: Write the failing test**

Create `lingoflix-extension/tests/unit/site-pages.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { SITE_URL } from '@/lib/config';
import { installSitePages } from '@/lib/site-pages';

beforeEach(() => fakeBrowser.reset());

const openedUrls = async () => (await fakeBrowser.tabs.query({})).map((tab) => tab.url).filter(Boolean);
/** For asserting that something did not happen. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('install and uninstall pages (free-own-key spec §4.7)', () => {
  it('the site is lingoflix.lipsum.fun', () => {
    expect(SITE_URL).toBe('https://lingoflix.lipsum.fun');
  });

  it('sets the goodbye page as the uninstall page each time the background starts', () => {
    const setUninstallURL = vi.spyOn(fakeBrowser.runtime, 'setUninstallURL').mockResolvedValue();
    installSitePages(fakeBrowser);
    expect(setUninstallURL).toHaveBeenCalledExactlyOnceWith('https://lingoflix.lipsum.fun/goodbye');
  });

  it('opens the welcome page in a new tab on first install only, not on updates', async () => {
    vi.spyOn(fakeBrowser.runtime, 'setUninstallURL').mockResolvedValue();
    installSitePages(fakeBrowser);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.1.0' });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'chrome_update' });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'shared_module_update', id: 'abcdefghijklmnopabcdefghijklmnop' });
    await settle();
    expect(await openedUrls()).toEqual([]);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await vi.waitFor(async () => expect(await openedUrls()).toEqual(['https://lingoflix.lipsum.fun/welcome']));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/site-pages.test.ts`
Expected: FAIL, Test Files 1 failed (1), no tests: `Error: Cannot find package '@/lib/site-pages' imported from .../tests/unit/site-pages.test.ts`

- [ ] **Step 3: The site's address, the pages, and the `key` comment**

In `lingoflix-extension/src/lib/config.ts`, directly above `export const DONATION_TITLE = 'Enjoying LingoFlix?';`, add:

```ts
/** LingoFlix's site: the install and uninstall pages (free-own-key spec §4.7). */
export const SITE_URL = 'https://lingoflix.lipsum.fun';

```

Create `lingoflix-extension/src/lib/site-pages.ts`:

```ts
import { SITE_URL } from '@/lib/config';

interface Listener<T extends unknown[]> {
  addListener(callback: (...args: T) => void): void;
}

/** The parts of `browser` the site pages use (the real one and `fakeBrowser` both fit). */
export interface SitePagesBrowser {
  runtime: {
    onInstalled: Listener<[details: { reason: string }]>;
    setUninstallURL(url: string): Promise<void>;
  };
  tabs: { create(properties: { url: string }): Promise<unknown> };
}

/**
 * Free-own-key spec §4.7: the site's welcome page opens on first install (not on updates), and its goodbye page
 * is the uninstall page, set each time the background starts. Called synchronously at start, so the worker that
 * installation wakes hears onInstalled. Both are best effort.
 */
export function installSitePages(browser: SitePagesBrowser): void {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') browser.tabs.create({ url: `${SITE_URL}/welcome` }).catch(() => undefined);
  });
  browser.runtime.setUninstallURL(`${SITE_URL}/goodbye`).catch(() => undefined);
}
```

In `lingoflix-extension/src/entrypoints/background.ts`, add `import { installSitePages } from '@/lib/site-pages';` directly below `import { installReminders } from '@/lib/reminders/service';`, and directly below the `installReminders({ ... });` call (after its closing `});`) add:

```ts

  // Free-own-key spec §4.7: the welcome page on first install, and the goodbye page as the uninstall page.
  installSitePages(browser);
```

In `lingoflix-extension/wxt.config.ts`, replace the comment above `key:`:

```ts
    // Premium spec §7.8: the Chrome Web Store item's public key, so every build (unpacked too) has the store's
    // extension ID, gdgblbcjeocifdhjfbpjpkcphlfmaoll, which the website hands sessions to.
```

with:

```ts
    // The Chrome Web Store item's public key, so every build (unpacked too) has the store's extension ID,
    // gdgblbcjeocifdhjfbpjpkcphlfmaoll: the Study Log is stored under that ID (free-own-key spec §2).
```

- [ ] **Step 4: Run the test again**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/site-pages.test.ts`
Expected: PASS (1 file, 3 tests).

- [ ] **Step 5: Run everything**

Run: `pnpm --filter lingoflix-extension test`
Expected: PASS (51 files, 621 tests).

Run: `pnpm --filter lingoflix-extension compile`
Expected: exit 0.

Run: `pnpm --filter lingoflix-extension build`
Expected: exit 0.

Run: `grep -c '/goodbye' lingoflix-extension/.output/chrome-mv3/background.js`
Expected: `1` (the built worker sets the uninstall page; the minified line also holds `setUninstallURL`).

- [ ] **Step 6: Commit**

```bash
git add lingoflix-extension/src lingoflix-extension/tests lingoflix-extension/wxt.config.ts
git commit -m "feat(extension): open the welcome page on install, and set the goodbye page for uninstall

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The README, and the full check

**Files:**
- Modify: `README.md` (repository root)

**Interfaces:**
- Consumes: everything above; no code changes.
- Produces: the root README's AI and key lines for Claude or OpenAI (spec §5.8, its README part). The "Premium, the AI endpoint" line spec §5.8 mentions is already gone (Plan 1). Support and donations stay as they are.

No other learner-facing doc of the extension names a Claude API key: `lingoflix-extension/README.md` points to the root README, and `docs/` holds specs and plans, which are history. There is no RED: this task changes docs only.

- [ ] **Step 1: The README**

In `README.md`, replace:

```markdown
- **Explain any line.** Hover a subtitle (or press E) and Claude explains what it means in this
  scene, the key expressions, and how to use them, using the surrounding dialogue. Ask follow-up
  questions right in the card.
- **Study Log.** Claude suggests the words, phrases, idioms and lines worth keeping from each line it
  explains; save the ones you want. Browse them by show, season and episode, filter and search them,
```

with:

```markdown
- **Explain any line.** Hover a subtitle (or press E) and Claude or OpenAI explains what it means in
  this scene, the key expressions, and how to use them, using the surrounding dialogue. Ask follow-up
  questions right in the card.
- **Study Log.** Each explanation suggests the words, phrases, idioms and lines worth keeping from
  the line; save the ones you want. Browse them by show, season and episode, filter and search them,
```

and replace:

```markdown
LingoFlix uses your own Claude API key (you pay Anthropic directly for what you use). The key and
your Study Log stay on your computer. Only when you ask for an explanation or a follow-up does
LingoFlix send Anthropic the line, the show and episode it's from, the dialogue around it, the
episode's earlier subtitle lines (you can turn this off in Settings), and a list of your recent
saved items and explained lines (with the show and episode each is from), so Claude can build on it.
```

with:

```markdown
LingoFlix uses your own API key from Anthropic (Claude) or OpenAI: get one at
[console.anthropic.com](https://console.anthropic.com/settings/keys) or
[platform.openai.com](https://platform.openai.com/api-keys), and you pay that company directly for
what you use. LingoFlix tells which one it is from the key. The key and your Study Log stay on your
computer. Only when you ask for an explanation or a follow-up does LingoFlix send the line, the show
and episode it's from, the dialogue around it, the episode's earlier subtitle lines (you can turn
this off in Settings), and a list of your recent saved items and explained lines (with the show and
episode each is from), so the AI can build on it. They go straight from your browser to Anthropic or
OpenAI, whichever your key is from, with your key, never through a LingoFlix server. Requests to
OpenAI ask it not to store them.
```

Run: `git ls-files '*.md' | grep -v '^docs/superpowers' | xargs grep -n "Claude API key\|Claude explains\|Claude suggests"`
Expected: no output.

- [ ] **Step 2: The full check, with no environment variables**

From the repository root, run each with an empty environment, e.g. `env -i PATH="$PATH" HOME="$HOME" pnpm test` (in zsh, type the prefix out; a prefix kept in a variable isn't word-split).

Run: `pnpm test`
Expected: exit 0. lingoflix-extension: 51 files, 621 tests passed. lingoflix-server: 10 files, 88 tests passed. No `stderr` lines.

Run: `pnpm compile`
Expected: exit 0 (both packages).

Run: `pnpm build`
Expected: exit 0. The extension builds to `lingoflix-extension/.output/chrome-mv3` (`background.js` about 598 kB, `content-scripts/netflix.js` about 402 kB); the server's routes are `/`, `/_not-found`, `/api/goodbye`, `/goodbye`, `/privacy`, `/terms`, `/welcome`.

Run: `grep -rlE --include='*.js' 'x-stainless|anthropic-version|api\.openai\.com|api\.anthropic\.com|dangerouslyAllowBrowser' lingoflix-extension/.output/chrome-mv3`
Expected: only `lingoflix-extension/.output/chrome-mv3/background.js`.

Run: `python3 -c "import json; print(json.load(open('lingoflix-extension/.output/chrome-mv3/manifest.json'))['host_permissions'])"`
Expected: `['https://www.netflix.com/*', 'https://api.anthropic.com/*', 'https://api.openai.com/*']`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README says LingoFlix explains with your own Claude or OpenAI key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After merge: the owner's live checklist (real keys)

Nothing in this plan calls a real API. With the merged build loaded unpacked in Chrome (`pnpm --filter lingoflix-extension build`, then Reload on `chrome://extensions`; the pinned `manifest.key` keeps the same extension ID, so the Study Log stays), the owner checks, once with a Claude key and once with an OpenAI key:

1. Settings: the card shows `Claude key` or `OpenAI key` before the masked key; Test key says `Your key works.`; the popup says `Claude key set` or `OpenAI key set`.
2. On Netflix: an explanation with save suggestions, Regenerate, and a follow-up. With OpenAI, also check that:
   - the strict tool with `maxItems` is accepted (suggestions appear);
   - `prompt_cache_breakpoint` and `verbosity: 'low'` with `effort: 'low'` are accepted (no 400);
   - no answer stalls 30 s before its first word (otherwise the card shows `Couldn't reach OpenAI`).
3. A follow-up on an explanation written by the other provider (swap keys in between) answers.
4. Optional: a key with no credit shows `Your Anthropic account is out of credit` / `Your OpenAI account is out of credit` with the billing link.
5. Removing and re-adding the unpacked extension opens `https://lingoflix.lipsum.fun/welcome`; removing it opens `/goodbye`; Reload (an update) opens neither. (Back up the Study Log first: Export, Full backup. Removing the extension deletes its storage.)

Still open from Plan 1 (ask before each): dropping the sign-in tables on Neon, and removing the eight unused Vercel variables.
