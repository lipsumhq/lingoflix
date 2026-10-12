# LingoFlix Answers Always Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An explanation or follow-up that has started always finishes and is saved, even after its card closes; a card that reopens a line still being answered joins that answer instead of paying for a second request.

**Architecture:** `serveExplainPort(port, deps)` (one call per card, all state per Port) becomes `createExplainService(deps)`, created once when the background starts, whose `serve(port)` handles each card. The service keeps the explanations in progress by line; a card's Port only watches an answer, so disconnecting stops the watching, never the stream. While anything is in progress, a 25 s keep-alive stops Chrome from closing the background.

**Tech Stack:** WXT (Chrome MV3), TypeScript, Vitest with WXT's fake browser, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-11-lingoflix-finish-answers-design.md` (approved). It amends the main spec's §6.3 (`docs/superpowers/specs/2026-10-09-lingoflix-design.md`).

## Global Constraints

- Saved answers are kept forever; storage, the study log and its keys don't change.
- A line is identified as saved answers are: video ID, explanation language, and the line through `normalizeLine` (`src/lib/subtitles/cue.ts`).
- A `start` for a line already in progress joins it: one `delta` with the text so far (when not empty), the later deltas, then the same `done` or `error`. The joining request's other fields are ignored.
- Disconnecting never aborts a stream. The only abort is the existing 30 s silence limit (`AI_IDLE_TIMEOUT_MS`), which ends the answer for every card.
- Keep-alive: `browser.runtime.getPlatformInfo()` every 25 s (`KEEP_ALIVE_MS = 25_000`) while at least one answer or follow-up is in progress; none when idle.
- Follow-ups finish and are appended but are never joined.
- The card's messages (`ExplainClientMessage`, `ExplainServerMessage`) and all learner-facing copy don't change.
- Never call a real AI API or use a real key in tests. Never read or print any `.env*` file.
- No em dashes anywhere (use a colon).
- Commands run from the repo root. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings beyond the spec (for the owner's review)

- **A card that closes before the request is even sent** (during the key and history reads, a few milliseconds) still gets its answer: once the background has the `start`, the answer runs. Today's "card already closed, don't send" early return goes, as the spec's "disconnecting never aborts" implies.
- **A Port that throws when posted to** (Chrome throws for a Port closed before its disconnect event arrives) is dropped from the watchers; the answer and the other cards carry on. Without this, one closed card could stop a shared answer.
- **Comments:** besides `protocol.ts`, the comments in `explain-port.ts` and `explain-controller.ts` stop saying closing aborts, and the main spec's §6.3 sentence points to the new spec.
- **Tests:** the existing single-card tests keep a local `serveExplainPort(port, deps)` helper (one service per card), so they don't change. The flow test named "closing aborts the request..." is renamed; its assertions don't change.

## Review Focus

1. A long OpenAI answer (reasoning before the first word) whose card is closed at once: Chrome must not stop the background after 30 s. The unit test proves the timer; only the live checklist proves Chrome honours it. (Task 1: "keeps the background alive every 25 s...")
2. A card whose Port is already closed when a delta goes out: the answer and the other cards carry on. (Task 1: "a card whose Port is already gone...")
3. Reopening a line Netflix re-rendered with other spacing: it joins. (Task 1: the join test reopens with a differently spaced line.)
4. A card that joins after the stream ended, while the answer is being saved: it gets the whole text and `done`, never a stuck spinner. (Task 1: "a card that joins while the answer is being saved...")
5. Two cards starting the same line within the key read: one request. (Task 1: "two cards that start the same line before the key is read...")

## File Structure

| Path | Responsibility |
|---|---|
| `lingoflix-extension/src/lib/ai/explain-service.ts` | `createExplainService`: answers in progress, watchers, keep-alive |
| `lingoflix-extension/src/lib/config.ts` | `KEEP_ALIVE_MS` |
| `lingoflix-extension/src/entrypoints/background.ts` | One service for every card; keep-alive wired to `getPlatformInfo` |
| `lingoflix-extension/src/lib/ai/protocol.ts`, `src/entrypoints/netflix.content/overlay/explain-port.ts`, `.../explain-controller.ts` | Comments only |
| `docs/superpowers/specs/2026-10-09-lingoflix-design.md` | §6.3 sentence |
| `lingoflix-extension/tests/unit/explain-service.test.ts` | New tests; helpers |
| `lingoflix-extension/tests/unit/explain-flow.test.ts` | One test renamed |

---

### Task 1: Answers finish, cards join, the background stays alive

**Files:**
- Modify: `lingoflix-extension/src/lib/ai/explain-service.ts`
- Modify: `lingoflix-extension/src/lib/config.ts`
- Modify: `lingoflix-extension/src/entrypoints/background.ts`
- Modify (comments): `lingoflix-extension/src/lib/ai/protocol.ts`, `lingoflix-extension/src/entrypoints/netflix.content/overlay/explain-port.ts`, `lingoflix-extension/src/entrypoints/netflix.content/overlay/explain-controller.ts`
- Modify: `docs/superpowers/specs/2026-10-09-lingoflix-design.md`
- Test: `lingoflix-extension/tests/unit/explain-service.test.ts`, `lingoflix-extension/tests/unit/explain-flow.test.ts`

**Interfaces:**
- Consumes: `ExplainPort`, `ExplainServiceDeps` (existing), `normalizeLine(text: string): string` from `@/lib/subtitles/cue`, `AI_IDLE_TIMEOUT_MS` from `@/lib/config`.
- Produces: `createExplainService(deps: ExplainServiceDeps): ExplainService`, `interface ExplainService { serve(port: ExplainPort): void }`, `ExplainServiceDeps.keepAlive(): void` (required), `KEEP_ALIVE_MS = 25_000` in `@/lib/config`. `serveExplainPort` is removed.

- [ ] **Step 1: Write the failing tests**

In `lingoflix-extension/tests/unit/explain-service.test.ts`:

1. Replace the import line

```ts
import { serveExplainPort, type ExplainPort, type ExplainServiceDeps } from '@/lib/ai/explain-service';
```

with

```ts
import { createExplainService, type ExplainPort, type ExplainServiceDeps } from '@/lib/ai/explain-service';
```

2. In `deps()`, add `keepAlive: () => {},` after `savedKeysFor,`, so its object ends:

```ts
    savedKeysFor,
    keepAlive: () => {},
    ...over,
  };
}
```

3. Right after `deps()` (before `const systemOf = ...`), add:

```ts
/** One card's Port, served by its own service (tests of a single card). */
const serveExplainPort = (port: ExplainPort, d: ExplainServiceDeps) => createExplainService(d).serve(port);

/** A client the test drives: each stream waits for the test's text, then for it to finish or fail. */
function controlledClient() {
  const streams: { signal: AbortSignal; text(delta: string): void; finish(toolCalls?: ToolCall[]): void; fail(error: unknown): void }[] = [];
  const client: AiClient = {
    stream: (_params, onText, signal) =>
      new Promise((resolve, reject) => {
        let text = '';
        signal.addEventListener('abort', () => reject(new Error('aborted')));
        streams.push({
          signal,
          text: (delta) => {
            text += delta;
            onText(delta);
          },
          finish: (toolCalls = []) => resolve({ text, toolCalls }),
          fail: reject,
        });
      }),
    async checkKey() {},
  };
  return { client, streams };
}

const START = { type: 'start', request: REQUEST } as const;
```

4. Delete this test, and the one blank line after it, from `describe('explain service: failures', ...)` (closing no longer aborts; the new tests below replace it):

```ts
  it('disconnect aborts the request and saves nothing', async () => {
    const { client, signals } = fakeClient({ hang: true });
    const { port, sent, send, disconnect } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    disconnect();
    await new Promise((r) => setTimeout(r, 0));
    expect(signals[0]!.aborted).toBe(true);
    expect(sent).toEqual([]);
    expect(await listExplanations()).toEqual([]);
  });

```

5. Insert this `describe` immediately before `describe('explain service: follow-ups', () => {`:

```ts
describe('explain service: answers finish (finish-answers spec)', () => {
  it('a card that closes mid-answer stops watching; the answer still finishes and is saved', async () => {
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const card = fakePort();
    service.serve(card.port);
    card.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.text('Part one. ');
    card.disconnect();
    streams[0]!.text('Part two.');
    streams[0]!.finish([SUGGESTIONS]);

    await vi.waitFor(async () => expect(await findExplanation('80077211', 'ko', REQUEST.phrase)).not.toBeNull());
    const saved = (await findExplanation('80077211', 'ko', REQUEST.phrase))!;
    expect(saved.response).toBe('Part one. Part two.');
    expect(saved.suggestions.map((s) => s.text)).toEqual(['call it a night', 'gonna']);
    expect(streams[0]!.signal.aborted).toBe(false);
    expect(card.sent).toEqual([{ type: 'delta', text: 'Part one. ' }]);
  });

  it('a card that reopens the line joins the answer: the text so far, then the rest and done; the AI is asked once', async () => {
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const first = fakePort();
    service.serve(first.port);
    first.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.text('Part one. ');
    streams[0]!.text('Part two. ');
    first.disconnect();

    // The same line, spaced differently, with a later story: still the same answer.
    const reopened = fakePort();
    service.serve(reopened.port);
    reopened.send({
      type: 'start',
      request: { ...REQUEST, phrase: `  ${REQUEST.phrase.replace(' ', '  ')} `, storySoFar: [{ text: 'Hi.', startMs: 1_000 }] },
    });
    expect(reopened.sent).toEqual([{ type: 'delta', text: 'Part one. Part two. ' }]);

    streams[0]!.text('Part three.');
    streams[0]!.finish();
    await vi.waitFor(() => expect(reopened.sent.at(-1)?.type).toBe('done'));
    expect(reopened.sent.slice(0, 2)).toEqual([
      { type: 'delta', text: 'Part one. Part two. ' },
      { type: 'delta', text: 'Part three.' },
    ]);
    expect(doneOf(reopened.sent).explanation.response).toBe('Part one. Part two. Part three.');
    expect(first.sent).toEqual([
      { type: 'delta', text: 'Part one. ' },
      { type: 'delta', text: 'Part two. ' },
    ]);
    expect(streams).toHaveLength(1);
    expect(await listExplanations()).toHaveLength(1);
  });

  it('two cards that start the same line before the key is read share one request', async () => {
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const [a, b] = [fakePort(), fakePort()];
    service.serve(a.port);
    service.serve(b.port);
    a.send(START);
    b.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.text('Shared.');
    streams[0]!.finish();
    await vi.waitFor(() => expect(b.sent.at(-1)?.type).toBe('done'));
    expect(a.sent).toEqual(b.sent);
    expect(streams).toHaveLength(1);
  });

  it("a card whose Port is already gone stops neither the answer nor the other cards", async () => {
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const [gone, card] = [fakePort(), fakePort()];
    service.serve(gone.port);
    service.serve(card.port);
    gone.send(START);
    card.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    // Chrome throws when a Port closed before its disconnect event arrived.
    gone.port.postMessage = () => {
      throw new Error('Attempting to use a disconnected port object');
    };
    streams[0]!.text('Still here.');
    streams[0]!.finish();
    await vi.waitFor(() => expect(card.sent.at(-1)?.type).toBe('done'));
    expect(card.sent[0]).toEqual({ type: 'delta', text: 'Still here.' });
    expect(await listExplanations()).toHaveLength(1);
  });

  it('a card that joins while the answer is being saved gets the whole text and done', async () => {
    const { client, streams } = controlledClient();
    let save: (() => void) | undefined;
    const service = createExplainService(
      deps(client, {
        saveExplanation: async (fields) => {
          await new Promise<void>((resolve) => (save = resolve));
          return saveExplanation(fields);
        },
      }),
    );
    const first = fakePort();
    service.serve(first.port);
    first.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.text('Whole answer.');
    streams[0]!.finish();
    await vi.waitFor(() => expect(save).toBeDefined());
    first.disconnect();

    const late = fakePort();
    service.serve(late.port);
    late.send(START);
    save!();
    await vi.waitFor(() => expect(late.sent.at(-1)?.type).toBe('done'));
    expect(late.sent[0]).toEqual({ type: 'delta', text: 'Whole answer.' });
    expect(streams).toHaveLength(1);
  });

  it('an error reaches every card watching; with none watching nothing is saved, and the next start asks again', async () => {
    const rejected = APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'x', new Headers());
    const error = { type: 'error', code: 'bad-key', message: 'Your Claude key was rejected', provider: 'claude' };
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const [a, b] = [fakePort(), fakePort()];
    service.serve(a.port);
    service.serve(b.port);
    a.send(START);
    b.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.fail(rejected);
    await vi.waitFor(() => expect(a.sent).toEqual([error]));
    expect(b.sent).toEqual([error]);

    const closed = fakePort();
    service.serve(closed.port);
    closed.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(2)); // the failed answer was dropped: a new request
    closed.disconnect();
    streams[1]!.fail(rejected);
    await new Promise((r) => setTimeout(r, 0));
    expect(closed.sent).toEqual([]);
    expect(await listExplanations()).toEqual([]);

    const next = fakePort();
    service.serve(next.port);
    next.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(3));
  });

  it('a silent stream ends the answer for every card, saves nothing, and the next start asks again', async () => {
    const error = { type: 'error', code: 'network', message: "Couldn't reach Claude", provider: 'claude' };
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client, { idleTimeoutMs: 20 }));
    const [a, b, closed] = [fakePort(), fakePort(), fakePort()];
    for (const card of [a, b, closed]) {
      service.serve(card.port);
      card.send(START);
    }
    closed.disconnect();
    await vi.waitFor(() => expect(a.sent).toEqual([error]));
    expect(b.sent).toEqual([error]);
    expect(closed.sent).toEqual([]);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.signal.aborted).toBe(true);
    expect(await listExplanations()).toEqual([]);

    const again = fakePort();
    service.serve(again.port);
    again.send(START);
    await vi.waitFor(() => expect(streams).toHaveLength(2));
  });

  it('a follow-up whose card closes still finishes and is appended', async () => {
    const stored = await saveExplanation(STORED);
    const { client, streams } = controlledClient();
    const service = createExplainService(deps(client));
    const card = fakePort();
    service.serve(card.port);
    card.send({
      type: 'follow-up',
      explanationId: stored.id,
      question: 'Why "gonna"?',
      sections: DEFAULT_SETTINGS.cardSections,
      storySoFar: [],
    });
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    card.disconnect();
    streams[0]!.text('It is casual speech.');
    streams[0]!.finish();
    await vi.waitFor(async () =>
      expect((await getExplanation(stored.id))!.followUps).toEqual([{ question: 'Why "gonna"?', answer: 'It is casual speech.' }]),
    );
    expect(card.sent).toEqual([]);
  });

  it('keeps the background alive every 25 s while an answer or follow-up is in progress, then stops', async () => {
    vi.useFakeTimers();
    try {
      const keepAlive = vi.fn();
      const { client, streams } = controlledClient();
      const service = createExplainService(deps(client, { keepAlive, idleTimeoutMs: 600_000 }));
      const [a, b] = [fakePort(), fakePort()];
      service.serve(a.port);
      service.serve(b.port);
      a.send(START);
      b.send({ type: 'start', request: { ...REQUEST, phrase: 'Night.' } }); // another line: its own answer
      await vi.waitFor(() => expect(streams).toHaveLength(2));
      a.disconnect();
      b.disconnect();
      expect(keepAlive).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(50_000);
      expect(keepAlive).toHaveBeenCalledTimes(2);
      streams[0]!.text('One.');
      streams[0]!.finish();
      await vi.advanceTimersByTimeAsync(25_000);
      expect(keepAlive).toHaveBeenCalledTimes(3); // the other answer is still in progress

      streams[1]!.text('Two.');
      streams[1]!.finish();
      await vi.waitFor(async () => expect(await listExplanations()).toHaveLength(2));
      keepAlive.mockClear();
      await vi.advanceTimersByTimeAsync(100_000);
      expect(keepAlive).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/explain-service.test.ts --reporter=default`
Expected: FAIL, `Tests  31 failed (31)`, each with `TypeError: createExplainService is not a function`.

- [ ] **Step 3: Put today's behavior behind the new name (temporary)**

So the new tests fail on behavior, not on a missing name: append to the end of `lingoflix-extension/src/lib/ai/explain-service.ts`, after a blank line (Step 5 replaces it):

```ts
export function createExplainService(deps: ExplainServiceDeps) {
  return { serve: (port: ExplainPort) => serveExplainPort(port, deps) };
}
```

- [ ] **Step 4: Run the tests: only the new behavior fails**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/explain-service.test.ts --reporter=default`
Expected: FAIL, `Tests  9 failed | 22 passed (31)`. The 9 are exactly the tests of `explain service: answers finish (finish-answers spec)`; every older test passes.

- [ ] **Step 5: Implement the service**

1. In `lingoflix-extension/src/lib/config.ts`, add on the line right after `export const AI_IDLE_TIMEOUT_MS = 30_000;` (no blank line between):

```ts
/** Finish-answers spec §3.4: under Chrome's 30 s idle limit for an extension's background. */
export const KEEP_ALIVE_MS = 25_000;
```

2. In `lingoflix-extension/src/lib/ai/explain-service.ts`, replace everything from the first line through the end of `export interface ExplainServiceDeps { ... }` with:

```ts
import { AI_IDLE_TIMEOUT_MS, KEEP_ALIVE_MS } from '@/lib/config';
import type { Explanation, FollowUp, NewExplanation, SaveSuggestion } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';
import { normalizeLine } from '@/lib/subtitles/cue';
import type { AiClient, StreamParams, StreamResult, SystemBlock, ToolCall } from './client';
import { learningHistoryBlock, splitStory, storyBlock, type HistorySources } from './context-blocks';
import { toExplainError } from './errors';
import { buildFollowUpMessages, buildSystemPrompt, buildUserMessage, type ExplainRequest } from './prompt';
import { PROVIDERS, providerOf, type Provider } from './provider';
import {
  errorCopy,
  parseClientMessage,
  type ExplainClientMessage,
  type ExplainErrorCode,
  type ExplainServerMessage,
} from './protocol';
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
  /**
   * A trivial extension API call, made every 25 s while an answer is in progress: Chrome stops a background
   * that makes no call for 30 s, and with no card watching nothing else would (finish-answers spec §3.4).
   */
  keepAlive(): void;
  idleTimeoutMs?: number;
}
```

(The imports gain `KEEP_ALIVE_MS`, `normalizeLine` and `ExplainClientMessage`; `ExplainServiceDeps` gains `keepAlive`.)

3. In the same file, replace everything from the doc comment that starts `/**\n * Serves one explanation or follow-up over a Port` through the end of the file (including Step 3's temporary `createExplainService`) with:

```ts
/** A line as saved answers identify it (the study log's explanation index): video, language, normalized text. */
const lineKey = (request: ExplainRequest) => `${request.videoId}|${request.language}|${normalizeLine(request.phrase)}`;

type Watcher = (message: ExplainServerMessage) => void;

/** One answer or follow-up in progress (finish-answers spec §3.1). */
interface Job {
  /** The text streamed so far, sent at once to a card that joins. */
  text: string;
  /** One per card watching; each posts to its own Port while it is connected. */
  watchers: Set<Watcher>;
  /** Takes the job off the list a card can join, just before its last message goes out. */
  release(): void;
}

/** The request to send, and how to store its answer. */
interface Prepared {
  params: StreamParams;
  finish(result: StreamResult): Promise<Explanation | null>;
}

export interface ExplainService {
  /** Serves one card's Port (spec §6.3): one start or one follow-up. */
  serve(port: ExplainPort): void;
}

/**
 * Serves every card's Port. An answer, once asked for, always finishes and is saved, whether or not a card
 * still watches it; a start for a line already being answered joins that answer (finish-answers spec §3).
 * Deltas stream to the cards watching, and the answer stops only when the stream is silent (no event at all)
 * for 30 s. Errors name the key's provider (free-own-key spec §4.6).
 */
export function createExplainService(deps: ExplainServiceDeps): ExplainService {
  /** Explanations in progress, by line. */
  const answers = new Map<string, Job>();
  let inProgress = 0;
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  /** Finish-answers spec §3.4: Chrome would stop the background mid-answer once no card is watching. */
  const begin = () => {
    inProgress += 1;
    if (inProgress === 1) keepAliveTimer = setInterval(() => deps.keepAlive(), KEEP_ALIVE_MS);
  };
  const end = () => {
    inProgress -= 1;
    if (inProgress === 0) clearInterval(keepAliveTimer);
  };

  /** v2 spec §5.2: the learning history block. When it can't be read, the request goes out without it. */
  async function historyFor(line: string): Promise<string | null> {
    try {
      return learningHistoryBlock(await deps.loadHistory(), line);
    } catch {
      return null;
    }
  }

  /** Null when a follow-up's explanation is gone. */
  async function prepare(message: ExplainClientMessage, provider: Provider): Promise<Prepared | null> {
    if (message.type === 'start') {
      const { request } = message;
      const history = await historyFor(request.phrase);
      const instructions = buildSystemPrompt(request.language, request.sections);
      const { system, recent } = contextFor(instructions, request.storySoFar, request.videoTimeMs, history);
      return {
        params: {
          kind: 'explain',
          system,
          messages: [{ role: 'user', content: buildUserMessage(request, recent) }],
          tools: [SUGGEST_SAVES_TOOL],
        },
        finish: (result) =>
          deps.saveExplanation(
            explanationFields(request, result.text, suggestionsFrom(result.toolCalls, request.phrase), PROVIDERS[provider].model),
          ),
      };
    }
    const explanation = await deps.getExplanation(message.explanationId);
    if (!explanation) return null;
    const history = await historyFor(explanation.phrase);
    const instructions = buildSystemPrompt(explanation.explanationLanguage, message.sections, true);
    const { system, recent } = contextFor(instructions, message.storySoFar, explanation.videoTimeMs, history);
    return {
      params: {
        kind: 'follow-up',
        system,
        messages: buildFollowUpMessages(explanation, message.question, recent),
      },
      finish: (result) => deps.appendFollowUp(explanation.id, { question: message.question.trim(), answer: result.text }),
    };
  }

  /** Runs one answer or follow-up to its end, and tells the cards still watching how it ended. */
  async function run(job: Job, message: ExplainClientMessage): Promise<void> {
    begin();
    const abort = new AbortController();
    /** The saved key's provider, once read. */
    let provider: Provider | null = null;
    let timedOut = false;
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const broadcast = (m: ExplainServerMessage) => {
      for (const watch of job.watchers) watch(m);
    };
    const settle = (m: ExplainServerMessage) => {
      if (settled) return;
      settled = true;
      job.release();
      broadcast(m);
    };
    const fail = (code: ExplainErrorCode, text: string = errorCopy(code, provider)) =>
      settle({ type: 'error', code, message: text, provider });
    const armIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, deps.idleTimeoutMs ?? AI_IDLE_TIMEOUT_MS);
    };

    try {
      const apiKey = await deps.getApiKey();
      // A key saved before Save checked the provider, that is neither Claude's nor OpenAI's, counts as none.
      const keyProvider = apiKey ? providerOf(apiKey) : null;
      if (!apiKey || !keyProvider) return fail('no-key');
      provider = keyProvider;
      const prepared = await prepare(message, keyProvider);
      if (!prepared) return fail('api', EXPLANATION_GONE);

      armIdleTimer();
      try {
        const result = await deps.createClient(apiKey).stream(
          prepared.params,
          (delta) => {
            armIdleTimer();
            job.text += delta;
            broadcast({ type: 'delta', text: delta });
          },
          abort.signal,
          armIdleTimer,
        );
        clearTimeout(idleTimer);
        if (!result.text.trim()) return fail('api', `${PROVIDERS[keyProvider].name} returned an empty answer.`);
        const explanation = await prepared.finish(result);
        if (!explanation) return fail('api', EXPLANATION_GONE);
        // The explanation is stored; not knowing which rows are saved only shows them as unsaved.
        const savedKeys = await deps.savedKeysFor(explanation).catch((): string[] => []);
        settle({ type: 'done', explanation, savedKeys });
      } catch (err) {
        clearTimeout(idleTimer);
        if (timedOut) return fail('network');
        const { code, message: text } = toExplainError(err, keyProvider);
        fail(code, text);
      }
    } catch {
      // A failure outside the stream (e.g. storage) must still end the cards' spinners.
      fail('network');
    } finally {
      clearTimeout(idleTimer);
      end();
    }
  }

  function serve(port: ExplainPort): void {
    let connected = true;
    let received = false;
    let job: Job | null = null;
    const watch: Watcher = (m) => {
      if (!connected) return;
      try {
        port.postMessage(m);
      } catch {
        // The Port closed before its disconnect event arrived: stop watching, as if it had.
        connected = false;
        job?.watchers.delete(watch);
      }
    };

    // Closing the card only stops it watching: the answer still finishes and is saved (finish-answers spec §3.2).
    port.onDisconnect.addListener(() => {
      connected = false;
      job?.watchers.delete(watch);
    });

    port.onMessage.addListener((raw) => {
      if (received) return; // one request per Port
      received = true;
      const message = parseClientMessage(raw);
      if (!message) return watch({ type: 'error', code: 'api', message: UNREADABLE, provider: null });

      if (message.type === 'follow-up') {
        job = { text: '', watchers: new Set([watch]), release: () => {} };
        void run(job, message);
        return;
      }
      const key = lineKey(message.request);
      const current = answers.get(key);
      if (current) {
        // Finish-answers spec §3.3: join the answer in progress; the AI is asked once.
        job = current;
        current.watchers.add(watch);
        if (current.text) watch({ type: 'delta', text: current.text });
        return;
      }
      const created: Job = {
        text: '',
        watchers: new Set([watch]),
        release: () => {
          if (answers.get(key) === created) answers.delete(key);
        },
      };
      job = created;
      answers.set(key, created);
      void run(created, message);
    });
  }

  return { serve };
}
```

`UNREADABLE`, `EXPLANATION_GONE`, `explanationFields`, `suggestionsFrom` and `contextFor` stay as they are, between the two replaced parts.

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --filter lingoflix-extension exec vitest run tests/unit/explain-service.test.ts --reporter=default`
Expected: PASS, `Tests  31 passed (31)`.

- [ ] **Step 7: Wire the background, and update the comments and the main spec**

1. In `lingoflix-extension/src/entrypoints/background.ts`, replace

```ts
import { serveExplainPort, type ExplainPort } from '@/lib/ai/explain-service';
```

with

```ts
import { createExplainService, type ExplainPort } from '@/lib/ai/explain-service';
```

and replace

```ts
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EXPLAIN_PORT || port.sender?.id !== browser.runtime.id) return;
    serveExplainPort(port as unknown as ExplainPort, {
      getApiKey,
      createClient,
      saveExplanation: (fields) => saveExplanation(fields),
      getExplanation,
      appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
      loadHistory: readStudyLog,
      savedKeysFor,
    });
  });
```

with

```ts
  // One service for every card, so a card that reopens a line joins its answer (finish-answers spec §3.3).
  const explain = createExplainService({
    getApiKey,
    createClient,
    saveExplanation: (fields) => saveExplanation(fields),
    getExplanation,
    appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
    loadHistory: readStudyLog,
    savedKeysFor,
    keepAlive: () => void browser.runtime.getPlatformInfo(),
  });
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EXPLAIN_PORT || port.sender?.id !== browser.runtime.id) return;
    explain.serve(port as unknown as ExplainPort);
  });
```

2. In `lingoflix-extension/src/lib/ai/protocol.ts`, replace

```ts
/** One Port per request (spec §6.3); disconnecting aborts it. */
```

with

```ts
/** One Port per request (spec §6.3); disconnecting only stops that card watching (finish-answers spec §3.2). */
```

3. In `lingoflix-extension/src/entrypoints/netflix.content/overlay/explain-port.ts`, replace

```ts
 * Runs one request over its own Port (spec §6.3). Returns a cancel function; cancelling disconnects,
 * which aborts the request in the background. If the Port drops without an answer (the worker restarted
 * or the extension was reloaded), the card says it couldn't reach LingoFlix's background: only the
 * background knows the key's provider.
```

with

```ts
 * Runs one request over its own Port (spec §6.3). Returns a cancel function; cancelling disconnects, and the
 * background still finishes and saves the answer (finish-answers spec §3.2). If the Port drops without an
 * answer (the worker restarted or the extension was reloaded), the card says it couldn't reach LingoFlix's
 * background: only the background knows the key's provider.
```

4. In `lingoflix-extension/src/entrypoints/netflix.content/overlay/explain-controller.ts`, replace

```ts
  /** Closes the card, aborts its requests, and resumes playback if LingoFlix paused it. */
```

with

```ts
  /** Closes the card, stops watching its requests (they still finish), and resumes playback if LingoFlix paused it. */
```

5. In `lingoflix-extension/tests/unit/explain-flow.test.ts`, rename the test (its body doesn't change):

```ts
  it('closing aborts the request and resumes through the pause guard', async () => {
```

becomes

```ts
  it('closing disconnects the Port (the background still finishes the answer) and resumes through the pause guard', async () => {
```

6. In `docs/superpowers/specs/2026-10-09-lingoflix-design.md` (§6.3), replace the sentence

```
Disconnecting the port aborts the request.
```

with

```
Disconnecting the port only stops that card watching: the answer still finishes and is saved, and a card that reopens the line joins it (finish-answers spec, 2026-10-11).
```

- [ ] **Step 8: Run the whole check**

Run: `env -i PATH="$PATH" HOME="$HOME" pnpm test`
Expected: PASS: `lingoflix-extension test: Tests  635 passed (635)` (52 files) and `lingoflix-server test: Tests  88 passed (88)`.

Run: `pnpm --filter lingoflix-extension compile`
Expected: exits 0 with no output after `tsc --noEmit`.

Run: `pnpm --filter lingoflix-extension build`
Expected: `Built extension`; `background.js` about 599 kB; `content-scripts/netflix.js` about 402 kB.

Run: `grep -rn "serveExplainPort" lingoflix-extension/src`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add lingoflix-extension/src/lib/ai/explain-service.ts lingoflix-extension/src/lib/config.ts \
  lingoflix-extension/src/entrypoints/background.ts lingoflix-extension/src/lib/ai/protocol.ts \
  lingoflix-extension/src/entrypoints/netflix.content/overlay/explain-port.ts \
  lingoflix-extension/src/entrypoints/netflix.content/overlay/explain-controller.ts \
  lingoflix-extension/tests/unit/explain-service.test.ts lingoflix-extension/tests/unit/explain-flow.test.ts \
  docs/superpowers/specs/2026-10-09-lingoflix-design.md
git commit -F - <<'EOF'
feat(extension): answers always finish, and a card that reopens a line joins its answer

Closing the card no longer cancels the request: the background finishes and saves every answer and
follow-up it was asked for, a start for a line already in progress joins it (the text so far, then the
rest), and a 25 s keep-alive stops Chrome closing the background mid-answer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## After merge: the owner's live checklist

Real key, on Netflix, with the new build loaded unpacked from `/Users/jay/Codes/jaycho1214/lingoflix/lingoflix-extension/.output/chrome-mv3` (reload the extension, then the Netflix tab).

1. Hover a line until the card starts writing, move the pointer away at once, wait 20 s, hover the line again: the full answer appears under "Explained before". The provider's usage page shows one request for it.
2. Hover a line, move away after a second, and hover back within 2 s: the card shows the text so far at once and keeps streaming.
3. With an OpenAI key, open a card and close it at once, wait 60 s, reopen: the answer is saved (the background stayed alive past 30 s).
4. Ask a follow-up, close the card at once, reopen the line after 20 s: the follow-up and its answer are there.
5. Ask a follow-up, close the card at once, reopen the line within a few seconds, ask another follow-up: each question keeps its own answer.
