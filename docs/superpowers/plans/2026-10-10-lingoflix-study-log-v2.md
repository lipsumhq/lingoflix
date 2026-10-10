# LingoFlix Study Log v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude suggests words, phrases, idioms and whole lines to save from each explained line; the Study Log lists only what the learner saves (with filters, search, a detail view, Anki/CSV/backup export and backup import), while every explanation is kept as history that Claude learns from, together with the story so far.

**Architecture:** Explanations (`log:` keys, renamed `Explanation` in code) stay the automatic history; a new `SavedItem` store (`item:`/`itemkey:` keys) is the Study Log. The background builds each Claude request from cached system blocks (story so far, learning history) and a `suggest_saves` tool, validates the tool's suggestions, and stores them on the explanation; the Netflix card shows them with Save toggles that go through new background requests. The options page lists saved items (tree, filters, search, detail view) and builds export files in the page.

**Tech Stack:** As Plan 2: WXT 0.21.4 (MV3), React 19.3.0, TypeScript 6.0.3, Tailwind 4.3.3, Vitest 5.0.3 + happy-dom + Testing Library, lucide-react 1.48.0, `@anthropic-ai/sdk` 0.128.0, `react-markdown` 10.1.0, pnpm. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-lingoflix-study-log-v2-design.md` (this feature; wins where it disagrees with the main spec) and `docs/superpowers/specs/2026-10-09-lingoflix-design.md` (everything else).

**Branch:** `feat/study-log-v2` from `main`.

## Global Constraints

- The v2 spec is the authority for this feature; the main spec for everything it doesn't change. Read the sections each task names.
- Model `claude-sonnet-5-5` (`CLAUDE_MODEL`). Explanation requests: `max_tokens` **1536** (`CLAUDE_EXPLAIN_MAX_TOKENS`). Follow-up requests: `max_tokens` **1024** (`CLAUDE_MAX_TOKENS`). Streaming always on, SDK `maxRetries: 0`, 30 s idle timeout (`CLAUDE_IDLE_TIMEOUT_MS`), error mapping unchanged (main spec §7.4).
- **API key:** only in `chrome.storage.local` `apiKey`, read only by the background worker, sent only to `https://api.anthropic.com`, never logged, never posted to a content script, never in an export or backup.
- **Storage keys:** explanations `log:{id}` + `logkey:{videoId}|{language}|{normalized line}` (unchanged); saved items `item:{id}` + `itemkey:{videoId}|{normalized lowercased line}|{type}|{normalized lowercased text}`; migration marker `migration:study-log-v2`. All in `chrome.storage.local`.
- **Saved item source fields** (line, context, show, season, episode, time, language) always come from the stored `Explanation`, never from the page.
- **Story so far:** never includes the target line, its 6 context lines before, or anything after; content script sends at most the last 1000 lines; background splits at `floor(targetStartMs / 300000) * 300000`, then caps chunk A to its last 600 lines and 48 000 characters and chunk B to its last 200 lines.
- **Learning history:** last 100 saved items and last 30 explained lines (by `updatedAt`, excluding the line being explained); texts cut at 120 characters, meanings at 80.
- **Suggestions:** at most 6, at most one `line`; types `word | phrase | idiom | line`; word/phrase/idiom text must appear in the line (case-insensitive, whitespace-normalized), ≤ 120 characters; `line` text is replaced by the line; meanings trimmed and cut at 200 characters.
- No new permissions (manifest stays `storage`, `unlimitedStorage`; hosts `https://www.netflix.com/*`, `https://api.anthropic.com/*`). Downloads use `<a download>` + Blob URLs.
- **Copy:** no em dashes (U+2014) or en dashes (U+2013) in any user-facing string or prompt text; use colons. Exact strings are given in each task; use them verbatim.
- **On-Netflix UI:** dark tokens only, px sizes, `ui-rounded` font stack, Lucide icons, no emoji (use Lucide `Check`, not a check character).
- **Options page look and feel:** reuse `src/components/styles.ts` (`buttonPrimary`, `buttonSecondary`, `card`, `iconTile`, `focusRing`, `keycap`).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `pnpm test` (Vitest), `pnpm compile` (tsc), `pnpm build` (WXT). A task is done when its tests pass, `pnpm compile` is clean, and the full suite passes.

## Review Focus

1. **Late in a long episode** (2000+ lines seen). The request stays within the caps, and chunk A is byte-identical for two lines in the same 5-minute window, so it can be read from cache. Test: Task 5, "chunk A is identical within a window and capped".
2. **Spoilers.** No line at or after the target's context window ever reaches Claude, from the subtitle file or from history. Tests: Task 4, "story so far stops before the context window (file and history)"; Task 7, "the request never contains a line after the context window".
3. **A card from history, then Regenerate.** "Explained before" shows the stored suggestions with the right Saved state. After Regenerate replaces the suggestions, items saved earlier stay saved, and any matching row shows Saved. Test: Task 9, "saved state survives Regenerate".
4. **Importing a backup into a non-empty Study Log.** Duplicates are skipped by id and by index key, invalid records are counted, items whose explanation isn't in the file still import, and nothing is overwritten. Test: Task 13, "add-only merge with duplicates, invalid records and orphan items".
5. **Non-Latin text and special characters in exports.** Korean or Japanese text, tabs, newlines, quotes and `& < >` survive Anki (HTML-escaped, tabs → spaces, newlines → `<br>`) and CSV (quoted, BOM, CRLF). Test: Task 12, "escapes tabs, newlines, quotes, HTML and keeps non-Latin text".

---

## File Structure

```
src/lib/study-log/types.ts        # T1: Explanation (was StudyLogEntry) + suggestions, toExplanation; T2: ItemType, SavedItem, isSavedItem
src/lib/study-log/store.ts        # T1: explanation store renamed; T2: resetStudyLog also clears items
src/lib/study-log/items.ts        # T2: saved items (save/unsave, list, delete, saved keys, migration)
src/lib/study-log/keys.ts         # T2: every storage prefix + MIGRATION_KEY (store.ts and items.ts re-export them)
src/lib/study-log/highlight.ts    # T11: occurrences of the item text in its line
src/lib/study-log/group.ts        # T10: tree over saved items
src/lib/study-log/filter.ts       # T10: type filter + search + ordering
src/lib/study-log/format.ts       # T5: episodeCode, whereLabel
src/lib/study-log/export.ts       # T12: Anki, CSV, backup text + file names
src/lib/study-log/import.ts       # T13: backup import (add-only) + summary text
src/lib/claude/suggestions.ts     # T3: suggest_saves tool, validateSuggestions, cardRows (no SDK import)
src/lib/claude/context-blocks.ts  # T5: story split/caps/blocks, learning history block
src/lib/claude/prompt.ts          # T5: suggest instruction, recent story in user messages; T7: ExplainRequest.storySoFar
src/lib/claude/client.ts          # T6: system blocks, tools, stream() → { text, toolCalls }
src/lib/claude/protocol.ts        # T7: storySoFar parsing, follow-up/done payload changes
src/lib/claude/explain-service.ts # T7: request assembly, suggestions, saved keys
src/lib/config.ts                 # T6: CLAUDE_EXPLAIN_MAX_TOKENS
src/lib/subtitles/context.ts      # T4: StoryLine, storyBefore
src/lib/subtitles/history.ts      # T4: HISTORY_LIMIT 600
src/lib/settings.ts               # T4: sendStorySoFar
src/lib/messages.ts               # T8: explanation:find, item:save, item:remove
src/lib/background/message-handler.ts  # T8
src/entrypoints/background.ts     # T7 (port deps), T8 (message deps, migration on install/update)
src/entrypoints/netflix.content/subtitle-session.ts      # T4: storySoFar(line)
src/entrypoints/netflix.content/overlay/card-state.ts    # T9
src/entrypoints/netflix.content/overlay/explain-port.ts  # T9 (T7 changes the done payload)
src/entrypoints/netflix.content/overlay/explain-controller.ts # T9
src/entrypoints/netflix.content/overlay/Card.tsx         # T9: Save section
src/entrypoints/netflix.content/overlay/OverlayApp.tsx   # T9
src/entrypoints/netflix.content/index.ts                 # T9 wiring
src/entrypoints/options/ExplanationsCard.tsx             # T4: toggle
src/entrypoints/options/StudyLogTab.tsx                  # T10 (rewrite), T11, T12, T13
src/entrypoints/options/StudyLogTree.tsx                 # T10: All items
src/entrypoints/options/StudyLogItems.tsx                # T10: list rows (replaces StudyLogEntries.tsx, deleted)
src/entrypoints/options/StudyLogToolbar.tsx              # T10: filters + search; T12/T13: Export menu
src/entrypoints/options/StudyLogDetail.tsx               # T11
src/hooks/useWideLayout.ts                               # T11: matchMedia('(min-width: 1100px)')
src/components/ConfirmDialog.tsx                         # T11: stops its own Escape
src/entrypoints/options/App.tsx                          # T11: wider Study Log tab
src/entrypoints/options/StudyLogExportMenu.tsx           # T12 (T13 adds Import backup…)
src/lib/download.ts                                      # T12: downloadText
tests/unit/*.test.ts(x)
```

## Interface Contract

Every task's implementer sees only its own task. These are the exact names and types shared between tasks;
each task's **Interfaces** block points back here.

```ts
// ── src/lib/study-log/types.ts ─────────────────────────────────────────── (T1, T2)
export interface FollowUp { question: string; answer: string }
export type ItemType = 'word' | 'phrase' | 'idiom' | 'line';                       // T1 (needed by SaveSuggestion)
export const ITEM_TYPES: readonly ItemType[] = ['word', 'phrase', 'idiom', 'line']; // T1
export interface SaveSuggestion { type: ItemType; text: string; meaning: string }   // T1
/** One explanation (automatic history). Was StudyLogEntry; same fields plus `suggestions`. */
export interface Explanation {
  id: string; phrase: string; response: string; followUps: FollowUp[];
  videoTimeMs: number; savedAt: string; updatedAt: string; videoId: string;
  kind: 'episode' | 'movie'; seriesId: string | null; seriesTitle: string;
  seasonNumber: number | null; episodeNumber: number | null; episodeTitle: string | null;
  context: DialogueContext; explanationLanguage: string; model: string;
  suggestions: SaveSuggestion[];
}
export type NewExplanation = Omit<Explanation, 'id' | 'followUps' | 'savedAt' | 'updatedAt'>;
/** Validates a stored/imported record; fills `suggestions: []` when missing (records from before v2). */
export function toExplanation(value: unknown): Explanation | null;
export function isSaveSuggestion(value: unknown): value is SaveSuggestion;          // T1
export interface SavedItem {                                                        // T2
  id: string; type: ItemType; text: string; meaning: string; explanationId: string | null;
  line: string; lineTimeMs: number; context: DialogueContext;
  videoId: string; kind: 'episode' | 'movie'; seriesId: string | null; seriesTitle: string;
  seasonNumber: number | null; episodeNumber: number | null; episodeTitle: string | null;
  explanationLanguage: string; savedAt: string; updatedAt: string;
}
export function isSavedItem(value: unknown): value is SavedItem;                    // T2

// ── src/lib/study-log/store.ts (explanations) ────────────────────────────── (T1; T2 extends reset)
export const EXPLANATION_PREFIX = 'log:';
export const EXPLANATION_INDEX_PREFIX = 'logkey:';
export function explanationIndexKey(videoId: string, language: string, phrase: string): string;
export function getExplanation(id: string): Promise<Explanation | null>;
export function findExplanation(videoId: string, language: string, phrase: string): Promise<Explanation | null>;
export function listExplanations(): Promise<Explanation[]>;
export function saveExplanation(fields: NewExplanation, now?: Date, newId?: () => string): Promise<Explanation>;
export function appendFollowUp(id: string, followUp: FollowUp, now?: Date): Promise<Explanation | null>;
export function deleteExplanations(ids: readonly string[]): Promise<void>;          // T1 rename; unused after T10, removed in T10
/** Removes every log:, logkey:, item:, itemkey: key (T2 adds the item prefixes). */
export function resetStudyLog(): Promise<void>;
export function watchStudyLog(callback: () => void): () => void;                    // T1: log: keys; T2: also item: keys

// ── src/lib/study-log/items.ts ───────────────────────────────────────────── (T2)
export const ITEM_PREFIX = 'item:';
export const ITEM_INDEX_PREFIX = 'itemkey:';
export const MIGRATION_KEY = 'migration:study-log-v2';
export function itemIndexKey(videoId: string, line: string, type: ItemType, text: string): string;
/** The index key a card row would have: `line` rows use the explanation's phrase as text. */
export function suggestionKey(explanation: Pick<Explanation, 'videoId' | 'phrase'>, suggestion: Pick<SaveSuggestion, 'type' | 'text'>): string;
export function itemFromSuggestion(explanation: Explanation, suggestion: SaveSuggestion, now: Date, id: string): SavedItem;
/** Idempotent: returns the existing item when its index key exists. */
export function saveItem(explanation: Explanation, suggestion: SaveSuggestion, now?: Date, newId?: () => string): Promise<SavedItem>;
/** Removes the item (and index key) that `suggestion` of `explanation` would have; no-op when not saved. */
export function unsaveItem(explanation: Pick<Explanation, 'videoId' | 'phrase'>, suggestion: Pick<SaveSuggestion, 'type' | 'text'>): Promise<void>;
export function getItem(id: string): Promise<SavedItem | null>;
export function listItems(): Promise<SavedItem[]>;
export function deleteItems(ids: readonly string[]): Promise<void>;
/** Index keys among `cardRows(explanation.suggestions, explanation.phrase)` that are saved. */
export function savedKeysFor(explanation: Explanation): Promise<string[]>;
/** One saved `line` item per pre-v2 explanation (no `suggestions` field); sets MIGRATION_KEY; returns how many were created. */
export function migrateStudyLogV2(newId?: () => string): Promise<number>;   // converted items keep their explanation's savedAt/updatedAt

// ── src/lib/claude/suggestions.ts (no SDK import) ─────────────────────────── (T3)
export const SUGGEST_SAVES_TOOL_NAME = 'suggest_saves';
export const SUGGEST_SAVES_TOOL: ToolShape;   // exact JSON from v2 spec §5.3; ToolShape is a local type structurally identical to Task 6's ToolDefinition (Task 3 runs first)
export const MAX_SUGGESTIONS = 6;
export function validateSuggestions(toolInput: unknown, line: string): SaveSuggestion[];
/** The card's rows: suggestions in order with the `line` one last; a `{ type: 'line', text: line, meaning: '' }` row when none. */
export function cardRows(suggestions: readonly SaveSuggestion[], line: string): SaveSuggestion[];

// ── src/lib/subtitles/context.ts / history.ts ─────────────────────────────── (T4)
export interface StoryLine { startMs: number; text: string }
export const STORY_SEND_LIMIT = 1000;
/** Lines before the target's context window, oldest first, at most `limit` (file when it matches, else history). */
export function storyBefore(line: ObservedLine, cues: readonly Cue[] | null, history: Pick<LineHistory, 'before' | 'all'>, limit?: number): StoryLine[];
export const HISTORY_LIMIT = 600;   // history.ts (was 50)
// SubtitleSession gains:  storySoFar(line: ObservedLine): StoryLine[];

// ── src/lib/settings.ts ───────────────────────────────────────────────────── (T4)
// Settings gains `sendStorySoFar: boolean` (default true).

// ── src/lib/study-log/format.ts ───────────────────────────────────────────── (T5)
/** "S1 E3", "E3", "S1", or "" for movies/unknown. */
export function episodeCode(fields: { kind: 'episode' | 'movie'; seasonNumber: number | null; episodeNumber: number | null }): string;
/** "Stranger Things S1 E3", or the movie title. */
export function whereLabel(fields: { kind: 'episode' | 'movie'; seriesTitle: string; seasonNumber: number | null; episodeNumber: number | null }): string;

// ── src/lib/claude/context-blocks.ts ──────────────────────────────────────── (T5)
export const STORY_CHUNK_MS = 300_000;
export const STORY_CACHED_MAX_LINES = 600;
export const STORY_CACHED_MAX_CHARS = 48_000;
export const STORY_RECENT_MAX_LINES = 200;
export function splitStory(lines: readonly StoryLine[], targetStartMs: number): { cached: StoryLine[]; recent: StoryLine[] };
export function storyBlock(cached: readonly StoryLine[]): string | null;
export function recentStoryText(recent: readonly StoryLine[]): string | null;
export interface HistorySources { items: readonly SavedItem[]; explanations: readonly Explanation[] }
export const HISTORY_ITEMS = 100;
export const HISTORY_LINES = 30;
export function learningHistoryBlock(sources: HistorySources, excludeLine: string): string | null;

// ── src/lib/claude/prompt.ts ──────────────────────────────────────────────── (T5; T7 adds storySoFar)
export interface ExplainRequest { phrase; context; title; videoId; videoTimeMs; language; sections; storySoFar: StoryLine[] }  // storySoFar: T7
export const SUGGEST_INSTRUCTION: (languageName: string) => string;   // v2 spec §5.3 text
export function buildSystemPrompt(language: string, sections: CardSections, followUp?: boolean): string;  // adds SUGGEST_INSTRUCTION when !followUp
export function buildUserMessage(request: Pick<ExplainRequest, 'phrase' | 'context' | 'title'>, recent?: readonly StoryLine[]): string;
export function buildFollowUpMessages(explanation: Explanation, question: string, recent?: readonly StoryLine[]): ChatMessage[];

// ── src/lib/claude/client.ts ──────────────────────────────────────────────── (T6)
export interface SystemBlock { text: string; cache: boolean }
export interface ToolDefinition { name: string; description: string; input_schema: Record<string, unknown> }
export interface StreamParams { model: string; maxTokens: number; system: string | SystemBlock[]; messages: ChatMessage[]; tools?: ToolDefinition[] }
export interface ToolCall { name: string; input: unknown }
export interface StreamResult { text: string; toolCalls: ToolCall[] }
export interface ClaudeClient {
  stream(params: StreamParams, onText: (delta: string) => void, signal: AbortSignal): Promise<StreamResult>;
  checkKey(): Promise<void>;
}
export function toSdkSystem(system: string | readonly SystemBlock[]): string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
export function readToolCalls(content: readonly unknown[]): ToolCall[];
// src/lib/config.ts: export const CLAUDE_EXPLAIN_MAX_TOKENS = 1536;

// ── src/lib/claude/protocol.ts ────────────────────────────────────────────── (T7)
export type ExplainClientMessage =
  | { type: 'start'; request: ExplainRequest }
  | { type: 'follow-up'; explanationId: string; question: string; sections: CardSections; storySoFar: StoryLine[] };
export type ExplainServerMessage =
  | { type: 'delta'; text: string }
  | { type: 'done'; explanation: Explanation; savedKeys: string[] }
  | { type: 'error'; code: ExplainErrorCode; message: string };

// ── src/lib/claude/explain-service.ts ─────────────────────────────────────── (T7)
export interface ExplainServiceDeps {
  getApiKey(): Promise<string | null>;
  createClient(apiKey: string): ClaudeClient;
  saveExplanation(fields: NewExplanation): Promise<Explanation>;
  getExplanation(id: string): Promise<Explanation | null>;
  appendFollowUp(id: string, followUp: FollowUp): Promise<Explanation | null>;
  loadHistory(): Promise<HistorySources>;
  savedKeysFor(explanation: Explanation): Promise<string[]>;
  idleTimeoutMs?: number;
}

// ── src/lib/messages.ts ───────────────────────────────────────────────────── (T8; replaces 'log:find')
'explanation:find': { request: { videoId: string; language: string; phrase: string }; response: { explanation: Explanation | null; savedKeys: string[] } };
'item:save':   { request: { explanationId: string; suggestion: SaveSuggestion }; response: { key: string } };
'item:remove': { request: { explanationId: string; suggestion: SaveSuggestion }; response: { key: string } };
// The handler accepts a suggestion only if it matches (type + normalized text) one of
// cardRows(explanation.suggestions, explanation.phrase); otherwise it throws 'Not a suggestion of this explanation'.

// ── overlay (T9) ──────────────────────────────────────────────────────────────
// CardState: `entry` → `explanation: Explanation | null`; `fromStudyLog` → `explainedBefore: boolean`;
//   new `savedKeys: string[]`; new `saveStatus: Record<string, 'saving' | 'error'>` (keyed by suggestionKey).
// ExplainController gains `toggleSave(row: SaveSuggestion): void`.
// ExplainControllerDeps: `findEntry` → `findExplanation(videoId, language, phrase): Promise<{ explanation: Explanation | null; savedKeys: string[] }>`;
//   new `saveItem(explanationId: string, suggestion: SaveSuggestion): Promise<string>` (resolves the key),
//   new `unsaveItem(explanationId: string, suggestion: SaveSuggestion): Promise<string>`;
//   `session: Pick<SubtitleSession, 'currentLine' | 'describe' | 'storySoFar'>`.
// StreamHandlers.onDone(explanation: Explanation, savedKeys: string[]).
// CardProps gains `onToggleSave(row: SaveSuggestion): void`.

// ── options (T10–T13) ─────────────────────────────────────────────────────────
// group.ts: groupStudyLog(items: readonly SavedItem[]): StudyLogTree, where EpisodeNode/MovieNode hold `items: SavedItem[]`.
// filter.ts: export type TypeFilter = ItemType | 'all';
//            export function filterItems(items: readonly SavedItem[], filter: { type: TypeFilter; query: string }): SavedItem[];
//            export function newestFirst(items: readonly SavedItem[]): SavedItem[];
// export.ts: toAnki(items), toCsv(items), toBackup(items, explanations, now: Date): string;   (CSV cells starting with = + - @ get a leading apostrophe)
//            exportFileName(kind: 'anki' | 'csv' | 'backup', now: Date): string;
// download.ts: downloadText(fileName: string, text: string, mimeType: string, doc?: Document): void;
// import.ts: export interface ImportSummary { itemsAdded: number; explanationsAdded: number; skipped: number; invalid: number }
//            export type ImportResult = { ok: true; summary: ImportSummary } | { ok: false; error: 'not-backup' | 'newer-version' };
//            export function importBackup(text: string): Promise<ImportResult>;
//            export function importSummaryText(summary: ImportSummary): string;
```

**Spec alignment:** v2 spec §4.2 and §5.5 were amended to match this contract: `item:save` and `item:remove` take
`{ explanationId, suggestion }` and answer `{ key }`; `explanation:find` (replacing `log:find`) also answers
`savedKeys`, so there is no separate `items:saved-keys`; the client returns `toolCalls`, dropping any cut off by
`max_tokens`.

## Tasks

1. Rename `StudyLogEntry` → `Explanation` and add `suggestions`
2. Saved items store, migration, Reset all
3. Suggestions: the `suggest_saves` tool, validation, card rows
4. Story so far on the Netflix side, and the setting
5. Context blocks and prompt text
6. Claude client: system blocks, tools, tool calls
7. Explain protocol and service: assemble the request, store suggestions
8. Background requests for saving items, and migration on update
9. The card's Save section
10. Study Log list: All items, filters, search, deletes
11. Detail view
12. Export: Anki, CSV, backup
13. Import backup
14. Docs, build, live check

---
### Task 1: Rename `StudyLogEntry` → `Explanation` and add `suggestions`

Spec: v2 spec §3.1 (explanations keep their storage keys; one new field `suggestions`). This task is a
behavior-preserving rename plus the new field: nothing user-visible changes. Port payloads and background message
names stay exactly as they are (`'log:find'` answers `{ entry }`, the port's `done` message carries `entry`, the
follow-up message carries `entryId`); Tasks 7 and 8 change those. The overlay's `findEntry` dependency and
`CardState.entry` also keep their names here; Task 9 renames them.

**Files:**
- Modify (rewrite): `src/lib/study-log/types.ts`, `src/lib/study-log/store.ts`, `src/lib/claude/explain-service.ts`, `src/entrypoints/background.ts`
- Modify (rename only): `src/lib/study-log/group.ts`, `src/lib/messages.ts`, `src/lib/claude/protocol.ts`, `src/lib/claude/prompt.ts`, `src/lib/background/message-handler.ts`, `src/entrypoints/options/StudyLogEntries.tsx`, `src/entrypoints/options/StudyLogTab.tsx`, `src/entrypoints/netflix.content/overlay/explain-port.ts`, `src/entrypoints/netflix.content/overlay/card-state.ts`, `src/entrypoints/netflix.content/overlay/explain-controller.ts`
- Test (rewrite): `tests/unit/study-log.test.ts`
- Test (rename/fixtures): `tests/unit/explain-service.test.ts`, `tests/unit/background-messages.test.ts`, `tests/unit/study-log-tab.test.tsx`, `tests/unit/card.test.tsx`, `tests/unit/claude.test.ts`, `tests/unit/explain-flow.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (Interface Contract, `types.ts` and `store.ts` sections):
  - `types.ts`: `FollowUp`, `ItemType`, `ITEM_TYPES`, `SaveSuggestion`, `isSaveSuggestion(value)`, `Explanation` (all `StudyLogEntry` fields plus `suggestions: SaveSuggestion[]`), `NewExplanation`, `toExplanation(value): Explanation | null`.
  - `store.ts`: `EXPLANATION_PREFIX = 'log:'`, `EXPLANATION_INDEX_PREFIX = 'logkey:'`, `explanationIndexKey`, `getExplanation`, `findExplanation`, `listExplanations`, `saveExplanation`, `appendFollowUp`, `deleteExplanations`, `resetStudyLog`, `watchStudyLog` (same behavior as before; Task 2 extends the last two).
  - `ExplainServiceDeps.getEntry` → `getExplanation`; `MessageHandlerDeps.findEntry` → `findExplanation`.
  - `toExplanation` rule: a record without a `suggestions` array (written before v2) reads as `suggestions: []`; inside an array, each malformed suggestion (not `{ type: ItemType, text: string, meaning: string }`) is dropped on its own and the rest are kept.
  - Every caller of `saveExplanation` passes `suggestions: []` until Task 7 fills them from Claude.

- [ ] **Step 1: Make sure you're on the feature branch**

```bash
git switch feat/study-log-v2 2>/dev/null || git switch -c feat/study-log-v2 main
git status --short
```

Expected: on `feat/study-log-v2`, clean working tree.

- [ ] **Step 2: Write the failing tests**

Replace `tests/unit/study-log.test.ts` with:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { episodeLabel, formatTimestamp, seasonLabel } from '@/lib/study-log/format';
import { groupStudyLog } from '@/lib/study-log/group';
import {
  appendFollowUp,
  deleteExplanations,
  findExplanation,
  getExplanation,
  listExplanations,
  resetStudyLog,
  saveExplanation,
} from '@/lib/study-log/store';
import { isSaveSuggestion, toExplanation, type Explanation, type NewExplanation } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());

const line = (over: Partial<NewExplanation> = {}): NewExplanation => ({
  phrase: "I'm gonna call it a night.",
  response: '## Meaning\nTime to sleep.',
  videoTimeMs: 1_834_200,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: ['Where are you going?'], after: [] },
  explanationLanguage: 'ko',
  model: 'claude-sonnet-5-5',
  suggestions: [],
  ...over,
});

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('explanation store', () => {
  it('saves an explanation and finds it again by video, language, and normalized line', async () => {
    const saved = await saveExplanation(line(), new Date('2026-10-10T10:00:00Z'), ids());
    expect(saved).toMatchObject({ id: 'id-1', followUps: [], savedAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z' });
    expect(await findExplanation('80077211', 'ko', "I'm gonna\ncall it   a night.")).toEqual(saved);
    expect(await findExplanation('80077211', 'en', "I'm gonna call it a night.")).toBeNull();
    expect(await findExplanation('11111111', 'ko', "I'm gonna call it a night.")).toBeNull();
    expect(await getExplanation('id-1')).toEqual(saved);
  });

  it('saving the same line again replaces the response, keeps id and savedAt, clears follow-ups (Regenerate)', async () => {
    const first = await saveExplanation(line(), new Date('2026-10-10T10:00:00Z'), ids());
    await appendFollowUp(first.id, { question: 'Formal?', answer: 'No.' });
    const again = await saveExplanation(line({ response: 'New answer' }), new Date('2026-10-11T10:00:00Z'), () => 'unused');
    expect(again).toMatchObject({
      id: 'id-1',
      response: 'New answer',
      followUps: [],
      savedAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-11T10:00:00.000Z',
    });
    expect(await listExplanations()).toHaveLength(1);
  });

  it('appends follow-ups in order', async () => {
    const saved = await saveExplanation(line(), new Date('2026-10-10T10:00:00Z'), ids());
    await appendFollowUp(saved.id, { question: 'Q1', answer: 'A1' });
    const after = await appendFollowUp(saved.id, { question: 'Q2', answer: 'A2' }, new Date('2026-10-12T00:00:00Z'));
    expect(after?.followUps).toEqual([
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ]);
    expect(after?.updatedAt).toBe('2026-10-12T00:00:00.000Z');
    expect(await appendFollowUp('missing', { question: 'Q', answer: 'A' })).toBeNull();
  });

  it('deletes explanations and their lookup keys only', async () => {
    const next = ids();
    const a = await saveExplanation(line({ phrase: 'A' }), undefined, next);
    const b = await saveExplanation(line({ phrase: 'B' }), undefined, next);
    await deleteExplanations([a.id]);
    expect(await findExplanation(a.videoId, 'ko', 'A')).toBeNull();
    expect(await getExplanation(a.id)).toBeNull();
    expect(await findExplanation(b.videoId, 'ko', 'B')).toEqual(b);
  });

  it('Reset all removes the whole Study Log and nothing else', async () => {
    await fakeBrowser.storage.local.set({ apiKey: 'sk-ant-secret', other: 1 });
    const next = ids();
    await saveExplanation(line({ phrase: 'A' }), undefined, next);
    await saveExplanation(line({ phrase: 'B' }), undefined, next);
    await resetStudyLog();
    expect(await listExplanations()).toEqual([]);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ apiKey: 'sk-ant-secret', other: 1 });
  });

  it('skips corrupt stored explanations', async () => {
    await fakeBrowser.storage.local.set({ 'log:bad': { id: 'bad' }, 'log:worse': 'text' });
    await saveExplanation(line(), undefined, ids());
    expect((await listExplanations()).map((e) => e.id)).toEqual(['id-1']);
  });
});

describe('explanation records (v2 spec §3.1)', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    ...line(),
    id: 'old',
    followUps: [],
    savedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  });

  it('reads a record saved before v2 (no suggestions field) with suggestions: []', async () => {
    const { suggestions: _none, ...preV2 } = stored();
    await fakeBrowser.storage.local.set({ 'log:old': preV2 });
    expect(await getExplanation('old')).toEqual({ ...preV2, suggestions: [] });
    expect((await listExplanations()).map((e) => e.suggestions)).toEqual([[]]);
  });

  it('reads a suggestions field that is not an array as no suggestions', async () => {
    await fakeBrowser.storage.local.set({ 'log:old': stored({ suggestions: 'none' }) });
    expect((await getExplanation('old'))?.suggestions).toEqual([]);
  });

  it('keeps well-formed suggestions and drops only the malformed ones', async () => {
    await fakeBrowser.storage.local.set({
      'log:old': stored({
        suggestions: [
          { type: 'idiom', text: 'call it a night', meaning: 'stop for the night' },
          { type: 'slang', text: 'gonna', meaning: 'going to' },
          { type: 'word', text: 5, meaning: 'five' },
          { type: 'word', text: 'gonna' },
          'gonna',
          { type: 'word', text: 'gonna', meaning: 'going to' },
        ],
      }),
    });
    expect((await getExplanation('old'))?.suggestions).toEqual([
      { type: 'idiom', text: 'call it a night', meaning: 'stop for the night' },
      { type: 'word', text: 'gonna', meaning: 'going to' },
    ]);
  });

  it('rejects values that are not explanations', () => {
    expect(toExplanation({ id: 'x' })).toBeNull();
    expect(toExplanation('text')).toBeNull();
    expect(toExplanation(null)).toBeNull();
    expect(toExplanation([])).toBeNull();
  });

  it('recognizes a save suggestion of each type', () => {
    for (const type of ['word', 'phrase', 'idiom', 'line']) expect(isSaveSuggestion({ type, text: 't', meaning: '' })).toBe(true);
    expect(isSaveSuggestion({ type: 'sentence', text: 't', meaning: '' })).toBe(false);
    expect(isSaveSuggestion({ type: 'word', text: 't' })).toBe(false);
  });

  it('saves suggestions with the explanation, and Regenerate replaces them', async () => {
    const first = await saveExplanation(
      line({ suggestions: [{ type: 'word', text: 'gonna', meaning: 'going to' }] }),
      new Date('2026-10-10T10:00:00Z'),
      ids(),
    );
    expect(first.suggestions).toEqual([{ type: 'word', text: 'gonna', meaning: 'going to' }]);
    const again = await saveExplanation(
      line({ suggestions: [{ type: 'idiom', text: 'call it a night', meaning: 'go to bed' }] }),
      new Date('2026-10-11T10:00:00Z'),
      () => 'unused',
    );
    expect(again.suggestions).toEqual([{ type: 'idiom', text: 'call it a night', meaning: 'go to bed' }]);
    expect(await getExplanation(first.id)).toEqual(again);
  });
});

const explanation = (over: Partial<Explanation>): Explanation => ({
  id: 'x',
  phrase: 'p',
  response: 'r',
  followUps: [],
  videoTimeMs: 0,
  savedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  videoId: 'v',
  kind: 'episode',
  seriesId: 's',
  seriesTitle: 'S',
  seasonNumber: 1,
  episodeNumber: 1,
  episodeTitle: null,
  context: { before: [], after: [] },
  explanationLanguage: 'en',
  model: 'claude-sonnet-5-5',
  suggestions: [],
  ...over,
});

describe('groupStudyLog', () => {
  const st = { seriesId: 'st', seriesTitle: 'Stranger Things' };
  const entries = [
    explanation({ id: 'st-e3-late', ...st, videoId: 'e3', episodeNumber: 3, videoTimeMs: 2000, updatedAt: '2026-10-05T00:00:00Z' }),
    explanation({ id: 'st-e3-early', ...st, videoId: 'e3', episodeNumber: 3, videoTimeMs: 1000, updatedAt: '2026-10-03T00:00:00Z' }),
    explanation({ id: 'st-e1', ...st, videoId: 'e1', episodeNumber: 1, updatedAt: '2026-10-02T00:00:00Z' }),
    explanation({ id: 'st-s2', ...st, videoId: 's2e1', seasonNumber: 2, episodeNumber: 1, updatedAt: '2026-10-01T00:00:00Z' }),
    explanation({ id: 'dark', seriesId: 'dark', seriesTitle: 'Dark', videoId: 'd1', updatedAt: '2026-10-06T00:00:00Z' }),
    explanation({ id: 'roma', kind: 'movie', seriesId: null, seriesTitle: 'Roma', videoId: 'm1', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-04T00:00:00Z' }),
    explanation({ id: 'okja', kind: 'movie', seriesId: null, seriesTitle: 'Okja', videoId: 'm2', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-07T00:00:00Z' }),
  ];

  it('builds series → season → episode with counts, plus Movies, in the spec order', () => {
    const tree = groupStudyLog(entries);
    expect(tree.total).toBe(7);
    expect(tree.series.map((s) => [s.title, s.count])).toEqual([
      ['Dark', 1],
      ['Stranger Things', 4],
    ]);
    const stranger = tree.series[1]!;
    expect(stranger.seasons.map((s) => [s.seasonNumber, s.count])).toEqual([
      [1, 3],
      [2, 1],
    ]);
    expect(stranger.seasons[0]!.episodes.map((e) => e.episodeNumber)).toEqual([1, 3]);
    expect(stranger.seasons[0]!.episodes[1]!.entries.map((e) => e.id)).toEqual(['st-e3-early', 'st-e3-late']);
    expect(tree.movies.map((m) => m.title)).toEqual(['Okja', 'Roma']);
  });

  it('puts unnumbered seasons and episodes last', () => {
    const tree = groupStudyLog([
      explanation({ id: 'a', seasonNumber: null, episodeNumber: null, videoId: 'x' }),
      explanation({ id: 'b', seasonNumber: 1, episodeNumber: 2, videoId: 'y' }),
    ]);
    expect(tree.series[0]!.seasons.map((s) => s.seasonNumber)).toEqual([1, null]);
  });
});

describe('labels', () => {
  it('formats timestamps like the player', () => {
    expect(formatTimestamp(1_834_200)).toBe('30:34');
    expect(formatTimestamp(5000)).toBe('0:05');
    expect(formatTimestamp(3_723_000)).toBe('1:02:03');
    expect(formatTimestamp(-10)).toBe('0:00');
  });

  it('names seasons and episodes', () => {
    expect(seasonLabel(2)).toBe('Season 2');
    expect(seasonLabel(null)).toBe('Episodes');
    expect(episodeLabel({ episodeNumber: 3, episodeTitle: 'Holly, Jolly' })).toBe('E3 · Holly, Jolly');
    expect(episodeLabel({ episodeNumber: null, episodeTitle: null })).toBe('Episode');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/study-log.test.ts`
Expected: FAIL. The new names aren't exported yet, so the store tests fail with `TypeError: saveExplanation`/`getExplanation`/`findExplanation is not a function` (or `listExplanations is not a function`), and the record tests fail with `toExplanation is not a function` / `isSaveSuggestion is not a function`.

- [ ] **Step 4: Rewrite `src/lib/study-log/types.ts`**

```ts
import type { DialogueContext } from '@/lib/subtitles/context';

export interface FollowUp {
  question: string;
  answer: string;
}

/** What Claude can suggest saving from a line, and what a saved item is (v2 spec §3.1). */
export type ItemType = 'word' | 'phrase' | 'idiom' | 'line';
export const ITEM_TYPES: readonly ItemType[] = ['word', 'phrase', 'idiom', 'line'];

/** One `suggest_saves` item, validated (v2 spec §5.4). */
export interface SaveSuggestion {
  type: ItemType;
  text: string;
  meaning: string;
}

/** One explanation: the automatic history (v2 spec §3.1). Times are episode ms; dates are ISO 8601. */
export interface Explanation {
  id: string;
  phrase: string;
  /** Markdown. */
  response: string;
  followUps: FollowUp[];
  videoTimeMs: number;
  savedAt: string;
  updatedAt: string;
  videoId: string;
  kind: 'episode' | 'movie';
  seriesId: string | null;
  /** Series title, or the movie title. */
  seriesTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  context: DialogueContext;
  explanationLanguage: string;
  model: string;
  /** Claude's save suggestions; `[]` when there were none, and for records written before v2. */
  suggestions: SaveSuggestion[];
}

export type NewExplanation = Omit<Explanation, 'id' | 'followUps' | 'savedAt' | 'updatedAt'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown) => Array.isArray(value) && value.every((v) => typeof v === 'string');

export function isSaveSuggestion(value: unknown): value is SaveSuggestion {
  return (
    isRecord(value) &&
    ITEM_TYPES.includes(value.type as ItemType) &&
    typeof value.text === 'string' &&
    typeof value.meaning === 'string'
  );
}

/**
 * A stored (or imported) explanation, or null when the value isn't one. A record written before v2 has no
 * `suggestions`, so it reads as `[]`; malformed suggestions are dropped one by one and the rest are kept.
 */
export function toExplanation(value: unknown): Explanation | null {
  if (!isRecord(value)) return null;
  const v = value;
  const valid =
    typeof v.id === 'string' &&
    typeof v.phrase === 'string' &&
    typeof v.response === 'string' &&
    Array.isArray(v.followUps) &&
    typeof v.videoTimeMs === 'number' &&
    typeof v.savedAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    typeof v.videoId === 'string' &&
    (v.kind === 'episode' || v.kind === 'movie') &&
    typeof v.seriesTitle === 'string' &&
    typeof v.explanationLanguage === 'string' &&
    isRecord(v.context) &&
    isStringArray(v.context.before) &&
    isStringArray(v.context.after);
  if (!valid) return null;
  const suggestions = Array.isArray(v.suggestions) ? v.suggestions.filter(isSaveSuggestion) : [];
  return { ...(v as unknown as Explanation), suggestions };
}
```

- [ ] **Step 5: Rewrite `src/lib/study-log/store.ts`**

```ts
import { browser } from '#imports';
import { normalizeLine } from '@/lib/subtitles/cue';
import { toExplanation, type Explanation, type FollowUp, type NewExplanation } from './types';

/** `log:{id}` holds an explanation (v2 spec §3.1). */
export const EXPLANATION_PREFIX = 'log:';
/** `logkey:{videoId}|{language}|{normalized line}` holds the id of that line's explanation. */
export const EXPLANATION_INDEX_PREFIX = 'logkey:';

const explanationKey = (id: string) => `${EXPLANATION_PREFIX}${id}`;

export function explanationIndexKey(videoId: string, language: string, phrase: string): string {
  return `${EXPLANATION_INDEX_PREFIX}${videoId}|${language}|${normalizeLine(phrase)}`;
}

const indexKeyOf = (e: Pick<Explanation, 'videoId' | 'explanationLanguage' | 'phrase'>) =>
  explanationIndexKey(e.videoId, e.explanationLanguage, e.phrase);

const isExplanation = (value: Explanation | null): value is Explanation => value !== null;

export async function getExplanation(id: string): Promise<Explanation | null> {
  const key = explanationKey(id);
  return toExplanation((await browser.storage.local.get(key))[key]);
}

/** Main spec §5.3 step 3.1: the explanation of this line, in this language, in this video. */
export async function findExplanation(videoId: string, language: string, phrase: string): Promise<Explanation | null> {
  const key = explanationIndexKey(videoId, language, phrase);
  const id = (await browser.storage.local.get(key))[key];
  return typeof id === 'string' ? getExplanation(id) : null;
}

export async function listExplanations(): Promise<Explanation[]> {
  const all = await browser.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(EXPLANATION_PREFIX))
    .map(([, value]) => toExplanation(value))
    .filter(isExplanation);
}

/**
 * Saves a finished explanation. Saving a line that already has one replaces its response and suggestions and
 * clears its follow-ups (they referred to the old response) but keeps its id and savedAt: that is Regenerate.
 */
export async function saveExplanation(
  fields: NewExplanation,
  now: Date = new Date(),
  newId: () => string = () => crypto.randomUUID(),
): Promise<Explanation> {
  const existing = await findExplanation(fields.videoId, fields.explanationLanguage, fields.phrase);
  const stamp = now.toISOString();
  const explanation: Explanation = existing
    ? { ...existing, ...fields, followUps: [], updatedAt: stamp }
    : { ...fields, id: newId(), followUps: [], savedAt: stamp, updatedAt: stamp };
  await browser.storage.local.set({ [explanationKey(explanation.id)]: explanation, [indexKeyOf(explanation)]: explanation.id });
  return explanation;
}

export async function appendFollowUp(id: string, followUp: FollowUp, now: Date = new Date()): Promise<Explanation | null> {
  const explanation = await getExplanation(id);
  if (!explanation) return null;
  const next: Explanation = { ...explanation, followUps: [...explanation.followUps, followUp], updatedAt: now.toISOString() };
  await browser.storage.local.set({ [explanationKey(id)]: next });
  return next;
}

export async function deleteExplanations(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const keys = ids.map(explanationKey);
  const stored = Object.values(await browser.storage.local.get(keys))
    .map((value) => toExplanation(value))
    .filter(isExplanation);
  const indexes = await browser.storage.local.get(stored.map(indexKeyOf));
  const ownIndexes = Object.entries(indexes)
    .filter(([, id]) => typeof id === 'string' && ids.includes(id))
    .map(([key]) => key);
  await browser.storage.local.remove([...keys, ...ownIndexes]);
}

/** Main spec §5.5 Reset all: every explanation and lookup key, nothing else (the API key stays). */
export async function resetStudyLog(): Promise<void> {
  const keys = Object.keys(await browser.storage.local.get(null)).filter(
    (key) => key.startsWith(EXPLANATION_PREFIX) || key.startsWith(EXPLANATION_INDEX_PREFIX),
  );
  if (keys.length > 0) await browser.storage.local.remove(keys);
}

/** Calls back whenever any explanation is added, changed, or removed (e.g. from a Netflix tab). */
export function watchStudyLog(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(EXPLANATION_PREFIX))) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
```

- [ ] **Step 6: Run the store tests to verify they pass**

Run: `pnpm vitest run tests/unit/study-log.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 7: Rename the type everywhere else**

These two commands rename only whole words (`\b`), so `StudyLogEntries` (the component) and `setEntries` (state) are untouched. The overlay's `findEntry` dependency (`explain-controller.ts`, `netflix.content/index.ts`, `explain-flow.test.ts`) is deliberately left out of the second command; Task 9 renames it.

```bash
perl -pi -e 's/\bNewStudyLogEntry\b/NewExplanation/g; s/\bStudyLogEntry\b/Explanation/g' \
  src/lib/study-log/group.ts \
  src/lib/messages.ts \
  src/lib/claude/protocol.ts \
  src/lib/claude/prompt.ts \
  src/lib/background/message-handler.ts \
  src/entrypoints/options/StudyLogEntries.tsx \
  src/entrypoints/options/StudyLogTab.tsx \
  src/entrypoints/netflix.content/overlay/explain-port.ts \
  src/entrypoints/netflix.content/overlay/card-state.ts \
  src/entrypoints/netflix.content/overlay/explain-controller.ts \
  tests/unit/card.test.tsx \
  tests/unit/claude.test.ts \
  tests/unit/explain-flow.test.ts \
  tests/unit/study-log-tab.test.tsx
perl -pi -e 's/\bgetEntry\b/getExplanation/g; s/\bfindEntry\b/findExplanation/g; s/\blistEntries\b/listExplanations/g; s/\bdeleteEntries\b/deleteExplanations/g' \
  src/lib/background/message-handler.ts \
  src/entrypoints/options/StudyLogTab.tsx \
  tests/unit/explain-service.test.ts \
  tests/unit/background-messages.test.ts \
  tests/unit/study-log-tab.test.tsx
```

Afterwards, for example, `src/lib/background/message-handler.ts` reads:

```ts
import type { Explanation } from '@/lib/study-log/types';
// …
  findExplanation(videoId: string, language: string, phrase: string): Promise<Explanation | null>;
// …
        return { entry: await deps.findExplanation(videoId, language, phrase) } satisfies BackgroundResponse<'log:find'>;
```

and `src/entrypoints/options/StudyLogTab.tsx` imports
`import { deleteExplanations, listExplanations, resetStudyLog, watchStudyLog } from '@/lib/study-log/store';` and
`import type { Explanation } from '@/lib/study-log/types';`.

- [ ] **Step 8: Rewrite `src/lib/claude/explain-service.ts`**

Same behavior; the dependency `getEntry` becomes `getExplanation`, and the saved fields gain `suggestions: []`.
The port messages keep `entryId` and `entry`.

```ts
import { CLAUDE_IDLE_TIMEOUT_MS, CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from '@/lib/config';
import type { Explanation, FollowUp, NewExplanation } from '@/lib/study-log/types';
import type { ClaudeClient } from './client';
import { toExplainError } from './errors';
import { buildFollowUpMessages, buildSystemPrompt, buildUserMessage, type ChatMessage, type ExplainRequest } from './prompt';
import { ERROR_COPY, parseClientMessage, type ExplainErrorCode, type ExplainServerMessage } from './protocol';

/** The part of `chrome.runtime.Port` the service uses. */
export interface ExplainPort {
  postMessage(message: ExplainServerMessage): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface ExplainServiceDeps {
  getApiKey(): Promise<string | null>;
  createClient(apiKey: string): ClaudeClient;
  saveExplanation(fields: NewExplanation): Promise<Explanation>;
  getExplanation(id: string): Promise<Explanation | null>;
  appendFollowUp(id: string, followUp: FollowUp): Promise<Explanation | null>;
  idleTimeoutMs?: number;
}

const UNREADABLE = 'LingoFlix sent a request it could not read.';
const ENTRY_GONE = 'This explanation is no longer in your Study Log.';
const EMPTY_ANSWER = 'Claude returned an empty answer.';

function explanationFields(request: ExplainRequest, response: string): NewExplanation {
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
    model: CLAUDE_MODEL,
    suggestions: [],
  };
}

/**
 * Serves one explanation or follow-up over a Port (spec §6.3). Streams deltas, saves the result only when
 * the stream completed and the card is still open, and aborts when the Port disconnects or the stream is
 * silent for 30 s.
 */
export function serveExplainPort(port: ExplainPort, deps: ExplainServiceDeps): void {
  const abort = new AbortController();
  let disconnected = false;
  let received = false;
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const post = (message: ExplainServerMessage) => {
    if (!disconnected) port.postMessage(message);
  };
  const fail = (code: ExplainErrorCode, message: string = ERROR_COPY[code]) => post({ type: 'error', code, message });
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, deps.idleTimeoutMs ?? CLAUDE_IDLE_TIMEOUT_MS);
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

  async function run(raw: unknown): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message) return fail('api', UNREADABLE);
    const apiKey = await deps.getApiKey();
    if (!apiKey) return fail('no-key');
    if (disconnected) return;

    let system: string;
    let messages: ChatMessage[];
    let finish: (text: string) => Promise<Explanation | null>;
    if (message.type === 'start') {
      const { request } = message;
      system = buildSystemPrompt(request.language, request.sections);
      messages = [{ role: 'user', content: buildUserMessage(request) }];
      finish = (text) => deps.saveExplanation(explanationFields(request, text));
    } else {
      const explanation = await deps.getExplanation(message.entryId);
      if (!explanation) return fail('api', ENTRY_GONE);
      system = buildSystemPrompt(explanation.explanationLanguage, message.sections, true);
      messages = buildFollowUpMessages(explanation, message.question);
      finish = (text) => deps.appendFollowUp(explanation.id, { question: message.question.trim(), answer: text });
    }

    armIdleTimer();
    try {
      const text = await deps.createClient(apiKey).streamText(
        { model: CLAUDE_MODEL, maxTokens: CLAUDE_MAX_TOKENS, system, messages },
        (delta) => {
          armIdleTimer();
          post({ type: 'delta', text: delta });
        },
        abort.signal,
      );
      clearTimeout(idleTimer);
      if (disconnected) return; // the card closed: nothing is saved
      if (!text.trim()) return fail('api', EMPTY_ANSWER);
      const saved = await finish(text);
      if (!saved) return fail('api', ENTRY_GONE);
      post({ type: 'done', entry: saved });
    } catch (err) {
      clearTimeout(idleTimer);
      if (disconnected) return;
      if (timedOut) return fail('network');
      const { code, message: text } = toExplainError(err);
      fail(code, text);
    }
  }
}
```

- [ ] **Step 9: Rewrite `src/entrypoints/background.ts`**

```ts
import { browser, defineBackground } from '#imports';
import { getApiKey, removeApiKey, setApiKey } from '@/lib/api-key';
import { createMessageHandler } from '@/lib/background/message-handler';
import { createSdkClient } from '@/lib/claude/client';
import { serveExplainPort, type ExplainPort } from '@/lib/claude/explain-service';
import { EXPLAIN_PORT } from '@/lib/claude/protocol';
import { takePendingSeek } from '@/lib/pending-seek';
import { appendFollowUp, findExplanation, getExplanation, saveExplanation } from '@/lib/study-log/store';

export default defineBackground(() => {
  const handle = createMessageHandler({
    getApiKey,
    setApiKey,
    removeApiKey,
    createClient: createSdkClient,
    findExplanation,
    takePendingSeek: (videoId) => takePendingSeek(videoId),
    openOptions: async (hash) => {
      await browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}${hash}` });
    },
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return undefined; // only LingoFlix's own pages and scripts
    // By URL, not by `sender.tab`: the options page opens in a tab too.
    const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(browser.runtime.getURL('/'));
    handle(message, { fromExtensionPage }).then(sendResponse, (err: unknown) => sendResponse({ error: String(err) }));
    return true; // respond asynchronously
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EXPLAIN_PORT || port.sender?.id !== browser.runtime.id) return;
    serveExplainPort(port as unknown as ExplainPort, {
      getApiKey,
      createClient: createSdkClient,
      saveExplanation: (fields) => saveExplanation(fields),
      getExplanation,
      appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
    });
  });
});
```

- [ ] **Step 10: Add `suggestions: []` to the remaining test fixtures**

In `tests/unit/explain-service.test.ts`, in the test `follow-up: replays the conversation and appends the Q&A to the entry`, replace

```ts
      explanationLanguage: 'ko',
      model: CLAUDE_MODEL,
    });
    const { client, calls } = fakeClient({ deltas: ['아니요.'] });
```

with

```ts
      explanationLanguage: 'ko',
      model: CLAUDE_MODEL,
      suggestions: [],
    });
    const { client, calls } = fakeClient({ deltas: ['아니요.'] });
```

In `tests/unit/background-messages.test.ts`, in the test `finds a saved explanation for a line`, replace

```ts
      explanationLanguage: 'en',
      model: 'm',
    });
```

with

```ts
      explanationLanguage: 'en',
      model: 'm',
      suggestions: [],
    });
```

In `tests/unit/study-log-tab.test.tsx`, in the `line` fixture, replace

```ts
  model: 'claude-sonnet-5-5',
  ...over,
});
```

with

```ts
  model: 'claude-sonnet-5-5',
  suggestions: [],
  ...over,
});
```

- [ ] **Step 11: Check nothing still uses the old names**

```bash
grep -rn "StudyLogEntry\|getEntry\|listEntries\|deleteEntries\|ENTRY_PREFIX\|indexKey(" src tests
grep -rn "findEntry" src tests
```

Expected: the first command prints nothing. The second prints only `src/entrypoints/netflix.content/overlay/explain-controller.ts`, `src/entrypoints/netflix.content/index.ts` and `tests/unit/explain-flow.test.ts` (the overlay dependency Task 9 renames).

- [ ] **Step 12: Run the whole suite and the type check**

Run: `pnpm test`
Expected: PASS, every test file (no behavior changed outside the new tests).

Run: `pnpm compile`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add src/lib/study-log/types.ts src/lib/study-log/store.ts src/lib/study-log/group.ts src/lib/messages.ts \
  src/lib/claude/protocol.ts src/lib/claude/prompt.ts src/lib/claude/explain-service.ts src/lib/background/message-handler.ts \
  src/entrypoints/background.ts src/entrypoints/options/StudyLogEntries.tsx src/entrypoints/options/StudyLogTab.tsx \
  src/entrypoints/netflix.content/overlay/explain-port.ts src/entrypoints/netflix.content/overlay/card-state.ts \
  src/entrypoints/netflix.content/overlay/explain-controller.ts \
  tests/unit/study-log.test.ts tests/unit/explain-service.test.ts tests/unit/background-messages.test.ts \
  tests/unit/study-log-tab.test.tsx tests/unit/card.test.tsx tests/unit/claude.test.ts tests/unit/explain-flow.test.ts
git commit -m "refactor(study-log): rename StudyLogEntry to Explanation and store save suggestions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 2: Saved items store, migration, Reset all

Spec: v2 spec §3.2 (saved items and their index), §3.3 (one-time conversion), §3.4 (Reset all), §4.1 (the card's
rows: Claude's suggestions with the line row last, or a "Whole line" row). Saved items are the new Study Log; their
source fields are always copied from the stored `Explanation`.

**Files:**
- Create: `src/lib/study-log/keys.ts` (every Study Log storage prefix in one place, so `store.ts` and `items.ts` don't import each other)
- Create: `src/lib/study-log/items.ts`
- Create: `src/lib/claude/suggestions.ts` (only `cardRows` in this task; Task 3 adds the rest of the file)
- Modify: `src/lib/study-log/types.ts` (add `SavedItem`, `isSavedItem`)
- Modify: `src/lib/study-log/store.ts` (prefixes come from `keys.ts`; `resetStudyLog` and `watchStudyLog` cover items)
- Test: `tests/unit/saved-items.test.ts` (create), `tests/unit/suggestions.test.ts` (create; Task 3 extends it)

**Interfaces:**
- Consumes (Task 1): `Explanation`, `NewExplanation`, `SaveSuggestion`, `ItemType`, `ITEM_TYPES`, `toExplanation` from `types.ts`; `saveExplanation`, `listExplanations`, `resetStudyLog`, `watchStudyLog` from `store.ts`.
- Produces (Interface Contract, `items.ts` section and `SavedItem`/`isSavedItem` in `types.ts`):
  - `items.ts`: `ITEM_PREFIX`, `ITEM_INDEX_PREFIX`, `MIGRATION_KEY` (re-exported from `keys.ts`), `itemIndexKey`, `suggestionKey`, `itemFromSuggestion`, `saveItem`, `unsaveItem`, `getItem`, `listItems`, `deleteItems`, `savedKeysFor`, `migrateStudyLogV2`.
  - **Signature note:** `migrateStudyLogV2(newId?: () => string): Promise<number>` takes no `now`. Each converted item is dated like the explanation it came from (`savedAt`/`updatedAt` copied), so the list keeps the order lines were explained in. Callers (Task 8, Task 10) call it with no arguments.
  - `suggestions.ts` (this task): `cardRows(suggestions: readonly SaveSuggestion[], line: string): SaveSuggestion[]`. Task 3 adds `SUGGEST_SAVES_TOOL_NAME`, `SUGGEST_SAVES_TOOL`, `MAX_SUGGESTIONS`, `validateSuggestions` to the same file.
  - `store.ts`: `EXPLANATION_PREFIX` and `EXPLANATION_INDEX_PREFIX` are still exported from `store.ts` (re-exported from `keys.ts`); `resetStudyLog` now removes `log:`, `logkey:`, `item:`, `itemkey:` keys but keeps the API key, every other key and `migration:study-log-v2`; `watchStudyLog` fires on `log:` and `item:` changes.
  - Conversion rule: only explanation records **without a `suggestions` field** are converted (they were saved by the old explain-equals-save Study Log). Records written by v2 always carry `suggestions` and stay history only. Once `migration:study-log-v2` is `true`, the conversion does nothing.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/suggestions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cardRows } from '@/lib/claude/suggestions';
import type { SaveSuggestion } from '@/lib/study-log/types';

const LINE = "I'm gonna\ncall it a night.";
const IDIOM: SaveSuggestion = { type: 'idiom', text: 'call it a night', meaning: 'end the evening' };
const WORD: SaveSuggestion = { type: 'word', text: 'gonna', meaning: 'going to' };

describe('cardRows (v2 spec §4.1)', () => {
  it("keeps Claude's order and puts the line suggestion last, with its meaning", () => {
    expect(cardRows([{ type: 'line', text: LINE, meaning: 'Time for bed.' }, IDIOM, WORD], LINE)).toEqual([
      IDIOM,
      WORD,
      { type: 'line', text: LINE, meaning: 'Time for bed.' },
    ]);
  });

  it('adds a Whole line row without a meaning when Claude suggested no line', () => {
    expect(cardRows([WORD], LINE)).toEqual([WORD, { type: 'line', text: LINE, meaning: '' }]);
    expect(cardRows([], LINE)).toEqual([{ type: 'line', text: LINE, meaning: '' }]);
  });
});
```

Create `tests/unit/saved-items.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { cardRows } from '@/lib/claude/suggestions';
import {
  MIGRATION_KEY,
  deleteItems,
  getItem,
  itemFromSuggestion,
  itemIndexKey,
  listItems,
  migrateStudyLogV2,
  saveItem,
  savedKeysFor,
  suggestionKey,
  unsaveItem,
} from '@/lib/study-log/items';
import { listExplanations, resetStudyLog, saveExplanation, watchStudyLog } from '@/lib/study-log/store';
import { isSavedItem, type Explanation, type NewExplanation, type SaveSuggestion } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());

const IDIOM: SaveSuggestion = { type: 'idiom', text: 'call it a night', meaning: 'end the evening' };
const WORD: SaveSuggestion = { type: 'word', text: 'gonna', meaning: 'going to' };
const NOW = new Date('2026-10-10T21:41:00Z');

const fields = (over: Partial<NewExplanation> = {}): NewExplanation => ({
  phrase: "I'm gonna call it a night.",
  response: '## Meaning\nTime to sleep.',
  videoTimeMs: 1_834_200,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: ['Where are you going?'], after: ['Night.'] },
  explanationLanguage: 'ko',
  model: 'claude-sonnet-5-5',
  suggestions: [IDIOM, WORD],
  ...over,
});

/** An explanation as the background would have it (saving items doesn't read it from storage). */
const explanationOf = (over: Partial<NewExplanation> = {}, id = 'log-1'): Explanation => ({
  ...fields(over),
  id,
  followUps: [],
  savedAt: '2026-10-10T21:40:00.000Z',
  updatedAt: '2026-10-10T21:40:00.000Z',
});

const stored = async (key: string): Promise<unknown> => (await fakeBrowser.storage.local.get(key))[key];

describe('saved items (v2 spec §3.2)', () => {
  it('saves a suggestion as an item whose source fields come from the explanation', async () => {
    const explanation = explanationOf();
    const item = await saveItem(explanation, IDIOM, NOW, () => 'item-1');
    expect(item).toEqual({
      id: 'item-1',
      type: 'idiom',
      text: 'call it a night',
      meaning: 'end the evening',
      explanationId: 'log-1',
      line: "I'm gonna call it a night.",
      lineTimeMs: 1_834_200,
      context: { before: ['Where are you going?'], after: ['Night.'] },
      videoId: '80077211',
      kind: 'episode',
      seriesId: '80057281',
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      episodeTitle: 'Holly, Jolly',
      explanationLanguage: 'ko',
      savedAt: '2026-10-10T21:41:00.000Z',
      updatedAt: '2026-10-10T21:41:00.000Z',
    });
    expect(await getItem('item-1')).toEqual(item);
    expect(await stored(suggestionKey(explanation, IDIOM))).toBe('item-1');
    expect(itemFromSuggestion(explanation, IDIOM, NOW, 'item-1')).toEqual(item);
  });

  it('builds index keys that ignore case and spacing', () => {
    expect(itemIndexKey('1', "I'm  GONNA\ncall it", 'word', ' Gonna ')).toBe("itemkey:1|i'm gonna call it|word|gonna");
  });

  it('saving the same suggestion of the same line again returns the item already saved', async () => {
    const explanation = explanationOf();
    const first = await saveItem(explanation, IDIOM, NOW, () => 'item-1');
    const again = await saveItem(explanation, { type: 'idiom', text: 'Call It  a NIGHT', meaning: 'changed' }, NOW, () => 'item-2');
    // The same line explained in another language is still the same line.
    const otherLanguage = await saveItem(explanationOf({ explanationLanguage: 'en' }, 'log-2'), IDIOM, NOW, () => 'item-3');
    expect(again).toEqual(first);
    expect(otherLanguage).toEqual(first);
    expect((await listItems()).map((i) => i.id)).toEqual(['item-1']);
  });

  it('the same word from another line is a separate item', async () => {
    const a = explanationOf({}, 'log-a');
    const b = explanationOf({ phrase: "We're gonna be late.", videoTimeMs: 5000 }, 'log-b');
    await saveItem(a, WORD, NOW, () => 'item-a');
    const fromB = await saveItem(b, WORD, NOW, () => 'item-b');
    expect(fromB).toMatchObject({ id: 'item-b', text: 'gonna', line: "We're gonna be late.", lineTimeMs: 5000, explanationId: 'log-b' });
    expect((await listItems()).map((i) => i.line).sort()).toEqual(["I'm gonna call it a night.", "We're gonna be late."]);
  });

  it('a whole-line row is saved with the line itself as its text', async () => {
    const explanation = explanationOf();
    const item = await saveItem(explanation, { type: 'line', text: 'whatever Claude wrote', meaning: 'Time for bed.' }, NOW, () => 'item-1');
    expect(item).toMatchObject({ type: 'line', text: explanation.phrase, line: explanation.phrase, meaning: 'Time for bed.' });
    expect(suggestionKey(explanation, { type: 'line', text: 'anything' })).toBe(
      itemIndexKey('80077211', explanation.phrase, 'line', explanation.phrase),
    );
  });

  it('a lookup key left pointing at a missing item is replaced by a new item', async () => {
    const explanation = explanationOf();
    await fakeBrowser.storage.local.set({ [suggestionKey(explanation, WORD)]: 'gone' });
    const item = await saveItem(explanation, WORD, NOW, () => 'item-1');
    expect(item.id).toBe('item-1');
    expect(await stored(suggestionKey(explanation, WORD))).toBe('item-1');
  });

  it('unsave removes the item and its lookup key; unsaving something not saved does nothing', async () => {
    const explanation = explanationOf();
    await saveItem(explanation, IDIOM, NOW, () => 'item-1');
    await unsaveItem(explanation, { type: 'idiom', text: 'call it a night' });
    expect(await getItem('item-1')).toBeNull();
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
    await unsaveItem(explanation, WORD);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it("lists the saved rows' keys, including the Whole line row when Claude suggested no line", async () => {
    const explanation = explanationOf({ suggestions: [IDIOM, WORD] });
    expect(await savedKeysFor(explanation)).toEqual([]);
    await saveItem(explanation, WORD, NOW, () => 'w');
    await saveItem(explanation, { type: 'line', text: explanation.phrase, meaning: '' }, NOW, () => 'l');
    const rows = cardRows(explanation.suggestions, explanation.phrase);
    expect(rows.map((r) => r.type)).toEqual(['idiom', 'word', 'line']);
    expect(await savedKeysFor(explanation)).toEqual([suggestionKey(explanation, WORD), suggestionKey(explanation, rows[2]!)]);
  });

  it('lists items and skips corrupt records', async () => {
    await fakeBrowser.storage.local.set({ 'item:bad': { id: 'bad', type: 'sentence' }, 'item:worse': 'text' });
    await saveItem(explanationOf(), WORD, NOW, () => 'item-1');
    expect((await listItems()).map((i) => i.id)).toEqual(['item-1']);
    expect(await getItem('bad')).toBeNull();
  });

  it('deleteItems removes the items and only the lookup keys that still point at them', async () => {
    const explanation = explanationOf();
    await saveItem(explanation, IDIOM, NOW, () => 'a');
    const b = await saveItem(explanation, WORD, NOW, () => 'b');
    await deleteItems(['a']);
    expect(await getItem('a')).toBeNull();
    expect(await stored(suggestionKey(explanation, IDIOM))).toBeUndefined();
    expect(await getItem('b')).toEqual(b);
    await fakeBrowser.storage.local.set({ [suggestionKey(explanation, WORD)]: 'someone-else' });
    await deleteItems(['b']);
    expect(await getItem('b')).toBeNull();
    expect(await stored(suggestionKey(explanation, WORD))).toBe('someone-else');
    await deleteItems([]);
  });

  it('recognizes a saved item, including one from a movie or with no explanation', () => {
    const valid = itemFromSuggestion(explanationOf(), IDIOM, NOW, 'x');
    expect(isSavedItem(valid)).toBe(true);
    expect(
      isSavedItem({ ...valid, kind: 'movie', explanationId: null, seriesId: null, seasonNumber: null, episodeNumber: null, episodeTitle: null }),
    ).toBe(true);
    for (const bad of [
      { ...valid, type: 'sentence' },
      { ...valid, lineTimeMs: Number.NaN },
      { ...valid, context: { before: [1], after: [] } },
      { ...valid, explanationId: 5 },
      { ...valid, meaning: undefined },
      'item',
      null,
    ]) {
      expect(isSavedItem(bad)).toBe(false);
    }
  });

  it('watchStudyLog also reports saved-item changes', async () => {
    const changed = vi.fn();
    const stop = watchStudyLog(changed);
    await fakeBrowser.storage.local.set({ unrelated: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(changed).not.toHaveBeenCalled();
    await saveItem(explanationOf(), WORD, NOW, () => 'item-1');
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    stop();
  });

  it('Reset all removes explanations and saved items, and keeps the API key, other keys and the migration marker', async () => {
    await fakeBrowser.storage.local.set({ apiKey: 'sk-ant-secret', other: 1, [MIGRATION_KEY]: true });
    const explanation = await saveExplanation(fields(), NOW, () => 'log-1');
    await saveItem(explanation, IDIOM, NOW, () => 'item-1');
    await resetStudyLog();
    expect(await listItems()).toEqual([]);
    expect(await listExplanations()).toEqual([]);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ apiKey: 'sk-ant-secret', other: 1, [MIGRATION_KEY]: true });
  });
});

describe('migrateStudyLogV2 (v2 spec §3.3)', () => {
  /** An explanation as the Study Log stored it before v2: no `suggestions` field. */
  const preV2 = (id: string, over: Partial<NewExplanation> = {}) => {
    const { suggestions: _none, ...rest } = fields(over);
    return { ...rest, id, followUps: [], savedAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-02T09:00:00.000Z' };
  };
  const counter = (prefix: string) => {
    let n = 0;
    return () => `${prefix}-${++n}`;
  };

  it('turns every explanation saved before v2 into a saved whole-line item, once', async () => {
    await fakeBrowser.storage.local.set({
      'log:old-1': preV2('old-1'),
      'log:old-2': preV2('old-2', { phrase: 'Where are you going?', videoTimeMs: 1000 }),
    });
    expect(await migrateStudyLogV2(counter('item'))).toBe(2);
    const items = await listItems();
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.explanationId === 'old-1')).toMatchObject({
      type: 'line',
      text: "I'm gonna call it a night.",
      line: "I'm gonna call it a night.",
      meaning: '',
      lineTimeMs: 1_834_200,
      context: { before: ['Where are you going?'], after: ['Night.'] },
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      explanationLanguage: 'ko',
      savedAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
    });
    expect(await stored(MIGRATION_KEY)).toBe(true);
    expect(await migrateStudyLogV2(counter('again'))).toBe(0);
    expect(await listItems()).toHaveLength(2);
  });

  it('never converts explanations written by v2 (they are history only)', async () => {
    await saveExplanation(fields(), NOW, () => 'log-1');
    expect(await migrateStudyLogV2()).toBe(0);
    expect(await listItems()).toEqual([]);
    expect(await stored(MIGRATION_KEY)).toBe(true);
  });

  it('does nothing once it has run', async () => {
    await migrateStudyLogV2();
    await fakeBrowser.storage.local.set({ 'log:late': preV2('late') });
    expect(await migrateStudyLogV2()).toBe(0);
    expect(await listItems()).toEqual([]);
  });

  it('skips a line that already has a saved whole-line item (an interrupted run)', async () => {
    await fakeBrowser.storage.local.set({ 'log:old-1': preV2('old-1') });
    const [explanation] = await listExplanations();
    await saveItem(explanation!, { type: 'line', text: explanation!.phrase, meaning: '' }, NOW, () => 'kept');
    expect(await migrateStudyLogV2()).toBe(0);
    expect((await listItems()).map((i) => i.id)).toEqual(['kept']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/saved-items.test.ts tests/unit/suggestions.test.ts`
Expected: FAIL. Both files fail to load because the modules don't exist yet: `Error: Cannot find package '@/lib/claude/suggestions'` (and no tests run).

- [ ] **Step 3: Create `src/lib/claude/suggestions.ts` with the card rows**

Task 3 adds the tool and the validation to this file.

```ts
import type { SaveSuggestion } from '@/lib/study-log/types';

/**
 * The card's Save rows (v2 spec §4.1): Claude's suggestions in order, the `line` one last. When Claude suggested
 * no line, a Whole line row without a meaning; the line can always be saved.
 */
export function cardRows(suggestions: readonly SaveSuggestion[], line: string): SaveSuggestion[] {
  const lineSuggestion = suggestions.find((s) => s.type === 'line');
  return [...suggestions.filter((s) => s.type !== 'line'), { type: 'line', text: line, meaning: lineSuggestion?.meaning ?? '' }];
}
```

- [ ] **Step 4: Add `SavedItem` to `src/lib/study-log/types.ts`**

Append to the end of the file (after `toExplanation`):

```ts
/** One saved item: the Study Log (v2 spec §3.2). Its source fields are copied from the explanation. */
export interface SavedItem {
  id: string;
  type: ItemType;
  /** The word, phrase or idiom as it appears in the line; for `line`, the whole line. */
  text: string;
  /** Short meaning in `explanationLanguage`; may be ''. */
  meaning: string;
  /** The explanation it came from; null when that record is gone or was never imported. */
  explanationId: string | null;
  /** The full subtitle line. */
  line: string;
  /** Episode time where the line starts. */
  lineTimeMs: number;
  context: DialogueContext;
  videoId: string;
  kind: 'episode' | 'movie';
  seriesId: string | null;
  /** Series title, or the movie title. */
  seriesTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  explanationLanguage: string;
  savedAt: string;
  updatedAt: string;
}

const isNullableString = (value: unknown) => value === null || typeof value === 'string';
const isNullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));

export function isSavedItem(value: unknown): value is SavedItem {
  if (!isRecord(value)) return false;
  const v = value;
  return (
    typeof v.id === 'string' &&
    ITEM_TYPES.includes(v.type as ItemType) &&
    typeof v.text === 'string' &&
    typeof v.meaning === 'string' &&
    isNullableString(v.explanationId) &&
    typeof v.line === 'string' &&
    typeof v.lineTimeMs === 'number' &&
    Number.isFinite(v.lineTimeMs) &&
    isRecord(v.context) &&
    isStringArray(v.context.before) &&
    isStringArray(v.context.after) &&
    typeof v.videoId === 'string' &&
    (v.kind === 'episode' || v.kind === 'movie') &&
    isNullableString(v.seriesId) &&
    typeof v.seriesTitle === 'string' &&
    isNullableNumber(v.seasonNumber) &&
    isNullableNumber(v.episodeNumber) &&
    isNullableString(v.episodeTitle) &&
    typeof v.explanationLanguage === 'string' &&
    typeof v.savedAt === 'string' &&
    typeof v.updatedAt === 'string'
  );
}
```

- [ ] **Step 5: Create `src/lib/study-log/keys.ts`**

```ts
// Storage keys of the Study Log (v2 spec §3), in one place so the explanation store and the item store don't
// import each other.

/** `log:{id}` holds an explanation. */
export const EXPLANATION_PREFIX = 'log:';
/** `logkey:{videoId}|{language}|{normalized line}` holds the id of that line's explanation. */
export const EXPLANATION_INDEX_PREFIX = 'logkey:';
/** `item:{id}` holds a saved item. */
export const ITEM_PREFIX = 'item:';
/** `itemkey:{videoId}|{line}|{type}|{text}` (normalized, lowercased) holds the id of that saved item. */
export const ITEM_INDEX_PREFIX = 'itemkey:';
/** `true` once the explanations saved before v2 have become saved whole-line items. */
export const MIGRATION_KEY = 'migration:study-log-v2';
```

- [ ] **Step 6: Point `src/lib/study-log/store.ts` at the shared keys and cover items in Reset all and the watcher**

Replace

```ts
import { toExplanation, type Explanation, type FollowUp, type NewExplanation } from './types';

/** `log:{id}` holds an explanation (v2 spec §3.1). */
export const EXPLANATION_PREFIX = 'log:';
/** `logkey:{videoId}|{language}|{normalized line}` holds the id of that line's explanation. */
export const EXPLANATION_INDEX_PREFIX = 'logkey:';
```

with

```ts
import { EXPLANATION_INDEX_PREFIX, EXPLANATION_PREFIX, ITEM_INDEX_PREFIX, ITEM_PREFIX } from './keys';
import { toExplanation, type Explanation, type FollowUp, type NewExplanation } from './types';

export { EXPLANATION_INDEX_PREFIX, EXPLANATION_PREFIX } from './keys';
```

Replace

```ts
/** Main spec §5.5 Reset all: every explanation and lookup key, nothing else (the API key stays). */
export async function resetStudyLog(): Promise<void> {
  const keys = Object.keys(await browser.storage.local.get(null)).filter(
    (key) => key.startsWith(EXPLANATION_PREFIX) || key.startsWith(EXPLANATION_INDEX_PREFIX),
  );
  if (keys.length > 0) await browser.storage.local.remove(keys);
}

/** Calls back whenever any explanation is added, changed, or removed (e.g. from a Netflix tab). */
export function watchStudyLog(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(EXPLANATION_PREFIX))) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
```

with

```ts
const STUDY_LOG_PREFIXES = [EXPLANATION_PREFIX, EXPLANATION_INDEX_PREFIX, ITEM_PREFIX, ITEM_INDEX_PREFIX];

/**
 * v2 spec §3.4 Reset all: the explanation history and the saved items, with their lookup keys. Nothing else:
 * the API key stays, and so does the migration marker (otherwise later explanations would be converted).
 */
export async function resetStudyLog(): Promise<void> {
  const keys = Object.keys(await browser.storage.local.get(null)).filter((key) =>
    STUDY_LOG_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
  if (keys.length > 0) await browser.storage.local.remove(keys);
}

/** Calls back whenever an explanation or a saved item is added, changed, or removed (e.g. from a Netflix tab). */
export function watchStudyLog(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((key) => key.startsWith(EXPLANATION_PREFIX) || key.startsWith(ITEM_PREFIX))) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
```

- [ ] **Step 7: Create `src/lib/study-log/items.ts`**

```ts
import { browser } from '#imports';
import { cardRows } from '@/lib/claude/suggestions';
import { normalizeLine } from '@/lib/subtitles/cue';
import { EXPLANATION_PREFIX, ITEM_INDEX_PREFIX, ITEM_PREFIX, MIGRATION_KEY } from './keys';
import { isSavedItem, toExplanation, type Explanation, type ItemType, type SaveSuggestion, type SavedItem } from './types';

export { ITEM_INDEX_PREFIX, ITEM_PREFIX, MIGRATION_KEY } from './keys';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const itemKey = (id: string) => `${ITEM_PREFIX}${id}`;
/** Comparable form for lookup keys: case, spacing and line breaks don't matter. */
const fold = (text: string) => normalizeLine(text).toLowerCase();

export function itemIndexKey(videoId: string, line: string, type: ItemType, text: string): string {
  return `${ITEM_INDEX_PREFIX}${videoId}|${fold(line)}|${type}|${fold(text)}`;
}

/** The lookup key a card row would have: `line` rows use the explanation's phrase as their text. */
export function suggestionKey(
  explanation: Pick<Explanation, 'videoId' | 'phrase'>,
  suggestion: Pick<SaveSuggestion, 'type' | 'text'>,
): string {
  const text = suggestion.type === 'line' ? explanation.phrase : suggestion.text;
  return itemIndexKey(explanation.videoId, explanation.phrase, suggestion.type, text);
}

const indexKeyOf = (item: Pick<SavedItem, 'videoId' | 'line' | 'type' | 'text'>) =>
  itemIndexKey(item.videoId, item.line, item.type, item.text);

/** The item `suggestion` becomes. Every source field comes from the stored explanation, never from the page. */
export function itemFromSuggestion(explanation: Explanation, suggestion: SaveSuggestion, now: Date, id: string): SavedItem {
  const stamp = now.toISOString();
  return {
    id,
    type: suggestion.type,
    text: suggestion.type === 'line' ? explanation.phrase : suggestion.text,
    meaning: suggestion.meaning,
    explanationId: explanation.id,
    line: explanation.phrase,
    lineTimeMs: explanation.videoTimeMs,
    context: { before: [...explanation.context.before], after: [...explanation.context.after] },
    videoId: explanation.videoId,
    kind: explanation.kind,
    seriesId: explanation.seriesId,
    seriesTitle: explanation.seriesTitle,
    seasonNumber: explanation.seasonNumber,
    episodeNumber: explanation.episodeNumber,
    episodeTitle: explanation.episodeTitle,
    explanationLanguage: explanation.explanationLanguage,
    savedAt: stamp,
    updatedAt: stamp,
  };
}

export async function getItem(id: string): Promise<SavedItem | null> {
  const key = itemKey(id);
  const value = (await browser.storage.local.get(key))[key];
  return isSavedItem(value) ? value : null;
}

export async function listItems(): Promise<SavedItem[]> {
  const all = await browser.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ITEM_PREFIX))
    .map(([, value]) => value)
    .filter(isSavedItem);
}

/** Saves `suggestion` of `explanation`. Saving it again (same line, type and text) returns the item already saved. */
export async function saveItem(
  explanation: Explanation,
  suggestion: SaveSuggestion,
  now: Date = new Date(),
  newId: () => string = () => crypto.randomUUID(),
): Promise<SavedItem> {
  const indexKey = suggestionKey(explanation, suggestion);
  const existingId = (await browser.storage.local.get(indexKey))[indexKey];
  if (typeof existingId === 'string') {
    const existing = await getItem(existingId);
    if (existing) return existing;
  }
  const item = itemFromSuggestion(explanation, suggestion, now, newId());
  await browser.storage.local.set({ [itemKey(item.id)]: item, [indexKey]: item.id });
  return item;
}

/** Removes the item `suggestion` of `explanation` was saved as, with its lookup key. Nothing saved: no-op. */
export async function unsaveItem(
  explanation: Pick<Explanation, 'videoId' | 'phrase'>,
  suggestion: Pick<SaveSuggestion, 'type' | 'text'>,
): Promise<void> {
  const indexKey = suggestionKey(explanation, suggestion);
  const id = (await browser.storage.local.get(indexKey))[indexKey];
  if (typeof id !== 'string') return;
  await browser.storage.local.remove([indexKey, itemKey(id)]);
}

/** Removes items and the lookup keys that still point at them (a key re-pointed at another item stays). */
export async function deleteItems(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const keys = ids.map(itemKey);
  const items = Object.values(await browser.storage.local.get(keys)).filter(isSavedItem);
  const indexes = await browser.storage.local.get(items.map(indexKeyOf));
  const ownIndexes = Object.entries(indexes)
    .filter(([, id]) => typeof id === 'string' && ids.includes(id))
    .map(([key]) => key);
  await browser.storage.local.remove([...keys, ...ownIndexes]);
}

/** Lookup keys of the card rows (`cardRows`) of this explanation that are saved, in row order. */
export async function savedKeysFor(explanation: Explanation): Promise<string[]> {
  const keys = [...new Set(cardRows(explanation.suggestions, explanation.phrase).map((row) => suggestionKey(explanation, row)))];
  const saved = await browser.storage.local.get(keys);
  return keys.filter((key) => typeof saved[key] === 'string');
}

/**
 * v2 spec §3.3: before v2 every explanation was in the Study Log, so each one saved then (a record without a
 * `suggestions` field) becomes a saved whole-line item, dated like its explanation. Explanations written by v2
 * stay history only. Runs once (MIGRATION_KEY); a rerun after an interruption skips lines already saved.
 */
export async function migrateStudyLogV2(newId: () => string = () => crypto.randomUUID()): Promise<number> {
  const all = await browser.storage.local.get(null);
  if (all[MIGRATION_KEY] === true) return 0;
  const writes: Record<string, unknown> = {};
  let created = 0;
  for (const [key, raw] of Object.entries(all)) {
    if (!key.startsWith(EXPLANATION_PREFIX) || (isRecord(raw) && 'suggestions' in raw)) continue;
    const explanation = toExplanation(raw);
    if (!explanation) continue;
    const row: SaveSuggestion = { type: 'line', text: explanation.phrase, meaning: '' };
    const indexKey = suggestionKey(explanation, row);
    if (typeof all[indexKey] === 'string' || indexKey in writes) continue;
    const item: SavedItem = {
      ...itemFromSuggestion(explanation, row, new Date(), newId()),
      savedAt: explanation.savedAt,
      updatedAt: explanation.updatedAt,
    };
    writes[itemKey(item.id)] = item;
    writes[indexKey] = item.id;
    created++;
  }
  writes[MIGRATION_KEY] = true;
  await browser.storage.local.set(writes);
  return created;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/saved-items.test.ts tests/unit/suggestions.test.ts tests/unit/study-log.test.ts`
Expected: PASS (all tests in the three files).

- [ ] **Step 9: Run the whole suite and the type check**

Run: `pnpm test`
Expected: PASS, every test file.

Run: `pnpm compile`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/study-log/keys.ts src/lib/study-log/items.ts src/lib/study-log/types.ts src/lib/study-log/store.ts \
  src/lib/claude/suggestions.ts tests/unit/saved-items.test.ts tests/unit/suggestions.test.ts
git commit -m "feat(study-log): saved items store with one-time conversion of existing lines" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 3: Suggestions: the `suggest_saves` tool, validation, card rows

Spec: v2 spec §5.3 (the tool, exactly as written there) and §5.4 (validation). The background calls
`validateSuggestions` on Claude's tool input before anything is stored or shown (Task 7); the card uses `cardRows`
(Task 2). This file must not import the Anthropic SDK or anything that does: the Netflix content script bundles it.

**Files:**
- Modify (rewrite): `src/lib/claude/suggestions.ts` (Task 2 created it with `cardRows` only)
- Test (rewrite): `tests/unit/suggestions.test.ts` (keeps Task 2's `cardRows` tests)

**Interfaces:**
- Consumes (Task 1): `ITEM_TYPES`, `ItemType`, `SaveSuggestion` from `@/lib/study-log/types`; `normalizeLine` from `@/lib/subtitles/cue`. Keeps Task 2's `cardRows` unchanged.
- Produces (Interface Contract, `suggestions.ts` section): `SUGGEST_SAVES_TOOL_NAME = 'suggest_saves'`, `MAX_SUGGESTIONS = 6`, `SUGGEST_SAVES_TOOL`, `validateSuggestions(toolInput: unknown, line: string): SaveSuggestion[]`, `cardRows` (from Task 2).
  - **Type note:** `ToolDefinition` doesn't exist until Task 6 adds it to `client.ts`, so `SUGGEST_SAVES_TOOL` is typed here with a private `ToolShape` (`{ name: string; description: string; input_schema: Record<string, unknown> }`), structurally identical. Task 6 may replace `ToolShape` with `import type { ToolDefinition } from './client'` (type-only, so no SDK code reaches the content script).
  - Validation rules (the exact behavior later tasks rely on):
    - Input without an `items` array gives `[]`. Each item must be an object with `type` in `word | phrase | idiom | line` and string `text` and `meaning`; anything else is dropped.
    - `word`/`phrase`/`idiom`: `text` is trimmed and must be non-empty, at most 120 characters, and appear in the line ignoring case, spacing and line breaks. The trimmed text is kept as Claude wrote it.
    - `line`: `text` is replaced by the line itself (any string Claude sent is accepted, and the 120-character limit doesn't apply to it).
    - `meaning` is trimmed and cut at 200 characters (cut, not dropped).
    - The first of two suggestions with the same type and text (ignoring case and spacing) wins, so there is at most one `line`. Items are processed in order and at most 6 valid ones are kept (invalid ones don't count toward the 6).

- [ ] **Step 1: Write the failing tests**

Replace `tests/unit/suggestions.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_SUGGESTIONS, SUGGEST_SAVES_TOOL, SUGGEST_SAVES_TOOL_NAME, cardRows, validateSuggestions } from '@/lib/claude/suggestions';
import type { SaveSuggestion } from '@/lib/study-log/types';

const LINE = "I'm gonna\ncall it a night.";
const IDIOM: SaveSuggestion = { type: 'idiom', text: 'call it a night', meaning: 'end the evening' };
const WORD: SaveSuggestion = { type: 'word', text: 'gonna', meaning: 'going to' };
const input = (...items: unknown[]) => ({ items });

describe('cardRows (v2 spec §4.1)', () => {
  it("keeps Claude's order and puts the line suggestion last, with its meaning", () => {
    expect(cardRows([{ type: 'line', text: LINE, meaning: 'Time for bed.' }, IDIOM, WORD], LINE)).toEqual([
      IDIOM,
      WORD,
      { type: 'line', text: LINE, meaning: 'Time for bed.' },
    ]);
  });

  it('adds a Whole line row without a meaning when Claude suggested no line', () => {
    expect(cardRows([WORD], LINE)).toEqual([WORD, { type: 'line', text: LINE, meaning: '' }]);
    expect(cardRows([], LINE)).toEqual([{ type: 'line', text: LINE, meaning: '' }]);
  });
});

describe('the suggest_saves tool (v2 spec §5.3)', () => {
  it('is exactly the tool in the spec', () => {
    expect(SUGGEST_SAVES_TOOL_NAME).toBe('suggest_saves');
    expect(MAX_SUGGESTIONS).toBe(6);
    expect(SUGGEST_SAVES_TOOL).toEqual({
      name: 'suggest_saves',
      description: 'Save suggestions for the learner: items from the subtitle line worth studying.',
      input_schema: {
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
            },
          },
        },
        required: ['items'],
      },
    });
  });
});

describe('validateSuggestions (v2 spec §5.4)', () => {
  it('keeps valid suggestions in order, with text and meaning trimmed', () => {
    expect(
      validateSuggestions(input({ type: 'idiom', text: '  call it a night ', meaning: ' end the evening ' }, { ...WORD }), LINE),
    ).toEqual([IDIOM, WORD]);
  });

  it('finds the text in the line whatever its case, spacing or line breaks, and keeps it as written', () => {
    expect(validateSuggestions(input({ type: 'phrase', text: 'GONNA  call', meaning: 'm' }), LINE)).toEqual([
      { type: 'phrase', text: 'GONNA  call', meaning: 'm' },
    ]);
  });

  it('drops text that is empty, longer than 120 characters, or not in the line', () => {
    const long = 'word '.repeat(30).trim(); // 149 characters, and in the line below
    expect(
      validateSuggestions(
        input(
          { type: 'word', text: '   ', meaning: 'm' },
          { type: 'word', text: 'tomorrow', meaning: 'm' },
          { type: 'phrase', text: long, meaning: 'm' },
        ),
        `${long} gonna`,
      ),
    ).toEqual([]);
  });

  it('drops unknown types and items without string text and meaning', () => {
    expect(
      validateSuggestions(
        input(
          { type: 'slang', text: 'gonna', meaning: 'm' },
          { type: 'word', text: 5, meaning: 'm' },
          { type: 'word', text: 'gonna' },
          { text: 'gonna', meaning: 'm' },
          'gonna',
          null,
          WORD,
        ),
        LINE,
      ),
    ).toEqual([WORD]);
  });

  it('returns no suggestions for input without an items array', () => {
    for (const bad of [undefined, null, 'items', [], {}, { items: 'gonna' }]) {
      expect(validateSuggestions(bad, LINE)).toEqual([]);
    }
  });

  it("uses the line itself as a line suggestion's text, whatever Claude wrote, even past 120 characters", () => {
    const longLine = `${'so '.repeat(50)}gonna`; // 155 characters
    expect(validateSuggestions(input({ type: 'line', text: 'something else', meaning: ' Time for bed. ' }), longLine)).toEqual([
      { type: 'line', text: longLine, meaning: 'Time for bed.' },
    ]);
  });

  it('keeps the first of duplicates (same type and text, any case or spacing), so at most one line', () => {
    expect(
      validateSuggestions(
        input(
          WORD,
          { type: 'word', text: ' GONNA ', meaning: 'other' },
          { type: 'phrase', text: 'gonna', meaning: 'as a phrase' },
          { type: 'line', text: LINE, meaning: 'first' },
          { type: 'line', text: 'x', meaning: 'second' },
        ),
        LINE,
      ),
    ).toEqual([WORD, { type: 'phrase', text: 'gonna', meaning: 'as a phrase' }, { type: 'line', text: LINE, meaning: 'first' }]);
  });

  it("keeps at most 6 valid suggestions; invalid ones don't count", () => {
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
    const result = validateSuggestions(
      input({ type: 'word', text: 'nine', meaning: 'm' }, ...words.map((text) => ({ type: 'word', text, meaning: 'm' }))),
      words.join(' '),
    );
    expect(result.map((s) => s.text)).toEqual(['one', 'two', 'three', 'four', 'five', 'six']);
  });

  it('cuts meanings at 200 characters', () => {
    const [only] = validateSuggestions(input({ ...WORD, meaning: 'x'.repeat(250) }), LINE);
    expect(only?.meaning).toBe('x'.repeat(200));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/suggestions.test.ts`
Expected: FAIL. The `cardRows` tests pass; the tool test fails because `SUGGEST_SAVES_TOOL_NAME` is `undefined`, and every `validateSuggestions` test fails with `TypeError: validateSuggestions is not a function`.

- [ ] **Step 3: Rewrite `src/lib/claude/suggestions.ts`**

```ts
import { ITEM_TYPES, type ItemType, type SaveSuggestion } from '@/lib/study-log/types';
import { normalizeLine } from '@/lib/subtitles/cue';

// Bundled into the Netflix content script (the card uses cardRows): never import the Anthropic SDK here.

export const SUGGEST_SAVES_TOOL_NAME = 'suggest_saves';
export const MAX_SUGGESTIONS = 6;
const MAX_TEXT_CHARS = 120;
const MAX_MEANING_CHARS = 200;

/** The shape of a Messages API tool definition, as the Claude client sends it. */
interface ToolShape {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** v2 spec §5.3, exactly. Claude calls it once, after the explanation. */
export const SUGGEST_SAVES_TOOL: ToolShape = {
  name: SUGGEST_SAVES_TOOL_NAME,
  description: 'Save suggestions for the learner: items from the subtitle line worth studying.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: MAX_SUGGESTIONS,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...ITEM_TYPES] },
            text: { type: 'string' },
            meaning: { type: 'string' },
          },
          required: ['type', 'text', 'meaning'],
        },
      },
    },
    required: ['items'],
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Comparable form: case, spacing and line breaks don't matter. */
const fold = (text: string) => normalizeLine(text).toLowerCase();

/**
 * Claude's `suggest_saves` input, checked (v2 spec §5.4); anything invalid is dropped silently.
 * - The type must be word, phrase, idiom or line, and text and meaning must be strings.
 * - Word, phrase and idiom text is trimmed and must be non-empty, at most 120 characters, and appear in the line
 *   (ignoring case, spacing and line breaks). A line suggestion's text is replaced by the line itself.
 * - Meanings are trimmed and cut at 200 characters.
 * - The first of two suggestions with the same type and text wins (so at most one line); at most 6 are kept.
 */
export function validateSuggestions(toolInput: unknown, line: string): SaveSuggestion[] {
  const items = isRecord(toolInput) && Array.isArray(toolInput.items) ? toolInput.items : [];
  const foldedLine = fold(line);
  const seen = new Set<string>();
  const valid: SaveSuggestion[] = [];
  for (const raw of items) {
    if (valid.length >= MAX_SUGGESTIONS) break;
    if (!isRecord(raw)) continue;
    const { type, text, meaning } = raw;
    if (!ITEM_TYPES.includes(type as ItemType) || typeof text !== 'string' || typeof meaning !== 'string') continue;
    const itemType = type as ItemType;
    const itemText = itemType === 'line' ? line : text.trim();
    if (itemType !== 'line' && (!itemText || itemText.length > MAX_TEXT_CHARS || !foldedLine.includes(fold(itemText)))) continue;
    const key = `${itemType}|${fold(itemText)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ type: itemType, text: itemText, meaning: meaning.trim().slice(0, MAX_MEANING_CHARS) });
  }
  return valid;
}

/**
 * The card's Save rows (v2 spec §4.1): Claude's suggestions in order, the `line` one last. When Claude suggested
 * no line, a Whole line row without a meaning; the line can always be saved.
 */
export function cardRows(suggestions: readonly SaveSuggestion[], line: string): SaveSuggestion[] {
  const lineSuggestion = suggestions.find((s) => s.type === 'line');
  return [...suggestions.filter((s) => s.type !== 'line'), { type: 'line', text: line, meaning: lineSuggestion?.meaning ?? '' }];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/suggestions.test.ts tests/unit/saved-items.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Check the content script stays free of the SDK**

Run: `grep -n "anthropic\|from './client'\|from \"./client\"" src/lib/claude/suggestions.ts`
Expected: no output.

- [ ] **Step 6: Run the whole suite and the type check**

Run: `pnpm test`
Expected: PASS, every test file.

Run: `pnpm compile`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/claude/suggestions.ts tests/unit/suggestions.test.ts
git commit -m "feat(claude): suggest_saves tool and suggestion validation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 4: Story so far on the Netflix side, and the setting

Spec: v2 §5.2 (story so far), §8 (setting). The content script must be able to hand Claude every subtitle line
before the target's context window: from the validated subtitle file when there is one, else from the lines
seen. Never the target, its 6 context lines before, or anything after (Review Focus 2). The rolling history grows
from 50 to 600 lines so the fallback has something to send. A new setting, on by default, turns this off.

**Files:**
- Modify: `src/lib/subtitles/context.ts` (share the episode-order logic; add `StoryLine`, `STORY_SEND_LIMIT`, `storyBefore`)
- Modify: `src/lib/subtitles/history.ts:13` (`HISTORY_LIMIT` 50 → 600)
- Modify: `src/entrypoints/netflix.content/subtitle-session.ts` (`storySoFar(line)`)
- Modify: `src/lib/settings.ts` (`sendStorySoFar`)
- Modify: `src/entrypoints/options/ExplanationsCard.tsx` (toggle)
- Test: `tests/unit/subtitle-context.test.ts`, `tests/unit/subtitle-session.test.ts`, `tests/unit/settings.test.ts`, `tests/unit/settings-ui.test.tsx`

**Interfaces:**
- Consumes: `findCue`, `describeLine`, `CONTEXT_LINES`, `OBSERVED_START_LEAD_MS` (context.ts); `normalizeLine`, `Cue` (cue.ts); `LineHistory`, `ObservedLine` (history.ts).
- Produces (Interface Contract):
  - `export interface StoryLine { startMs: number; text: string }` and `export const STORY_SEND_LIMIT = 1000;` in `src/lib/subtitles/context.ts`
  - `export function storyBefore(line: ObservedLine, cues: readonly Cue[] | null, history: Pick<LineHistory, 'before' | 'all'>, limit?: number): StoryLine[]`. Texts are `normalizeLine`d (one line each), oldest first.
  - `HISTORY_LIMIT = 600` (history.ts)
  - `SubtitleSession.storySoFar(line: ObservedLine): StoryLine[]`
  - `Settings.sendStorySoFar: boolean` (default `true`)

- [ ] **Step 1: Write the failing context tests**

In `tests/unit/subtitle-context.test.ts`, change the context import (line 2) to:

```ts
import { OBSERVED_START_LEAD_MS, STORY_SEND_LIMIT, describeLine, findCue, storyBefore, trackMatchesLine } from '@/lib/subtitles/context';
```

Replace the test `'keeps the last 50 lines and lists earlier lines oldest first'` (inside `describe('line history')`) with:

```ts
  it('keeps the last 600 lines and lists earlier lines oldest first', () => {
    const h = createLineHistory();
    for (let i = 0; i < 610; i++) h.observe(`L${i}`, i * 1000);
    expect(h.all()).toHaveLength(600);
    expect(h.all()[0]!.text).toBe('L10');
    const last = h.current()!;
    expect(h.before(last, 3).map((l) => l.text)).toEqual(['L606', 'L607', 'L608']);
  });
```

Add this block after `describe('describeLine', …)`:

```ts
describe('storyBefore (v2 spec §5.2: the story so far)', () => {
  it('story so far stops before the context window (file and history)', () => {
    // From the file: Line 10 is the target; Line 4–9 are its context before, Line 11–14 after.
    const fromFile = observeAll([['Line 10', 31_100]]);
    const target = fromFile.current()!;
    const story = storyBefore(target, CUES, fromFile);
    expect(story).toEqual([0, 1, 2, 3].map((i) => ({ startMs: 1000 + i * 3000, text: `Line ${i}` })));
    const { context } = describeLine(target, CUES, fromFile);
    const texts = story.map((l) => l.text);
    for (const text of [...context.before, 'Line 10', ...context.after]) expect(texts).not.toContain(text);

    // From history after rewinding: lines seen later in the episode never count.
    const h = createLineHistory();
    for (let i = 0; i < 12; i++) {
      h.observe(`Seen ${i}`, 10_000 + i * 2000);
      h.observe('', 11_000 + i * 2000);
    }
    h.observe('Seen 3', 16_050); // rewound to Seen 3
    const rewound = h.current()!;
    expect(describeLine(rewound, null, h).context.before).toEqual(['Seen 0', 'Seen 1', 'Seen 2']);
    expect(storyBefore(rewound, null, h)).toEqual([]);
  });

  it('from history: the lines before the 6 context lines, in episode order, starting 300 ms early', () => {
    const h = createLineHistory();
    for (let i = 0; i < 9; i++) {
      h.observe(`Seen ${i}`, 10_000 + i * 2000);
      h.observe('', 11_000 + i * 2000);
    }
    const line = h.current()!; // Seen 8; its context before is Seen 2–7
    expect(describeLine(line, null, h).context.before).toEqual(['Seen 2', 'Seen 3', 'Seen 4', 'Seen 5', 'Seen 6', 'Seen 7']);
    expect(storyBefore(line, null, h)).toEqual([
      { startMs: 10_000 - OBSERVED_START_LEAD_MS, text: 'Seen 0' },
      { startMs: 12_000 - OBSERVED_START_LEAD_MS, text: 'Seen 1' },
    ]);
  });

  it('keeps the newest `limit` lines (1000 by default), one line per cue; nothing near the start or for an untimed line', () => {
    const fromFile = observeAll([['Line 10', 31_100]]);
    expect(storyBefore(fromFile.current()!, CUES, fromFile, 2).map((l) => l.text)).toEqual(['Line 2', 'Line 3']);
    const twoLine: Cue[] = CUES.map((c, i) => (i === 1 ? { ...c, text: 'Two\nlines' } : c));
    expect(storyBefore(fromFile.current()!, twoLine, fromFile)[1]).toEqual({ startMs: 4000, text: 'Two lines' });

    const early = observeAll([['Line 3', 10_100]]);
    expect(storyBefore(early.current()!, CUES, early)).toEqual([]);

    expect(STORY_SEND_LIMIT).toBe(1000);
    const many: Cue[] = Array.from({ length: 1300 }, (_, i) => ({ startMs: i * 1000, endMs: i * 1000 + 900, text: `Cue ${i}` }));
    const late = observeAll([['Cue 1250', 1_250_100]]);
    const story = storyBefore(late.current()!, many, late);
    expect(story).toHaveLength(1000);
    expect(story[0]!.text).toBe('Cue 244');
    expect(story.at(-1)!.text).toBe('Cue 1243');

    const untimed = observeAll([['Hello', null as unknown as number]]);
    expect(storyBefore(untimed.current()!, null, untimed)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/subtitle-context.test.ts`
Expected: FAIL. `storyBefore is not a function` in the three new tests, and the history test fails with `expected [ …(50) ] to have a length of 600 but got 50`.

- [ ] **Step 3: Implement `storyBefore` and the 600-line history**

In `src/lib/subtitles/history.ts`, replace:

```ts
export const HISTORY_LIMIT = 50;
```

with:

```ts
/** Enough lines to send as the story so far when there is no subtitle file (v2 spec §5.2). */
export const HISTORY_LIMIT = 600;
```

In `src/lib/subtitles/context.ts`, replace the whole `historyBefore` function and its doc comment:

```ts
/**
 * Up to CONTEXT_LINES lines seen before `line` in episode order, not in the order they were seen: after
 * rewinding or Replay, lines seen again are new history entries. Repeats of the target line and rewatched
 * duplicates (same text within 500 ms) are left out.
 */
function historyBefore(line: ObservedLine, history: Pick<LineHistory, 'before' | 'all'>): string[] {
  const at = line.shownAtMs;
  if (at === null) return history.before(line, CONTEXT_LINES).map((l) => l.text);
  const earlier = history
    .all()
    .filter((l): l is ObservedLine & { shownAtMs: number } => l.shownAtMs !== null && l.shownAtMs < at)
    .filter((l) => l.normalized !== line.normalized)
    .sort((a, b) => a.shownAtMs - b.shownAtMs);
  const lastSeen = new Map<string, number>();
  const merged: ObservedLine[] = [];
  for (const l of earlier) {
    const previous = lastSeen.get(l.normalized);
    if (previous !== undefined && l.shownAtMs - previous <= REWATCHED_WITHIN_MS) continue;
    lastSeen.set(l.normalized, l.shownAtMs);
    merged.push(l);
  }
  return merged.slice(-CONTEXT_LINES).map((l) => l.text);
}
```

with:

```ts
type TimedLine = ObservedLine & { shownAtMs: number };

/**
 * Lines seen before episode time `at`, in episode order, not in the order they were seen: after rewinding or
 * Replay, lines seen again are new history entries. Repeats of `line` itself, untimed lines, and rewatched
 * duplicates (same text within 500 ms) are left out.
 */
function seenBefore(line: ObservedLine, at: number, history: Pick<LineHistory, 'all'>): TimedLine[] {
  const earlier = history
    .all()
    .filter((l): l is TimedLine => l.shownAtMs !== null && l.shownAtMs < at)
    .filter((l) => l.normalized !== line.normalized)
    .sort((a, b) => a.shownAtMs - b.shownAtMs);
  const lastSeen = new Map<string, number>();
  const merged: TimedLine[] = [];
  for (const l of earlier) {
    const previous = lastSeen.get(l.normalized);
    if (previous !== undefined && l.shownAtMs - previous <= REWATCHED_WITHIN_MS) continue;
    lastSeen.set(l.normalized, l.shownAtMs);
    merged.push(l);
  }
  return merged;
}

/** Up to CONTEXT_LINES lines seen before `line`, in episode order (see seenBefore). */
function historyBefore(line: ObservedLine, history: Pick<LineHistory, 'before' | 'all'>): string[] {
  const at = line.shownAtMs;
  if (at === null) return history.before(line, CONTEXT_LINES).map((l) => l.text);
  return seenBefore(line, at, history).slice(-CONTEXT_LINES).map((l) => l.text);
}
```

Append to the end of `src/lib/subtitles/context.ts`:

```ts
/** One line of the story so far: when it starts (episode ms) and its text on one line. */
export interface StoryLine {
  startMs: number;
  text: string;
}

/** The content script sends at most this many story lines (v2 spec §5.2). */
export const STORY_SEND_LIMIT = 1000;

/**
 * The story so far (v2 spec §5.2): the lines before `line`'s context window, oldest first, at most `limit`.
 * From the subtitle file when it has the line, else from the lines seen (starting 300 ms before they
 * appeared). Never the line itself, its CONTEXT_LINES lines before, or anything after it, so Claude never sees
 * past the context (no spoilers).
 */
export function storyBefore(
  line: ObservedLine,
  cues: readonly Cue[] | null,
  history: Pick<LineHistory, 'before' | 'all'>,
  limit = STORY_SEND_LIMIT,
): StoryLine[] {
  const at = line.shownAtMs;
  if (at === null || limit <= 0) return [];
  const first = cues ? findCue(cues, line.normalized, at) : -1;
  if (cues && first >= 0) {
    const end = Math.max(0, first - CONTEXT_LINES);
    return cues.slice(Math.max(0, end - limit), end).map((c) => ({ startMs: c.startMs, text: normalizeLine(c.text) }));
  }
  const seen = seenBefore(line, at, history);
  const end = Math.max(0, seen.length - CONTEXT_LINES);
  return seen
    .slice(Math.max(0, end - limit), end)
    .map((l) => ({ startMs: Math.max(0, l.shownAtMs - OBSERVED_START_LEAD_MS), text: l.normalized }));
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run tests/unit/subtitle-context.test.ts`
Expected: PASS (all tests, including the existing `describeLine` ones: the refactor keeps `historyBefore`'s results).

- [ ] **Step 5: Write the failing session test**

Add to `describe('subtitle session')` in `tests/unit/subtitle-session.test.ts`:

```ts
  it('story so far: from the file once it matches, else from the lines seen; never the context window', async () => {
    const file = setup();
    file.show('Line 6', 19_100);
    file.show('Line 10', 31_100);
    await settle();
    const target = file.session.currentLine()!;
    expect(file.session.storySoFar(target)).toEqual([0, 1, 2, 3].map((i) => ({ startMs: 1000 + i * 3000, text: `Line ${i}` })));

    const seen = setup({});
    for (let i = 0; i < 9; i++) seen.show(`Seen ${i}`, 10_000 + i * 2000);
    await settle();
    const last = seen.session.currentLine()!; // Seen 8; its context before is Seen 2–7
    expect(seen.session.storySoFar(last)).toEqual([
      { startMs: 9700, text: 'Seen 0' },
      { startMs: 11_700, text: 'Seen 1' },
    ]);
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/subtitle-session.test.ts`
Expected: FAIL with `file.session.storySoFar is not a function`.

- [ ] **Step 7: Add `storySoFar` to the session**

In `src/entrypoints/netflix.content/subtitle-session.ts`, replace the context import:

```ts
import { describeLine, trackMatchesLine, type LineDetails } from '@/lib/subtitles/context';
```

with:

```ts
import { describeLine, storyBefore, trackMatchesLine, type LineDetails, type StoryLine } from '@/lib/subtitles/context';
```

In `interface SubtitleSession`, after the `describe(line: ObservedLine): LineDetails;` member, add:

```ts
  /** The lines before the context window, for Claude's story so far (v2 spec §5.2). Never the context or later. */
  storySoFar(line: ObservedLine): StoryLine[];
```

In the object returned by `createSubtitleSession`, after the `describe(line) { … }` method, add:

```ts
    storySoFar(line) {
      syncVideo();
      return storyBefore(line, usableCues(line), history);
    },
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run tests/unit/subtitle-session.test.ts tests/unit/subtitle-context.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing settings tests**

Add to `describe('explanation and line settings')` in `tests/unit/settings.test.ts`:

```ts
  it('Send the story so far: on by default, kept when off, repaired when invalid', () => {
    expect(DEFAULT_SETTINGS.sendStorySoFar).toBe(true);
    expect(normalizeSettings(undefined, 'en').sendStorySoFar).toBe(true);
    expect(normalizeSettings({ sendStorySoFar: false }, 'en').sendStorySoFar).toBe(false);
    expect(normalizeSettings({ sendStorySoFar: 'no' }, 'en').sendStorySoFar).toBe(true);
  });
```

Add to `describe('explanation and line settings')` in `tests/unit/settings-ui.test.tsx`:

```tsx
  it('saves Send the story so far', async () => {
    render(<SettingsTab send={fakeBackground().send} />);
    const toggle = await screen.findByRole('switch', { name: 'Send the story so far' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.textContent).toContain('Better explanations; more tokens late in an episode.');
    fireEvent.click(toggle);
    await waitFor(async () => expect((await loadSettings()).sendStorySoFar).toBe(false));
  });
```

- [ ] **Step 10: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/settings.test.ts tests/unit/settings-ui.test.tsx`
Expected: FAIL. The settings test fails with `expected undefined to be true`, and the UI test can't find a switch named "Send the story so far".

- [ ] **Step 11: Add the setting and its toggle**

In `src/lib/settings.ts`, in `interface Settings`, replace:

```ts
  cardSections: CardSections;
}
```

with:

```ts
  cardSections: CardSections;
  /** Send Claude the subtitle lines before the dialogue: the story so far (v2 spec §5.2, §8). */
  sendStorySoFar: boolean;
}
```

In `DEFAULT_SETTINGS`, replace:

```ts
  cardSections: { meaning: true, keyExpressions: true, howToUse: true, followUp: true },
};
```

with:

```ts
  cardSections: { meaning: true, keyExpressions: true, howToUse: true, followUp: true },
  sendStorySoFar: true,
};
```

In `normalizeSettings`, replace:

```ts
    cardSections: normalizeCardSections(r.cardSections),
  };
}
```

with:

```ts
    cardSections: normalizeCardSections(r.cardSections),
    sendStorySoFar: typeof r.sendStorySoFar === 'boolean' ? r.sendStorySoFar : DEFAULT_SETTINGS.sendStorySoFar,
  };
}
```

(`mergeForWrite` needs no change: it writes every known field and keeps unknown ones.)

In `src/entrypoints/options/ExplanationsCard.tsx`, replace the doc comment:

```ts
/** Spec §5.8: explanation language, card sections, Pause on hover. */
```

with:

```ts
/** Spec §5.8: explanation language, card sections, Pause on hover; v2 spec §8: Send the story so far. */
```

and replace the Pause on hover block:

```tsx
      <div className="border-t-2 border-soft py-3">
        <Toggle
          label="Pause on hover"
          description="Pause the video while you read the card."
          checked={settings.pauseOnHover}
          onChange={(pauseOnHover) => void update((s) => ({ ...s, pauseOnHover }))}
        />
      </div>
```

with:

```tsx
      <div className="border-t-2 border-soft py-3">
        <Toggle
          label="Pause on hover"
          description="Pause the video while you read the card."
          checked={settings.pauseOnHover}
          onChange={(pauseOnHover) => void update((s) => ({ ...s, pauseOnHover }))}
        />
      </div>

      <div className="border-t-2 border-soft py-3">
        <Toggle
          label="Send the story so far"
          description="Better explanations; more tokens late in an episode."
          checked={settings.sendStorySoFar}
          onChange={(sendStorySoFar) => void update((s) => ({ ...s, sendStorySoFar }))}
        />
      </div>
```

- [ ] **Step 12: Run them to verify they pass**

Run: `pnpm vitest run tests/unit/settings.test.ts tests/unit/settings-ui.test.tsx`
Expected: PASS.

- [ ] **Step 13: Full suite and type check**

Run: `pnpm test && pnpm compile`
Expected: every test passes; `tsc` reports no errors.

- [ ] **Step 14: Commit**

```bash
git add src/lib/subtitles/context.ts src/lib/subtitles/history.ts src/entrypoints/netflix.content/subtitle-session.ts src/lib/settings.ts src/entrypoints/options/ExplanationsCard.tsx tests/unit/subtitle-context.test.ts tests/unit/subtitle-session.test.ts tests/unit/settings.test.ts tests/unit/settings-ui.test.tsx
git commit -m "feat: story so far from the subtitle file or the lines seen, and the Send the story so far setting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 5: Context blocks and prompt text

Spec: v2 §5.1 (request shape), §5.2 (context blocks: story split at the 5-minute boundary, caps applied after
the split, learning history), §5.3 (instruction text). This task builds the text; Task 7 puts it into requests.
Chunk A (`system[1]`) must be byte-identical for every target line in the same 5-minute window, so Anthropic's
prompt cache can reuse it (Review Focus 1).

**Files:**
- Create: `src/lib/claude/context-blocks.ts`
- Modify: `src/lib/study-log/format.ts` (`episodeCode`, `whereLabel`)
- Modify: `src/lib/claude/prompt.ts` (`SUGGEST_INSTRUCTION`, `buildSystemPrompt`, `buildUserMessage`, `buildFollowUpMessages`)
- Test: create `tests/unit/context-blocks.test.ts`; modify `tests/unit/claude.test.ts`, `tests/unit/study-log.test.ts`

**Interfaces:**
- Consumes:
  - `StoryLine` (Task 4, `src/lib/subtitles/context.ts`); `normalizeLine` (`src/lib/subtitles/cue.ts`)
  - `Explanation`, `SavedItem` (Tasks 1–2, `src/lib/study-log/types.ts`)
  - `SUGGEST_SAVES_TOOL_NAME`, `MAX_SUGGESTIONS` (Task 3, `src/lib/claude/suggestions.ts`)
  - `buildFollowUpMessages` as Task 1 left it, taking an `Explanation`
- Produces (Interface Contract):
  - `src/lib/study-log/format.ts`: `episodeCode(fields)`, `whereLabel(fields)`
  - `src/lib/claude/context-blocks.ts`:
    - `STORY_CHUNK_MS = 300_000`, `STORY_CACHED_MAX_LINES = 600`, `STORY_CACHED_MAX_CHARS = 48_000`, `STORY_RECENT_MAX_LINES = 200`
    - `splitStory(lines, targetStartMs): { cached; recent }`
    - `storyBlock(cached): string | null`
    - `recentStoryText(recent): string | null`
    - `interface HistorySources { items; explanations }`
    - `HISTORY_ITEMS = 100`, `HISTORY_LINES = 30`
    - `learningHistoryBlock(sources, excludeLine): string | null`
  - `src/lib/claude/prompt.ts`:
    - `SUGGEST_INSTRUCTION(languageName): string`
    - `buildSystemPrompt(language, sections, followUp?)`, which appends `SUGGEST_INSTRUCTION` only when not a follow-up
    - `buildUserMessage(request, recent?)`
    - `buildFollowUpMessages(explanation, question, recent?)`

- [ ] **Step 1: Write the failing label tests**

In `tests/unit/study-log.test.ts`, change the format import to:

```ts
import { episodeCode, episodeLabel, formatTimestamp, seasonLabel, whereLabel } from '@/lib/study-log/format';
```

and append at the end of the file:

```ts
describe('where an item is from (v2 spec §5.2, §6.1)', () => {
  it('codes episodes as S1 E3 and leaves movies blank', () => {
    expect(episodeCode({ kind: 'episode', seasonNumber: 1, episodeNumber: 3 })).toBe('S1 E3');
    expect(episodeCode({ kind: 'episode', seasonNumber: null, episodeNumber: 3 })).toBe('E3');
    expect(episodeCode({ kind: 'episode', seasonNumber: 2, episodeNumber: null })).toBe('S2');
    expect(episodeCode({ kind: 'episode', seasonNumber: null, episodeNumber: null })).toBe('');
    expect(episodeCode({ kind: 'movie', seasonNumber: null, episodeNumber: null })).toBe('');
  });

  it('labels the show with its code, or the movie by its title', () => {
    expect(whereLabel({ kind: 'episode', seriesTitle: 'Stranger Things', seasonNumber: 1, episodeNumber: 3 })).toBe('Stranger Things S1 E3');
    expect(whereLabel({ kind: 'episode', seriesTitle: 'Stranger Things', seasonNumber: null, episodeNumber: null })).toBe('Stranger Things');
    expect(whereLabel({ kind: 'movie', seriesTitle: 'Roma', seasonNumber: null, episodeNumber: null })).toBe('Roma');
  });
});
```

- [ ] **Step 2: Write the failing context-block tests**

Create `tests/unit/context-blocks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  HISTORY_ITEMS,
  HISTORY_LINES,
  STORY_CACHED_MAX_CHARS,
  STORY_CACHED_MAX_LINES,
  STORY_CHUNK_MS,
  STORY_RECENT_MAX_LINES,
  learningHistoryBlock,
  recentStoryText,
  splitStory,
  storyBlock,
} from '@/lib/claude/context-blocks';
import type { Explanation, SavedItem } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';

/** One line per second: line i starts at i·1000 ms. */
const story = (count: number, text: (i: number) => string = (i) => `Line ${i}`): StoryLine[] =>
  Array.from({ length: count }, (_, i) => ({ startMs: i * 1000, text: text(i) }));

/** What the content script sends for a target at `targetStartMs`: lines before the context window, last 1000. */
const sent = (all: readonly StoryLine[], targetStartMs: number) => all.filter((l) => l.startMs < targetStartMs - 6000).slice(-1000);

describe('splitStory', () => {
  it('splits at the last 5-minute boundary before the target and drops anything at or after the target', () => {
    const { cached, recent } = splitStory(
      [
        { startMs: 0, text: 'Opening' },
        { startMs: 299_999, text: 'Last before the boundary' },
        { startMs: 300_000, text: 'First after the boundary' },
        { startMs: 310_000, text: 'Just before' },
        { startMs: 320_000, text: 'The target itself' },
        { startMs: 400_000, text: 'Later' },
      ],
      320_000,
    );
    expect(STORY_CHUNK_MS).toBe(300_000);
    expect(cached.map((l) => l.text)).toEqual(['Opening', 'Last before the boundary']);
    expect(recent.map((l) => l.text)).toEqual(['First after the boundary', 'Just before']);
  });

  it('puts every line in chunk B during the first 5 minutes, normalizes text, and skips empty lines', () => {
    const { cached, recent } = splitStory(
      [
        { startMs: 1000, text: '  Two\nlines  ' },
        { startMs: 2000, text: '   ' },
      ],
      120_000,
    );
    expect(cached).toEqual([]);
    expect(recent).toEqual([{ startMs: 1000, text: 'Two lines' }]);
  });

  it('chunk A is identical within a window and capped', () => {
    // A long episode: 2000 lines, one per second.
    const all = story(2000, (i) => `Line ${i}: ${'words '.repeat(3)}`);
    const early = splitStory(sent(all, 1_210_000), 1_210_000);
    const late = splitStory(sent(all, 1_495_000), 1_495_000);
    // Both targets are in the window that starts at 1 200 000 ms: chunk A is the same text, chunk B differs.
    expect(storyBlock(early.cached)).toBe(storyBlock(late.cached));
    expect(early.recent).not.toEqual(late.recent);
    expect(early.cached).toHaveLength(STORY_CACHED_MAX_LINES);
    expect(early.cached.at(-1)!.startMs).toBe(1_199_000);
    expect(late.recent).toHaveLength(STORY_RECENT_MAX_LINES);
    expect(late.recent.at(-1)!.startMs).toBe(1_488_000);

    // Long lines: the character cap binds before the line cap.
    const wordy = story(2000, (i) => `${i} ${'x'.repeat(150)}`);
    const { cached } = splitStory(sent(wordy, 1_210_000), 1_210_000);
    const chars = cached.reduce((sum, l) => sum + l.text.length + 1, 0);
    expect(chars).toBeLessThanOrEqual(STORY_CACHED_MAX_CHARS);
    expect(cached.length).toBeLessThan(STORY_CACHED_MAX_LINES);
    expect(cached.at(-1)!.startMs).toBe(1_199_000);
    expect(storyBlock(splitStory(sent(wordy, 1_299_000), 1_299_000).cached)).toBe(storyBlock(cached));
  });
});

describe('story text', () => {
  it('chunk A is a system block with a header and one line each; empty is null', () => {
    expect(storyBlock([{ startMs: 0, text: 'Hello.' }, { startMs: 1000, text: 'Hi.' }])).toBe(
      'Story so far in this episode (subtitle lines before the dialogue below, oldest first):\nHello.\nHi.',
    );
    expect(storyBlock([])).toBeNull();
  });

  it('chunk B goes on top of the user message under "Just before:"; empty is null', () => {
    expect(recentStoryText([{ startMs: 0, text: 'Hello.' }, { startMs: 1000, text: 'Hi.' }])).toBe('Just before:\n  Hello.\n  Hi.');
    expect(recentStoryText([])).toBeNull();
  });
});

const item = (over: Partial<SavedItem> = {}): SavedItem => ({
  id: 'i1',
  type: 'idiom',
  text: 'call it a night',
  meaning: "end the evening's activities",
  explanationId: 'e1',
  line: "I'm gonna call it a night.",
  lineTimeMs: 1_834_200,
  context: { before: [], after: [] },
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  explanationLanguage: 'en',
  savedAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  ...over,
});

const explanation = (over: Partial<Explanation> = {}): Explanation => ({
  id: 'e1',
  phrase: "Where's Will?",
  response: '## Meaning\nA question.',
  followUps: [],
  videoTimeMs: 1000,
  savedAt: '2026-10-10T09:00:00.000Z',
  updatedAt: '2026-10-10T09:00:00.000Z',
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: [], after: [] },
  explanationLanguage: 'en',
  model: 'claude-sonnet-5-5',
  suggestions: [],
  ...over,
});

const HEADER =
  "What this learner has studied (most recent first). Connect to it when useful, don't re-explain basics they already saved, and don't suggest items they already saved.";

describe('learningHistoryBlock', () => {
  it('lists saved items and explained lines with where they are from (v2 spec §5.2)', () => {
    expect(
      learningHistoryBlock(
        {
          items: [
            item(),
            item({ id: 'i2', type: 'line', text: 'Mouth breather.', meaning: '', kind: 'movie', seriesTitle: 'Roma', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-09T00:00:00.000Z' }),
          ],
          explanations: [explanation()],
        },
        'Something else entirely.',
      ),
    ).toBe(
      [
        HEADER,
        'Saved:',
        "- call it a night (idiom): end the evening's activities [Stranger Things S1 E3]",
        '- Mouth breather. (line) [Roma]',
        'Recently explained lines:',
        `- "Where's Will?" [Stranger Things S1 E3]`,
      ].join('\n'),
    );
  });

  it('is most recent first, keeps 100 items and 30 lines, and cuts long text and meanings', () => {
    const items = Array.from({ length: 120 }, (_, i) =>
      item({ id: `i${i}`, text: `word ${i}`, meaning: 'm', updatedAt: `2026-10-10T10:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}.000Z` }),
    );
    const explanations = Array.from({ length: 40 }, (_, i) =>
      explanation({ id: `e${i}`, phrase: `Line ${i}`, updatedAt: `2026-10-10T09:${String(i).padStart(2, '0')}:00.000Z` }),
    );
    const block = learningHistoryBlock({ items, explanations }, 'Not in the list')!;
    const lines = block.split('\n');
    expect(lines.filter((l) => l.startsWith('- word '))).toHaveLength(HISTORY_ITEMS);
    expect(lines.filter((l) => l.startsWith('- "Line '))).toHaveLength(HISTORY_LINES);
    expect(lines[2]).toBe('- word 119 (idiom): m [Stranger Things S1 E3]'); // 10:59:01, the newest
    expect(lines.indexOf('- "Line 39" [Stranger Things S1 E3]')).toBe(lines.indexOf('Recently explained lines:') + 1);
    expect(block).not.toContain('"Line 9"'); // the 10 oldest lines are left out

    const long = learningHistoryBlock({ items: [item({ text: 'a'.repeat(200), meaning: 'b'.repeat(100) })], explanations: [] }, 'x')!;
    expect(long.split('\n')[2]).toBe(`- ${'a'.repeat(119)}… (idiom): ${'b'.repeat(79)}… [Stranger Things S1 E3]`);
  });

  it('leaves out the line being explained, and is null when there is nothing to say', () => {
    const block = learningHistoryBlock(
      { items: [], explanations: [explanation({ phrase: "I'm gonna\ncall it a night." }), explanation({ id: 'e2' })] },
      "i'm gonna call it a night.",
    )!;
    expect(block).not.toContain('call it a night');
    expect(block).toContain(`- "Where's Will?"`);
    expect(learningHistoryBlock({ items: [], explanations: [] }, 'x')).toBeNull();
    expect(learningHistoryBlock({ items: [], explanations: [explanation({ phrase: 'Same.' })] }, 'Same.')).toBeNull();
  });
});
```

- [ ] **Step 3: Write the failing prompt tests**

In `tests/unit/claude.test.ts`, change the prompt import (line 4) to:

```ts
import {
  SUGGEST_INSTRUCTION,
  buildFollowUpMessages,
  buildSystemPrompt,
  buildUserMessage,
  titleLine,
  type ExplainRequest,
} from '@/lib/claude/prompt';
```

In the test `'is the spec §7.2 prompt in the chosen language with every enabled section'`, replace:

```ts
    expect(prompt.endsWith(
      'with headings written in Korean (한국어):\n' +
        '1. Meaning: natural translation plus what the line means in this scene: tone, nuance, sarcasm, slang, register.\n' +
        '2. Key expressions: idioms, phrasal verbs, slang in the line, each with a short definition.\n' +
        '3. How to use it: 2 or 3 everyday example sentences in the original language, each with a translation.',
    )).toBe(true);
```

with:

```ts
    expect(prompt).toContain(
      'with headings written in Korean (한국어):\n' +
        '1. Meaning: natural translation plus what the line means in this scene: tone, nuance, sarcasm, slang, register.\n' +
        '2. Key expressions: idioms, phrasal verbs, slang in the line, each with a short definition.\n' +
        '3. How to use it: 2 or 3 everyday example sentences in the original language, each with a translation.\n\n' +
        SUGGEST_INSTRUCTION('Korean (한국어)'),
    );
    expect(prompt.endsWith(SUGGEST_INSTRUCTION('Korean (한국어)'))).toBe(true);
```

Add these tests to `describe('buildSystemPrompt')`:

```ts
  it('asks for suggest_saves after the explanation (v2 spec §5.3), never in follow-ups', () => {
    expect(SUGGEST_INSTRUCTION('Korean (한국어)')).toBe(
      'After the explanation, call suggest_saves once with up to 6 items from the subtitle line that are worth studying: ' +
        'single words, phrases, idioms, and the whole line if it is worth keeping as a sentence. ' +
        'Use the exact text as it appears in the line. ' +
        'Give each a meaning of at most 12 words in Korean (한국어). ' +
        'Leave out items the learner already saved. ' +
        "Don't mention the tool or the suggestions in your explanation.",
    );
    expect(SUGGEST_INSTRUCTION('Korean (한국어)')).not.toMatch(/[–—]/);
    expect(buildSystemPrompt('ko', ALL, true)).not.toContain('suggest_saves');
  });
```

Add this test to `describe('user message')`:

```ts
  it('puts the story just before the dialogue on top (chunk B, v2 spec §5.1)', () => {
    const request = { phrase: 'Line', context: { before: ['Before'], after: [] }, title: EPISODE };
    expect(
      buildUserMessage(request, [
        { startMs: 1000, text: 'Earlier one.' },
        { startMs: 2000, text: 'Earlier two.' },
      ]),
    ).toBe(
      [
        'Just before:',
        '  Earlier one.',
        '  Earlier two.',
        '',
        'Title: Stranger Things, Season 1, Episode 3 "Holly, Jolly"',
        'Dialogue (the line to explain is marked with >>>):',
        '  Before',
        '>>> Line',
      ].join('\n'),
    );
    expect(buildUserMessage(request, [])).toBe(buildUserMessage(request));
  });
```

Add this test to `describe('buildFollowUpMessages')` (Task 1 already made this file import `type Explanation` instead of `StudyLogEntry`):

```ts
  it('puts the story just before the dialogue on top of the first message too', () => {
    const explanation = {
      phrase: 'Line',
      response: 'Explanation',
      followUps: [],
      context: { before: [], after: [] },
      suggestions: [],
      ...EPISODE,
    } as unknown as Explanation;
    const messages = buildFollowUpMessages(explanation, 'Q', [{ startMs: 0, text: 'Earlier.' }]);
    expect(messages[0]!.content.startsWith('Just before:\n  Earlier.\n\nTitle: Stranger Things')).toBe(true);
    expect(buildFollowUpMessages(explanation, 'Q')[0]!.content.startsWith('Title: ')).toBe(true);
  });
```

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/study-log.test.ts tests/unit/context-blocks.test.ts tests/unit/claude.test.ts`
Expected: FAIL.
- `study-log.test.ts`: `episodeCode is not a function`.
- `context-blocks.test.ts`: `Failed to resolve import "@/lib/claude/context-blocks"`.
- `claude.test.ts`: `SUGGEST_INSTRUCTION is not a function`.

- [ ] **Step 5: Add `episodeCode` and `whereLabel`**

Append to `src/lib/study-log/format.ts`:

```ts
interface Where {
  kind: 'episode' | 'movie';
  seasonNumber: number | null;
  episodeNumber: number | null;
}

/** "S1 E3", "E3", "S1", or "" for movies and unnumbered episodes (v2 spec §6.1 rows). */
export function episodeCode(fields: Where): string {
  if (fields.kind === 'movie') return '';
  return [fields.seasonNumber !== null ? `S${fields.seasonNumber}` : null, fields.episodeNumber !== null ? `E${fields.episodeNumber}` : null]
    .filter(Boolean)
    .join(' ');
}

/** "Stranger Things S1 E3", or the movie's title (v2 spec §5.2 learning history). */
export function whereLabel(fields: Where & { seriesTitle: string }): string {
  const code = episodeCode(fields);
  return code ? `${fields.seriesTitle} ${code}` : fields.seriesTitle;
}
```

- [ ] **Step 6: Create the context blocks**

Create `src/lib/claude/context-blocks.ts`:

```ts
import { whereLabel } from '@/lib/study-log/format';
import type { Explanation, SavedItem } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';
import { normalizeLine } from '@/lib/subtitles/cue';

/** v2 spec §5.2: chunk A ends at the last 5-minute boundary before the target line. */
export const STORY_CHUNK_MS = 300_000;
export const STORY_CACHED_MAX_LINES = 600;
export const STORY_CACHED_MAX_CHARS = 48_000;
export const STORY_RECENT_MAX_LINES = 200;

const STORY_HEADER = 'Story so far in this episode (subtitle lines before the dialogue below, oldest first):';
const RECENT_HEADER = 'Just before:';

/** The newest lines that fit in `maxLines` lines and `maxChars` characters (each line counts its newline). */
function newestWithin(lines: readonly StoryLine[], maxLines: number, maxChars: number): StoryLine[] {
  const kept: StoryLine[] = [];
  let chars = 0;
  for (let i = lines.length - 1; i >= 0 && kept.length < maxLines; i--) {
    const line = lines[i]!;
    chars += line.text.length + 1;
    if (chars > maxChars) break;
    kept.push(line);
  }
  return kept.reverse();
}

/**
 * Splits the story so far at the last 5-minute boundary before the target line (v2 spec §5.2). Chunk A
 * ("cached", before the boundary) depends only on the lines and the boundary, so every request in the same
 * window sends the same text and it is read from the prompt cache; caps apply after the split for that reason.
 * Chunk B ("recent") is the rest. Lines at or after the target's start never pass, whatever the page sent.
 */
export function splitStory(lines: readonly StoryLine[], targetStartMs: number): { cached: StoryLine[]; recent: StoryLine[] } {
  const boundary = Math.floor(Math.max(0, targetStartMs) / STORY_CHUNK_MS) * STORY_CHUNK_MS;
  const usable = lines
    .filter((l) => Number.isFinite(l.startMs) && l.startMs < targetStartMs)
    .map((l) => ({ startMs: l.startMs, text: normalizeLine(l.text) }))
    .filter((l) => l.text)
    .sort((a, b) => a.startMs - b.startMs);
  return {
    cached: newestWithin(
      usable.filter((l) => l.startMs < boundary),
      STORY_CACHED_MAX_LINES,
      STORY_CACHED_MAX_CHARS,
    ),
    recent: usable.filter((l) => l.startMs >= boundary).slice(-STORY_RECENT_MAX_LINES),
  };
}

/** `system[1]`: chunk A with its header, one line each; null when there is none. */
export function storyBlock(cached: readonly StoryLine[]): string | null {
  if (cached.length === 0) return null;
  return [STORY_HEADER, ...cached.map((l) => normalizeLine(l.text))].join('\n');
}

/** The top of the user message: chunk B under "Just before:"; null when there is none. */
export function recentStoryText(recent: readonly StoryLine[]): string | null {
  if (recent.length === 0) return null;
  return [RECENT_HEADER, ...recent.map((l) => `  ${normalizeLine(l.text)}`)].join('\n');
}

export interface HistorySources {
  items: readonly SavedItem[];
  explanations: readonly Explanation[];
}

/** v2 spec §5.2 limits for the learning history. */
export const HISTORY_ITEMS = 100;
export const HISTORY_LINES = 30;
const HISTORY_TEXT_CHARS = 120;
const HISTORY_MEANING_CHARS = 80;

const HISTORY_HEADER =
  "What this learner has studied (most recent first). Connect to it when useful, don't re-explain basics they already saved, and don't suggest items they already saved.";

function cut(text: string, max: number): string {
  const clean = normalizeLine(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const newestFirst = <T extends { updatedAt: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
const sameLine = (a: string, b: string) => normalizeLine(a).toLowerCase() === normalizeLine(b).toLowerCase();

/**
 * `system[2]`: what the learner saved and recently explained, most recent first (v2 spec §5.2), leaving out
 * the line being explained. Null when there is nothing to list.
 */
export function learningHistoryBlock(sources: HistorySources, excludeLine: string): string | null {
  const items = newestFirst(sources.items).slice(0, HISTORY_ITEMS);
  const lines = newestFirst(sources.explanations)
    .filter((e) => !sameLine(e.phrase, excludeLine))
    .slice(0, HISTORY_LINES);
  if (items.length === 0 && lines.length === 0) return null;
  const out = [HISTORY_HEADER];
  if (items.length > 0) {
    out.push('Saved:');
    for (const i of items) {
      const meaning = cut(i.meaning, HISTORY_MEANING_CHARS);
      out.push(`- ${cut(i.text, HISTORY_TEXT_CHARS)} (${i.type})${meaning ? `: ${meaning}` : ''} [${whereLabel(i)}]`);
    }
  }
  if (lines.length > 0) {
    out.push('Recently explained lines:');
    for (const e of lines) out.push(`- "${cut(e.phrase, HISTORY_TEXT_CHARS)}" [${whereLabel(e)}]`);
  }
  return out.join('\n');
}
```

- [ ] **Step 7: Update the prompt**

In `src/lib/claude/prompt.ts`, add these imports to the import block at the top:

```ts
import type { StoryLine } from '@/lib/subtitles/context';
import { recentStoryText } from './context-blocks';
import { MAX_SUGGESTIONS, SUGGEST_SAVES_TOOL_NAME } from './suggestions';
```

Above `buildSystemPrompt`, add:

```ts
/** v2 spec §5.3: asks for the suggest_saves call after the explanation. */
export const SUGGEST_INSTRUCTION = (languageName: string): string =>
  `After the explanation, call ${SUGGEST_SAVES_TOOL_NAME} once with up to ${MAX_SUGGESTIONS} items from the subtitle line that are worth studying: ` +
  'single words, phrases, idioms, and the whole line if it is worth keeping as a sentence. ' +
  'Use the exact text as it appears in the line. ' +
  `Give each a meaning of at most 12 words in ${languageName}. ` +
  'Leave out items the learner already saved. ' +
  "Don't mention the tool or the suggestions in your explanation.";
```

In `buildSystemPrompt`, replace the doc comment:

```ts
/** Spec §7.2 (and §7.3 when `followUp`). With every content section off, Meaning is still asked for. */
```

with:

```ts
/**
 * Spec §7.2 plus the suggest_saves instruction (v2 spec §5.3), or §7.3 when `followUp` (no suggestions).
 * With every content section off, Meaning is still asked for.
 */
```

and replace its return statement:

```ts
  return followUp
    ? `${prompt}\n\nThe learner is now asking a follow-up question about this line. Answer it directly and briefly in ${lang}, without those sections.`
    : prompt;
```

with:

```ts
  return followUp
    ? `${prompt}\n\nThe learner is now asking a follow-up question about this line. Answer it directly and briefly in ${lang}, without those sections.`
    : `${prompt}\n\n${SUGGEST_INSTRUCTION(lang)}`;
```

Replace the whole `buildUserMessage` function:

```ts
export function buildUserMessage(request: Pick<ExplainRequest, 'phrase' | 'context' | 'title'>): string {
  const indent = (line: string) => `  ${normalizeLine(line)}`;
  return [
    titleLine(request.title),
    'Dialogue (the line to explain is marked with >>>):',
    ...request.context.before.map(indent),
    `>>> ${normalizeLine(request.phrase)}`,
    ...request.context.after.map(indent),
  ].join('\n');
}
```

with:

```ts
/** Spec §7.2 layout, with the story just before it (v2 spec §5.2 chunk B) on top when there is one. */
export function buildUserMessage(request: Pick<ExplainRequest, 'phrase' | 'context' | 'title'>, recent: readonly StoryLine[] = []): string {
  const indent = (line: string) => `  ${normalizeLine(line)}`;
  const dialogue = [
    titleLine(request.title),
    'Dialogue (the line to explain is marked with >>>):',
    ...request.context.before.map(indent),
    `>>> ${normalizeLine(request.phrase)}`,
    ...request.context.after.map(indent),
  ].join('\n');
  const story = recentStoryText(recent);
  return story ? `${story}\n\n${dialogue}` : dialogue;
}
```

Replace the whole `buildFollowUpMessages` function, as Task 1 left it, with:

```ts
/**
 * Spec §7.3: [user: initial request, assistant: explanation, user: q1, assistant: a1, …, user: new question].
 * `recent` is chunk B of the story so far, on top of the first message as in the original request.
 */
export function buildFollowUpMessages(explanation: Explanation, question: string, recent: readonly StoryLine[] = []): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'user', content: buildUserMessage({ phrase: explanation.phrase, context: explanation.context, title: titleOf(explanation) }, recent) },
    { role: 'assistant', content: explanation.response },
  ];
  for (const followUp of explanation.followUps) {
    messages.push({ role: 'user', content: followUp.question }, { role: 'assistant', content: followUp.answer });
  }
  messages.push({ role: 'user', content: question.trim() });
  return messages;
}
```

(`titleOf` stays as Task 1 left it: it takes an `Explanation` and returns its `TitleInfo`.)

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm vitest run tests/unit/study-log.test.ts tests/unit/context-blocks.test.ts tests/unit/claude.test.ts`
Expected: PASS. That includes the existing claude tests. The "lists only the enabled sections" test still sees no `2.`, because the instruction's text ("at most 12 words") contains no `2.`.

- [ ] **Step 9: Full suite and type check**

Run: `pnpm test && pnpm compile`
Expected: every test passes; `tsc` reports no errors. Two existing explain-service tests depend on this change, and both still pass:
- `toContain('Korean (한국어)')` on the system prompt;
- `expect.stringContaining('>>> …')` on the user message.

- [ ] **Step 10: Commit**

```bash
git add src/lib/claude/context-blocks.ts src/lib/claude/prompt.ts src/lib/study-log/format.ts tests/unit/context-blocks.test.ts tests/unit/claude.test.ts tests/unit/study-log.test.ts
git commit -m "feat: story-so-far and learning-history blocks, and the suggest_saves instruction" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 6: Claude client: system blocks, tools, tool calls

Spec: v2 §5.1 (system blocks with cache markers, `tools`, `tool_choice: auto`, `max_tokens` 1536), §5.5
(client interface). `ClaudeClient.streamText` becomes `stream`, which returns the text and any tool calls. This
task only changes the client and the constant, and keeps every caller working as before. Task 7 uses the new
inputs and outputs.

Facts from the SDK (`@anthropic-ai/sdk` 0.128.0, checked with Context7 and the installed types):
- `TextBlockParam.cache_control` is `{ type: 'ephemeral' }` and marks a cache breakpoint at that block.
- `Tool.input_schema` is `{ type: 'object'; properties?; required?; [k: string]: unknown }`.
- `tool_choice: { type: 'auto' }` lets Claude write text before calling a tool.
- `stream.finalMessage()` resolves with content blocks, including `{ type: 'tool_use', id, name, input }`.

**Files:**
- Modify: `src/lib/claude/client.ts` (whole file)
- Modify: `src/lib/config.ts` (`CLAUDE_EXPLAIN_MAX_TOKENS`)
- Modify: `src/lib/claude/explain-service.ts` (call `stream`)
- Test: create `tests/unit/claude-client.test.ts`; modify `tests/unit/explain-service.test.ts`, `tests/unit/background-messages.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` (`src/lib/claude/prompt.ts`), `CLAUDE_API_BASE_URL` (`src/lib/config.ts`).
- Produces (Interface Contract), all in `src/lib/claude/client.ts`:
  - `SystemBlock { text; cache }`
  - `ToolDefinition { name; description; input_schema }`
  - `StreamParams { model; maxTokens; system: string | SystemBlock[]; messages; tools? }`
  - `ToolCall { name; input }`
  - `StreamResult { text; toolCalls }`
  - `ClaudeClient { stream(params, onText, signal): Promise<StreamResult>; checkKey() }`
  - `toSdkSystem(system)`
  - `readToolCalls(content)`
  - `createSdkClient(apiKey)`

  In `src/lib/config.ts`: `CLAUDE_EXPLAIN_MAX_TOKENS = 1536`.

- [ ] **Step 1: Write the failing client tests**

Create `tests/unit/claude-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSdkClient, readToolCalls, toSdkSystem, type ToolDefinition } from '@/lib/claude/client';
import { CLAUDE_API_BASE_URL, CLAUDE_EXPLAIN_MAX_TOKENS, CLAUDE_MAX_TOKENS } from '@/lib/config';

const sdk = vi.hoisted(() => ({ stream: vi.fn(), constructed: [] as unknown[] }));

// Only the SDK's client class is replaced; its error classes stay real.
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    messages = { stream: sdk.stream };
    models = { list: async () => ({}) };
    constructor(options: unknown) {
      sdk.constructed.push(options);
    }
  }
  return { ...actual, default: FakeAnthropic };
});

/** Stands in for the SDK's MessageStream: replays text deltas, then resolves with the final content. */
function fakeStream(deltas: string[], content: unknown[], stopReason = 'end_turn') {
  const onText: Array<(delta: string) => void> = [];
  return {
    on(event: string, handler: (delta: string) => void) {
      if (event === 'text') onText.push(handler);
      return this;
    },
    async finalMessage() {
      for (const delta of deltas) for (const handler of onText) handler(delta);
      return { content, stop_reason: stopReason };
    },
  };
}

const TOOL: ToolDefinition = {
  name: 'suggest_saves',
  description: 'Save suggestions.',
  input_schema: { type: 'object', properties: { items: { type: 'array' } }, required: ['items'] },
};

describe('toSdkSystem', () => {
  it('passes a string through, maps cache to a cache_control breakpoint, and leaves out empty blocks', () => {
    expect(toSdkSystem('Rules')).toBe('Rules');
    expect(
      toSdkSystem([
        { text: 'Rules', cache: false },
        { text: 'Story so far', cache: true },
        { text: '   ', cache: true },
        { text: 'History', cache: true },
      ]),
    ).toEqual([
      { type: 'text', text: 'Rules' },
      { type: 'text', text: 'Story so far', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'History', cache_control: { type: 'ephemeral' } },
    ]);
  });
});

describe('readToolCalls', () => {
  it('reads tool_use blocks and ignores everything else', () => {
    expect(
      readToolCalls([
        { type: 'text', text: 'Explanation' },
        { type: 'tool_use', id: 't1', name: 'suggest_saves', input: { items: [] } },
        { type: 'tool_use', id: 't2', input: {} }, // no name
        null,
        'junk',
      ]),
    ).toEqual([{ name: 'suggest_saves', input: { items: [] } }]);
    expect(readToolCalls([])).toEqual([]);
  });
});

describe('createSdkClient', () => {
  it('explanations get room for the tool call (1536 tokens); follow-ups keep 1024', () => {
    expect(CLAUDE_EXPLAIN_MAX_TOKENS).toBe(1536);
    expect(CLAUDE_MAX_TOKENS).toBe(1024);
  });

  it('streams text and returns it with the tool calls; system blocks, tools and tool_choice go to the SDK', async () => {
    sdk.stream.mockReturnValue(
      fakeStream(['Hel', 'lo'], [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 't1', name: 'suggest_saves', input: { items: [{ type: 'word', text: 'Hello', meaning: 'hi' }] } },
      ]),
    );
    const deltas: string[] = [];
    const signal = new AbortController().signal;
    const result = await createSdkClient('sk-ant-test').stream(
      {
        model: 'claude-sonnet-5-5',
        maxTokens: CLAUDE_EXPLAIN_MAX_TOKENS,
        system: [
          { text: 'Rules', cache: false },
          { text: 'Story so far', cache: true },
        ],
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [TOOL],
      },
      (delta) => deltas.push(delta),
      signal,
    );
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result).toEqual({ text: 'Hello', toolCalls: [{ name: 'suggest_saves', input: { items: [{ type: 'word', text: 'Hello', meaning: 'hi' }] } }] });
    expect(sdk.constructed.at(-1)).toMatchObject({ apiKey: 'sk-ant-test', baseURL: CLAUDE_API_BASE_URL });
    const [body, options] = sdk.stream.mock.calls.at(-1)!;
    expect(body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 1536,
      system: [
        { type: 'text', text: 'Rules' },
        { type: 'text', text: 'Story so far', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [TOOL],
      tool_choice: { type: 'auto' },
    });
    expect(options).toEqual({ signal, maxRetries: 0 });
  });

  it('drops tool calls cut off by max_tokens (v2 spec §5.4: no suggestions then)', async () => {
    sdk.stream.mockReturnValue(
      fakeStream(
        ['Long'],
        [
          { type: 'text', text: 'Long' },
          { type: 'tool_use', id: 't1', name: 'suggest_saves', input: { items: [{ type: 'word', text: 'Lo', meaning: 'cut' }] } },
        ],
        'max_tokens',
      ),
    );
    const result = await createSdkClient('sk-ant-test').stream(
      { model: 'claude-sonnet-5-5', maxTokens: CLAUDE_EXPLAIN_MAX_TOKENS, system: 'Rules', messages: [{ role: 'user', content: 'Q' }], tools: [TOOL] },
      () => {},
      new AbortController().signal,
    );
    expect(result).toEqual({ text: 'Long', toolCalls: [] });
  });

  it('without tools, sends neither tools nor tool_choice, and a plain system string', async () => {
    sdk.stream.mockReturnValue(fakeStream(['A'], [{ type: 'text', text: 'A' }]));
    const result = await createSdkClient('sk-ant-test').stream(
      { model: 'claude-sonnet-5-5', maxTokens: CLAUDE_MAX_TOKENS, system: 'Rules', messages: [{ role: 'user', content: 'Q' }] },
      () => {},
      new AbortController().signal,
    );
    expect(result).toEqual({ text: 'A', toolCalls: [] });
    const [body] = sdk.stream.mock.calls.at(-1)!;
    expect(body).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 1024, system: 'Rules', messages: [{ role: 'user', content: 'Q' }] });
    expect('tools' in body).toBe(false);
    expect('tool_choice' in body).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/claude-client.test.ts`
Expected: FAIL.
- `toSdkSystem is not a function` and `readToolCalls is not a function`.
- `expected undefined to be 1536` (the constant doesn't exist yet).
- `createSdkClient(...).stream is not a function`.

- [ ] **Step 3: Add the constant**

In `src/lib/config.ts`, replace:

```ts
/** Spec §7.1: one constant for the model. */
export const CLAUDE_MODEL = 'claude-sonnet-5-5';
export const CLAUDE_MAX_TOKENS = 1024;
```

with:

```ts
/** Spec §7.1: one constant for the model. */
export const CLAUDE_MODEL = 'claude-sonnet-5-5';
/** Follow-up answers (main spec §7.1). */
export const CLAUDE_MAX_TOKENS = 1024;
/** Explanations: room for the suggest_saves call after the text (v2 spec §5.1). */
export const CLAUDE_EXPLAIN_MAX_TOKENS = 1536;
```

- [ ] **Step 4: Rewrite the client**

Replace the whole of `src/lib/claude/client.ts` with:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_API_BASE_URL } from '@/lib/config';
import type { ChatMessage } from './prompt';

/** One part of the system prompt; `cache` puts a prompt-cache breakpoint after it (v2 spec §5.1). */
export interface SystemBlock {
  text: string;
  cache: boolean;
}

/** A tool Claude may call, in the API's shape (`input_schema` is a JSON Schema object). */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface StreamParams {
  model: string;
  maxTokens: number;
  system: string | SystemBlock[];
  messages: ChatMessage[];
  /** Offered with tool_choice auto, so Claude still writes its explanation first. */
  tools?: ToolDefinition[];
}

export interface ToolCall {
  name: string;
  input: unknown;
}

export interface StreamResult {
  /** The final message's text blocks, joined. */
  text: string;
  toolCalls: ToolCall[];
}

/** The slice of the Anthropic SDK LingoFlix uses. Tests substitute a fake. */
export interface ClaudeClient {
  /** Streams text deltas to `onText`; resolves with the text and tool calls; rejects with the SDK's errors. */
  stream(params: StreamParams, onText: (delta: string) => void, signal: AbortSignal): Promise<StreamResult>;
  /** The cheapest authenticated call, `GET /v1/models` (spec §5.8 Test key). */
  checkKey(): Promise<void>;
}

type SdkSystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

/** The system prompt in the SDK's shape: `cache` becomes a cache_control breakpoint; empty blocks are left out. */
export function toSdkSystem(system: string | readonly SystemBlock[]): string | SdkSystemBlock[] {
  if (typeof system === 'string') return system;
  return system
    .filter((block) => block.text.trim())
    .map((block): SdkSystemBlock =>
      block.cache ? { type: 'text', text: block.text, cache_control: { type: 'ephemeral' } } : { type: 'text', text: block.text },
    );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The tool_use blocks of a final message's content, in order. */
export function readToolCalls(content: readonly unknown[]): ToolCall[] {
  return content
    .filter((block): block is Record<string, unknown> & { name: string } => isRecord(block) && block.type === 'tool_use' && typeof block.name === 'string')
    .map((block) => ({ name: block.name, input: block.input }));
}

const KEY_CHECK_TIMEOUT_MS = 15_000;

export function createSdkClient(apiKey: string): ClaudeClient {
  // Runs in the extension's service worker; the key only ever goes to api.anthropic.com.
  const client = new Anthropic({ apiKey, baseURL: CLAUDE_API_BASE_URL, dangerouslyAllowBrowser: true });
  return {
    async stream(params, onText, signal) {
      const tools = params.tools ?? [];
      const body: Parameters<typeof client.messages.stream>[0] = {
        model: params.model,
        max_tokens: params.maxTokens,
        system: toSdkSystem(params.system),
        messages: params.messages,
        ...(tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: { ...tool.input_schema, type: 'object' as const },
              })),
              tool_choice: { type: 'auto' as const },
            }
          : {}),
      };
      // No SDK retries: a retried 429/529 (which may wait out a long retry-after) would outlast the 30 s idle
      // timer and show "Couldn't reach Claude" instead of "Claude is busy right now" (spec §7.4).
      const stream = client.messages.stream(body, { signal, maxRetries: 0 });
      stream.on('text', (delta) => onText(delta));
      const message = await stream.finalMessage();
      return {
        text: message.content.map((block) => (block.type === 'text' ? block.text : '')).join(''),
        // A tool call cut off by max_tokens is only partly parsed: drop it (v2 spec §5.4).
        toolCalls: message.stop_reason === 'max_tokens' ? [] : readToolCalls(message.content),
      };
    },
    async checkKey() {
      await client.models.list({ limit: 1 }, { timeout: KEY_CHECK_TIMEOUT_MS, maxRetries: 0 });
    },
  };
}
```

(`input_schema` is spread with `type: 'object'` so it type-checks as the SDK's `Tool.InputSchema` without a cast. The test's `TOOL.input_schema` already has `type: 'object'`, so the body still equals it.)

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run tests/unit/claude-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Move the callers and fakes to `stream`**

In `src/lib/claude/explain-service.ts`, replace:

```ts
      const text = await deps.createClient(apiKey).streamText(
```

with:

```ts
      const { text } = await deps.createClient(apiKey).stream(
```

Nothing else in the service changes in this task. Task 7 starts using `toolCalls`, system blocks and tools.

In `tests/unit/explain-service.test.ts`, change the client import to:

```ts
import type { ClaudeClient, StreamParams, ToolCall } from '@/lib/claude/client';
```

and replace the whole `fakeClient` function with:

```ts
function fakeClient(script: { deltas?: string[]; error?: unknown; hang?: boolean; toolCalls?: ToolCall[] } = {}) {
  const calls: StreamParams[] = [];
  const signals: AbortSignal[] = [];
  const client: ClaudeClient = {
    async stream(params, onText, signal) {
      calls.push(params);
      signals.push(signal);
      if (script.hang) {
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      for (const delta of script.deltas ?? []) {
        await Promise.resolve();
        onText(delta);
      }
      if (script.error) throw script.error;
      return { text: (script.deltas ?? []).join(''), toolCalls: script.toolCalls ?? [] };
    },
    async checkKey() {},
  };
  return { client, calls, signals };
}
```

In `tests/unit/background-messages.test.ts`, replace:

```ts
  const createClient = vi.fn((_key: string): ClaudeClient => ({ streamText: async () => '', checkKey }));
```

with:

```ts
  const createClient = vi.fn((_key: string): ClaudeClient => ({ stream: async () => ({ text: '', toolCalls: [] }), checkKey }));
```

- [ ] **Step 7: Run the callers' tests**

Run: `pnpm vitest run tests/unit/explain-service.test.ts tests/unit/background-messages.test.ts tests/unit/claude-client.test.ts`
Expected: PASS (the explain-service tests behave exactly as before).

- [ ] **Step 8: Full suite and type check**

Run: `pnpm test && pnpm compile`
Expected: every test passes; `tsc` reports no errors. If `rg -n "streamText" src tests` finds anything, rename it to `stream` the same way, then re-run.

- [ ] **Step 9: Commit**

```bash
git add src/lib/claude/client.ts src/lib/config.ts src/lib/claude/explain-service.ts tests/unit/claude-client.test.ts tests/unit/explain-service.test.ts tests/unit/background-messages.test.ts
git commit -m "feat: Claude client takes cached system blocks and tools, and returns tool calls" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 7: Explain protocol and service: assemble the request, store suggestions

v2 spec §5.1 (request shape), §5.2 (context blocks), §5.4 (validating suggestions), §4.2 (the `done` payload). The background now builds each explanation request from three system blocks (instructions, the cached story so far, the cached learning history), asks for `suggest_saves`, validates what comes back, and stores it on the explanation. Follow-ups get the same story and history blocks without tools. The `done` message carries the explanation and the keys of its saved rows.

**Files:**
- Modify: `src/lib/claude/prompt.ts` (`ExplainRequest` gains `storySoFar`)
- Modify: `src/lib/claude/protocol.ts` (whole file below)
- Modify: `src/lib/claude/explain-service.ts` (whole file below)
- Modify: `src/entrypoints/netflix.content/overlay/explain-port.ts` (whole file below: the renamed `done` payload; Task 9 adds `savedKeys` to the handler)
- Modify: `src/entrypoints/netflix.content/overlay/explain-controller.ts` (two small edits so it still compiles; Task 9 rewrites it)
- Modify: `src/entrypoints/background.ts` (port wiring)
- Test: `tests/unit/claude.test.ts` (the `parseClientMessage` block), `tests/unit/explain-service.test.ts` (whole file below), `tests/unit/explain-flow.test.ts` (payload renames)

**Interfaces:**
- Consumes:
  - `StoryLine`, `STORY_SEND_LIMIT` from `src/lib/subtitles/context.ts` (Task 4).
  - `splitStory`, `storyBlock`, `learningHistoryBlock`, `HistorySources` from `src/lib/claude/context-blocks.ts` (Task 5).
  - `buildSystemPrompt` (adds `SUGGEST_INSTRUCTION` when not a follow-up), `buildUserMessage(request, recent?)`, `buildFollowUpMessages(explanation, question, recent?)` from `src/lib/claude/prompt.ts` (Task 5).
  - `ClaudeClient.stream`, `StreamParams`, `StreamResult`, `SystemBlock`, `ToolCall` from `src/lib/claude/client.ts`, and `CLAUDE_EXPLAIN_MAX_TOKENS` from `src/lib/config.ts` (Task 6).
  - `SUGGEST_SAVES_TOOL`, `SUGGEST_SAVES_TOOL_NAME`, `validateSuggestions` from `src/lib/claude/suggestions.ts` (Task 3).
  - `listItems`, `savedKeysFor`, `saveItem`, `suggestionKey` from `src/lib/study-log/items.ts` (Task 2).
  - `Explanation`, `NewExplanation`, `SaveSuggestion`, `SavedItem` and the explanation store functions from Task 1.
- Produces (Interface Contract):
  - `ExplainRequest.storySoFar: StoryLine[]`.
  - `ExplainClientMessage` follow-up = `{ type: 'follow-up'; explanationId; question; sections; storySoFar }`.
  - `ExplainServerMessage` done = `{ type: 'done'; explanation: Explanation; savedKeys: string[] }`.
  - `ExplainServiceDeps` with `getExplanation`, `loadHistory`, `savedKeysFor`.
  - `StreamHandlers.onDone(explanation: Explanation)` in `explain-port.ts`, which Task 9 extends with `savedKeys`.
- Copy change: a follow-up on an explanation that is gone now says "This explanation is no longer available." The old "…no longer in your Study Log." is wrong in v2, because explanations are history and not the Study Log.

- [ ] **Step 1: Write the failing protocol tests**

In `tests/unit/claude.test.ts`, add this import after the existing imports:

```ts
import { STORY_SEND_LIMIT, type StoryLine } from '@/lib/subtitles/context';
```

Then replace the whole `describe('parseClientMessage', () => { … });` block at the end of the file with:

```ts
describe('parseClientMessage', () => {
  const story: StoryLine[] = [
    { startMs: 1000, text: 'Earlier line' },
    { startMs: 4000, text: 'Another line' },
  ];
  const request: ExplainRequest = {
    phrase: 'Hi',
    context: { before: ['a'], after: [] },
    title: EPISODE,
    videoId: '80077211',
    videoTimeMs: 10_000,
    language: 'ko',
    sections: ALL,
    storySoFar: story,
  };

  it('accepts well-formed start and follow-up messages, with the story so far', () => {
    expect(parseClientMessage({ type: 'start', request })).toEqual({ type: 'start', request });
    expect(parseClientMessage({ type: 'start', request: { ...request, storySoFar: [] } })).toEqual({
      type: 'start',
      request: { ...request, storySoFar: [] },
    });
    expect(parseClientMessage({ type: 'follow-up', explanationId: 'e1', question: 'Why?', sections: ALL, storySoFar: story })).toEqual({
      type: 'follow-up',
      explanationId: 'e1',
      question: 'Why?',
      sections: ALL,
      storySoFar: story,
    });
  });

  it('rejects malformed ones', () => {
    expect(parseClientMessage({ type: 'start', request: { ...request, phrase: '' } })).toBeNull();
    expect(parseClientMessage({ type: 'start', request: { ...request, language: 'xx' } })).toBeNull();
    expect(parseClientMessage({ type: 'start', request: { ...request, videoTimeMs: Number.NaN } })).toBeNull();
    expect(parseClientMessage({ type: 'start', request: { ...request, context: { before: [1], after: [] } } })).toBeNull();
    expect(parseClientMessage({ type: 'follow-up', explanationId: 'e1', question: '   ', sections: ALL, storySoFar: [] })).toBeNull();
    expect(parseClientMessage({ type: 'follow-up', entryId: 'e1', question: 'Why?', sections: ALL, storySoFar: [] })).toBeNull(); // old field name
    expect(parseClientMessage({ type: 'follow-up', explanationId: 'e1', question: 'Why?', sections: ALL })).toBeNull(); // no story
    expect(parseClientMessage({ type: 'nope' })).toBeNull();
  });

  it('rejects a story that is malformed or larger than the content script ever sends', () => {
    const start = (storySoFar: unknown) => parseClientMessage({ type: 'start', request: { ...request, storySoFar } });
    expect(start(undefined)).toBeNull();
    expect(start([{ startMs: -1, text: 'x' }])).toBeNull();
    expect(start([{ startMs: Number.NaN, text: 'x' }])).toBeNull();
    expect(start([{ startMs: 1, text: 7 }])).toBeNull();
    expect(start(['just text'])).toBeNull();
    expect(start([{ startMs: 1, text: 'x'.repeat(2001) }])).toBeNull();
    expect(start(Array.from({ length: STORY_SEND_LIMIT + 1 }, (_, i) => ({ startMs: i, text: 'x' })))).toBeNull();
    expect(start(Array.from({ length: 101 }, (_, i) => ({ startMs: i, text: 'x'.repeat(2000) })))).toBeNull(); // 202 000 characters
    expect(start(Array.from({ length: STORY_SEND_LIMIT }, (_, i) => ({ startMs: i, text: 'line' })))).not.toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing service tests**

Replace `tests/unit/explain-service.test.ts` with:

```ts
import { APIError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ClaudeClient, StreamParams, SystemBlock, ToolCall } from '@/lib/claude/client';
import { serveExplainPort, type ExplainPort, type ExplainServiceDeps } from '@/lib/claude/explain-service';
import type { ExplainRequest } from '@/lib/claude/prompt';
import type { ExplainServerMessage } from '@/lib/claude/protocol';
import { SUGGEST_SAVES_TOOL } from '@/lib/claude/suggestions';
import { CLAUDE_MODEL } from '@/lib/config';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { listItems, saveItem, savedKeysFor, suggestionKey } from '@/lib/study-log/items';
import { appendFollowUp, findExplanation, getExplanation, listExplanations, saveExplanation } from '@/lib/study-log/store';
import type { NewExplanation } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());

const REQUEST: ExplainRequest = {
  phrase: "I'm gonna call it a night.",
  context: { before: ['Where are you going?'], after: ['Night.'] },
  title: {
    videoId: '80077211',
    kind: 'episode',
    seriesId: '80057281',
    seriesTitle: 'Stranger Things',
    seasonNumber: 1,
    episodeNumber: 3,
    episodeTitle: 'Holly, Jolly',
  },
  videoId: '80077211',
  videoTimeMs: 1_834_200, // 30:34, so the last 5-minute boundary is 30:00 (1 800 000 ms)
  language: 'ko',
  sections: DEFAULT_SETTINGS.cardSections,
  storySoFar: [],
};

/** What a stored explanation of REQUEST's line looks like. */
const STORED: NewExplanation = {
  phrase: REQUEST.phrase,
  response: 'Explanation',
  videoTimeMs: 1_834_200,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: REQUEST.context,
  explanationLanguage: 'ko',
  model: CLAUDE_MODEL,
  suggestions: [{ type: 'idiom', text: 'call it a night', meaning: '그만 자러 가다' }],
};

const SUGGESTIONS: ToolCall = {
  name: 'suggest_saves',
  input: {
    items: [
      { type: 'idiom', text: 'call it a night', meaning: ' 그만 자러 가다 ' },
      { type: 'word', text: 'gonna', meaning: 'going to' },
      { type: 'word', text: 'banana', meaning: 'not in the line' },
      { type: 'slang', text: 'night', meaning: 'not a type' },
    ],
  },
};

function fakePort() {
  const sent: ExplainServerMessage[] = [];
  let onMessage: (message: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const port: ExplainPort = {
    postMessage: (m) => sent.push(m),
    onMessage: { addListener: (l) => (onMessage = l) },
    onDisconnect: { addListener: (l) => (onDisconnect = l) },
  };
  return { port, sent, send: (m: unknown) => onMessage(m), disconnect: () => onDisconnect() };
}

function fakeClient(script: { deltas?: string[]; toolCalls?: ToolCall[]; error?: unknown; hang?: boolean } = {}) {
  const calls: StreamParams[] = [];
  const signals: AbortSignal[] = [];
  const client: ClaudeClient = {
    async stream(params, onText, signal) {
      calls.push(params);
      signals.push(signal);
      if (script.hang) {
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      for (const delta of script.deltas ?? []) {
        await Promise.resolve();
        onText(delta);
      }
      if (script.error) throw script.error;
      return { text: (script.deltas ?? []).join(''), toolCalls: script.toolCalls ?? [] };
    },
    async checkKey() {},
  };
  return { client, calls, signals };
}

function deps(client: ClaudeClient, over: Partial<ExplainServiceDeps> = {}): ExplainServiceDeps {
  return {
    getApiKey: async () => 'sk-ant-test-key-0000',
    createClient: () => client,
    saveExplanation: (fields) => saveExplanation(fields),
    getExplanation,
    appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
    loadHistory: async () => ({ items: await listItems(), explanations: await listExplanations() }),
    savedKeysFor,
    ...over,
  };
}

const systemOf = (params: StreamParams) => params.system as SystemBlock[];
const doneOf = (sent: ExplainServerMessage[]) => sent.at(-1) as Extract<ExplainServerMessage, { type: 'done' }>;

describe('explain service: explanations', () => {
  it('streams deltas, stores the explanation with its checked suggestions, and finishes with it and its saved keys', async () => {
    const { client, calls } = fakeClient({ deltas: ['## 의미\n', '잘 시간이야.'], toolCalls: [SUGGESTIONS] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(sent.slice(0, 2)).toEqual([
      { type: 'delta', text: '## 의미\n' },
      { type: 'delta', text: '잘 시간이야.' },
    ]);
    const done = doneOf(sent);
    expect(done.explanation).toMatchObject({
      phrase: REQUEST.phrase,
      response: '## 의미\n잘 시간이야.',
      videoTimeMs: 1_834_200,
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      explanationLanguage: 'ko',
      model: CLAUDE_MODEL,
      context: REQUEST.context,
      suggestions: [
        { type: 'idiom', text: 'call it a night', meaning: '그만 자러 가다' },
        { type: 'word', text: 'gonna', meaning: 'going to' },
      ],
    });
    expect(done.savedKeys).toEqual([]);
    expect(await findExplanation('80077211', 'ko', REQUEST.phrase)).toEqual(done.explanation);
    expect(calls[0]).toMatchObject({ model: CLAUDE_MODEL, maxTokens: 1536, tools: [SUGGEST_SAVES_TOOL] });
    expect(systemOf(calls[0]!)[0]).toEqual({ text: expect.stringContaining('Korean (한국어)'), cache: false });
    expect(systemOf(calls[0]!)[0]!.text).toContain('suggest_saves');
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: expect.stringContaining(">>> I'm gonna call it a night.") }]);
  });

  it('without a suggest_saves call, the explanation is stored with no suggestions', async () => {
    for (const toolCalls of [[], [{ name: 'some_other_tool', input: SUGGESTIONS.input }]]) {
      fakeBrowser.reset();
      const { client } = fakeClient({ deltas: ['Fine.'], toolCalls });
      const { port, sent, send } = fakePort();
      serveExplainPort(port, deps(client));
      send({ type: 'start', request: REQUEST });
      await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
      expect(doneOf(sent).explanation.suggestions).toEqual([]);
      expect((await findExplanation('80077211', 'ko', REQUEST.phrase))?.response).toBe('Fine.');
    }
  });

  it('sends the story so far: the part before the last 5-minute boundary cached in the system prompt, the rest in the message', async () => {
    const { client, calls } = fakeClient({ deltas: ['ok'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    const storySoFar = [
      { startMs: 1_700_000, text: 'Old line' },
      { startMs: 1_810_000, text: 'Recent line' },
    ];
    send({ type: 'start', request: { ...REQUEST, storySoFar } });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    const system = systemOf(calls[0]!);
    expect(system[1]).toEqual({ text: expect.stringContaining('Old line'), cache: true });
    expect(system[1]!.text).not.toContain('Recent line');
    const message = calls[0]!.messages[0]!.content;
    expect(message).toContain('Recent line');
    expect(message).not.toContain('Old line');
  });

  it('sends the learning history as a cached block, leaving out the line being explained', async () => {
    const other = await saveExplanation({ ...STORED, phrase: 'Where is Will?', videoTimeMs: 600_000, suggestions: [] });
    await saveItem(other, { type: 'line', text: 'Where is Will?', meaning: 'asking about Will' });
    await saveExplanation(STORED); // this line was explained before: it is the one being explained again
    const { client, calls } = fakeClient({ deltas: ['ok'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    const history = systemOf(calls[0]!).at(-1)!;
    expect(history.cache).toBe(true);
    expect(history.text).toContain('Where is Will?');
    expect(history.text).not.toContain(REQUEST.phrase);
  });

  it('leaves out empty blocks, and caches the story and history but not the instructions', async () => {
    const bare = fakeClient({ deltas: ['ok'] });
    const a = fakePort();
    serveExplainPort(a.port, deps(bare.client));
    a.send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(a.sent.at(-1)?.type).toBe('done'));
    expect(systemOf(bare.calls[0]!)).toEqual([{ text: expect.stringContaining('Korean'), cache: false }]);

    const full = fakeClient({ deltas: ['ok'] });
    const b = fakePort();
    serveExplainPort(b.port, deps(full.client)); // the store now holds an explanation: history is not empty
    b.send({ type: 'start', request: { ...REQUEST, phrase: 'Another line.', storySoFar: [{ startMs: 1000, text: 'Old line' }] } });
    await vi.waitFor(() => expect(b.sent.at(-1)?.type).toBe('done'));
    expect(systemOf(full.calls[0]!).map((block) => block.cache)).toEqual([false, true, true]);
  });

  it('the request never contains a line after the context window', async () => {
    const spoiler = { startMs: 1_900_000, text: 'SPOILER: who did it' };
    const storySoFar = [{ startMs: 1_000_000, text: 'Way back' }, spoiler, { startMs: 1_834_200, text: 'SPOILER at the same time' }];
    const { client, calls } = fakeClient({ deltas: ['ok'] });
    const a = fakePort();
    serveExplainPort(a.port, deps(client));
    a.send({ type: 'start', request: { ...REQUEST, storySoFar } });
    await vi.waitFor(() => expect(a.sent.at(-1)?.type).toBe('done'));
    const startRequest = JSON.stringify(calls[0]);
    expect(startRequest).toContain('Way back');
    expect(startRequest).toContain('Night.'); // the 6 lines after the target are context, and allowed
    expect(startRequest).not.toContain('SPOILER');

    const saved = await saveExplanation(STORED);
    const b = fakePort();
    serveExplainPort(b.port, deps(client));
    b.send({ type: 'follow-up', explanationId: saved.id, question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar });
    await vi.waitFor(() => expect(b.sent.at(-1)?.type).toBe('done'));
    const followUpRequest = JSON.stringify(calls[1]);
    expect(followUpRequest).toContain('Way back');
    expect(followUpRequest).not.toContain('SPOILER');
  });

  it('done carries the keys of saved rows, and Regenerate keeps saved items', async () => {
    const stored = await saveExplanation(STORED);
    await saveItem(stored, stored.suggestions[0]!);
    const { client } = fakeClient({ deltas: ['New explanation'], toolCalls: [SUGGESTIONS] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    const done = doneOf(sent);
    expect(done.explanation.id).toBe(stored.id);
    expect(done.savedKeys).toEqual([suggestionKey(REQUEST, { type: 'idiom', text: 'call it a night' })]);
    expect(await listItems()).toHaveLength(1);
  });

  it('a failure reading saved keys still finishes, with none', async () => {
    const { client } = fakeClient({ deltas: ['ok'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client, { savedKeysFor: async () => Promise.reject(new Error('storage')) }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(doneOf(sent).savedKeys).toEqual([]);
  });
});

describe('explain service: failures', () => {
  it('without a key, asks for one and makes no request', async () => {
    const createClient = vi.fn();
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(fakeClient().client, { getApiKey: async () => null, createClient }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'no-key', message: 'Add your Claude API key' }]));
    expect(createClient).not.toHaveBeenCalled();
  });

  it("a background failure before the request (storage gone) shows Couldn't reach Claude", async () => {
    const { port, sent, send } = fakePort();
    serveExplainPort(
      port,
      deps(fakeClient().client, {
        getApiKey: async () => {
          throw new Error('storage gone');
        },
      }),
    );
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'network', message: "Couldn't reach Claude" }]));
  });

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

  it("a silent stream times out as Couldn't reach Claude", async () => {
    const { client } = fakeClient({ hang: true });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client, { idleTimeoutMs: 20 }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'network', message: "Couldn't reach Claude" }]));
    expect(await listExplanations()).toEqual([]);
  });

  it('maps API errors to card states and saves nothing', async () => {
    const rejected = APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'x', new Headers());
    const { client } = fakeClient({ deltas: [], error: rejected });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'bad-key', message: 'Your API key was rejected' }]));
    expect(await listExplanations()).toEqual([]);
  });

  it('an empty answer is an error, not an explanation', async () => {
    const { client } = fakeClient({ deltas: ['  '], toolCalls: [SUGGESTIONS] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)).toEqual({ type: 'error', code: 'api', message: 'Claude returned an empty answer.' }));
    expect(await listExplanations()).toEqual([]);
  });
});

describe('explain service: follow-ups', () => {
  it('replays the conversation with the same story and history, without tools, and appends the Q&A', async () => {
    const saved = await saveExplanation(STORED);
    const { client, calls } = fakeClient({ deltas: ['아니요.'], toolCalls: [SUGGESTIONS] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    const storySoFar = [
      { startMs: 1_700_000, text: 'Old line' },
      { startMs: 1_810_000, text: 'Recent line' },
    ];
    send({ type: 'follow-up', explanationId: saved.id, question: ' Is it formal? ', sections: DEFAULT_SETTINGS.cardSections, storySoFar });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(calls[0]).toMatchObject({ model: CLAUDE_MODEL, maxTokens: 1024 });
    expect(calls[0]!.tools).toBeUndefined();
    const system = systemOf(calls[0]!);
    expect(system[0]).toEqual({ text: expect.stringContaining('follow-up question'), cache: false });
    expect(system[1]).toEqual({ text: expect.stringContaining('Old line'), cache: true });
    expect(calls[0]!.messages[0]!.content).toContain('Recent line');
    expect(calls[0]!.messages.map((m) => m.content).slice(1)).toEqual(['Explanation', 'Is it formal?']);
    const done = doneOf(sent);
    expect(done.explanation.followUps).toEqual([{ question: 'Is it formal?', answer: '아니요.' }]);
    expect(done.explanation.suggestions).toEqual(STORED.suggestions); // a follow-up never changes the suggestions
    expect(done.savedKeys).toEqual([]);
    expect((await getExplanation(saved.id))?.followUps).toEqual([{ question: 'Is it formal?', answer: '아니요.' }]);
  });

  it('a follow-up on a deleted explanation, malformed messages, and second messages are handled', async () => {
    const { client } = fakeClient({ deltas: ['x'] });
    const a = fakePort();
    serveExplainPort(a.port, deps(client));
    a.send({ type: 'follow-up', explanationId: 'gone', question: 'Why?', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] });
    await vi.waitFor(() => expect(a.sent).toEqual([{ type: 'error', code: 'api', message: 'This explanation is no longer available.' }]));

    const b = fakePort();
    serveExplainPort(b.port, deps(client));
    b.send({ type: 'start', request: { ...REQUEST, phrase: '' } });
    b.send({ type: 'start', request: REQUEST }); // ignored: one request per port
    await vi.waitFor(() => expect(b.sent).toEqual([{ type: 'error', code: 'api', message: 'LingoFlix sent a request it could not read.' }]));
  });
});
```

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `pnpm vitest run tests/unit/claude.test.ts tests/unit/explain-service.test.ts`
Expected: FAIL. `parseClientMessage` drops `storySoFar` and refuses `explanationId`; the service posts `{ type: 'done', entry }`, sends a plain string `system` with `maxTokens` 1024 and no `tools`, and has no `loadHistory` or `savedKeysFor`.

- [ ] **Step 4: Add `storySoFar` to `ExplainRequest`**

In `src/lib/claude/prompt.ts`, `StoryLine` is already imported by Task 5 (for `buildUserMessage`'s `recent`). Replace the interface:

```ts
/** Everything the overlay sends to explain a line (spec §7.2). Times are episode ms. */
export interface ExplainRequest {
  phrase: string;
  context: DialogueContext;
  title: TitleInfo | null;
  videoId: string;
  videoTimeMs: number;
  /** A code from src/lib/languages.ts. */
  language: string;
  sections: CardSections;
  /** v2 spec §5.2: lines before the context window, oldest first; empty when Send the story so far is off. */
  storySoFar: StoryLine[];
}
```

- [ ] **Step 5: Parse the new messages**

Replace `src/lib/claude/protocol.ts` with:

```ts
import { parseTitleInfo } from '@/lib/bridge/protocol';
import { isExplanationLanguage } from '@/lib/languages';
import { CARD_SECTION_IDS, type CardSections } from '@/lib/settings';
import type { Explanation } from '@/lib/study-log/types';
import { STORY_SEND_LIMIT, type StoryLine } from '@/lib/subtitles/context';
import type { ExplainRequest } from './prompt';

/** One Port per request (spec §6.3); disconnecting aborts it. */
export const EXPLAIN_PORT = 'explain';

export type ExplainClientMessage =
  | { type: 'start'; request: ExplainRequest }
  | { type: 'follow-up'; explanationId: string; question: string; sections: CardSections; storySoFar: StoryLine[] };

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

const MAX_LINE_CHARS = 2000;
const MAX_QUESTION_CHARS = 2000;
/** More than the content script ever sends (STORY_SEND_LIMIT lines of normal subtitle length). */
const MAX_STORY_CHARS = 200_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isLine = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_LINE_CHARS;
const isLines = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 6 && value.every(isLine);

function parseSections(value: unknown): CardSections | null {
  if (!isRecord(value) || !CARD_SECTION_IDS.every((id) => typeof value[id] === 'boolean')) return null;
  return { meaning: !!value.meaning, keyExpressions: !!value.keyExpressions, howToUse: !!value.howToUse, followUp: !!value.followUp };
}

/** v2 spec §5.2: at most STORY_SEND_LIMIT lines, each a subtitle line with an episode time. */
function parseStory(value: unknown): StoryLine[] | null {
  if (!Array.isArray(value) || value.length > STORY_SEND_LIMIT) return null;
  const lines: StoryLine[] = [];
  let total = 0;
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const { startMs, text } = raw;
    if (typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0) return null;
    if (!isLine(text)) return null;
    total += text.length;
    if (total > MAX_STORY_CHARS) return null;
    lines.push({ startMs, text });
  }
  return lines;
}

function parseRequest(value: unknown): ExplainRequest | null {
  if (!isRecord(value)) return null;
  const { phrase, context, title, videoId, videoTimeMs, language, sections, storySoFar } = value;
  if (!isLine(phrase) || !phrase.trim()) return null;
  if (!isRecord(context) || !isLines(context.before) || !isLines(context.after)) return null;
  if (typeof videoId !== 'string' || !/^\d+$/.test(videoId)) return null;
  if (typeof videoTimeMs !== 'number' || !Number.isFinite(videoTimeMs) || videoTimeMs < 0) return null;
  if (!isExplanationLanguage(language)) return null;
  const parsedSections = parseSections(sections);
  const parsedTitle = title === null ? null : parseTitleInfo(title);
  const parsedStory = parseStory(storySoFar);
  if (!parsedSections || !parsedStory || (title !== null && !parsedTitle)) return null;
  return {
    phrase,
    context: { before: context.before, after: context.after },
    title: parsedTitle,
    videoId,
    videoTimeMs,
    language,
    sections: parsedSections,
    storySoFar: parsedStory,
  };
}

export function parseClientMessage(value: unknown): ExplainClientMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === 'start') {
    const request = parseRequest(value.request);
    return request ? { type: 'start', request } : null;
  }
  if (value.type === 'follow-up') {
    const { explanationId, question } = value;
    const sections = parseSections(value.sections);
    const storySoFar = parseStory(value.storySoFar);
    if (typeof explanationId !== 'string' || !explanationId || !sections || !storySoFar) return null;
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_CHARS) return null;
    return { type: 'follow-up', explanationId, question, sections, storySoFar };
  }
  return null;
}
```

- [ ] **Step 6: Assemble the request and store the suggestions**

Replace `src/lib/claude/explain-service.ts` with:

```ts
import { CLAUDE_EXPLAIN_MAX_TOKENS, CLAUDE_IDLE_TIMEOUT_MS, CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from '@/lib/config';
import type { Explanation, FollowUp, NewExplanation, SaveSuggestion } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';
import type { ClaudeClient, StreamParams, StreamResult, SystemBlock, ToolCall } from './client';
import { learningHistoryBlock, splitStory, storyBlock, type HistorySources } from './context-blocks';
import { toExplainError } from './errors';
import { buildFollowUpMessages, buildSystemPrompt, buildUserMessage, type ExplainRequest } from './prompt';
import { ERROR_COPY, parseClientMessage, type ExplainErrorCode, type ExplainServerMessage } from './protocol';
import { SUGGEST_SAVES_TOOL, SUGGEST_SAVES_TOOL_NAME, validateSuggestions } from './suggestions';

/** The part of `chrome.runtime.Port` the service uses. */
export interface ExplainPort {
  postMessage(message: ExplainServerMessage): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface ExplainServiceDeps {
  getApiKey(): Promise<string | null>;
  createClient(apiKey: string): ClaudeClient;
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
const EMPTY_ANSWER = 'Claude returned an empty answer.';

function explanationFields(request: ExplainRequest, response: string, suggestions: SaveSuggestion[]): NewExplanation {
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
    model: CLAUDE_MODEL,
    suggestions,
  };
}

/** v2 spec §5.4: the first suggest_saves call, checked; none when Claude didn't call it. */
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
 * silent for 30 s.
 */
export function serveExplainPort(port: ExplainPort, deps: ExplainServiceDeps): void {
  const abort = new AbortController();
  let disconnected = false;
  let received = false;
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const post = (message: ExplainServerMessage) => {
    if (!disconnected) port.postMessage(message);
  };
  const fail = (code: ExplainErrorCode, message: string = ERROR_COPY[code]) => post({ type: 'error', code, message });
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, deps.idleTimeoutMs ?? CLAUDE_IDLE_TIMEOUT_MS);
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

  async function run(raw: unknown): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message) return fail('api', UNREADABLE);
    const apiKey = await deps.getApiKey();
    if (!apiKey) return fail('no-key');
    if (disconnected) return;

    let params: StreamParams;
    let finish: (result: StreamResult) => Promise<Explanation | null>;
    if (message.type === 'start') {
      const { request } = message;
      const history = learningHistoryBlock(await deps.loadHistory(), request.phrase);
      const instructions = buildSystemPrompt(request.language, request.sections);
      const { system, recent } = contextFor(instructions, request.storySoFar, request.videoTimeMs, history);
      params = {
        model: CLAUDE_MODEL,
        maxTokens: CLAUDE_EXPLAIN_MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: buildUserMessage(request, recent) }],
        tools: [SUGGEST_SAVES_TOOL],
      };
      finish = (result) =>
        deps.saveExplanation(explanationFields(request, result.text, suggestionsFrom(result.toolCalls, request.phrase)));
    } else {
      const explanation = await deps.getExplanation(message.explanationId);
      if (!explanation) return fail('api', EXPLANATION_GONE);
      const history = learningHistoryBlock(await deps.loadHistory(), explanation.phrase);
      const instructions = buildSystemPrompt(explanation.explanationLanguage, message.sections, true);
      const { system, recent } = contextFor(instructions, message.storySoFar, explanation.videoTimeMs, history);
      params = {
        model: CLAUDE_MODEL,
        maxTokens: CLAUDE_MAX_TOKENS,
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
      );
      clearTimeout(idleTimer);
      if (disconnected) return; // the card closed: nothing is saved
      if (!result.text.trim()) return fail('api', EMPTY_ANSWER);
      const explanation = await finish(result);
      if (!explanation) return fail('api', EXPLANATION_GONE);
      // The explanation is stored; not knowing which rows are saved only shows them as unsaved.
      const savedKeys = await deps.savedKeysFor(explanation).catch((): string[] => []);
      post({ type: 'done', explanation, savedKeys });
    } catch (err) {
      clearTimeout(idleTimer);
      if (disconnected) return;
      if (timedOut) return fail('network');
      const { code, message: text } = toExplainError(err);
      fail(code, text);
    }
  }
}
```

- [ ] **Step 7: Rename the payload where the content script reads it**

Replace `src/entrypoints/netflix.content/overlay/explain-port.ts` with:

```ts
import { browser } from '#imports';
import {
  ERROR_COPY,
  EXPLAIN_PORT,
  type ExplainClientMessage,
  type ExplainErrorCode,
  type ExplainServerMessage,
} from '@/lib/claude/protocol';
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
  onDone(explanation: Explanation): void;
  onError(code: ExplainErrorCode, message: string): void;
}

/**
 * Runs one request over its own Port (spec §6.3). Returns a cancel function; cancelling disconnects,
 * which aborts the request in the background. If the Port drops without an answer (the worker restarted
 * or the extension was reloaded), the card shows "Couldn't reach Claude".
 */
export function streamExplanation(connect: Connect, message: ExplainClientMessage, handlers: StreamHandlers): () => void {
  let finished = false;
  let port: PortLike;
  try {
    port = connect();
  } catch {
    handlers.onError('network', ERROR_COPY.network);
    return () => {};
  }
  port.onMessage.addListener((raw) => {
    if (finished) return;
    const m = raw as ExplainServerMessage;
    if (m.type === 'delta') {
      handlers.onDelta(m.text);
    } else if (m.type === 'done') {
      finished = true;
      handlers.onDone(m.explanation);
      port.disconnect();
    } else if (m.type === 'error') {
      finished = true;
      handlers.onError(m.code, m.message);
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    if (finished) return;
    finished = true;
    handlers.onError('network', ERROR_COPY.network);
  });
  port.postMessage(message);
  return () => {
    if (finished) return;
    finished = true;
    port.disconnect();
  };
}
```

In `src/entrypoints/netflix.content/overlay/explain-controller.ts` make two edits. Task 9 rewrites this file and sends the real story.

1. In `open()`, add `storySoFar: [],` as the last property of the `const req: ExplainRequest = { … }` literal, after `sections: settings.cardSections,`.
2. In `askFollowUp`, replace the follow-up message

```ts
        { type: 'follow-up', entryId: card.entry.id, question: text, sections: settings.cardSections },
```

with

```ts
        { type: 'follow-up', explanationId: card.entry.id, question: text, sections: settings.cardSections, storySoFar: [] },
```

In `tests/unit/explain-flow.test.ts`, rename the payloads:

1. In `'posts the request, streams deltas, finishes with the entry, then disconnects'`, replace

```ts
    streamExplanation(() => fake.port, { type: 'follow-up', entryId: 'e', question: 'q', sections: DEFAULT_SETTINGS.cardSections }, {
```

with

```ts
    streamExplanation(() => fake.port, { type: 'follow-up', explanationId: 'e', question: 'q', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] }, {
```

and replace `fake.receive({ type: 'done', entry: { id: 'e' } });` with `fake.receive({ type: 'done', explanation: { id: 'e' }, savedKeys: [] });`.

2. In `'streams a new explanation with the line, its context, the title, and the line start'`, add `storySoFar: [],` after `sections: settings.cardSections,` in the expected `request`, and replace

```ts
    ports[0]!.receive({ type: 'done', entry: { ...SAVED, response: 'Hello', followUps: [] } });
```

with

```ts
    ports[0]!.receive({ type: 'done', explanation: { ...SAVED, response: 'Hello', followUps: [] }, savedKeys: [] });
```

3. In `'a follow-up streams under its question and keeps the updated entry'`, replace

```ts
    expect(ports[0]!.posted[0]).toEqual({ type: 'follow-up', entryId: 'e1', question: 'Is it formal?', sections: settings.cardSections });
```

with

```ts
    expect(ports[0]!.posted[0]).toEqual({
      type: 'follow-up',
      explanationId: 'e1',
      question: 'Is it formal?',
      sections: settings.cardSections,
      storySoFar: [],
    });
```

and replace

```ts
    ports[0]!.receive({ type: 'done', entry: { ...SAVED, followUps: [{ question: 'Is it formal?', answer: 'No.' }] } });
```

with

```ts
    ports[0]!.receive({ type: 'done', explanation: { ...SAVED, followUps: [{ question: 'Is it formal?', answer: 'No.' }] }, savedKeys: [] });
```

- [ ] **Step 8: Wire the new dependencies in the background**

In `src/entrypoints/background.ts`, replace the `@/lib/study-log/store` import with these two imports:

```ts
import { listItems, savedKeysFor } from '@/lib/study-log/items';
import { appendFollowUp, findExplanation, getExplanation, listExplanations, saveExplanation } from '@/lib/study-log/store';
```

and replace the `browser.runtime.onConnect.addListener(…)` block with:

```ts
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EXPLAIN_PORT || port.sender?.id !== browser.runtime.id) return;
    serveExplainPort(port as unknown as ExplainPort, {
      getApiKey,
      createClient: createSdkClient,
      saveExplanation: (fields) => saveExplanation(fields),
      getExplanation,
      appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
      loadHistory: async () => ({ items: await listItems(), explanations: await listExplanations() }),
      savedKeysFor,
    });
  });
```

- [ ] **Step 9: Run the tests to make sure they pass**

Run: `pnpm vitest run tests/unit/claude.test.ts tests/unit/explain-service.test.ts tests/unit/explain-flow.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the whole suite and the type check**

Run: `pnpm test && pnpm compile`
Expected: every test passes; `tsc` reports no errors.

- [ ] **Step 11: Commit**

```bash
git add src/lib/claude/prompt.ts src/lib/claude/protocol.ts src/lib/claude/explain-service.ts \
  src/entrypoints/netflix.content/overlay/explain-port.ts src/entrypoints/netflix.content/overlay/explain-controller.ts \
  src/entrypoints/background.ts tests/unit/claude.test.ts tests/unit/explain-service.test.ts tests/unit/explain-flow.test.ts
git commit -m "feat(claude): send the story so far and learning history as cached blocks; store save suggestions" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 8: Background requests for saving items, and migration on update

v2 spec §4.2 (messages), §3.3 (one-time conversion). The Netflix card saves and unsaves rows through the background, which owns Study Log writes from Netflix. A row is accepted only if it is one of the rows the card shows for that explanation (`cardRows(explanation.suggestions, explanation.phrase)`), and every stored field comes from the stored `Explanation`, never from the page. `'log:find'` becomes `'explanation:find'`, which also returns the keys of the line's saved rows. The background runs the v2 conversion when the extension is installed or updated.

**Files:**
- Modify: `src/lib/messages.ts` (whole file below)
- Modify: `src/lib/background/message-handler.ts` (whole file below)
- Modify: `src/entrypoints/background.ts` (whole file below)
- Modify: `src/entrypoints/netflix.content/index.ts` (one call site; Task 9 finishes the wiring)
- Test: `tests/unit/background-messages.test.ts` (whole file below)

**Interfaces:**
- Consumes:
  - `cardRows` from `src/lib/claude/suggestions.ts` (Task 3).
  - `suggestionKey`, `saveItem`, `unsaveItem`, `savedKeysFor`, `listItems`, `migrateStudyLogV2` from `src/lib/study-log/items.ts` (Task 2).
  - `isSaveSuggestion`, `Explanation`, `SaveSuggestion`, `SavedItem`, `NewExplanation` from `src/lib/study-log/types.ts` (Tasks 1–2).
  - `findExplanation`, `getExplanation`, `listExplanations`, `saveExplanation`, `appendFollowUp` from `src/lib/study-log/store.ts` (Task 1).
  - `ClaudeClient` with `stream` from `src/lib/claude/client.ts` (Task 6).
  - The port wiring from Task 7.
- Produces (Interface Contract):
  - `BackgroundRequests['explanation:find' | 'item:save' | 'item:remove']`.
  - `MessageHandlerDeps` with `findExplanation`, `getExplanation`, `saveItem`, `unsaveItem`, `savedKeysFor`.
  - Errors thrown by the handler (the background replies `{ error }`, and `sendToBackground` rejects):
    - `'Bad request'`: `explanationId` not a string, or `suggestion` not a `SaveSuggestion`.
    - `'Explanation not found'`.
    - `'Not a suggestion of this explanation'`.
  - `'log:find'` no longer exists, so it answers `Unknown request log:find`.

- [ ] **Step 1: Write the failing tests**

Replace `tests/unit/background-messages.test.ts` with:

```ts
import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getApiKey, maskApiKey, removeApiKey, setApiKey } from '@/lib/api-key';
import { createMessageHandler, type MessageHandlerDeps } from '@/lib/background/message-handler';
import type { ClaudeClient } from '@/lib/claude/client';
import { PENDING_SEEK_MAX_AGE_MS, setPendingSeek, takePendingSeek } from '@/lib/pending-seek';
import { listItems, saveItem, savedKeysFor, suggestionKey, unsaveItem } from '@/lib/study-log/items';
import { findExplanation, getExplanation, saveExplanation } from '@/lib/study-log/store';
import type { NewExplanation } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());

const KEY = 'sk-ant-api03-abcdefghijklmnop-wxyz';
const FROM_PAGE = { fromExtensionPage: true };
const FROM_NETFLIX = { fromExtensionPage: false };

const LINE: NewExplanation = {
  phrase: "I'm gonna call it a night.",
  response: '## Meaning\nTime to sleep.',
  videoTimeMs: 1_834_200,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: ['Where are you going?'], after: ['Night.'] },
  explanationLanguage: 'ko',
  model: 'claude-sonnet-5-5',
  suggestions: [
    { type: 'idiom', text: 'call it a night', meaning: '그만 자러 가다' },
    { type: 'word', text: 'gonna', meaning: 'going to' },
  ],
};

function handlerWith(checkKey: ClaudeClient['checkKey'] = async () => {}, over: Partial<MessageHandlerDeps> = {}) {
  const createClient = vi.fn((_key: string): ClaudeClient => ({ stream: async () => ({ text: '', toolCalls: [] }), checkKey }));
  const openOptions = vi.fn(async (_hash?: string) => {});
  const serve = createMessageHandler({
    getApiKey,
    setApiKey,
    removeApiKey,
    createClient,
    findExplanation,
    getExplanation,
    saveItem: (explanation, suggestion) => saveItem(explanation, suggestion),
    unsaveItem: (explanation, suggestion) => unsaveItem(explanation, suggestion),
    savedKeysFor,
    takePendingSeek: (videoId) => takePendingSeek(videoId),
    openOptions,
    ...over,
  });
  const handle = (message: unknown, context = FROM_PAGE) => serve(message, context);
  return { handle, createClient, openOptions };
}

describe('API key requests', () => {
  it('stores, reports (masked), and removes the key, never echoing it back', async () => {
    const { handle } = handlerWith();
    const replies: unknown[] = [];
    replies.push(await handle({ type: 'api-key:status' }));
    replies.push(await handle({ type: 'api-key:set', key: `  ${KEY}  ` }));
    replies.push(await handle({ type: 'api-key:status' }));
    expect(replies).toEqual([
      { set: false, masked: null },
      { ok: true },
      { set: true, masked: maskApiKey(KEY) },
    ]);
    expect(maskApiKey(KEY)).toBe('sk-ant-…wxyz');
    expect(await getApiKey()).toBe(KEY);
    expect(JSON.stringify(replies)).not.toContain('abcdefghijklmnop');
    expect(await handle({ type: 'api-key:remove' })).toEqual({ ok: true });
    expect(await handle({ type: 'api-key:status' })).toEqual({ set: false, masked: null });
  });

  it('refuses keys that are empty or contain spaces, invisible, or non-ASCII characters', async () => {
    const { handle } = handlerWith();
    expect(await handle({ type: 'api-key:set', key: '   ' })).toEqual({ ok: false });
    expect(await handle({ type: 'api-key:set', key: 'two words' })).toEqual({ ok: false });
    expect(await handle({ type: 'api-key:set', key: 'sk-ant-\u200babc' })).toEqual({ ok: false });
    expect(await handle({ type: 'api-key:set', key: 'sk-ant-\u00e9abc' })).toEqual({ ok: false });
    expect(await getApiKey()).toBeNull();
  });

  it('Test key refuses a typed key that does not look like one, without calling Anthropic', async () => {
    const { handle, createClient } = handlerWith();
    expect(await handle({ type: 'api-key:test', key: 'two words' })).toEqual({
      result: 'rejected',
      message: "That doesn't look like an API key.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('only LingoFlix pages may set, remove, or test the key; anyone may read its status', async () => {
    const { handle, createClient } = handlerWith();
    await expect(handle({ type: 'api-key:set', key: KEY }, FROM_NETFLIX)).rejects.toThrow(/Not allowed/);
    expect(await getApiKey()).toBeNull();
    await setApiKey(KEY);
    await expect(handle({ type: 'api-key:remove' }, FROM_NETFLIX)).rejects.toThrow(/Not allowed/);
    await expect(handle({ type: 'api-key:test' }, FROM_NETFLIX)).rejects.toThrow(/Not allowed/);
    expect(createClient).not.toHaveBeenCalled();
    expect(await getApiKey()).toBe(KEY);
    expect(await handle({ type: 'api-key:status' }, FROM_NETFLIX)).toEqual({ set: true, masked: maskApiKey(KEY) });
  });

  it('Test key: valid, rejected, or network, using the typed key, else the saved one', async () => {
    await setApiKey(KEY);
    const ok = handlerWith();
    expect(await ok.handle({ type: 'api-key:test' })).toEqual({ result: 'valid', message: 'Your key works.' });
    expect(ok.createClient).toHaveBeenCalledWith(KEY);
    await ok.handle({ type: 'api-key:test', key: ' sk-ant-typed ' });
    expect(ok.createClient).toHaveBeenLastCalledWith('sk-ant-typed');

    const rejected = handlerWith(async () => {
      throw APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid' } }, 'x', new Headers());
    });
    expect(await rejected.handle({ type: 'api-key:test' })).toEqual({ result: 'rejected', message: 'Anthropic rejected this key.' });

    const offline = handlerWith(async () => {
      throw new APIConnectionError({ message: 'fetch failed' });
    });
    expect(await offline.handle({ type: 'api-key:test' })).toEqual({
      result: 'network',
      message: "Couldn't reach Anthropic. Check your connection.",
    });
  });

  it('Test key without any key says so', async () => {
    const { handle } = handlerWith();
    expect(await handle({ type: 'api-key:test' })).toEqual({ result: 'rejected', message: 'No API key to test.' });
  });
});

describe('explanations and saved items', () => {
  it('explanation:find returns the stored explanation of a line with the keys of its saved rows', async () => {
    const stored = await saveExplanation(LINE);
    await saveItem(stored, stored.suggestions[0]!);
    const { handle } = handlerWith();
    expect(await handle({ type: 'explanation:find', videoId: '80077211', language: 'ko', phrase: "I'm gonna  call it a night." }, FROM_NETFLIX)).toEqual({
      explanation: stored,
      savedKeys: [suggestionKey(stored, stored.suggestions[0]!)],
    });
    expect(await handle({ type: 'explanation:find', videoId: '80077211', language: 'en', phrase: LINE.phrase })).toEqual({
      explanation: null,
      savedKeys: [],
    });
    expect(await handle({ type: 'explanation:find', videoId: 7 })).toEqual({ explanation: null, savedKeys: [] });
  });

  it('item:save stores a row the card offers, with every field from storage, once', async () => {
    const stored = await saveExplanation(LINE);
    const { handle } = handlerWith();
    // Case and spacing don't matter; the meaning the page sends is ignored.
    const reply = await handle(
      { type: 'item:save', explanationId: stored.id, suggestion: { type: 'idiom', text: 'Call it  a night', meaning: 'tampered' } },
      FROM_NETFLIX,
    );
    expect(reply).toEqual({ key: suggestionKey(stored, stored.suggestions[0]!) });
    await handle({ type: 'item:save', explanationId: stored.id, suggestion: stored.suggestions[0] }, FROM_NETFLIX);
    const items = await listItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'idiom',
      text: 'call it a night',
      meaning: '그만 자러 가다',
      explanationId: stored.id,
      line: LINE.phrase,
      lineTimeMs: 1_834_200,
      context: LINE.context,
      videoId: '80077211',
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      explanationLanguage: 'ko',
    });
  });

  it('the whole line can always be saved, even without a line suggestion', async () => {
    const stored = await saveExplanation(LINE);
    const { handle } = handlerWith();
    const wholeLine = { type: 'line', text: LINE.phrase, meaning: '' };
    expect(await handle({ type: 'item:save', explanationId: stored.id, suggestion: wholeLine }, FROM_NETFLIX)).toEqual({
      key: suggestionKey(stored, { type: 'line', text: LINE.phrase }),
    });
    expect(await listItems()).toEqual([expect.objectContaining({ type: 'line', text: LINE.phrase, meaning: '', explanationId: stored.id })]);
  });

  it('refuses rows the explanation does not offer, unknown explanations, and malformed requests', async () => {
    const stored = await saveExplanation(LINE);
    const { handle } = handlerWith();
    const save = (explanationId: unknown, suggestion: unknown) => handle({ type: 'item:save', explanationId, suggestion }, FROM_NETFLIX);
    await expect(save(stored.id, { type: 'word', text: 'night', meaning: 'x' })).rejects.toThrow('Not a suggestion of this explanation');
    await expect(save(stored.id, { type: 'phrase', text: 'call it a night', meaning: '' })).rejects.toThrow('Not a suggestion of this explanation');
    await expect(save('gone', stored.suggestions[0])).rejects.toThrow('Explanation not found');
    await expect(save(stored.id, { type: 'word', text: 'gonna' })).rejects.toThrow('Bad request');
    await expect(save(42, stored.suggestions[0])).rejects.toThrow('Bad request');
    await expect(handle({ type: 'item:remove', explanationId: stored.id, suggestion: 'gonna' }, FROM_NETFLIX)).rejects.toThrow('Bad request');
    expect(await listItems()).toEqual([]);
  });

  it('item:remove removes the saved row, and does nothing when it is not saved', async () => {
    const stored = await saveExplanation(LINE);
    const { handle } = handlerWith();
    const word = stored.suggestions[1]!;
    await handle({ type: 'item:save', explanationId: stored.id, suggestion: word }, FROM_NETFLIX);
    expect(await listItems()).toHaveLength(1);
    const reply = { key: suggestionKey(stored, word) };
    expect(await handle({ type: 'item:remove', explanationId: stored.id, suggestion: word }, FROM_NETFLIX)).toEqual(reply);
    expect(await listItems()).toEqual([]);
    expect(await handle({ type: 'item:remove', explanationId: stored.id, suggestion: word }, FROM_NETFLIX)).toEqual(reply);
  });
});

describe('pending seek', () => {
  it('a pending seek is taken once, by its own video, within 2 minutes', async () => {
    const now = Date.now();
    await setPendingSeek('42', 30_000, now);
    expect(await takePendingSeek('7', now + 1000)).toBeNull(); // another video doesn't consume it
    expect(await takePendingSeek('42', now + 1000)).toBe(30_000);
    expect(await takePendingSeek('42', now + 2000)).toBeNull(); // already taken
    await setPendingSeek('42', 30_000, now);
    expect(await takePendingSeek('42', now + PENDING_SEEK_MAX_AGE_MS + 1)).toBeNull(); // stale
    const { handle } = handlerWith();
    await setPendingSeek('42', 5000);
    expect(await handle({ type: 'pending-seek:take', videoId: '42' })).toEqual({ timeMs: 5000 });
  });
});

describe('other requests', () => {
  it('opens the options page, only at known routes', async () => {
    const { handle, openOptions } = handlerWith();
    await handle({ type: 'open-options', hash: '#/study-log' });
    await handle({ type: 'open-options', hash: 'javascript:alert(1)' });
    expect(openOptions.mock.calls).toEqual([['#/study-log'], ['']]);
  });

  it('rejects unknown requests, including the old log:find', async () => {
    const { handle } = handlerWith();
    await expect(handle({ type: 'nope' })).rejects.toThrow(/Unknown request/);
    await expect(handle('nope')).rejects.toThrow(/Unknown request/);
    await expect(handle({ type: 'log:find', videoId: '1', language: 'en', phrase: 'x' })).rejects.toThrow(/Unknown request log:find/);
  });
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `pnpm vitest run tests/unit/background-messages.test.ts`
Expected: FAIL. `createMessageHandler` has no `explanation:find`, `item:save` or `item:remove` cases, so those requests reject with "Unknown request". `log:find` still answers, and the `MessageHandlerDeps` passed in don't match its type.

- [ ] **Step 3: Declare the requests**

Replace `src/lib/messages.ts` with:

```ts
import { browser } from '#imports';
import type { Explanation, SaveSuggestion } from '@/lib/study-log/types';

export type KeyTestResult = 'valid' | 'rejected' | 'network' | 'error';

/** Requests answered by the background worker (spec §6.3, v2 spec §4.2), with their responses. */
export interface BackgroundRequests {
  'api-key:status': { request: object; response: { set: boolean; masked: string | null } };
  'api-key:set': { request: { key: string }; response: { ok: boolean } };
  'api-key:remove': { request: object; response: { ok: true } };
  'api-key:test': { request: { key?: string }; response: { result: KeyTestResult; message: string } };
  /** The stored explanation of a line, and the index keys of its card rows that are saved. */
  'explanation:find': {
    request: { videoId: string; language: string; phrase: string };
    response: { explanation: Explanation | null; savedKeys: string[] };
  };
  /** Saves one of the explanation's card rows; answers with its index key. */
  'item:save': { request: { explanationId: string; suggestion: SaveSuggestion }; response: { key: string } };
  /** Removes the saved item of one of the explanation's card rows (no-op when not saved). */
  'item:remove': { request: { explanationId: string; suggestion: SaveSuggestion }; response: { key: string } };
  'pending-seek:take': { request: { videoId: string }; response: { timeMs: number | null } };
  'open-options': { request: { hash?: string }; response: { ok: true } };
}

export type BackgroundRequestType = keyof BackgroundRequests;
export type BackgroundRequest<T extends BackgroundRequestType> = { type: T } & BackgroundRequests[T]['request'];
export type BackgroundResponse<T extends BackgroundRequestType> = BackgroundRequests[T]['response'];

export async function sendToBackground<T extends BackgroundRequestType>(message: BackgroundRequest<T>): Promise<BackgroundResponse<T>> {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (typeof response === 'object' && response !== null && 'error' in response) {
    throw new Error(String((response as { error: unknown }).error));
  }
  return response as BackgroundResponse<T>;
}
```

- [ ] **Step 4: Answer them**

Replace `src/lib/background/message-handler.ts` with:

```ts
import { maskApiKey } from '@/lib/api-key';
import type { ClaudeClient } from '@/lib/claude/client';
import { toExplainError } from '@/lib/claude/errors';
import { cardRows } from '@/lib/claude/suggestions';
import type { BackgroundResponse } from '@/lib/messages';
import { suggestionKey } from '@/lib/study-log/items';
import { isSaveSuggestion, type Explanation, type SavedItem, type SaveSuggestion } from '@/lib/study-log/types';
import { normalizeLine } from '@/lib/subtitles/cue';

export interface MessageHandlerDeps {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  removeApiKey(): Promise<void>;
  createClient(apiKey: string): ClaudeClient;
  findExplanation(videoId: string, language: string, phrase: string): Promise<Explanation | null>;
  getExplanation(id: string): Promise<Explanation | null>;
  saveItem(explanation: Explanation, suggestion: SaveSuggestion): Promise<SavedItem>;
  unsaveItem(explanation: Explanation, suggestion: SaveSuggestion): Promise<void>;
  savedKeysFor(explanation: Explanation): Promise<string[]>;
  takePendingSeek(videoId: string): Promise<number | null>;
  openOptions(hash: string): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A pasted key: printable ASCII only (no spaces, no invisible or non-ASCII characters), a sane length.
 * Anthropic's own check happens in Test key.
 */
const looksLikeKey = (key: string) => /^[\x21-\x7e]{1,300}$/.test(key);
const NOT_A_KEY = "That doesn't look like an API key.";
const OPTIONS_ROUTE = /^#\/[a-z-]*$/;
/** Requests that change or use the key: only LingoFlix's own pages (options, popup) may send them. */
const PAGE_ONLY = new Set(['api-key:set', 'api-key:remove', 'api-key:test']);

const sameText = (a: string, b: string) => normalizeLine(a).toLowerCase() === normalizeLine(b).toLowerCase();

export interface MessageContext {
  /** The sender is one of LingoFlix's own pages, not a content script on Netflix. */
  fromExtensionPage: boolean;
}

export function createMessageHandler(deps: MessageHandlerDeps): (message: unknown, context: MessageContext) => Promise<unknown> {
  async function testKey(key: string | null): Promise<BackgroundResponse<'api-key:test'>> {
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
  }

  /**
   * v2 spec §4.2: the row must be one the card shows for this explanation. The stored row is used, never
   * the page's copy, and the item's source fields come from the stored explanation.
   */
  async function rowOf(m: Record<string, unknown>): Promise<{ explanation: Explanation; row: SaveSuggestion }> {
    const { explanationId, suggestion } = m;
    if (typeof explanationId !== 'string' || !isSaveSuggestion(suggestion)) throw new Error('Bad request');
    const explanation = await deps.getExplanation(explanationId);
    if (!explanation) throw new Error('Explanation not found');
    const row = cardRows(explanation.suggestions, explanation.phrase).find(
      (r) => r.type === suggestion.type && sameText(r.text, suggestion.text),
    );
    if (!row) throw new Error('Not a suggestion of this explanation');
    return { explanation, row };
  }

  return async (message, context) => {
    const type = isRecord(message) ? message.type : undefined;
    const m = isRecord(message) ? message : {};
    if (typeof type === 'string' && PAGE_ONLY.has(type) && !context.fromExtensionPage) throw new Error('Not allowed');
    switch (type) {
      case 'api-key:status': {
        const key = await deps.getApiKey();
        return { set: key !== null, masked: key ? maskApiKey(key) : null } satisfies BackgroundResponse<'api-key:status'>;
      }
      case 'api-key:set': {
        const key = typeof m.key === 'string' ? m.key.trim() : '';
        if (!looksLikeKey(key)) return { ok: false } satisfies BackgroundResponse<'api-key:set'>;
        await deps.setApiKey(key);
        return { ok: true } satisfies BackgroundResponse<'api-key:set'>;
      }
      case 'api-key:remove':
        await deps.removeApiKey();
        return { ok: true } satisfies BackgroundResponse<'api-key:remove'>;
      case 'api-key:test': {
        const typed = typeof m.key === 'string' ? m.key.trim() : '';
        if (typed && !looksLikeKey(typed)) return { result: 'rejected', message: NOT_A_KEY } satisfies BackgroundResponse<'api-key:test'>;
        return testKey(typed || (await deps.getApiKey()));
      }
      case 'explanation:find': {
        const { videoId, language, phrase } = m;
        if (typeof videoId !== 'string' || typeof language !== 'string' || typeof phrase !== 'string') {
          return { explanation: null, savedKeys: [] } satisfies BackgroundResponse<'explanation:find'>;
        }
        const explanation = await deps.findExplanation(videoId, language, phrase);
        return {
          explanation,
          savedKeys: explanation ? await deps.savedKeysFor(explanation) : [],
        } satisfies BackgroundResponse<'explanation:find'>;
      }
      case 'item:save': {
        const { explanation, row } = await rowOf(m);
        await deps.saveItem(explanation, row);
        return { key: suggestionKey(explanation, row) } satisfies BackgroundResponse<'item:save'>;
      }
      case 'item:remove': {
        const { explanation, row } = await rowOf(m);
        await deps.unsaveItem(explanation, row);
        return { key: suggestionKey(explanation, row) } satisfies BackgroundResponse<'item:remove'>;
      }
      case 'pending-seek:take':
        return {
          timeMs: typeof m.videoId === 'string' ? await deps.takePendingSeek(m.videoId) : null,
        } satisfies BackgroundResponse<'pending-seek:take'>;
      case 'open-options': {
        const hash = typeof m.hash === 'string' && OPTIONS_ROUTE.test(m.hash) ? m.hash : '';
        await deps.openOptions(hash);
        return { ok: true } satisfies BackgroundResponse<'open-options'>;
      }
      default:
        throw new Error(`Unknown request ${String(type)}`);
    }
  };
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `pnpm vitest run tests/unit/background-messages.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the background and run the conversion on install and update**

Replace `src/entrypoints/background.ts` with the file below. The `onConnect` block is the one from Task 7. The conversion isn't unit-tested here: this is entrypoint wiring, and `migrateStudyLogV2` itself is tested in Task 2. The options page also runs it before listing the Study Log (Task 10), so a failure here only delays it.

```ts
import { browser, defineBackground } from '#imports';
import { getApiKey, removeApiKey, setApiKey } from '@/lib/api-key';
import { createMessageHandler } from '@/lib/background/message-handler';
import { createSdkClient } from '@/lib/claude/client';
import { serveExplainPort, type ExplainPort } from '@/lib/claude/explain-service';
import { EXPLAIN_PORT } from '@/lib/claude/protocol';
import { takePendingSeek } from '@/lib/pending-seek';
import { listItems, migrateStudyLogV2, saveItem, savedKeysFor, unsaveItem } from '@/lib/study-log/items';
import { appendFollowUp, findExplanation, getExplanation, listExplanations, saveExplanation } from '@/lib/study-log/store';

export default defineBackground(() => {
  // v2 spec §3.3: lines explained before v2 become saved whole-line items, once.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install' || reason === 'update') void migrateStudyLogV2().catch(() => undefined);
  });

  const handle = createMessageHandler({
    getApiKey,
    setApiKey,
    removeApiKey,
    createClient: createSdkClient,
    findExplanation,
    getExplanation,
    saveItem: (explanation, suggestion) => saveItem(explanation, suggestion),
    unsaveItem: (explanation, suggestion) => unsaveItem(explanation, suggestion),
    savedKeysFor,
    takePendingSeek: (videoId) => takePendingSeek(videoId),
    openOptions: async (hash) => {
      await browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}${hash}` });
    },
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return undefined; // only LingoFlix's own pages and scripts
    // By URL, not by `sender.tab`: the options page opens in a tab too.
    const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(browser.runtime.getURL('/'));
    handle(message, { fromExtensionPage }).then(sendResponse, (err: unknown) => sendResponse({ error: String(err) }));
    return true; // respond asynchronously
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EXPLAIN_PORT || port.sender?.id !== browser.runtime.id) return;
    serveExplainPort(port as unknown as ExplainPort, {
      getApiKey,
      createClient: createSdkClient,
      saveExplanation: (fields) => saveExplanation(fields),
      getExplanation,
      appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
      loadHistory: async () => ({ items: await listItems(), explanations: await listExplanations() }),
      savedKeysFor,
    });
  });
});
```

- [ ] **Step 7: Keep the content script compiling**

`'log:find'` no longer exists. In `src/entrypoints/netflix.content/index.ts`, replace

```ts
        (await sendToBackground({ type: 'log:find', videoId, language, phrase })).entry,
```

with

```ts
        (await sendToBackground({ type: 'explanation:find', videoId, language, phrase })).explanation,
```

Task 9 replaces this dependency with `findExplanation`, which also uses the `savedKeys`.

- [ ] **Step 8: Run the whole suite, the type check, and the build**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: every test passes; `tsc` reports no errors; the build finishes.

- [ ] **Step 9: Commit**

```bash
git add src/lib/messages.ts src/lib/background/message-handler.ts src/entrypoints/background.ts \
  src/entrypoints/netflix.content/index.ts tests/unit/background-messages.test.ts
git commit -m "feat(background): save and unsave card rows, find explanations with saved keys, convert on update" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 9: The card's Save section

v2 spec §4.1 (layout, toggles, "Explained before", Regenerate), §4.2 (messages), §5.2 (the story so far comes from the session), §9 (save errors). When the explanation finishes, the card shows Claude's suggestions with Save toggles. A **Whole line** row is always last. Saving and removing go through the background (Task 8), and the card tracks which rows are saved by their index keys. The controller now sends the story so far, and sends the same story with follow-ups.

**Files:**
- Modify: `src/entrypoints/netflix.content/overlay/card-state.ts` (whole file below)
- Modify: `src/entrypoints/netflix.content/overlay/explain-port.ts` (whole file below)
- Modify: `src/entrypoints/netflix.content/overlay/explain-controller.ts` (whole file below)
- Modify: `src/entrypoints/netflix.content/overlay/Card.tsx` (whole file below)
- Modify: `src/entrypoints/netflix.content/overlay/OverlayApp.tsx` (whole file below)
- Modify: `src/entrypoints/netflix.content/index.ts` (two wiring edits)
- Test: `tests/unit/card.test.tsx` (whole file below), `tests/unit/explain-flow.test.ts` (whole file below)

**Interfaces:**
- Consumes:
  - `cardRows` from `src/lib/claude/suggestions.ts` (Task 3).
  - `suggestionKey` from `src/lib/study-log/items.ts` (Task 2).
  - `Explanation`, `SaveSuggestion`, `ItemType` from `src/lib/study-log/types.ts` (Task 1).
  - `SubtitleSession.storySoFar(line)` and `Settings.sendStorySoFar` (Task 4).
  - `StoryLine` from `src/lib/subtitles/context.ts` (Task 4).
  - The `done` payload `{ explanation, savedKeys }` and the follow-up message shape (Task 7).
  - `BackgroundRequests['explanation:find' | 'item:save' | 'item:remove']` (Task 8).
- Produces (Interface Contract):
  - `CardState` with `explanation`, `explainedBefore`, `savedKeys`, `saveStatus`, plus `SaveStatus = 'saving' | 'error'`.
  - `ExplainController.toggleSave(row)`.
  - `ExplainControllerDeps.findExplanation`, `saveItem`, `unsaveItem`.
  - `StreamHandlers.onDone(explanation, savedKeys)`.
  - `CardProps.onToggleSave(row)`.
- Card copy, verbatim:
  - the section heading **Save**;
  - row buttons labelled **Save** (Lucide `Plus`), **Saved** (Lucide `Check`, `aria-pressed="true"`), and **Couldn't save** after a failed save, with Lucide `Loader2` while saving;
  - the button's accessible name `Save "<text>"`, or `Save whole line` for the line row;
  - the line row's text **Whole line**;
  - type badges **WORD**, **PHRASE**, **IDIOM**, **LINE**;
  - the footer label **Explained before** (Lucide `BookOpen`), replacing "From your Study Log".
- Behavior (v2 spec §9): a failed save shows "Couldn't save" on its row. A failed removal stays **Saved**. Tapping the row again retries either. While a row is saving, its button is disabled and further taps are ignored.

- [ ] **Step 1: Write the failing card tests**

Replace `tests/unit/card.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Card } from '@/entrypoints/netflix.content/overlay/Card';
import type { CardState } from '@/entrypoints/netflix.content/overlay/card-state';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { suggestionKey } from '@/lib/study-log/items';
import type { Explanation, SaveSuggestion } from '@/lib/study-log/types';

afterEach(cleanup);

const LINE = "I'm gonna call it\na night.";
const IDIOM: SaveSuggestion = { type: 'idiom', text: 'call it a night', meaning: 'end the evening' };
const WORD: SaveSuggestion = { type: 'word', text: 'gonna', meaning: 'going to (casual)' };
const EXPLANATION = { id: 'e1', videoId: '80077211', phrase: LINE, followUps: [], suggestions: [IDIOM, WORD] } as unknown as Explanation;
const key = (row: Pick<SaveSuggestion, 'type' | 'text'>) => suggestionKey(EXPLANATION, row);

const BASE: CardState = {
  key: 1,
  line: LINE,
  anchor: null,
  openedBy: 'hover',
  status: 'done',
  response: '## Meaning\nTime to **sleep**. See [this](https://example.com).\n\nPlain <b>bold</b> text.\n\n<script>alert(1)</script>',
  explanation: EXPLANATION,
  error: null,
  followUps: [],
  followUpBusy: false,
  sections: DEFAULT_SETTINGS.cardSections,
  explainedBefore: true,
  savedKeys: [],
  saveStatus: {},
};

function renderCard(over: Partial<CardState> = {}) {
  const handlers = {
    onRegenerate: vi.fn(),
    onRetry: vi.fn(),
    onFollowUp: vi.fn(),
    onToggleSave: vi.fn(),
    onClose: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  render(<Card card={{ ...BASE, ...over }} player={{ left: 0, top: 0, width: 1280, height: 720 }} {...handlers} />);
  return handlers;
}

const saveSection = () => screen.getByRole('region', { name: 'Save' });
const saveButtonNames = () => within(saveSection()).getAllByRole('button').map((b) => b.getAttribute('aria-label'));

describe('explanation card', () => {
  it('shows the line and the explanation as Markdown: no links, no raw HTML', () => {
    renderCard();
    expect(screen.getByRole('dialog', { name: 'LingoFlix explanation' }).textContent).toContain("I'm gonna call it");
    expect(screen.getByRole('heading', { name: 'Meaning' })).toBeTruthy();
    expect(screen.getByText('sleep').tagName).toBe('STRONG');
    expect(screen.getByText('this')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('b, script')).toBeNull(); // raw HTML is dropped, its text stays plain
    expect(dialog.textContent).not.toContain('alert(1)');
  });

  it('says "Explained before" only for an explanation from the history', () => {
    renderCard();
    expect(screen.getByText('Explained before')).toBeTruthy();
    expect(screen.queryByText('From your Study Log')).toBeNull();
    cleanup();
    renderCard({ explainedBefore: false });
    expect(screen.queryByText('Explained before')).toBeNull();
  });

  it('Regenerate and Close call back', () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(h.onRegenerate).toHaveBeenCalled();
    expect(h.onClose).toHaveBeenCalled();
  });

  it('shows "Thinking…" while loading, without Regenerate or a Save section', () => {
    renderCard({ status: 'loading', response: '', explanation: null, explainedBefore: false });
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Save' })).toBeNull();
  });

  it('error cards follow spec §7.4', () => {
    const noKey = renderCard({ status: 'error', response: '', explanation: null, error: { code: 'no-key', message: 'Add your Claude API key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(noKey.onOpenSettings).toHaveBeenCalled();
    cleanup();
    const offline = renderCard({ status: 'error', response: '', explanation: null, error: { code: 'network', message: "Couldn't reach Claude" } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(offline.onRetry).toHaveBeenCalled();
    cleanup();
    renderCard({ status: 'error', response: '', explanation: null, error: { code: 'api', message: 'Your credit balance is too low.' } });
    expect(screen.getByRole('alert').textContent).toBe('Your credit balance is too low.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Save' })).toBeNull();
    cleanup();
    renderCard({
      status: 'error',
      line: '',
      response: '',
      explanation: null,
      error: { code: 'image-subs', message: "This title's subtitles can't be read as text" },
    });
    expect(screen.getByRole('alert').textContent).toBe("This title's subtitles can't be read as text");
  });

  it('follow-up: Enter sends, Shift+Enter does not', () => {
    const h = renderCard();
    const box = screen.getByLabelText('Ask a follow-up question');
    fireEvent.change(box, { target: { value: '  Is it rude?  ' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(h.onFollowUp).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(h.onFollowUp).toHaveBeenCalledWith('Is it rude?');
  });

  it('a follow-up question is capped at the 2000 characters the background accepts', () => {
    renderCard();
    expect(screen.getByLabelText('Ask a follow-up question').getAttribute('maxlength')).toBe('2000');
  });

  it('Enter during IME composition does not send', () => {
    const h = renderCard();
    const box = screen.getByLabelText('Ask a follow-up question');
    fireEvent.change(box, { target: { value: '격식' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(h.onFollowUp).not.toHaveBeenCalled();
  });

  it('shows follow-ups, and hides the box when the section is off or the card is not done', () => {
    renderCard({ followUps: [{ question: 'Is it rude?', answer: 'Not at **all**.', status: 'done', error: null }] });
    expect(screen.getByText('Is it rude?')).toBeTruthy();
    expect(screen.getByText('all').tagName).toBe('STRONG');
    cleanup();
    renderCard({ sections: { ...DEFAULT_SETTINGS.cardSections, followUp: false } });
    expect(screen.queryByLabelText('Ask a follow-up question')).toBeNull();
    cleanup();
    renderCard({ status: 'streaming' });
    expect(screen.queryByLabelText('Ask a follow-up question')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Save' })).toBeNull();
  });
});

describe('the Save section (v2 spec §4.1)', () => {
  it("lists Claude's suggestions, then the whole line, with type badges and meanings", () => {
    renderCard();
    expect(saveButtonNames()).toEqual(['Save "call it a night"', 'Save "gonna"', 'Save whole line']);
    const section = saveSection();
    for (const text of ['IDIOM', 'WORD', 'LINE', 'call it a night', 'end the evening', 'gonna', 'going to (casual)', 'Whole line']) {
      expect(within(section).getByText(text)).toBeTruthy();
    }
  });

  it("offers Claude's whole-line suggestion last, with its meaning", () => {
    const lineRow: SaveSuggestion = { type: 'line', text: LINE, meaning: 'Time for bed.' };
    renderCard({ explanation: { ...EXPLANATION, suggestions: [lineRow, IDIOM] } });
    expect(saveButtonNames()).toEqual(['Save "call it a night"', 'Save whole line']);
    expect(within(saveSection()).getByText('Time for bed.')).toBeTruthy();
  });

  it("shows Save, Saved, and Couldn't save, and calls back with the row", () => {
    const h = renderCard({ savedKeys: [key(IDIOM)], saveStatus: { [key(WORD)]: 'error' } });
    const idiom = screen.getByRole('button', { name: 'Save "call it a night"' });
    expect(idiom.getAttribute('aria-pressed')).toBe('true');
    expect(idiom.textContent).toBe('Saved');
    const word = screen.getByRole('button', { name: 'Save "gonna"' });
    expect(word.getAttribute('aria-pressed')).toBe('false');
    expect(word.textContent).toBe("Couldn't save");
    expect(screen.getByRole('button', { name: 'Save whole line' }).textContent).toBe('Save');
    fireEvent.click(word);
    fireEvent.click(idiom);
    expect(h.onToggleSave.mock.calls).toEqual([[WORD], [IDIOM]]);
  });

  it('a row that is saving is disabled', () => {
    const h = renderCard({ saveStatus: { [key(IDIOM)]: 'saving' } });
    const saving = screen.getByRole('button', { name: 'Save "call it a night"' }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(saving.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(saving);
    expect(h.onToggleSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing controller tests**

Replace `tests/unit/explain-flow.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { CardState } from '@/entrypoints/netflix.content/overlay/card-state';
import { createExplainController } from '@/entrypoints/netflix.content/overlay/explain-controller';
import { streamExplanation, type Connect } from '@/entrypoints/netflix.content/overlay/explain-port';
import { placeCard } from '@/entrypoints/netflix.content/overlay/positioning';
import { createStore } from '@/entrypoints/netflix.content/overlay/store';
import type { TitleInfo } from '@/lib/netflix/title';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { suggestionKey } from '@/lib/study-log/items';
import type { Explanation, SaveSuggestion } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';
import type { ObservedLine } from '@/lib/subtitles/history';

function fakePort() {
  const posted: unknown[] = [];
  let onMessage: (m: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const port = {
    postMessage: (m: unknown) => posted.push(m),
    disconnect: vi.fn(),
    onMessage: { addListener: (l: (m: unknown) => void) => (onMessage = l) },
    onDisconnect: { addListener: (l: () => void) => (onDisconnect = l) },
  };
  return { port, posted, receive: (m: unknown) => onMessage(m), drop: () => onDisconnect() };
}

describe('placeCard (spec §5.3: above the line, inside the player, scrolls if tall)', () => {
  it('sits above the line, centered on it', () => {
    const player = { left: 0, top: 0, width: 1920, height: 1080 };
    const line = { left: 700, top: 900, width: 520, height: 60 };
    expect(placeCard(line, player, 300)).toEqual({ left: 700, top: 588, width: 520, maxHeight: 876 });
  });

  it('keeps the card inside a small player', () => {
    const player = { left: 0, top: 0, width: 360, height: 240 };
    const line = { left: 100, top: 200, width: 160, height: 30 };
    const p = placeCard(line, player, 900);
    expect(p).toEqual({ left: 12, top: 12, width: 336, maxHeight: 176 });
    expect(p.left + p.width).toBeLessThanOrEqual(player.width);
    expect(p.top).toBeGreaterThanOrEqual(player.top);
  });

  it('without a line, sits above the player controls', () => {
    const p = placeCard(null, { left: 0, top: 0, width: 1000, height: 600 }, 200);
    expect(p.left).toBe(240);
    expect(p.top + 200).toBe(600 - 72);
  });
});

describe('streamExplanation', () => {
  it('posts the request, streams deltas, finishes with the explanation and saved keys, then disconnects', () => {
    const fake = fakePort();
    const onDelta = vi.fn();
    const onDone = vi.fn();
    streamExplanation(
      () => fake.port,
      { type: 'follow-up', explanationId: 'e', question: 'q', sections: DEFAULT_SETTINGS.cardSections, storySoFar: [] },
      { onDelta, onDone, onError: vi.fn() },
    );
    expect(fake.posted).toHaveLength(1);
    fake.receive({ type: 'delta', text: 'Hi' });
    fake.receive({ type: 'done', explanation: { id: 'e' }, savedKeys: ['k1'] });
    expect(onDelta).toHaveBeenCalledWith('Hi');
    expect(onDone).toHaveBeenCalledWith({ id: 'e' }, ['k1']);
    expect(fake.port.disconnect).toHaveBeenCalled();
  });

  it("a dropped port shows Couldn't reach Claude", () => {
    const fake = fakePort();
    const onError = vi.fn();
    streamExplanation(() => fake.port, { type: 'start', request: {} as never }, { onDelta: vi.fn(), onDone: vi.fn(), onError });
    fake.drop();
    expect(onError).toHaveBeenCalledWith('network', "Couldn't reach Claude");
  });

  it('cancel disconnects and silences anything that arrives later', () => {
    const fake = fakePort();
    const onDelta = vi.fn();
    const cancel = streamExplanation(() => fake.port, { type: 'start', request: {} as never }, { onDelta, onDone: vi.fn(), onError: vi.fn() });
    cancel();
    fake.receive({ type: 'delta', text: 'late' });
    expect(fake.port.disconnect).toHaveBeenCalled();
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('a reloaded extension (connect throws) is a network error', () => {
    const onError = vi.fn();
    const connect: Connect = () => {
      throw new Error('Extension context invalidated.');
    };
    streamExplanation(connect, { type: 'start', request: {} as never }, { onDelta: vi.fn(), onDone: vi.fn(), onError });
    expect(onError).toHaveBeenCalledWith('network', "Couldn't reach Claude");
  });
});

const TITLE: TitleInfo = {
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
};
const LINE: ObservedLine = { text: "I'm gonna call it\na night.", normalized: "I'm gonna call it a night.", shownAtMs: 22_100, hiddenAtMs: null };
const STORY: StoryLine[] = [{ startMs: 1000, text: 'Earlier line' }];
const IDIOM: SaveSuggestion = { type: 'idiom', text: 'call it a night', meaning: '그만 자다' };
const WORD: SaveSuggestion = { type: 'word', text: 'gonna', meaning: 'going to' };
const LINE_ROW: SaveSuggestion = { type: 'line', text: LINE.text, meaning: '' };
const SAVED = {
  id: 'e1',
  videoId: '80077211',
  phrase: LINE.text,
  response: '## 의미\n잘 시간.',
  followUps: [{ question: 'Formal?', answer: 'No.' }],
  suggestions: [IDIOM],
} as unknown as Explanation;
const IDIOM_KEY = suggestionKey(SAVED, IDIOM);
const LINE_KEY = suggestionKey(SAVED, LINE_ROW);

interface SetupOptions {
  found?: { explanation: Explanation | null; savedKeys: string[] };
  imageBased?: boolean;
  line?: ObservedLine | null;
  sendStorySoFar?: boolean;
}

function setupExplain(over: SetupOptions = {}) {
  const store = createStore<CardState | null>(null);
  const ports: ReturnType<typeof fakePort>[] = [];
  const connect: Connect = () => {
    const p = fakePort();
    ports.push(p);
    return p.port;
  };
  const line = over.line === undefined ? LINE : over.line;
  const session = {
    currentLine: () => line,
    describe: () => ({
      context: { before: ['Where are you going?'], after: ['Night.'] },
      timing: { startMs: 22_000, endMs: 24_000 },
      fromTrack: true,
    }),
    storySoFar: vi.fn((_line: ObservedLine) => STORY),
  };
  const bridge = {
    callSync: vi.fn((method: string) => {
      if (method === 'getState') {
        return {
          ok: true,
          result: {
            currentTimeMs: 22_500,
            durationMs: 1_000_000,
            paused: true,
            videoId: '80077211',
            textTrack: { trackId: 't', language: 'en', isImageBased: !!over.imageBased, isNone: false },
          },
        };
      }
      if (method === 'getTitle') return { ok: true, result: TITLE };
      return { ok: true, result: null };
    }),
  };
  const pause = { resume: vi.fn() };
  const findExplanation = vi.fn(async () => over.found ?? { explanation: null, savedKeys: [] });
  const saveItem = vi.fn(async (_explanationId: string, row: SaveSuggestion) => suggestionKey(SAVED, row));
  const unsaveItem = vi.fn(async (_explanationId: string, row: SaveSuggestion) => suggestionKey(SAVED, row));
  const settings = { ...DEFAULT_SETTINGS, explanationLanguage: 'ko', sendStorySoFar: over.sendStorySoFar ?? true };
  const explain = createExplainController({
    store,
    session: session as never,
    bridge: bridge as never,
    pause,
    connect,
    findExplanation,
    saveItem,
    unsaveItem,
    getSettings: () => settings,
    getVideoId: () => '80077211',
    subtitleRects: () => [{ left: 100, top: 500, right: 400, bottom: 560, width: 300, height: 60 } as DOMRect],
  });
  return { store, ports, explain, findExplanation, saveItem, unsaveItem, pause, settings, session };
}

async function openStored(found: SetupOptions['found'] = { explanation: SAVED, savedKeys: [] }) {
  const setup = setupExplain({ found });
  setup.explain.open('hover');
  await vi.waitFor(() => expect(setup.store.get()?.status).toBe('done'));
  return setup;
}

describe('explain controller', () => {
  it('shows a stored explanation instantly, marked Explained before, with its saved rows', async () => {
    const { store, ports, findExplanation } = await openStored({ explanation: SAVED, savedKeys: [IDIOM_KEY] });
    expect(store.get()).toMatchObject({
      line: LINE.text,
      response: SAVED.response,
      explanation: { id: 'e1' },
      explainedBefore: true,
      savedKeys: [IDIOM_KEY],
      saveStatus: {},
      followUps: [{ question: 'Formal?', answer: 'No.', status: 'done', error: null }],
    });
    expect(findExplanation).toHaveBeenCalledWith('80077211', 'ko', LINE.text);
    expect(ports).toHaveLength(0);
  });

  it('streams a new explanation with the line, its context, the title, the line start, and the story so far', async () => {
    const { store, ports, explain, settings, session } = setupExplain();
    explain.open('hover');
    expect(store.get()).toMatchObject({
      status: 'loading',
      anchor: { left: 100, top: 500, width: 300, height: 60 },
      explanation: null,
      explainedBefore: false,
      savedKeys: [],
      saveStatus: {},
    });
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    expect(session.storySoFar).toHaveBeenCalledWith(LINE);
    expect(ports[0]!.posted[0]).toEqual({
      type: 'start',
      request: {
        phrase: LINE.text,
        context: { before: ['Where are you going?'], after: ['Night.'] },
        title: TITLE,
        videoId: '80077211',
        videoTimeMs: 22_000,
        language: 'ko',
        sections: settings.cardSections,
        storySoFar: STORY,
      },
    });
    ports[0]!.receive({ type: 'delta', text: 'Hel' });
    ports[0]!.receive({ type: 'delta', text: 'lo' });
    expect(store.get()).toMatchObject({ status: 'streaming', response: 'Hello' });
    ports[0]!.receive({ type: 'done', explanation: { ...SAVED, response: 'Hello', followUps: [] }, savedKeys: [IDIOM_KEY] });
    expect(store.get()).toMatchObject({ status: 'done', response: 'Hello', explanation: { id: 'e1' }, savedKeys: [IDIOM_KEY], explainedBefore: false });
  });

  it('sends no story when Send the story so far is off', async () => {
    const { ports, explain, session } = setupExplain({ sendStorySoFar: false });
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    expect(ports[0]!.posted[0]).toMatchObject({ type: 'start', request: { storySoFar: [] } });
    expect(session.storySoFar).not.toHaveBeenCalled();
  });

  it('Regenerate streams again and clears follow-ups and the Explained before mark', async () => {
    const { store, ports, explain } = await openStored();
    explain.regenerate();
    expect(store.get()).toMatchObject({ status: 'loading', response: '', followUps: [], explanation: null, explainedBefore: false });
    expect(ports[0]!.posted[0]).toMatchObject({ type: 'start', request: { storySoFar: STORY } });
  });

  it('saved state survives Regenerate', async () => {
    const { store, ports, explain, unsaveItem } = await openStored({ explanation: SAVED, savedKeys: [IDIOM_KEY] });
    explain.regenerate();
    const fresh = { ...SAVED, response: 'New', followUps: [], suggestions: [WORD, IDIOM] } as Explanation;
    ports[0]!.receive({ type: 'done', explanation: fresh, savedKeys: [IDIOM_KEY] });
    expect(store.get()).toMatchObject({
      status: 'done',
      explainedBefore: false,
      savedKeys: [IDIOM_KEY],
      explanation: { suggestions: [WORD, IDIOM] },
    });
    expect(unsaveItem).not.toHaveBeenCalled();
  });

  it('a follow-up carries the explanation id and the same story so far, and keeps the updated explanation', async () => {
    const { store, ports, explain, settings } = await openStored({ explanation: { ...SAVED, followUps: [] } as Explanation, savedKeys: [] });
    explain.askFollowUp('  Is it formal?  ');
    explain.askFollowUp('ignored while busy');
    expect(store.get()?.followUps).toEqual([{ question: 'Is it formal?', answer: '', status: 'streaming', error: null }]);
    expect(ports).toHaveLength(1);
    expect(ports[0]!.posted[0]).toEqual({
      type: 'follow-up',
      explanationId: 'e1',
      question: 'Is it formal?',
      sections: settings.cardSections,
      storySoFar: STORY,
    });
    ports[0]!.receive({ type: 'delta', text: 'No' });
    expect(store.get()?.followUps[0]?.answer).toBe('No');
    ports[0]!.receive({ type: 'done', explanation: { ...SAVED, followUps: [{ question: 'Is it formal?', answer: 'No.' }] }, savedKeys: [] });
    expect(store.get()).toMatchObject({ followUpBusy: false, followUps: [{ answer: 'No.', status: 'done' }] });
  });

  it('Save: saving, then Saved; tapping a saved row removes it', async () => {
    const { store, explain, saveItem, unsaveItem } = await openStored();
    explain.toggleSave(IDIOM);
    expect(store.get()?.saveStatus).toEqual({ [IDIOM_KEY]: 'saving' });
    explain.toggleSave(IDIOM); // ignored while saving
    expect(saveItem).toHaveBeenCalledTimes(1);
    expect(saveItem).toHaveBeenCalledWith('e1', IDIOM);
    await vi.waitFor(() => expect(store.get()?.savedKeys).toEqual([IDIOM_KEY]));
    expect(store.get()?.saveStatus).toEqual({});
    explain.toggleSave(IDIOM);
    expect(unsaveItem).toHaveBeenCalledWith('e1', IDIOM);
    await vi.waitFor(() => expect(store.get()?.savedKeys).toEqual([]));
    expect(store.get()?.saveStatus).toEqual({});
  });

  it("a failed save says Couldn't save and tapping again retries; a failed removal stays Saved", async () => {
    const { store, explain, saveItem, unsaveItem } = await openStored();
    saveItem.mockRejectedValueOnce(new Error('offline'));
    explain.toggleSave(LINE_ROW);
    await vi.waitFor(() => expect(store.get()?.saveStatus).toEqual({ [LINE_KEY]: 'error' }));
    expect(store.get()?.savedKeys).toEqual([]);
    explain.toggleSave(LINE_ROW);
    await vi.waitFor(() => expect(store.get()?.savedKeys).toEqual([LINE_KEY]));
    expect(store.get()?.saveStatus).toEqual({});

    unsaveItem.mockRejectedValueOnce(new Error('offline'));
    explain.toggleSave(LINE_ROW);
    await vi.waitFor(() => expect(unsaveItem).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.get()?.saveStatus).toEqual({}));
    expect(store.get()?.savedKeys).toEqual([LINE_KEY]);
  });

  it('nothing can be saved before the explanation is done', async () => {
    const { ports, explain, saveItem } = setupExplain();
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    explain.toggleSave(IDIOM);
    expect(saveItem).not.toHaveBeenCalled();
  });

  it('closing aborts the request and resumes through the pause guard', async () => {
    const { store, ports, explain, pause } = setupExplain();
    explain.open('shortcut');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    explain.close();
    expect(ports[0]!.port.disconnect).toHaveBeenCalled();
    expect(store.get()).toBeNull();
    expect(pause.resume).toHaveBeenCalledTimes(1);
  });

  it("a dropped port shows Couldn't reach Claude", async () => {
    const { store, ports, explain } = setupExplain();
    explain.open('hover');
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    ports[0]!.drop();
    expect(store.get()).toMatchObject({ status: 'error', error: { code: 'network', message: "Couldn't reach Claude" } });
  });

  it("image-based subtitles get the can't-be-read card; no line means no card", () => {
    const image = setupExplain({ imageBased: true, line: null });
    expect(image.explain.open('shortcut')).toBe(true);
    expect(image.store.get()).toMatchObject({ status: 'error', error: { code: 'image-subs', message: "This title's subtitles can't be read as text" } });
    const none = setupExplain({ line: null });
    expect(none.explain.open('shortcut')).toBe(false);
    expect(none.store.get()).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `pnpm vitest run tests/unit/card.test.tsx tests/unit/explain-flow.test.ts`
Expected: FAIL. `CardState` has no `explanation`, `explainedBefore`, `savedKeys` or `saveStatus`. The card has no Save section and still says "From your Study Log". The controller has no `toggleSave`, sends `storySoFar: []`, calls `findEntry` rather than `findExplanation`, and `onDone` gets no saved keys.

- [ ] **Step 4: Card state**

Replace `src/entrypoints/netflix.content/overlay/card-state.ts` with:

```ts
import type { ExplainErrorCode } from '@/lib/claude/protocol';
import type { CardSections } from '@/lib/settings';
import type { Explanation } from '@/lib/study-log/types';

/** A viewport rectangle. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CardErrorCode = ExplainErrorCode | 'image-subs';

export interface FollowUpView {
  question: string;
  answer: string;
  status: 'streaming' | 'done' | 'error';
  error: string | null;
}

/** A Save row with a save or removal in flight, or whose last save failed (v2 spec §4.1, §9). */
export type SaveStatus = 'saving' | 'error';

export interface CardState {
  /** New for every opened card, so late answers for an old card are dropped. */
  key: number;
  /** The subtitle line, line breaks kept. The card stays on it (spec §5.3 step 6). */
  line: string;
  /** Where the line was on screen when the card opened. */
  anchor: Box | null;
  openedBy: 'hover' | 'shortcut';
  status: 'loading' | 'streaming' | 'done' | 'error';
  response: string;
  /** The stored explanation, once Claude finished or when found in the history. */
  explanation: Explanation | null;
  error: { code: CardErrorCode; message: string } | null;
  followUps: FollowUpView[];
  followUpBusy: boolean;
  sections: CardSections;
  /** Shown from the explanation history without asking Claude ("Explained before"). */
  explainedBefore: boolean;
  /** Index keys (`suggestionKey`) of this line's Save rows that are saved. */
  savedKeys: string[];
  /** By row key: rows with a request in flight, or whose last save failed. */
  saveStatus: Record<string, SaveStatus>;
}

export const IMAGE_SUBTITLES_MESSAGE = "This title's subtitles can't be read as text";

export function unionBox(rects: readonly Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[]): Box | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, width: right - left, height: bottom - top };
}
```

- [ ] **Step 5: Pass the saved keys through the port**

Replace `src/entrypoints/netflix.content/overlay/explain-port.ts` with:

```ts
import { browser } from '#imports';
import {
  ERROR_COPY,
  EXPLAIN_PORT,
  type ExplainClientMessage,
  type ExplainErrorCode,
  type ExplainServerMessage,
} from '@/lib/claude/protocol';
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
  onError(code: ExplainErrorCode, message: string): void;
}

/**
 * Runs one request over its own Port (spec §6.3). Returns a cancel function; cancelling disconnects,
 * which aborts the request in the background. If the Port drops without an answer (the worker restarted
 * or the extension was reloaded), the card shows "Couldn't reach Claude".
 */
export function streamExplanation(connect: Connect, message: ExplainClientMessage, handlers: StreamHandlers): () => void {
  let finished = false;
  let port: PortLike;
  try {
    port = connect();
  } catch {
    handlers.onError('network', ERROR_COPY.network);
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
      handlers.onError(m.code, m.message);
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    if (finished) return;
    finished = true;
    handlers.onError('network', ERROR_COPY.network);
  });
  port.postMessage(message);
  return () => {
    if (finished) return;
    finished = true;
    port.disconnect();
  };
}
```

- [ ] **Step 6: The controller**

Replace `src/entrypoints/netflix.content/overlay/explain-controller.ts` with:

```ts
import type { BridgeClient } from '@/lib/bridge/client';
import { parseTitleInfo } from '@/lib/bridge/protocol';
import type { ExplainRequest } from '@/lib/claude/prompt';
import type { Settings } from '@/lib/settings';
import { suggestionKey } from '@/lib/study-log/items';
import type { Explanation, SaveSuggestion } from '@/lib/study-log/types';
import type { SubtitleSession } from '../subtitle-session';
import { IMAGE_SUBTITLES_MESSAGE, unionBox, type CardState, type FollowUpView, type SaveStatus } from './card-state';
import { streamExplanation, type Connect } from './explain-port';
import type { PauseGuard } from './pause';
import type { Store } from './store';

export interface ExplainControllerDeps {
  store: Store<CardState | null>;
  session: Pick<SubtitleSession, 'currentLine' | 'describe' | 'storySoFar'>;
  bridge: Pick<BridgeClient, 'callSync'>;
  pause: Pick<PauseGuard, 'resume'>;
  connect: Connect;
  /** v2 spec §4.2 `explanation:find`: the line's stored explanation, and the keys of its saved rows. */
  findExplanation(videoId: string, language: string, phrase: string): Promise<{ explanation: Explanation | null; savedKeys: string[] }>;
  /** v2 spec §4.2 `item:save`; resolves with the row's key. */
  saveItem(explanationId: string, suggestion: SaveSuggestion): Promise<string>;
  /** v2 spec §4.2 `item:remove`; resolves with the row's key. */
  unsaveItem(explanationId: string, suggestion: SaveSuggestion): Promise<string>;
  getSettings(): Settings | null;
  getVideoId(): string | null;
  subtitleRects(): readonly Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[];
}

export interface ExplainController {
  /** Opens a card for the current line (spec §5.3 step 3). False when there is no line to explain. */
  open(openedBy: 'hover' | 'shortcut'): boolean;
  regenerate(): void;
  retry(): void;
  askFollowUp(question: string): void;
  /** Saves a row of the card's Save section, or removes it when it is saved (v2 spec §4.1). */
  toggleSave(row: SaveSuggestion): void;
  /** Closes the card, aborts its requests, and resumes playback if LingoFlix paused it. */
  close(): void;
  isOpen(): boolean;
  openedBy(): 'hover' | 'shortcut' | null;
}

export function createExplainController(deps: ExplainControllerDeps): ExplainController {
  let nextKey = 1;
  let request: ExplainRequest | null = null;
  let cancelMain: (() => void) | null = null;
  let cancelFollowUp: (() => void) | null = null;

  const update = (key: number, fn: (card: CardState) => CardState) =>
    deps.store.update((card) => (card && card.key === key ? fn(card) : card));

  const stopRequests = () => {
    cancelMain?.();
    cancelFollowUp?.();
    cancelMain = null;
    cancelFollowUp = null;
  };

  const stream = (key: number, req: ExplainRequest) => {
    cancelMain?.();
    cancelMain = streamExplanation(deps.connect, { type: 'start', request: req }, {
      onDelta: (text) => update(key, (c) => ({ ...c, status: 'streaming', response: c.response + text })),
      // The payload says which rows are saved, so items saved before (e.g. before Regenerate) show as Saved.
      onDone: (explanation, savedKeys) =>
        update(key, (c) => ({ ...c, status: 'done', response: explanation.response, explanation, savedKeys, error: null })),
      onError: (code, message) => update(key, (c) => ({ ...c, status: 'error', error: { code, message } })),
    });
  };

  const open = (openedBy: 'hover' | 'shortcut'): boolean => {
    const settings = deps.getSettings();
    const videoId = deps.getVideoId();
    if (!settings || !videoId) return false;
    const state = deps.bridge.callSync('getState');
    const imageBased = state.ok && state.result.textTrack?.isImageBased === true;
    const line = deps.session.currentLine();
    if (!line && !imageBased) return false;

    stopRequests();
    const key = nextKey++;
    const base: CardState = {
      key,
      line: line?.text ?? '',
      anchor: unionBox(deps.subtitleRects()),
      openedBy,
      status: 'loading',
      response: '',
      explanation: null,
      error: null,
      followUps: [],
      followUpBusy: false,
      sections: settings.cardSections,
      explainedBefore: false,
      savedKeys: [],
      saveStatus: {},
    };
    if (imageBased || !line) {
      request = null;
      deps.store.set({ ...base, status: 'error', error: { code: 'image-subs', message: IMAGE_SUBTITLES_MESSAGE } });
      return true;
    }

    const details = deps.session.describe(line);
    const title = deps.bridge.callSync('getTitle');
    const req: ExplainRequest = {
      phrase: line.text,
      context: details.context,
      title: title.ok ? parseTitleInfo(title.result) : null,
      videoId,
      videoTimeMs: details.timing?.startMs ?? (state.ok ? state.result.currentTimeMs : 0),
      language: settings.explanationLanguage,
      sections: settings.cardSections,
      // v2 spec §5.2: only lines before the context window; none when Send the story so far is off.
      storySoFar: settings.sendStorySoFar ? deps.session.storySoFar(line) : [],
    };
    request = req;
    deps.store.set(base);
    deps.findExplanation(videoId, req.language, req.phrase).then(
      ({ explanation, savedKeys }) => {
        if (deps.store.get()?.key !== key) return;
        if (!explanation) return stream(key, req);
        update(key, (c) => ({
          ...c,
          status: 'done',
          response: explanation.response,
          explanation,
          savedKeys,
          explainedBefore: true,
          followUps: explanation.followUps.map((f) => ({ ...f, status: 'done', error: null })),
        }));
      },
      () => {
        if (deps.store.get()?.key === key) stream(key, req);
      },
    );
    return true;
  };

  /** Regenerate and Retry: ask Claude again for the same line; the stored explanation is replaced on success. */
  const restart = () => {
    const card = deps.store.get();
    if (!card || !request) return;
    cancelFollowUp?.();
    cancelFollowUp = null;
    // Saved items stay saved; the done payload brings the saved keys of the new rows.
    deps.store.set({
      ...card,
      status: 'loading',
      response: '',
      explanation: null,
      error: null,
      followUps: [],
      followUpBusy: false,
      explainedBefore: false,
      saveStatus: {},
    });
    stream(card.key, request);
  };

  return {
    open,
    regenerate: restart,
    retry: restart,
    askFollowUp(question) {
      const card = deps.store.get();
      const settings = deps.getSettings();
      const text = question.trim();
      if (!card?.explanation || card.followUpBusy || !text || !settings) return;
      const { key } = card;
      const index = card.followUps.length;
      deps.store.set({
        ...card,
        followUpBusy: true,
        followUps: [...card.followUps, { question: text, answer: '', status: 'streaming', error: null }],
      });
      const setFollowUp = (fn: (f: FollowUpView) => FollowUpView, extra: Partial<CardState> = {}) =>
        update(key, (c) => ({ ...c, ...extra, followUps: c.followUps.map((f, i) => (i === index ? fn(f) : f)) }));
      cancelFollowUp = streamExplanation(
        deps.connect,
        // The same story as the explanation it follows (v2 spec §5.1).
        {
          type: 'follow-up',
          explanationId: card.explanation.id,
          question: text,
          sections: settings.cardSections,
          storySoFar: request?.storySoFar ?? [],
        },
        {
          onDelta: (delta) => setFollowUp((f) => ({ ...f, answer: f.answer + delta })),
          onDone: (explanation) =>
            setFollowUp((f) => ({ ...f, status: 'done', answer: explanation.followUps[index]?.answer ?? f.answer }), {
              explanation,
              followUpBusy: false,
            }),
          onError: (_code, message) => setFollowUp((f) => ({ ...f, status: 'error', error: message }), { followUpBusy: false }),
        },
      );
    },
    toggleSave(row) {
      const card = deps.store.get();
      if (!card?.explanation || card.status !== 'done') return;
      const { key, explanation } = card;
      const rowKey = suggestionKey(explanation, row);
      if (card.saveStatus[rowKey] === 'saving') return;
      const wasSaved = card.savedKeys.includes(rowKey);
      const settle = (status: SaveStatus | null, saved: boolean) =>
        update(key, (c) => {
          const saveStatus = { ...c.saveStatus };
          if (status) saveStatus[rowKey] = status;
          else delete saveStatus[rowKey];
          const others = c.savedKeys.filter((k) => k !== rowKey);
          return { ...c, saveStatus, savedKeys: saved ? [...others, rowKey] : others };
        });
      settle('saving', wasSaved);
      (wasSaved ? deps.unsaveItem(explanation.id, row) : deps.saveItem(explanation.id, row)).then(
        () => settle(null, !wasSaved),
        // v2 spec §9: a failed save says so on its row; a failed removal stays Saved. Tapping again retries.
        () => settle(wasSaved ? null : 'error', wasSaved),
      );
    },
    close() {
      stopRequests();
      request = null;
      deps.store.set(null);
      deps.pause.resume();
    },
    isOpen: () => deps.store.get() !== null,
    openedBy: () => deps.store.get()?.openedBy ?? null,
  };
}
```

- [ ] **Step 7: The card**

Replace `src/entrypoints/netflix.content/overlay/Card.tsx` with:

```tsx
import { ArrowUp, BookOpen, Check, Loader2, Plus, RotateCcw, Settings as SettingsIcon, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { LogoMark } from '@/components/Logo';
import { Markdown } from '@/components/Markdown';
import { cardRows } from '@/lib/claude/suggestions';
import { suggestionKey } from '@/lib/study-log/items';
import type { Explanation, ItemType, SaveSuggestion } from '@/lib/study-log/types';
import type { Box, CardState, SaveStatus } from './card-state';
import { placeCard } from './positioning';

export interface CardProps {
  card: CardState;
  /** The player's viewport rect; null falls back to the bottom-right corner. */
  player: Box | null;
  onRegenerate(): void;
  onRetry(): void;
  onFollowUp(question: string): void;
  /** Saves a Save row, or removes it when it is saved. */
  onToggleSave(row: SaveSuggestion): void;
  onClose(): void;
  onOpenSettings(): void;
  cardRef?(element: HTMLElement | null): void;
}

const secondaryButton =
  'inline-flex items-center gap-1.5 rounded-xl border-2 border-line bg-card px-3 py-1.5 text-[12px] font-extrabold tracking-wide text-ink uppercase shadow-[0_3px_0_var(--lf-line)] hover:bg-soft active:translate-y-[3px] active:shadow-none disabled:opacity-40';
const primaryButton =
  'inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-[12px] font-extrabold tracking-wide text-on-brand uppercase shadow-[0_3px_0_var(--lf-brand-edge)] active:translate-y-[3px] active:shadow-none';
const saveToggle =
  'inline-flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1 text-[12px] font-extrabold tracking-wide uppercase active:translate-y-[3px] active:shadow-none disabled:opacity-60';
const saveButton = `${saveToggle} border-2 border-line bg-card text-ink shadow-[0_3px_0_var(--lf-line)] hover:bg-soft`;
const savedButton = `${saveToggle} border-2 border-brand bg-brand text-on-brand shadow-[0_3px_0_var(--lf-brand-edge)]`;

const TYPE_BADGE: Record<ItemType, string> = { word: 'WORD', phrase: 'PHRASE', idiom: 'IDIOM', line: 'LINE' };

function ErrorBlock({ error, onRetry, onOpenSettings }: { error: NonNullable<CardState['error']>; onRetry(): void; onOpenSettings(): void }) {
  const needsSettings = error.code === 'no-key' || error.code === 'bad-key';
  const canRetry = error.code === 'busy' || error.code === 'network';
  return (
    <div className="rounded-xl border-2 border-line bg-soft px-3 py-2.5">
      <p role="alert" className="text-[14px] font-extrabold">
        {error.message}
      </p>
      {needsSettings && (
        <button type="button" className={`${primaryButton} mt-2`} onClick={onOpenSettings}>
          <SettingsIcon size={14} strokeWidth={3} aria-hidden />
          Open Settings
        </button>
      )}
      {canRetry && (
        <button type="button" className={`${secondaryButton} mt-2`} onClick={onRetry}>
          <RotateCcw size={14} strokeWidth={3} aria-hidden />
          Retry
        </button>
      )}
    </div>
  );
}

function SaveRow({ row, saved, status, onToggle }: { row: SaveSuggestion; saved: boolean; status: SaveStatus | undefined; onToggle(): void }) {
  const wholeLine = row.type === 'line';
  const label = status === 'error' ? "Couldn't save" : saved ? 'Saved' : 'Save';
  const Icon = status === 'saving' ? Loader2 : saved ? Check : Plus;
  return (
    <li className="flex items-start gap-2.5">
      <button
        type="button"
        aria-label={wholeLine ? 'Save whole line' : `Save "${row.text}"`}
        aria-pressed={saved}
        aria-busy={status === 'saving'}
        disabled={status === 'saving'}
        onClick={onToggle}
        className={saved ? savedButton : saveButton}
      >
        <Icon size={14} strokeWidth={3} className={status === 'saving' ? 'animate-spin' : undefined} aria-hidden />
        <span>{label}</span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-[14px] leading-snug font-extrabold">{wholeLine ? 'Whole line' : row.text}</span>
          <span className="rounded-lg bg-soft px-1.5 py-0.5 text-[10px] font-black tracking-wide text-mute">{TYPE_BADGE[row.type]}</span>
        </p>
        {row.meaning && <p className="text-[13px] leading-snug font-semibold text-mute">{row.meaning}</p>}
      </div>
    </li>
  );
}

/** v2 spec §4.1: Claude's suggestions, then the whole line, each with a Save toggle. */
function SaveSection({
  explanation,
  savedKeys,
  saveStatus,
  onToggle,
}: {
  explanation: Explanation;
  savedKeys: readonly string[];
  saveStatus: CardState['saveStatus'];
  onToggle(row: SaveSuggestion): void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-3 border-t-2 border-soft pt-3">
      <h3 id={headingId} className="text-[12px] font-extrabold tracking-wide text-mute uppercase">
        Save
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {cardRows(explanation.suggestions, explanation.phrase).map((row) => {
          const key = suggestionKey(explanation, row);
          return <SaveRow key={key} row={row} saved={savedKeys.includes(key)} status={saveStatus[key]} onToggle={() => onToggle(row)} />;
        })}
      </ul>
    </section>
  );
}

function FollowUpBox({ busy, onSend }: { busy: boolean; onSend(question: string): void }) {
  const [text, setText] = useState('');
  const send = () => {
    const question = text.trim();
    if (!question || busy) return;
    onSend(question);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends and Shift+Enter is a new line. An Enter that commits an IME composition (Korean,
    // Japanese, Chinese) does neither: isComposing, or keyCode 229 in Chrome.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    send();
  };
  return (
    <form
      className="flex items-end gap-2 border-t-2 border-soft px-4 py-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        aria-label="Ask a follow-up question"
        rows={1}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about this line…"
        className="max-h-24 min-h-9 flex-1 resize-none rounded-xl border-2 border-line bg-page px-3 py-1.5 text-[14px] text-ink outline-none placeholder:text-mute focus:border-brand"
      />
      <button
        type="submit"
        aria-label="Send question"
        disabled={busy || !text.trim()}
        className="grid size-9 place-items-center rounded-xl bg-brand text-on-brand shadow-[0_3px_0_var(--lf-brand-edge)] disabled:opacity-40"
      >
        <ArrowUp size={18} strokeWidth={3} aria-hidden />
      </button>
    </form>
  );
}

/** The explanation card (spec §5.3–5.4, v2 spec §4.1), styled with the dark tokens (spec §5.10). */
export function Card({ card, player, onRegenerate, onRetry, onFollowUp, onToggleSave, onClose, onOpenSettings, cardRef }: CardProps) {
  const element = useRef<HTMLElement | null>(null);
  const [naturalHeight, setNaturalHeight] = useState(320);
  useLayoutEffect(() => {
    const height = element.current?.scrollHeight ?? 0;
    if (height > 0 && Math.abs(height - naturalHeight) > 1) setNaturalHeight(height);
  });
  const placement = player ? placeCard(card.anchor, player, naturalHeight) : null;
  const busy = card.status === 'loading' || card.status === 'streaming';

  return (
    <section
      ref={(el) => {
        element.current = el;
        cardRef?.(el);
      }}
      role="dialog"
      aria-label="LingoFlix explanation"
      className="pointer-events-auto fixed z-[2147483646] flex flex-col overflow-hidden rounded-[18px] border-2 border-line bg-card text-ink shadow-[0_6px_0_rgb(0_0_0/0.35)]"
      style={
        placement
          ? { left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }
          : { right: 16, bottom: 96, width: 420, maxHeight: 480 }
      }
    >
      <header className="flex items-start gap-2.5 border-b-2 border-soft px-4 py-3">
        <LogoMark size={22} />
        <p className="flex-1 text-[15px] leading-snug font-extrabold whitespace-pre-line">{card.line}</p>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-lg text-mute hover:bg-soft hover:text-ink"
        >
          <X size={16} strokeWidth={3} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite" aria-busy={busy}>
        {card.status === 'loading' && (
          <p className="flex items-center gap-2 text-[14px] font-bold text-mute">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Thinking…
          </p>
        )}
        {card.response && <Markdown>{card.response}</Markdown>}
        {card.error && <ErrorBlock error={card.error} onRetry={onRetry} onOpenSettings={onOpenSettings} />}
        {card.status === 'done' && card.explanation && (
          <SaveSection explanation={card.explanation} savedKeys={card.savedKeys} saveStatus={card.saveStatus} onToggle={onToggleSave} />
        )}
        {card.followUps.map((followUp, i) => (
          <div key={i} className="mt-3 border-t-2 border-soft pt-3">
            <p className="text-[13px] font-extrabold text-tint-ink">{followUp.question}</p>
            {followUp.answer && <Markdown>{followUp.answer}</Markdown>}
            {followUp.status === 'streaming' && !followUp.answer && <Loader2 size={16} className="mt-1 animate-spin text-mute" aria-hidden />}
            {followUp.error && (
              <p role="alert" className="mt-1 text-[13px] font-bold text-danger">
                {followUp.error}
              </p>
            )}
          </div>
        ))}
      </div>

      {card.sections.followUp && card.status === 'done' && card.explanation && <FollowUpBox busy={card.followUpBusy} onSend={onFollowUp} />}

      {card.status === 'done' && (
        <footer className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-mute">
            {card.explainedBefore && (
              <>
                <BookOpen size={14} aria-hidden />
                Explained before
              </>
            )}
          </span>
          <button type="button" className={secondaryButton} onClick={onRegenerate} disabled={busy}>
            <RotateCcw size={14} strokeWidth={3} aria-hidden />
            Regenerate
          </button>
        </footer>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Run the tests to make sure they pass**

Run: `pnpm vitest run tests/unit/card.test.tsx tests/unit/explain-flow.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the card into the page**

Replace `src/entrypoints/netflix.content/overlay/OverlayApp.tsx` with:

```tsx
import { Card } from './Card';
import type { Box, CardState } from './card-state';
import type { ExplainController } from './explain-controller';
import { useStore, type Store } from './store';

export interface OverlayAppProps {
  store: Store<CardState | null>;
  explain: Pick<ExplainController, 'regenerate' | 'retry' | 'askFollowUp' | 'toggleSave' | 'close'>;
  playerRect(): Box | null;
  openSettings(): void;
  onCardElement(element: HTMLElement | null): void;
}

export function OverlayApp({ store, explain, playerRect, openSettings, onCardElement }: OverlayAppProps) {
  const card = useStore(store);
  if (!card) return null;
  return (
    <Card
      key={card.key}
      card={card}
      player={playerRect()}
      onRegenerate={explain.regenerate}
      onRetry={explain.retry}
      onFollowUp={explain.askFollowUp}
      onToggleSave={explain.toggleSave}
      onClose={explain.close}
      onOpenSettings={openSettings}
      cardRef={onCardElement}
    />
  );
}
```

In `src/entrypoints/netflix.content/index.ts`:

1. In the `createExplainController({ … })` call, replace the `findEntry` dependency left by Task 8:

```ts
      findEntry: async (videoId, language, phrase) =>
        (await sendToBackground({ type: 'explanation:find', videoId, language, phrase })).explanation,
```

with

```ts
      findExplanation: (videoId, language, phrase) => sendToBackground({ type: 'explanation:find', videoId, language, phrase }),
      saveItem: async (explanationId, suggestion) => (await sendToBackground({ type: 'item:save', explanationId, suggestion })).key,
      unsaveItem: async (explanationId, suggestion) => (await sendToBackground({ type: 'item:remove', explanationId, suggestion })).key,
```

2. In the `mountOverlay(…)` call, replace

```ts
        explain: { regenerate: explain.regenerate, retry: explain.retry, askFollowUp: explain.askFollowUp, close: runtime.closeCard },
```

with

```ts
        explain: {
          regenerate: explain.regenerate,
          retry: explain.retry,
          askFollowUp: explain.askFollowUp,
          toggleSave: explain.toggleSave,
          close: runtime.closeCard,
        },
```

The page wiring has no unit test, as in Plan 2. It's covered by `pnpm compile` here and by the live checklist in Task 14.

- [ ] **Step 10: Run the whole suite, the type check, and the build**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: every test passes; `tsc` reports no errors; the build finishes.

- [ ] **Step 11: Commit**

```bash
git add src/entrypoints/netflix.content/overlay/card-state.ts src/entrypoints/netflix.content/overlay/explain-port.ts \
  src/entrypoints/netflix.content/overlay/explain-controller.ts src/entrypoints/netflix.content/overlay/Card.tsx \
  src/entrypoints/netflix.content/overlay/OverlayApp.tsx src/entrypoints/netflix.content/index.ts \
  tests/unit/card.test.tsx tests/unit/explain-flow.test.ts
git commit -m "feat(overlay): Save section on the card, saved state, and the story so far in requests" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 10: Study Log list: All items, filters, search, deletes

Spec: v2 spec §6.1 (layout, tree, toolbar, rows, empty states), §6.3 (deleting), §3.4 (Reset all), §3.3 (lazy conversion before listing).

The Study Log page lists **saved items** instead of explanations. The tree gains **All items** (the default
selection, newest first); a toolbar filters by type and searches text and meaning; rows show a type badge, the
text, the meaning and where the item is from. Deleting episodes, seasons, shows or movies removes saved items only;
**Reset all** clears saved items and explanation history. Clicking a row selects it (`aria-current`); Task 11 opens
the detail view from that selection.

**Files:**
- Modify: `src/lib/study-log/format.ts` (add `savedItemsLabel`)
- Create: `src/lib/study-log/filter.ts`
- Rewrite: `src/lib/study-log/group.ts` (tree over `SavedItem`)
- Modify: `src/lib/study-log/store.ts` (remove `deleteExplanations`, now unused)
- Rewrite: `src/entrypoints/options/StudyLogTree.tsx` (All items first, saved-item counts)
- Create: `src/entrypoints/options/StudyLogItems.tsx` (list rows, `TypeBadge`)
- Create: `src/entrypoints/options/StudyLogToolbar.tsx` (type filter, search, `actions` slot)
- Rewrite: `src/entrypoints/options/StudyLogTab.tsx`
- Delete: `src/entrypoints/options/StudyLogEntries.tsx`
- Create: `tests/unit/study-log-list.test.ts`
- Rewrite: `tests/unit/study-log-tab.test.tsx`
- Modify: `tests/unit/study-log.test.ts` (drop the old `groupStudyLog` block and the `deleteExplanations` test)

**Interfaces:**
- Consumes (Interface Contract): `SavedItem`, `ItemType`, `NewExplanation`, `SaveSuggestion` (`types.ts`, Tasks 1 and 2);
  `saveExplanation`, `listExplanations`, `resetStudyLog` (clears `log:`, `logkey:`, `item:`, `itemkey:`),
  `watchStudyLog` (fires on `log:` and `item:` changes) from `store.ts` (Tasks 1 and 2); `listItems`, `deleteItems`,
  `saveItem`, `migrateStudyLogV2`, `MIGRATION_KEY` from `items.ts` (Task 2); `episodeCode`, `whereLabel`,
  `formatTimestamp`, `seasonLabel`, `episodeLabel` from `format.ts` (Task 5 and Plan 2).
- Produces:
  - `group.ts`: `groupStudyLog(items: readonly SavedItem[]): StudyLogTree`; `EpisodeNode.items`, `MovieNode.items`
    (`SavedItem[]`, ordered by `lineTimeMs`, then `savedAt`); `SeasonNode.count`, `SeriesNode.count` count saved items.
  - `filter.ts`: `export type TypeFilter = ItemType | 'all'`; `filterItems(items, { type, query })`;
    `newestFirst(items)` (by `savedAt`, newest first, ties by `id`).
  - `format.ts`: `savedItemsLabel(n: number): string` → `"1 saved item"`, `"3 saved items"`.
  - `StudyLogTree.tsx`: `export const ALL_ITEMS = 'all-items'`.
  - `StudyLogItems.tsx`: `export const TYPE_LABEL: Record<ItemType, string>`, `export function TypeBadge({ type })`,
    `export function whereText(item: SavedItem, scope: 'all' | 'node'): string`; rows carry `data-item-text` on the
    text span.
  - `StudyLogToolbar.tsx`: props `{ type: TypeFilter; onTypeChange(next: TypeFilter): void; query: string;
    onQueryChange(next: string): void; actions?: ReactNode }`. **Task 12 renders its Export menu through `actions`.**
  - `StudyLogTab.tsx`: `export function StudyLogTab()` (no props in this task; Task 11 adds `openAtMoment`).

- [ ] **Step 1: Write the failing tests for grouping and filtering**

Create `tests/unit/study-log-list.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterItems, newestFirst } from '@/lib/study-log/filter';
import { savedItemsLabel } from '@/lib/study-log/format';
import { groupStudyLog } from '@/lib/study-log/group';
import type { SavedItem } from '@/lib/study-log/types';

const item = (over: Partial<SavedItem>): SavedItem => ({
  id: 'x',
  type: 'word',
  text: 'gonna',
  meaning: 'going to',
  explanationId: null,
  line: "I'm gonna call it a night.",
  lineTimeMs: 0,
  context: { before: [], after: [] },
  videoId: 'v',
  kind: 'episode',
  seriesId: 's',
  seriesTitle: 'S',
  seasonNumber: 1,
  episodeNumber: 1,
  episodeTitle: null,
  explanationLanguage: 'en',
  savedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('groupStudyLog (saved items)', () => {
  const st = { seriesId: 'st', seriesTitle: 'Stranger Things' };
  const items = [
    item({ id: 'st-e3-late', ...st, videoId: 'e3', episodeNumber: 3, lineTimeMs: 2000, updatedAt: '2026-10-05T00:00:00Z' }),
    item({ id: 'st-e3-early', ...st, videoId: 'e3', episodeNumber: 3, lineTimeMs: 1000, updatedAt: '2026-10-03T00:00:00Z' }),
    item({ id: 'st-e1', ...st, videoId: 'e1', episodeNumber: 1, updatedAt: '2026-10-02T00:00:00Z' }),
    item({ id: 'st-s2', ...st, videoId: 's2e1', seasonNumber: 2, episodeNumber: 1, updatedAt: '2026-10-01T00:00:00Z' }),
    item({ id: 'dark', seriesId: 'dark', seriesTitle: 'Dark', videoId: 'd1', updatedAt: '2026-10-06T00:00:00Z' }),
    item({ id: 'roma', kind: 'movie', seriesId: null, seriesTitle: 'Roma', videoId: 'm1', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-04T00:00:00Z' }),
    item({ id: 'okja', kind: 'movie', seriesId: null, seriesTitle: 'Okja', videoId: 'm2', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-07T00:00:00Z' }),
  ];

  it('builds series → season → episode with saved-item counts, plus Movies, in the spec order', () => {
    const tree = groupStudyLog(items);
    expect(tree.total).toBe(7);
    expect(tree.series.map((s) => [s.title, s.count])).toEqual([
      ['Dark', 1],
      ['Stranger Things', 4],
    ]);
    const stranger = tree.series[1]!;
    expect(stranger.seasons.map((s) => [s.seasonNumber, s.count])).toEqual([
      [1, 3],
      [2, 1],
    ]);
    expect(stranger.seasons[0]!.episodes.map((e) => e.episodeNumber)).toEqual([1, 3]);
    expect(stranger.seasons[0]!.episodes[1]!.items.map((i) => i.id)).toEqual(['st-e3-early', 'st-e3-late']);
    expect(tree.movies.map((m) => [m.title, m.items.map((i) => i.id)])).toEqual([
      ['Okja', ['okja']],
      ['Roma', ['roma']],
    ]);
  });

  it('orders items from the same line by when they were saved', () => {
    const tree = groupStudyLog([
      item({ id: 'later', lineTimeMs: 500, savedAt: '2026-10-02T00:00:00Z' }),
      item({ id: 'earlier', lineTimeMs: 500, savedAt: '2026-10-01T00:00:00Z' }),
      item({ id: 'first-line', lineTimeMs: 100, savedAt: '2026-10-09T00:00:00Z' }),
    ]);
    expect(tree.series[0]!.seasons[0]!.episodes[0]!.items.map((i) => i.id)).toEqual(['first-line', 'earlier', 'later']);
  });

  it('puts unnumbered seasons and episodes last', () => {
    const tree = groupStudyLog([
      item({ id: 'a', seasonNumber: null, episodeNumber: null, videoId: 'x' }),
      item({ id: 'b', seasonNumber: 1, episodeNumber: 2, videoId: 'y' }),
    ]);
    expect(tree.series[0]!.seasons.map((s) => s.seasonNumber)).toEqual([1, null]);
  });
});

describe('filterItems and newestFirst', () => {
  const items = [
    item({ id: '1', type: 'idiom', text: 'call it a night', meaning: 'stop for the evening' }),
    item({ id: '2', type: 'word', text: 'Gonna', meaning: 'going to (casual)' }),
    item({ id: '3', type: 'line', text: 'Where are you going?', meaning: '' }),
  ];
  const ids = (list: SavedItem[]) => list.map((i) => i.id);

  it('filters by type', () => {
    expect(ids(filterItems(items, { type: 'all', query: '' }))).toEqual(['1', '2', '3']);
    expect(ids(filterItems(items, { type: 'idiom', query: '' }))).toEqual(['1']);
    expect(ids(filterItems(items, { type: 'phrase', query: '' }))).toEqual([]);
  });

  it('searches text and meaning, ignoring case and surrounding spaces', () => {
    expect(ids(filterItems(items, { type: 'all', query: '  GONNA ' }))).toEqual(['2']);
    expect(ids(filterItems(items, { type: 'all', query: 'evening' }))).toEqual(['1']);
    expect(ids(filterItems(items, { type: 'all', query: 'go' }))).toEqual(['2', '3']);
    expect(ids(filterItems(items, { type: 'line', query: 'go' }))).toEqual(['3']);
  });

  it('newestFirst sorts by savedAt without changing the input', () => {
    const list = [
      item({ id: 'old', savedAt: '2026-10-01T00:00:00Z' }),
      item({ id: 'new', savedAt: '2026-10-03T00:00:00Z' }),
      item({ id: 'mid', savedAt: '2026-10-02T00:00:00Z' }),
    ];
    expect(ids(newestFirst(list))).toEqual(['new', 'mid', 'old']);
    expect(ids(list)).toEqual(['old', 'new', 'mid']);
  });

  it('names counts of saved items', () => {
    expect(savedItemsLabel(1)).toBe('1 saved item');
    expect(savedItemsLabel(3)).toBe('3 saved items');
    expect(savedItemsLabel(0)).toBe('0 saved items');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/study-log-list.test.ts`
Expected: FAIL: `Failed to resolve import "@/lib/study-log/filter"` (the module doesn't exist yet).

- [ ] **Step 3: Add `savedItemsLabel`, `filter.ts`, and rewrite `group.ts`**

Append to `src/lib/study-log/format.ts`:

```ts
/** "1 saved item", "3 saved items". */
export function savedItemsLabel(n: number): string {
  return `${n} saved ${n === 1 ? 'item' : 'items'}`;
}
```

Create `src/lib/study-log/filter.ts`:

```ts
import type { ItemType, SavedItem } from './types';

/** The Study Log toolbar's type filter (v2 spec §6.1). */
export type TypeFilter = ItemType | 'all';

/** Type filter plus a case-insensitive search over the item's text and meaning (v2 spec §6.1). */
export function filterItems(items: readonly SavedItem[], filter: { type: TypeFilter; query: string }): SavedItem[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (filter.type === 'all' || item.type === filter.type) &&
      (!query || item.text.toLocaleLowerCase().includes(query) || item.meaning.toLocaleLowerCase().includes(query)),
  );
}

/** All items view: most recently saved first. */
export function newestFirst(items: readonly SavedItem[]): SavedItem[] {
  return [...items].sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id));
}
```

Replace the whole of `src/lib/study-log/group.ts` with:

```ts
import type { SavedItem } from './types';

export interface EpisodeNode {
  key: string;
  videoId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  items: SavedItem[];
}

export interface SeasonNode {
  key: string;
  seasonNumber: number | null;
  episodes: EpisodeNode[];
  count: number;
}

export interface SeriesNode {
  key: string;
  seriesId: string | null;
  title: string;
  seasons: SeasonNode[];
  count: number;
  updatedAt: string;
}

export interface MovieNode {
  key: string;
  videoId: string;
  title: string;
  items: SavedItem[];
  updatedAt: string;
}

export interface StudyLogTree {
  series: SeriesNode[];
  movies: MovieNode[];
  total: number;
}

/** Numbers ascending, unnumbered last. */
function byNumber(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

const recentlyUpdatedFirst = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);
/** Where the line is in the episode; items from the same line in the order they were saved. */
const byLineTime = (a: SavedItem, b: SavedItem) => a.lineTimeMs - b.lineTimeMs || a.savedAt.localeCompare(b.savedAt);

/** v2 spec §6.1 (main spec §5.5 order): series by most recently updated; seasons and episodes in numeric order; Movies by most recent. */
export function groupStudyLog(items: readonly SavedItem[]): StudyLogTree {
  const series = new Map<string, SeriesNode>();
  const movies = new Map<string, MovieNode>();

  for (const item of items) {
    if (item.kind === 'movie') {
      const movie = movies.get(item.videoId) ?? {
        key: `movie:${item.videoId}`,
        videoId: item.videoId,
        title: item.seriesTitle,
        items: [],
        updatedAt: item.updatedAt,
      };
      movie.items.push(item);
      if (item.updatedAt > movie.updatedAt) movie.updatedAt = item.updatedAt;
      movies.set(item.videoId, movie);
      continue;
    }
    const seriesKey = `series:${item.seriesId ?? item.seriesTitle}`;
    const show = series.get(seriesKey) ?? {
      key: seriesKey,
      seriesId: item.seriesId,
      title: item.seriesTitle,
      seasons: [],
      count: 0,
      updatedAt: item.updatedAt,
    };
    series.set(seriesKey, show);
    if (item.updatedAt > show.updatedAt) show.updatedAt = item.updatedAt;
    show.count++;

    let season = show.seasons.find((s) => s.seasonNumber === item.seasonNumber);
    if (!season) {
      season = { key: `${seriesKey}|season:${item.seasonNumber ?? 'none'}`, seasonNumber: item.seasonNumber, episodes: [], count: 0 };
      show.seasons.push(season);
    }
    season.count++;

    let episode = season.episodes.find((ep) => ep.videoId === item.videoId);
    if (!episode) {
      episode = { key: `episode:${item.videoId}`, videoId: item.videoId, episodeNumber: item.episodeNumber, episodeTitle: item.episodeTitle, items: [] };
      season.episodes.push(episode);
    }
    episode.items.push(item);
  }

  const sortedSeries = [...series.values()].sort(recentlyUpdatedFirst);
  for (const show of sortedSeries) {
    show.seasons.sort((a, b) => byNumber(a.seasonNumber, b.seasonNumber));
    for (const season of show.seasons) {
      season.episodes.sort((a, b) => byNumber(a.episodeNumber, b.episodeNumber) || a.videoId.localeCompare(b.videoId));
      for (const episode of season.episodes) episode.items.sort(byLineTime);
    }
  }
  const sortedMovies = [...movies.values()].sort(recentlyUpdatedFirst);
  for (const movie of sortedMovies) movie.items.sort(byLineTime);

  return { series: sortedSeries, movies: sortedMovies, total: items.length };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run tests/unit/study-log-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the Study Log tab**

Replace the whole of `tests/unit/study-log-tab.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { StudyLogTab } from '@/entrypoints/options/StudyLogTab';
import { MIGRATION_KEY, listItems, saveItem } from '@/lib/study-log/items';
import { listExplanations, saveExplanation } from '@/lib/study-log/store';
import type { NewExplanation, SaveSuggestion } from '@/lib/study-log/types';

beforeEach(async () => {
  fakeBrowser.reset();
  // An install that has already moved to v2; the conversion test below removes this.
  await fakeBrowser.storage.local.set({ [MIGRATION_KEY]: true });
});
afterEach(cleanup);

const line = (over: Partial<NewExplanation>): NewExplanation => ({
  phrase: 'Line',
  response: '## Meaning\nAn explanation.',
  videoTimeMs: 1000,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: [], after: [] },
  explanationLanguage: 'en',
  model: 'claude-sonnet-5-5',
  suggestions: [],
  ...over,
});

async function save(over: Partial<NewExplanation>, suggestion: SaveSuggestion, savedAt: string) {
  return saveItem(await saveExplanation(line(over)), suggestion, new Date(savedAt));
}

const NIGHT = { phrase: "I'm gonna call it a night.", videoTimeMs: 1_834_200 };
const PILOT = { phrase: 'Pilot line', videoId: '80077209', episodeNumber: 1, episodeTitle: 'The Vanishing of Will Byers', videoTimeMs: 5000 };
const ROMA = {
  phrase: 'Movie line',
  videoId: '80240715',
  kind: 'movie' as const,
  seriesId: null,
  seriesTitle: 'Roma',
  seasonNumber: null,
  episodeNumber: null,
  episodeTitle: null,
};

/** 5 saved items from 4 explanations: 3 in E3, 1 in E1, 1 in the movie Roma. */
async function seed() {
  await save(ROMA, { type: 'phrase', text: 'Movie line', meaning: 'a line from a film' }, '2026-10-10T08:00:00Z');
  await save(PILOT, { type: 'word', text: 'Pilot', meaning: 'first episode' }, '2026-10-10T09:00:00Z');
  await save(NIGHT, { type: 'idiom', text: 'call it a night', meaning: 'stop for the evening' }, '2026-10-10T10:00:00Z');
  await save({ phrase: 'Where are you going?', videoTimeMs: 1000 }, { type: 'line', text: 'Where are you going?', meaning: '' }, '2026-10-10T10:01:00Z');
  await save(NIGHT, { type: 'word', text: 'gonna', meaning: 'going to (casual)' }, '2026-10-10T10:02:00Z');
}

const tree = () => screen.findByRole('navigation', { name: 'Shows and movies' });

/** The texts of the rows in the Saved items list, in order. */
async function rowTexts(): Promise<(string | null | undefined)[]> {
  const list = await screen.findByRole('list', { name: 'Saved items' });
  return within(list)
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[data-item-text]')?.textContent);
}

/** The row button whose text is `text`. */
async function rowButton(text: string): Promise<HTMLElement> {
  const list = await screen.findByRole('list', { name: 'Saved items' });
  const button = within(list)
    .getAllByRole('button')
    .find((b) => b.querySelector('[data-item-text]')?.textContent === text);
  if (!button) throw new Error(`No row for ${text}`);
  return button;
}

describe('Study Log tab', () => {
  it('invites a first save when empty', async () => {
    render(<StudyLogTab />);
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(screen.getByText('Hover a line on Netflix and save words, phrases, idioms or whole lines.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset all' })).toBeNull();
  });

  it('opens on All items, newest first, with where each item is from', async () => {
    await seed();
    render(<StudyLogTab />);
    expect(await rowTexts()).toEqual(['gonna', 'Where are you going?', 'call it a night', 'Pilot', 'Movie line']);
    expect(within(await tree()).getByRole('button', { name: 'All items, 5 saved items' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Words, phrases, idioms and lines you saved.')).toBeTruthy();
    const first = within(screen.getByRole('list', { name: 'Saved items' })).getAllByRole('listitem')[0]!;
    expect(within(first).getByText('Word')).toBeTruthy();
    expect(within(first).getByText('going to (casual)')).toBeTruthy();
    expect(within(first).getByText('Stranger Things S1 E3 30:34')).toBeTruthy();
  });

  it('shows series → season → episode with saved-item counts, and an episode’s items in line order', async () => {
    await seed();
    render(<StudyLogTab />);
    const nav = await tree();
    const seriesRow = within(nav).getByText('Stranger Things').parentElement!;
    expect(within(seriesRow).getByText('4')).toBeTruthy();
    expect(within(seriesRow).getByText('4 saved items')).toBeTruthy();
    const seasonRow = within(nav).getByText('Season 1').parentElement!;
    expect(within(seasonRow).getByText('4 saved items')).toBeTruthy();

    fireEvent.click(within(nav).getByRole('button', { name: 'E3 · Holly, Jolly, 3 saved items' }));
    await waitFor(async () => expect(await rowTexts()).toEqual(['Where are you going?', 'call it a night', 'gonna']));
    const rows = within(screen.getByRole('list', { name: 'Saved items' })).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('S1 E3 0:01')).toBeTruthy();

    fireEvent.click(within(nav).getByRole('button', { name: 'Roma, 1 saved item' }));
    expect(await screen.findByText('Roma 0:01')).toBeTruthy();
  });

  it('filters by type and searches text and meaning; Clear filters brings everything back', async () => {
    await seed();
    render(<StudyLogTab />);
    await rowTexts();
    fireEvent.click(screen.getByRole('radio', { name: 'Idioms' }));
    expect(await rowTexts()).toEqual(['call it a night']);
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    const search = screen.getByRole('searchbox', { name: 'Search saved items' });
    fireEvent.change(search, { target: { value: 'EVENING' } });
    expect(await rowTexts()).toEqual(['call it a night']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByText('Nothing matches.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await rowTexts()).toHaveLength(5);
    expect(screen.getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('searchbox', { name: 'Search saved items' }) as HTMLInputElement).value).toBe('');
  });

  it('deleting an episode asks first and removes its saved items only', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(within(await tree()).getByRole('button', { name: 'E3 · Holly, Jolly, 3 saved items' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete episode' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete episode?' });
    expect(within(dialog).getByText('All 3 saved items from this episode will be removed. Explanations stay in your history.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await listItems()).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Delete episode' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await listItems()).map((i) => i.text).sort()).toEqual(['Movie line', 'Pilot']));
    expect(await listExplanations()).toHaveLength(4);
  });

  it('deletes a whole season from the tree after confirming', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Stranger Things Season 1' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Stranger Things Season 1?' });
    expect(within(dialog).getByText('All 4 saved items from this season will be removed. Explanations stay in your history.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await listItems()).map((i) => i.text)).toEqual(['Movie line']));
  });

  it('Reset all clears saved items and explanation history after confirming', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reset all' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Reset your Study Log?' });
    expect(within(dialog).getByText("Every saved item and every explanation in your history will be removed. This can't be undone.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset all' }));
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(await listItems()).toEqual([]);
    expect(await listExplanations()).toEqual([]);
  });

  it('offers Reset all when only explanation history is left', async () => {
    await saveExplanation(line({ phrase: 'Explained, never saved' }));
    render(<StudyLogTab />);
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset all' })).toBeTruthy();
  });

  it('turns explanations from before v2 into saved lines the first time it opens', async () => {
    await fakeBrowser.storage.local.remove(MIGRATION_KEY);
    // As the Study Log stored it before v2: no `suggestions` field.
    const { suggestions: _none, ...preV2 } = await saveExplanation(line({ phrase: 'Old line' }));
    await fakeBrowser.storage.local.set({ [`log:${preV2.id}`]: preV2 });
    render(<StudyLogTab />);
    expect(await rowTexts()).toEqual(['Old line']);
    const row = within(screen.getByRole('list', { name: 'Saved items' })).getAllByRole('listitem')[0]!;
    expect(within(row).getByText('Line')).toBeTruthy();
  });

  it('shows an item saved from a Netflix tab without reloading', async () => {
    render(<StudyLogTab />);
    await screen.findByText('Nothing saved yet');
    await save({ phrase: 'Fresh line' }, { type: 'line', text: 'Fresh line', meaning: '' }, '2026-10-10T11:00:00Z');
    expect(await rowTexts()).toEqual(['Fresh line']);
  });

  it('selecting a row marks it as current', async () => {
    await seed();
    render(<StudyLogTab />);
    const pilot = await rowButton('Pilot');
    fireEvent.click(pilot);
    expect(pilot.getAttribute('aria-current')).toBe('true');
    expect((await rowButton('gonna')).getAttribute('aria-current')).toBeNull();
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/study-log-tab.test.tsx`
Expected: FAIL: the old tab still lists explanations (e.g. `Unable to find an element with the text: Nothing saved yet` and `Unable to find role="list" and name "Saved items"`).

- [ ] **Step 7: Rewrite the tree, add the list and toolbar, rewrite the tab**

Replace the whole of `src/entrypoints/options/StudyLogTree.tsx` with:

```tsx
import { Film, Trash2 } from 'lucide-react';
import { focusRing } from '@/components/styles';
import { episodeLabel, savedItemsLabel, seasonLabel } from '@/lib/study-log/format';
import type { SeasonNode, SeriesNode, StudyLogTree as Tree } from '@/lib/study-log/group';

/** The tree node that lists every saved item, newest first (v2 spec §6.1). */
export const ALL_ITEMS = 'all-items';

const countPill = 'ml-auto rounded-full bg-soft px-2 text-[11px] font-extrabold text-mute';
const trashButton = `grid size-7 shrink-0 place-items-center rounded-lg text-mute hover:bg-soft hover:text-danger ${focusRing}`;

interface StudyLogTreeProps {
  tree: Tree;
  selected: string;
  onSelect(key: string): void;
  onDeleteSeries(series: SeriesNode): void;
  onDeleteSeason(series: SeriesNode, season: SeasonNode): void;
}

function NodeButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={`${label}, ${savedItemsLabel(count)}`}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-xl border-2 px-2.5 py-1.5 text-left text-sm font-bold ${focusRing} ${
        active ? 'border-tint-line bg-tint text-tint-ink' : 'border-transparent hover:bg-soft'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span aria-hidden="true" className={countPill}>
        {count}
      </span>
    </button>
  );
}

/** A row's count: the pill is what you see, "N saved items" is what a screen reader says. */
function Count({ n }: { n: number }) {
  return (
    <>
      <span aria-hidden="true" className={countPill}>
        {n}
      </span>
      <span className="sr-only">{savedItemsLabel(n)}</span>
    </>
  );
}

/** v2 spec §6.1: All items, then Series → Season → Episode with saved-item counts, plus Movies. */
export function StudyLogTree({ tree, selected, onSelect, onDeleteSeries, onDeleteSeason }: StudyLogTreeProps) {
  return (
    <nav aria-label="Shows and movies" className="flex flex-col gap-4">
      <NodeButton label="All items" count={tree.total} active={selected === ALL_ITEMS} onClick={() => onSelect(ALL_ITEMS)} />
      {tree.series.map((series) => (
        <div key={series.key}>
          <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate text-[15px] font-black">{series.title}</p>
            <Count n={series.count} />
            <button type="button" aria-label={`Delete ${series.title}`} onClick={() => onDeleteSeries(series)} className={trashButton}>
              <Trash2 size={14} strokeWidth={2.5} aria-hidden />
            </button>
          </div>
          {series.seasons.map((season) => (
            <div key={season.key} className="mt-1.5">
              <div className="flex items-center gap-1 pl-1">
                <p className="flex-1 text-[12px] font-extrabold tracking-wide text-mute uppercase">{seasonLabel(season.seasonNumber)}</p>
                <Count n={season.count} />
                <button
                  type="button"
                  aria-label={`Delete ${series.title} ${seasonLabel(season.seasonNumber)}`}
                  onClick={() => onDeleteSeason(series, season)}
                  className={trashButton}
                >
                  <Trash2 size={14} strokeWidth={2.5} aria-hidden />
                </button>
              </div>
              <ul className="mt-1 flex flex-col gap-1">
                {season.episodes.map((episode) => (
                  <li key={episode.key}>
                    <NodeButton
                      label={episodeLabel(episode)}
                      count={episode.items.length}
                      active={selected === episode.key}
                      onClick={() => onSelect(episode.key)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
      {tree.movies.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-[15px] font-black">
            <Film size={16} strokeWidth={2.5} aria-hidden />
            Movies
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {tree.movies.map((movie) => (
              <li key={movie.key}>
                <NodeButton label={movie.title} count={movie.items.length} active={selected === movie.key} onClick={() => onSelect(movie.key)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
```

Create `src/entrypoints/options/StudyLogItems.tsx`:

```tsx
import { Trash2 } from 'lucide-react';
import { buttonSecondary, focusRing } from '@/components/styles';
import { episodeCode, formatTimestamp, whereLabel } from '@/lib/study-log/format';
import type { ItemType, SavedItem } from '@/lib/study-log/types';

export const TYPE_LABEL: Record<ItemType, string> = { word: 'Word', phrase: 'Phrase', idiom: 'Idiom', line: 'Line' };

/** WORD, PHRASE, IDIOM, LINE (uppercase by CSS, so screen readers say the word). */
export function TypeBadge({ type }: { type: ItemType }) {
  return (
    <span className="shrink-0 rounded-lg bg-tint px-2 py-0.5 text-[11px] font-black tracking-wide text-tint-ink uppercase">{TYPE_LABEL[type]}</span>
  );
}

/**
 * Where a row's item is from (v2 spec §6.1): "S1 E3 30:34" inside an episode, the movie title and time for a
 * movie, and the show spelled out in All items, where shows are mixed ("Stranger Things S1 E3 30:34").
 */
export function whereText(item: SavedItem, scope: 'all' | 'node'): string {
  const time = formatTimestamp(item.lineTimeMs);
  if (scope === 'all' || item.kind === 'movie') return `${whereLabel(item)} ${time}`;
  return [episodeCode(item), time].filter(Boolean).join(' ');
}

interface StudyLogItemsProps {
  heading: string;
  subheading: string;
  /** Already filtered and ordered. */
  items: readonly SavedItem[];
  scope: 'all' | 'node';
  selectedId: string | null;
  onSelectItem(item: SavedItem): void;
  /** "Delete episode" or "Delete movie"; null in All items (no bulk delete there). */
  deleteLabel: string | null;
  onDeleteAll(): void;
  onClearFilters(): void;
}

/** v2 spec §6.1: the selected node's saved items. Empty only when the filters match nothing. */
export function StudyLogItems({
  heading,
  subheading,
  items,
  scope,
  selectedId,
  onSelectItem,
  deleteLabel,
  onDeleteAll,
  onClearFilters,
}: StudyLogItemsProps) {
  return (
    <section aria-labelledby="study-log-items-heading" className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="study-log-items-heading" className="text-[19px] font-black">
            {heading}
          </h2>
          <p className="text-sm font-semibold text-mute">{subheading}</p>
        </div>
        {deleteLabel && (
          <button type="button" onClick={onDeleteAll} className={buttonSecondary}>
            <Trash2 size={14} strokeWidth={3} aria-hidden />
            {deleteLabel}
          </button>
        )}
      </header>
      {items.length === 0 ? (
        <div className="rounded-[18px] border-2 border-dashed border-line px-4 py-5 text-center">
          <p className="text-[15px] font-extrabold">Nothing matches.</p>
          <button type="button" onClick={onClearFilters} className={`${buttonSecondary} mt-3`}>
            Clear filters
          </button>
        </div>
      ) : (
        <ol aria-label="Saved items" className="flex flex-col gap-2">
          {items.map((item) => {
            const active = item.id === selectedId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelectItem(item)}
                  className={`flex w-full flex-col gap-1 rounded-[18px] border-2 px-4 py-3 text-left ${focusRing} ${
                    active ? 'border-tint-line bg-tint' : 'border-line bg-card hover:bg-soft'
                  }`}
                >
                  <span className="flex w-full items-start gap-2">
                    <TypeBadge type={item.type} />
                    <span data-item-text className="min-w-0 flex-1 text-[15px] font-extrabold whitespace-pre-line">
                      {item.text}
                    </span>
                    <span className="shrink-0 text-[12px] font-bold text-mute">{whereText(item, scope)}</span>
                  </span>
                  {item.meaning && <span className="text-sm font-semibold text-mute">{item.meaning}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
```

Create `src/entrypoints/options/StudyLogToolbar.tsx`:

```tsx
import { Captions, List, MessageSquareQuote, Search, Sparkles, Type, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { SegmentedControl } from '@/components/SegmentedControl';
import type { TypeFilter } from '@/lib/study-log/filter';

const TYPE_OPTIONS: readonly { value: TypeFilter; label: string; icon: LucideIcon }[] = [
  { value: 'all', label: 'All', icon: List },
  { value: 'word', label: 'Words', icon: Type },
  { value: 'phrase', label: 'Phrases', icon: MessageSquareQuote },
  { value: 'idiom', label: 'Idioms', icon: Sparkles },
  { value: 'line', label: 'Lines', icon: Captions },
];

interface StudyLogToolbarProps {
  type: TypeFilter;
  onTypeChange(next: TypeFilter): void;
  query: string;
  onQueryChange(next: string): void;
  /** Page actions at the end of the toolbar (Task 12 puts the Export menu here). */
  actions?: ReactNode;
}

/** v2 spec §6.1: type filter (single choice), search over text and meaning, then page actions. */
export function StudyLogToolbar({ type, onTypeChange, query, onQueryChange, actions }: StudyLogToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl label="Item type" value={type} options={TYPE_OPTIONS} onChange={onTypeChange} />
      <label className="flex min-w-48 flex-1 items-center gap-2 rounded-2xl border-2 border-line bg-card px-3 py-2 focus-within:border-brand">
        <Search size={16} strokeWidth={2.5} className="shrink-0 text-mute" aria-hidden />
        <input
          type="search"
          aria-label="Search saved items"
          placeholder="Search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm font-bold text-ink outline-none placeholder:text-mute"
        />
      </label>
      {actions}
    </div>
  );
}
```

Replace the whole of `src/entrypoints/options/StudyLogTab.tsx` with:

```tsx
import { BookOpen, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { buttonSecondary, card, iconTile } from '@/components/styles';
import { filterItems, newestFirst, type TypeFilter } from '@/lib/study-log/filter';
import { episodeLabel, savedItemsLabel, seasonLabel } from '@/lib/study-log/format';
import { groupStudyLog, type StudyLogTree as Tree } from '@/lib/study-log/group';
import { deleteItems, listItems, migrateStudyLogV2 } from '@/lib/study-log/items';
import { listExplanations, resetStudyLog, watchStudyLog } from '@/lib/study-log/store';
import type { SavedItem } from '@/lib/study-log/types';
import { StudyLogItems } from './StudyLogItems';
import { StudyLogToolbar } from './StudyLogToolbar';
import { ALL_ITEMS, StudyLogTree } from './StudyLogTree';

interface Selectable {
  key: string;
  heading: string;
  subheading: string;
  scope: 'all' | 'node';
  /** "Delete episode" or "Delete movie"; null for All items. */
  deleteLabel: string | null;
  /** "this episode" or "this movie", for the confirmation text. */
  place: string;
  items: SavedItem[];
}

interface PendingDelete {
  title: string;
  body: string;
  confirmLabel?: string;
  run(): Promise<void>;
}

interface Loaded {
  items: SavedItem[];
  /** How many explanations are in the history (Reset all also clears them). */
  historyCount: number;
}

const NO_ITEMS: SavedItem[] = [];
const KEEP_HISTORY = 'Explanations stay in your history.';

/** All items first, then episodes in tree order, then movies: what the list can show. */
function selectable(tree: Tree, all: readonly SavedItem[]): Selectable[] {
  const everything: Selectable = {
    key: ALL_ITEMS,
    heading: 'All items',
    subheading: savedItemsLabel(all.length),
    scope: 'all',
    deleteLabel: null,
    place: '',
    items: newestFirst(all),
  };
  const episodes = tree.series.flatMap((series) =>
    series.seasons.flatMap((season) =>
      season.episodes.map(
        (episode): Selectable => ({
          key: episode.key,
          heading: series.title,
          subheading: `${seasonLabel(season.seasonNumber)} · ${episodeLabel(episode)}`,
          scope: 'node',
          deleteLabel: 'Delete episode',
          place: 'this episode',
          items: episode.items,
        }),
      ),
    ),
  );
  const movies = tree.movies.map(
    (movie): Selectable => ({
      key: movie.key,
      heading: movie.title,
      subheading: 'Movie',
      scope: 'node',
      deleteLabel: 'Delete movie',
      place: 'this movie',
      items: movie.items,
    }),
  );
  return [everything, ...episodes, ...movies];
}

/** v2 spec §6: the learner's saved words, phrases, idioms and lines. */
export function StudyLogTab() {
  const [data, setData] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string>(ALL_ITEMS);
  const [type, setType] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      void Promise.all([listItems(), listExplanations()]).then(([items, explanations]) => {
        if (active) setData({ items, historyCount: explanations.length });
      });
    // Explanations from before v2 become saved lines first (v2 spec §3.3); if that fails, show what's there.
    void migrateStudyLogV2().then(load, load);
    const unwatch = watchStudyLog(load);
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  const items = data?.items ?? NO_ITEMS;
  const tree = useMemo(() => groupStudyLog(items), [items]);
  const nodes = useMemo(() => selectable(tree, items), [tree, items]);
  const current = nodes.find((n) => n.key === selected) ?? nodes[0]!;
  const visible = useMemo(() => filterItems(current.items, { type, query }), [current, type, query]);

  const confirmDelete = (title: string, body: string, ids: string[]) => setPending({ title, body, run: () => deleteItems(ids) });
  const clearFilters = () => {
    setType('all');
    setQuery('');
  };

  if (data === null) return <p className="text-sm font-semibold text-mute">Loading…</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-black tracking-tight">Study Log</h1>
          <p className="mt-1 text-[15px] font-semibold text-mute">Words, phrases, idioms and lines you saved.</p>
        </div>
        {items.length + data.historyCount > 0 && (
          <button
            type="button"
            className={buttonSecondary}
            onClick={() =>
              setPending({
                title: 'Reset your Study Log?',
                body: "Every saved item and every explanation in your history will be removed. This can't be undone.",
                confirmLabel: 'Reset all',
                run: resetStudyLog,
              })
            }
          >
            <RotateCcw size={14} strokeWidth={3} aria-hidden />
            Reset all
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <section className={`${card} flex items-start gap-3.5 px-5 py-5`}>
          <span className={iconTile}>
            <BookOpen size={20} strokeWidth={2.5} aria-hidden />
          </span>
          <div>
            <h2 className="text-[19px] font-black">Nothing saved yet</h2>
            <p className="mt-0.5 text-sm font-semibold text-mute">Hover a line on Netflix and save words, phrases, idioms or whole lines.</p>
          </div>
        </section>
      ) : (
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <StudyLogTree
            tree={tree}
            selected={current.key}
            onSelect={(key) => {
              setSelected(key);
              setSelectedItemId(null);
            }}
            onDeleteSeries={(series) =>
              confirmDelete(
                `Delete ${series.title}?`,
                `All ${savedItemsLabel(series.count)} from this show will be removed. ${KEEP_HISTORY}`,
                series.seasons.flatMap((s) => s.episodes.flatMap((e) => e.items.map((i) => i.id))),
              )
            }
            onDeleteSeason={(series, season) =>
              confirmDelete(
                `Delete ${series.title} ${seasonLabel(season.seasonNumber)}?`,
                `All ${savedItemsLabel(season.count)} from this season will be removed. ${KEEP_HISTORY}`,
                season.episodes.flatMap((e) => e.items.map((i) => i.id)),
              )
            }
          />
          <div className="flex min-w-0 flex-col gap-4">
            <StudyLogToolbar type={type} onTypeChange={setType} query={query} onQueryChange={setQuery} />
            <StudyLogItems
              heading={current.heading}
              subheading={current.subheading}
              items={visible}
              scope={current.scope}
              selectedId={selectedItemId}
              onSelectItem={(item) => setSelectedItemId(item.id)}
              deleteLabel={current.deleteLabel}
              onDeleteAll={() =>
                confirmDelete(
                  `${current.deleteLabel}?`,
                  `All ${savedItemsLabel(current.items.length)} from ${current.place} will be removed. ${KEEP_HISTORY}`,
                  current.items.map((i) => i.id),
                )
              }
              onClearFilters={clearFilters}
            />
          </div>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirmLabel}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            void action.run();
          }}
        />
      )}
    </div>
  );
}
```

Delete the old list component:

```bash
git rm src/entrypoints/options/StudyLogEntries.tsx
```

- [ ] **Step 8: Run the tab tests to verify they pass**

Run: `pnpm vitest run tests/unit/study-log-tab.test.tsx tests/unit/study-log-list.test.ts`
Expected: PASS.

- [ ] **Step 9: Remove `deleteExplanations` and the old grouping tests**

Nothing deletes single explanations any more (v2 spec §6.3: deletes remove saved items only; Reset all clears both).

1. In `src/lib/study-log/store.ts`, delete the whole `export async function deleteExplanations(ids: readonly string[]): Promise<void> { … }` function.
2. In `tests/unit/study-log.test.ts`:
   - delete the `it(…)` test that calls `deleteExplanations` (Plan 2's "deletes entries and their lookup keys only", renamed by Task 1);
   - delete the whole `describe('groupStudyLog', …)` block (its replacement is in `tests/unit/study-log-list.test.ts`), and the fixture factory directly above it that builds a full `Explanation` with `id: 'x'` if no other test in the file uses it (search the file for its name first);
   - remove `deleteExplanations` and `groupStudyLog` from the file's import lines (and the import of the `Explanation` type if nothing else uses it).

Then confirm nothing else refers to them:

Run: `grep -rn "deleteExplanations\|StudyLogEntries" src tests`
Expected: no output.

- [ ] **Step 10: Run the whole suite and the type check**

Run: `pnpm test && pnpm compile`
Expected: all tests PASS; `tsc --noEmit` prints nothing.

- [ ] **Step 11: Commit**

```bash
git add src/lib/study-log/format.ts src/lib/study-log/filter.ts src/lib/study-log/group.ts src/lib/study-log/store.ts \
  src/entrypoints/options/StudyLogTree.tsx src/entrypoints/options/StudyLogItems.tsx src/entrypoints/options/StudyLogToolbar.tsx \
  src/entrypoints/options/StudyLogTab.tsx tests/unit/study-log-list.test.ts tests/unit/study-log-tab.test.tsx tests/unit/study-log.test.ts
git commit -m "feat(study-log): list saved items with All items, type filter, search and item-only deletes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: Detail view

Spec: v2 spec §6.1 (detail column at ≥ 1100 px, otherwise in place of the list with **Back**, Escape closes), §6.2 (contents), §6.3 (deleting an item), main spec §5.5 (Open at this moment).

Clicking a row opens the detail view for that saved item: type badge, text, meaning, the full line with the item
highlighted, where it's from, **Open at this moment**, the saved date, the dialogue around it, Claude's explanation
with follow-ups, and **Delete**. On a wide window it is a third column; on a narrow one it replaces the list. The
options page gives the Study Log tab the full width so three columns fit.

**Files:**
- Create: `src/lib/study-log/highlight.ts`
- Create: `src/hooks/useWideLayout.ts`
- Create: `src/entrypoints/options/StudyLogDetail.tsx`
- Rewrite: `src/entrypoints/options/StudyLogTab.tsx` (detail integration, Escape, item delete, Open at this moment)
- Modify: `src/components/ConfirmDialog.tsx` (its Escape no longer reaches the page)
- Modify: `src/entrypoints/options/App.tsx` (Study Log tab uses the full width)
- Create: `tests/unit/study-log-detail.test.tsx`
- Modify: `tests/unit/study-log-tab.test.tsx`, `tests/unit/options.test.tsx`

**Interfaces:**
- Consumes (Interface Contract): `SavedItem`, `Explanation` (`types.ts`, Tasks 1 and 2); `getExplanation` (`store.ts`,
  Task 1); `deleteItems` (`items.ts`, Task 2); `formatTimestamp` (`format.ts`); `setPendingSeek` (`src/lib/pending-seek.ts`,
  Plan 2). From Task 10: `StudyLogTab` structure, `TypeBadge` (`StudyLogItems.tsx`), `StudyLogToolbar` (with its
  `actions` slot), `ALL_ITEMS`, the `rowButton` / `rowTexts` / `seed` helpers in `tests/unit/study-log-tab.test.tsx`.
- Produces:
  - `highlight.ts`: `export interface HighlightPart { text: string; mark: boolean }`;
    `export function highlightParts(line: string, text: string): HighlightPart[]` (every case-insensitive occurrence;
    any run of whitespace in `text` matches any run of whitespace in `line`).
  - `useWideLayout.ts`: `export const WIDE_LAYOUT_QUERY = '(min-width: 1100px)'`; `export function useWideLayout(): boolean`
    (true when `matchMedia` is missing).
  - `StudyLogDetail.tsx`: `export function detailWhere(item): string`; `export function StudyLogDetail(props:
    { item: SavedItem; narrow: boolean; onClose(): void; onDelete(item: SavedItem): void; onOpenAtMoment(item: SavedItem): void;
    loadExplanation?(id: string): Promise<Explanation | null> })`. Rendered as a `<section>` named by the item text
    (role `region`).
  - `StudyLogTab.tsx`: `export function StudyLogTab({ openAtMoment }: { openAtMoment?: (item: SavedItem) => Promise<void> } = {})`.
    Task 12 adds the Export menu through `StudyLogToolbar`'s `actions` prop, inside this file.

- [ ] **Step 1: Write the failing tests for highlighting, the layout hook and the detail view**

Create `tests/unit/study-log-detail.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyLogDetail, detailWhere } from '@/entrypoints/options/StudyLogDetail';
import { useWideLayout, WIDE_LAYOUT_QUERY } from '@/hooks/useWideLayout';
import { highlightParts } from '@/lib/study-log/highlight';
import type { Explanation, SavedItem } from '@/lib/study-log/types';

afterEach(cleanup);

const ITEM: SavedItem = {
  id: 'i1',
  type: 'idiom',
  text: 'call it a night',
  meaning: 'stop for the evening',
  explanationId: 'e1',
  line: "I'm gonna call it\na night. Call it a night!",
  lineTimeMs: 1_834_200,
  context: { before: ['Where are you going?', 'Home.'], after: ['Night, Mike.'] },
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  explanationLanguage: 'en',
  savedAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
};

const EXPLANATION = {
  id: 'e1',
  response: '## Meaning\nTime to **sleep**.',
  followUps: [{ question: 'Formal?', answer: 'No, casual.' }],
} as Explanation;

function renderDetail(over: Partial<SavedItem> = {}, opts: { narrow?: boolean; explanation?: Explanation | null } = {}) {
  const handlers = { onClose: vi.fn(), onDelete: vi.fn(), onOpenAtMoment: vi.fn() };
  const loadExplanation = vi.fn(async (_id: string) => (opts.explanation === undefined ? EXPLANATION : opts.explanation));
  const view = render(<StudyLogDetail item={{ ...ITEM, ...over }} narrow={opts.narrow ?? false} loadExplanation={loadExplanation} {...handlers} />);
  return { ...handlers, loadExplanation, container: view.container };
}

describe('highlightParts', () => {
  it('marks every occurrence, ignoring case and matching across line breaks', () => {
    expect(highlightParts("I'm gonna call it\na night. Call it a night!", 'call it a night')).toEqual([
      { text: "I'm gonna ", mark: false },
      { text: 'call it\na night', mark: true },
      { text: '. ', mark: false },
      { text: 'Call it a night', mark: true },
      { text: '!', mark: false },
    ]);
  });

  it('treats the text literally and leaves the line alone when it is not found', () => {
    expect(highlightParts('Is it 1+1?', '1+1')).toEqual([
      { text: 'Is it ', mark: false },
      { text: '1+1', mark: true },
      { text: '?', mark: false },
    ]);
    expect(highlightParts('What?', 'Why (not)?')).toEqual([{ text: 'What?', mark: false }]);
    expect(highlightParts('Line', '   ')).toEqual([{ text: 'Line', mark: false }]);
  });
});

describe('useWideLayout', () => {
  it('follows (min-width: 1100px)', () => {
    let matches = false;
    const listeners: (() => void)[] = [];
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          get matches() {
            return matches;
          },
          media: query,
          addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useWideLayout());
    expect(matchMedia).toHaveBeenCalledWith(WIDE_LAYOUT_QUERY);
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      for (const listener of listeners) listener();
    });
    expect(result.current).toBe(true);
  });

  it('is wide when matchMedia is missing', () => {
    const original = window.matchMedia;
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    try {
      const { result } = renderHook(() => useWideLayout());
      expect(result.current).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('detailWhere', () => {
  it('names the show, season, episode and time, or the movie and time', () => {
    expect(detailWhere(ITEM)).toBe('Stranger Things · Season 1 · E3 "Holly, Jolly" · 30:34');
    expect(detailWhere({ ...ITEM, kind: 'movie', seriesTitle: 'Roma', seasonNumber: null, episodeNumber: null, episodeTitle: null, lineTimeMs: 3_723_000 })).toBe(
      'Roma · 1:02:03',
    );
    expect(detailWhere({ ...ITEM, seasonNumber: null, episodeNumber: null, episodeTitle: 'Special' })).toBe('Stranger Things · "Special" · 30:34');
    expect(detailWhere({ ...ITEM, episodeTitle: null })).toBe('Stranger Things · Season 1 · E3 · 30:34');
  });
});

describe('StudyLogDetail', () => {
  it('shows the type, text, meaning, the line with the item highlighted, where it is from, and when it was saved', () => {
    const { container } = renderDetail();
    const detail = screen.getByRole('region', { name: 'call it a night' });
    expect(within(detail).getByText('Idiom')).toBeTruthy();
    expect(within(detail).getByText('stop for the evening')).toBeTruthy();
    expect([...container.querySelectorAll('blockquote mark')].map((m) => m.textContent)).toEqual(['call it\na night', 'Call it a night']);
    expect(within(detail).getByText('Stranger Things · Season 1 · E3 "Holly, Jolly" · 30:34')).toBeTruthy();
    expect(within(detail).getByText(`Saved ${new Date(ITEM.savedAt).toLocaleString()}`)).toBeTruthy();
  });

  it('does not highlight a whole-line item', () => {
    const { container } = renderDetail({ type: 'line', text: ITEM.line, meaning: '' });
    expect(container.querySelector('blockquote')?.textContent).toBe(ITEM.line);
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });

  it('shows the dialogue around the line when expanded, with the line marked', () => {
    renderDetail();
    const toggle = screen.getByRole('button', { name: 'Dialogue around it' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const rows = within(screen.getByRole('list', { name: 'Dialogue around it' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Where are you going?', 'Home.', ITEM.line, 'Night, Mike.']);
    expect(rows[2]!.getAttribute('aria-current')).toBe('true');
    expect(rows[2]!.querySelectorAll('mark')).toHaveLength(2);
  });

  it("loads Claude's explanation, collapsed when the item has a meaning", async () => {
    const { loadExplanation } = renderDetail();
    const toggle = screen.getByRole('button', { name: "Claude's explanation" });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(await screen.findByRole('heading', { name: 'Meaning' })).toBeTruthy();
    expect(screen.getByText('sleep').tagName).toBe('STRONG');
    expect(screen.getByText('Formal?')).toBeTruthy();
    expect(screen.getByText('No, casual.')).toBeTruthy();
    expect(loadExplanation).toHaveBeenCalledWith('e1');
  });

  it("opens Claude's explanation by default when there is no meaning, and says when it isn't available", async () => {
    const first = renderDetail({ meaning: '', explanationId: null });
    expect(screen.getByRole('button', { name: "Claude's explanation" }).getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText("Claude's explanation isn't available for this item.")).toBeTruthy();
    expect(first.loadExplanation).not.toHaveBeenCalled();
    cleanup();

    renderDetail({ meaning: '' }, { explanation: null });
    expect(await screen.findByText("Claude's explanation isn't available for this item.")).toBeTruthy();
  });

  it('Open at this moment, Delete and Close call back; Back replaces Close on a narrow window', () => {
    const wide = renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Open at this moment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(wide.onOpenAtMoment).toHaveBeenCalledWith(ITEM);
    expect(wide.onDelete).toHaveBeenCalledWith(ITEM);
    expect(wide.onClose).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    cleanup();

    const narrow = renderDetail({}, { narrow: true });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(narrow.onClose).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close details' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/study-log-detail.test.tsx`
Expected: FAIL: `Failed to resolve import "@/entrypoints/options/StudyLogDetail"` (and the hook and highlight modules).

- [ ] **Step 3: Add `highlight.ts`, `useWideLayout.ts` and `StudyLogDetail.tsx`**

Create `src/lib/study-log/highlight.ts`:

```ts
export interface HighlightPart {
  text: string;
  mark: boolean;
}

/** Characters with a meaning in a regular expression (the `u` flag rejects escaping anything else). */
const escapeRegExp = (s: string) => s.replace(/[\^$\\.*+?()[\]{}|/]/g, '\\$&');

/**
 * The line split around every case-insensitive occurrence of `text` (v2 spec §6.2). Any run of whitespace in
 * `text` matches any run in the line, so "call it a night" finds "call it\na night".
 */
export function highlightParts(line: string, text: string): HighlightPart[] {
  const words = text.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return [{ text: line, mark: false }];
  const pattern = new RegExp(words.join('\\s+'), 'giu');
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: line.slice(last, start), mark: false });
    parts.push({ text: match[0], mark: true });
    last = start + match[0].length;
  }
  if (last < line.length || parts.length === 0) parts.push({ text: line.slice(last), mark: false });
  return parts;
}
```

Create `src/hooks/useWideLayout.ts`:

```ts
import { useEffect, useState } from 'react';

/** v2 spec §6.1: at this width the detail view gets its own column; below it, it replaces the list. */
export const WIDE_LAYOUT_QUERY = '(min-width: 1100px)';

const mediaQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_LAYOUT_QUERY) : null;

/** True on wide windows, and wherever `matchMedia` is missing. */
export function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => mediaQuery()?.matches ?? true);
  useEffect(() => {
    const list = mediaQuery();
    if (!list) return;
    const onChange = () => setWide(list.matches);
    list.addEventListener('change', onChange);
    onChange();
    return () => list.removeEventListener('change', onChange);
  }, []);
  return wide;
}
```

Create `src/entrypoints/options/StudyLogDetail.tsx`:

```tsx
import { ArrowLeft, ChevronDown, Play, Trash2, X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Markdown } from '@/components/Markdown';
import { buttonSecondary, card, focusRing } from '@/components/styles';
import { formatTimestamp } from '@/lib/study-log/format';
import { highlightParts } from '@/lib/study-log/highlight';
import { getExplanation } from '@/lib/study-log/store';
import type { Explanation, SavedItem } from '@/lib/study-log/types';
import { TypeBadge } from './StudyLogItems';

interface StudyLogDetailProps {
  item: SavedItem;
  /** Narrow windows: the detail replaces the list, and Back returns to it. */
  narrow: boolean;
  onClose(): void;
  onDelete(item: SavedItem): void;
  onOpenAtMoment(item: SavedItem): void;
  loadExplanation?(id: string): Promise<Explanation | null>;
}

/** v2 spec §6.2: `Stranger Things · Season 1 · E3 "Holly, Jolly" · 30:34`, or `Roma · 1:02:03`. */
export function detailWhere(
  item: Pick<SavedItem, 'kind' | 'seriesTitle' | 'seasonNumber' | 'episodeNumber' | 'episodeTitle' | 'lineTimeMs'>,
): string {
  const time = formatTimestamp(item.lineTimeMs);
  if (item.kind === 'movie') return `${item.seriesTitle} · ${time}`;
  const title = item.episodeTitle ? `"${item.episodeTitle}"` : null;
  const episode = item.episodeNumber !== null ? [`E${item.episodeNumber}`, title].filter(Boolean).join(' ') : title;
  return [item.seriesTitle, item.seasonNumber !== null ? `Season ${item.seasonNumber}` : null, episode, time].filter(Boolean).join(' · ');
}

function Highlighted({ line, text, highlight }: { line: string; text: string; highlight: boolean }) {
  if (!highlight) return <>{line}</>;
  return (
    <>
      {highlightParts(line, text).map((part, i) =>
        part.mark ? (
          <mark key={i} className="rounded bg-tint px-0.5 text-tint-ink">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Collapsible({ label, defaultOpen, children }: { label: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="border-t-2 border-soft pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 text-[13px] font-extrabold text-mute hover:text-ink ${focusRing}`}
      >
        <ChevronDown size={14} strokeWidth={3} className={open ? 'rotate-180' : ''} aria-hidden />
        {label}
      </button>
      {open && (
        <div id={id} className="mt-2">
          {children}
        </div>
      )}
    </div>
  );
}

/** v2 spec §6.2: one saved item with everything known about where it came from. */
export function StudyLogDetail({ item, narrow, onClose, onDelete, onOpenAtMoment, loadExplanation = getExplanation }: StudyLogDetailProps) {
  const headingId = useId();
  // undefined while loading; null when there is none.
  const [explanation, setExplanation] = useState<Explanation | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setExplanation(undefined);
    const id = item.explanationId;
    const load = id ? loadExplanation(id).catch(() => null) : Promise.resolve(null);
    void load.then((found) => {
      if (active) setExplanation(found);
    });
    return () => {
      active = false;
    };
  }, [item.explanationId, loadExplanation]);

  const highlight = item.type !== 'line';

  return (
    <section aria-labelledby={headingId} className={`${card} flex min-w-0 flex-col gap-3 px-5 py-4`}>
      <div className="flex items-center justify-between gap-2">
        {narrow ? (
          <button type="button" onClick={onClose} className={buttonSecondary}>
            <ArrowLeft size={14} strokeWidth={3} aria-hidden />
            Back
          </button>
        ) : (
          <TypeBadge type={item.type} />
        )}
        {!narrow && (
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className={`grid size-8 place-items-center rounded-lg text-mute hover:bg-soft hover:text-ink ${focusRing}`}
          >
            <X size={16} strokeWidth={3} aria-hidden />
          </button>
        )}
      </div>
      {narrow && (
        <div>
          <TypeBadge type={item.type} />
        </div>
      )}

      <h2 id={headingId} className="text-[22px] leading-tight font-black whitespace-pre-line">
        {item.text}
      </h2>
      {item.meaning && <p className="text-[15px] font-bold text-mute">{item.meaning}</p>}

      <blockquote className="rounded-xl border-2 border-line bg-soft px-3 py-2 text-[15px] font-bold whitespace-pre-line">
        <Highlighted line={item.line} text={item.text} highlight={highlight} />
      </blockquote>
      <p className="text-sm font-bold">{detailWhere(item)}</p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onOpenAtMoment(item)} className={buttonSecondary}>
          <Play size={14} strokeWidth={3} fill="currentColor" aria-hidden />
          Open at this moment
        </button>
        <button type="button" onClick={() => onDelete(item)} className={buttonSecondary}>
          <Trash2 size={14} strokeWidth={3} aria-hidden />
          Delete
        </button>
      </div>
      <p className="text-[13px] font-semibold text-mute">Saved {new Date(item.savedAt).toLocaleString()}</p>

      <Collapsible label="Dialogue around it" defaultOpen={false}>
        <ol aria-label="Dialogue around it" className="flex flex-col gap-1 text-sm">
          {item.context.before.map((line, i) => (
            <li key={`before-${i}`} className="font-semibold whitespace-pre-line text-mute">
              {line}
            </li>
          ))}
          <li aria-current="true" className="font-extrabold whitespace-pre-line">
            <Highlighted line={item.line} text={item.text} highlight={highlight} />
          </li>
          {item.context.after.map((line, i) => (
            <li key={`after-${i}`} className="font-semibold whitespace-pre-line text-mute">
              {line}
            </li>
          ))}
        </ol>
      </Collapsible>

      <Collapsible label="Claude's explanation" defaultOpen={item.meaning === ''}>
        {explanation === undefined && <p className="text-sm font-semibold text-mute">Loading…</p>}
        {explanation === null && <p className="text-sm font-semibold text-mute">Claude's explanation isn't available for this item.</p>}
        {explanation && (
          <>
            <Markdown>{explanation.response}</Markdown>
            {explanation.followUps.map((f, i) => (
              <div key={i} className="mt-3 border-t-2 border-soft pt-2">
                <p className="text-[13px] font-extrabold text-tint-ink">{f.question}</p>
                <Markdown>{f.answer}</Markdown>
              </div>
            ))}
          </>
        )}
      </Collapsible>
    </section>
  );
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run tests/unit/study-log-detail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the detail view in the tab**

In `tests/unit/study-log-tab.test.tsx`:

1. Replace the first three import lines

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
```

with

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { takePendingSeek } from '@/lib/pending-seek';
```

2. Below the `rowButton` helper, add:

```tsx
/** happy-dom is 1024 px wide; tests pick the layout explicitly. */
function layout(wide: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: wide,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}
```

3. Replace the test `'selecting a row marks it as current'` (Task 10) with:

```tsx
  it('selecting a row marks it as current (wide window)', async () => {
    layout(true);
    await seed();
    render(<StudyLogTab />);
    const pilot = await rowButton('Pilot');
    fireEvent.click(pilot);
    expect(pilot.getAttribute('aria-current')).toBe('true');
    expect((await rowButton('gonna')).getAttribute('aria-current')).toBeNull();
  });
```

4. Append a new `describe` block at the end of the file:

```tsx
describe('Study Log detail view', () => {
  it('opens next to the list on a wide window; Escape closes it', async () => {
    layout(true);
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('call it a night'));
    const detail = await screen.findByRole('region', { name: 'call it a night' });
    expect(within(detail).getByText('stop for the evening')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Saved items' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'call it a night' })).toBeNull());
  });

  it('replaces the list on a narrow window; Back returns to it', async () => {
    layout(false);
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('Pilot'));
    expect(await screen.findByRole('region', { name: 'Pilot' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Saved items' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('list', { name: 'Saved items' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Pilot' })).toBeNull();
  });

  it('Open at this moment leaves a pending seek and opens the episode on Netflix', async () => {
    layout(true);
    await seed();
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('call it a night'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open at this moment' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ url: 'https://www.netflix.com/watch/80077211' }));
    expect(await takePendingSeek('80077211')).toBe(1_834_200);
  });

  it('Delete asks first (Escape cancels and keeps the detail open), then removes only that item', async () => {
    layout(true);
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('gonna'));
    const detail = await screen.findByRole('region', { name: 'gonna' });
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this item?' });
    expect(within(dialog).getByText('“gonna” will be removed from your Study Log. Its explanation stays in your history.')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('region', { name: 'gonna' })).toBeTruthy();

    fireEvent.click(within(screen.getByRole('region', { name: 'gonna' })).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'gonna' })).toBeNull());
    expect((await listItems()).map((i) => i.text).sort()).toEqual(['Movie line', 'Pilot', 'Where are you going?', 'call it a night']);
    expect(await listExplanations()).toHaveLength(4);
  });

  it('switching to another show or episode closes the detail view', async () => {
    layout(true);
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await rowButton('gonna'));
    expect(await screen.findByRole('region', { name: 'gonna' })).toBeTruthy();
    fireEvent.click(within(await tree()).getByRole('button', { name: 'Roma, 1 saved item' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'gonna' })).toBeNull());
  });
});
```

In `tests/unit/options.test.tsx`, add this test inside `describe('options page', …)`:

```tsx
  it('gives the Study Log the full width, with tips and support below it', async () => {
    window.location.hash = '#/study-log';
    try {
      render(<App />);
      const main = await screen.findByRole('main');
      expect(main.parentElement!.className).toContain('max-w-7xl');
      expect(main.parentElement!.className).not.toContain('lg:grid-cols-[minmax(0,1fr)_260px]');
    } finally {
      window.location.hash = '';
    }
  });
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/study-log-tab.test.tsx tests/unit/options.test.tsx`
Expected: FAIL: the detail tests can't find `region "call it a night"` (the tab doesn't render a detail view yet); the options test finds `max-w-5xl`. The Task 10 tests still pass.

- [ ] **Step 7: Integrate the detail view, stop the dialog's Escape at the dialog, widen the Study Log tab**

In `src/components/ConfirmDialog.tsx`, replace

```tsx
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
```

with

```tsx
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // The dialog owns this Escape: the page behind it (e.g. the Study Log detail view) must not also react.
        e.stopPropagation();
        onCancel();
      }}
```

Replace the whole of `src/entrypoints/options/StudyLogTab.tsx` with:

```tsx
import { browser } from '#imports';
import { BookOpen, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { buttonSecondary, card, iconTile } from '@/components/styles';
import { useWideLayout } from '@/hooks/useWideLayout';
import { setPendingSeek } from '@/lib/pending-seek';
import { filterItems, newestFirst, type TypeFilter } from '@/lib/study-log/filter';
import { episodeLabel, savedItemsLabel, seasonLabel } from '@/lib/study-log/format';
import { groupStudyLog, type StudyLogTree as Tree } from '@/lib/study-log/group';
import { deleteItems, listItems, migrateStudyLogV2 } from '@/lib/study-log/items';
import { listExplanations, resetStudyLog, watchStudyLog } from '@/lib/study-log/store';
import type { SavedItem } from '@/lib/study-log/types';
import { StudyLogDetail } from './StudyLogDetail';
import { StudyLogItems } from './StudyLogItems';
import { StudyLogToolbar } from './StudyLogToolbar';
import { ALL_ITEMS, StudyLogTree } from './StudyLogTree';

interface Selectable {
  key: string;
  heading: string;
  subheading: string;
  scope: 'all' | 'node';
  /** "Delete episode" or "Delete movie"; null for All items. */
  deleteLabel: string | null;
  /** "this episode" or "this movie", for the confirmation text. */
  place: string;
  items: SavedItem[];
}

interface PendingDelete {
  title: string;
  body: string;
  confirmLabel?: string;
  run(): Promise<void>;
}

interface Loaded {
  items: SavedItem[];
  /** How many explanations are in the history (Reset all also clears them). */
  historyCount: number;
}

const NO_ITEMS: SavedItem[] = [];
const KEEP_HISTORY = 'Explanations stay in your history.';

/** All items first, then episodes in tree order, then movies: what the list can show. */
function selectable(tree: Tree, all: readonly SavedItem[]): Selectable[] {
  const everything: Selectable = {
    key: ALL_ITEMS,
    heading: 'All items',
    subheading: savedItemsLabel(all.length),
    scope: 'all',
    deleteLabel: null,
    place: '',
    items: newestFirst(all),
  };
  const episodes = tree.series.flatMap((series) =>
    series.seasons.flatMap((season) =>
      season.episodes.map(
        (episode): Selectable => ({
          key: episode.key,
          heading: series.title,
          subheading: `${seasonLabel(season.seasonNumber)} · ${episodeLabel(episode)}`,
          scope: 'node',
          deleteLabel: 'Delete episode',
          place: 'this episode',
          items: episode.items,
        }),
      ),
    ),
  );
  const movies = tree.movies.map(
    (movie): Selectable => ({
      key: movie.key,
      heading: movie.title,
      subheading: 'Movie',
      scope: 'node',
      deleteLabel: 'Delete movie',
      place: 'this movie',
      items: movie.items,
    }),
  );
  return [everything, ...episodes, ...movies];
}

/** Main spec §5.5 Open at this moment: leave a pending seek, then open the episode on Netflix. */
async function openInNetflix(item: SavedItem): Promise<void> {
  await setPendingSeek(item.videoId, item.lineTimeMs);
  await browser.tabs.create({ url: `https://www.netflix.com/watch/${item.videoId}` });
}

/** v2 spec §6: the learner's saved words, phrases, idioms and lines, with a detail view. */
export function StudyLogTab({ openAtMoment = openInNetflix }: { openAtMoment?: (item: SavedItem) => Promise<void> } = {}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string>(ALL_ITEMS);
  const [type, setType] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const wide = useWideLayout();

  useEffect(() => {
    let active = true;
    const load = () =>
      void Promise.all([listItems(), listExplanations()]).then(([items, explanations]) => {
        if (active) setData({ items, historyCount: explanations.length });
      });
    // Explanations from before v2 become saved lines first (v2 spec §3.3); if that fails, show what's there.
    void migrateStudyLogV2().then(load, load);
    const unwatch = watchStudyLog(load);
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  const items = data?.items ?? NO_ITEMS;
  const tree = useMemo(() => groupStudyLog(items), [items]);
  const nodes = useMemo(() => selectable(tree, items), [tree, items]);
  const current = nodes.find((n) => n.key === selected) ?? nodes[0]!;
  const visible = useMemo(() => filterItems(current.items, { type, query }), [current, type, query]);
  // Gone when it was deleted (here or from another tab).
  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;

  // v2 spec §6.1: Escape closes the detail view. A confirmation dialog handles its own Escape first.
  useEffect(() => {
    if (!selectedItem || pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedItemId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedItem, pending]);

  const confirmDelete = (title: string, body: string, ids: string[]) => setPending({ title, body, run: () => deleteItems(ids) });
  const clearFilters = () => {
    setType('all');
    setQuery('');
  };
  const closeDetail = () => setSelectedItemId(null);
  const askDeleteItem = (item: SavedItem) =>
    setPending({
      title: 'Delete this item?',
      body: `“${item.text}” will be removed from your Study Log. Its explanation stays in your history.`,
      run: async () => {
        await deleteItems([item.id]);
        setSelectedItemId((id) => (id === item.id ? null : id));
      },
    });

  if (data === null) return <p className="text-sm font-semibold text-mute">Loading…</p>;

  const detail = selectedItem && (
    <StudyLogDetail
      key={selectedItem.id}
      item={selectedItem}
      narrow={!wide}
      onClose={closeDetail}
      onDelete={askDeleteItem}
      onOpenAtMoment={(item) => void openAtMoment(item)}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-black tracking-tight">Study Log</h1>
          <p className="mt-1 text-[15px] font-semibold text-mute">Words, phrases, idioms and lines you saved.</p>
        </div>
        {items.length + data.historyCount > 0 && (
          <button
            type="button"
            className={buttonSecondary}
            onClick={() =>
              setPending({
                title: 'Reset your Study Log?',
                body: "Every saved item and every explanation in your history will be removed. This can't be undone.",
                confirmLabel: 'Reset all',
                run: resetStudyLog,
              })
            }
          >
            <RotateCcw size={14} strokeWidth={3} aria-hidden />
            Reset all
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <section className={`${card} flex items-start gap-3.5 px-5 py-5`}>
          <span className={iconTile}>
            <BookOpen size={20} strokeWidth={2.5} aria-hidden />
          </span>
          <div>
            <h2 className="text-[19px] font-black">Nothing saved yet</h2>
            <p className="mt-0.5 text-sm font-semibold text-mute">Hover a line on Netflix and save words, phrases, idioms or whole lines.</p>
          </div>
        </section>
      ) : (
        <div
          className={`grid gap-5 md:grid-cols-[220px_minmax(0,1fr)] ${
            detail && wide ? 'min-[1100px]:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]' : ''
          }`}
        >
          <StudyLogTree
            tree={tree}
            selected={current.key}
            onSelect={(key) => {
              setSelected(key);
              setSelectedItemId(null);
            }}
            onDeleteSeries={(series) =>
              confirmDelete(
                `Delete ${series.title}?`,
                `All ${savedItemsLabel(series.count)} from this show will be removed. ${KEEP_HISTORY}`,
                series.seasons.flatMap((s) => s.episodes.flatMap((e) => e.items.map((i) => i.id))),
              )
            }
            onDeleteSeason={(series, season) =>
              confirmDelete(
                `Delete ${series.title} ${seasonLabel(season.seasonNumber)}?`,
                `All ${savedItemsLabel(season.count)} from this season will be removed. ${KEEP_HISTORY}`,
                season.episodes.flatMap((e) => e.items.map((i) => i.id)),
              )
            }
          />
          {detail && !wide ? (
            detail
          ) : (
            <div className="flex min-w-0 flex-col gap-4">
              <StudyLogToolbar type={type} onTypeChange={setType} query={query} onQueryChange={setQuery} />
              <StudyLogItems
                heading={current.heading}
                subheading={current.subheading}
                items={visible}
                scope={current.scope}
                selectedId={selectedItemId}
                onSelectItem={(item) => setSelectedItemId(item.id)}
                deleteLabel={current.deleteLabel}
                onDeleteAll={() =>
                  confirmDelete(
                    `${current.deleteLabel}?`,
                    `All ${savedItemsLabel(current.items.length)} from ${current.place} will be removed. ${KEEP_HISTORY}`,
                    current.items.map((i) => i.id),
                  )
                }
                onClearFilters={clearFilters}
              />
            </div>
          )}
          {detail && wide && detail}
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirmLabel}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            void action.run();
          }}
        />
      )}
    </div>
  );
}
```

In `src/entrypoints/options/App.tsx`:

1. After `useTheme(settings?.theme);`, add:

```tsx
  // v2 spec §6.1: the Study Log needs room for tree, list and detail; tips and support go below it.
  const fullWidth = tab === 'study-log';
  const width = fullWidth ? 'max-w-7xl' : 'max-w-5xl';
```

2. Replace

```tsx
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
```

with

```tsx
        <div className={`mx-auto flex ${width} flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4`}>
```

3. Replace

```tsx
      <div className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_260px]">
```

with

```tsx
      <div className={`mx-auto grid ${width} gap-6 px-6 py-8 ${fullWidth ? '' : 'lg:grid-cols-[minmax(0,1fr)_260px]'}`}>
```

4. Replace

```tsx
        <aside aria-label="Tips and support" className="flex flex-col gap-4 lg:pt-[74px]">
```

with

```tsx
        <aside aria-label="Tips and support" className={fullWidth ? 'grid gap-4 md:grid-cols-2' : 'flex flex-col gap-4 lg:pt-[74px]'}>
```

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm vitest run tests/unit/study-log-tab.test.tsx tests/unit/study-log-detail.test.tsx tests/unit/options.test.tsx`
Expected: PASS (the "Delete asks first" test covers `ConfirmDialog`'s Escape: it cancels, and the detail view behind it stays open).

- [ ] **Step 9: Run the whole suite and the type check**

Run: `pnpm test && pnpm compile`
Expected: all tests PASS; `tsc --noEmit` prints nothing.

- [ ] **Step 10: Commit**

```bash
git add src/lib/study-log/highlight.ts src/hooks/useWideLayout.ts src/entrypoints/options/StudyLogDetail.tsx \
  src/entrypoints/options/StudyLogTab.tsx src/entrypoints/options/App.tsx src/components/ConfirmDialog.tsx \
  tests/unit/study-log-detail.test.tsx tests/unit/study-log-tab.test.tsx tests/unit/options.test.tsx
git commit -m "feat(study-log): detail view with highlighted line, dialogue, explanation, Open at this moment and Delete" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Export: Anki, CSV, backup

Read v2 spec §7, §7.1, §7.2, §7.3 and §9 ("Export items are disabled when they would export nothing") first.

**Files:**
- Create: `src/lib/study-log/export.ts`
- Create: `src/lib/download.ts`
- Create: `src/entrypoints/options/StudyLogExportMenu.tsx`
- Modify: `src/entrypoints/options/StudyLogTab.tsx` (as Task 11 left it)
- Test: `tests/unit/study-log-export.test.ts`, `tests/unit/download.test.ts`, `tests/unit/study-log-export-menu.test.tsx`

**Interfaces:**
- Consumes:
  - `SavedItem`, `Explanation`, `NewExplanation`, `SaveSuggestion` from `src/lib/study-log/types.ts` (Tasks 1, 2).
  - `formatTimestamp(ms)` and `episodeCode(fields)` from `src/lib/study-log/format.ts`. `episodeCode` comes from Task 5 and returns "S1 E3", "E3", "S1", or "" for movies or unknown values.
  - `listItems()`, `saveItem(explanation, suggestion, now?, newId?)` and `MIGRATION_KEY` from `src/lib/study-log/items.ts` (Task 2).
  - `listExplanations()`, `saveExplanation(fields, now?, newId?)` and `watchStudyLog(callback)` from `src/lib/study-log/store.ts` (Tasks 1, 2).
  - From Task 11's `StudyLogTab.tsx`:
    - state `data: { items: SavedItem[]; historyCount: number } | null` (null while loading, then the "Loading…" early return), derived `items` (never null) and `visible: SavedItem[]` (the current view after tree selection, type filter and search, in list order);
    - it renders `<StudyLogToolbar … />` only when there is at least one saved item, and `StudyLogToolbar` (Task 10) accepts `actions?: ReactNode`, rendered at the toolbar's right end;
    - with no saved items it renders an empty-state card instead of the toolbar and list;
    - the page header row is the element holding `<h1>Study Log</h1>` and the conditional Reset all button;
    - the props object already has `openAtMoment?`, and "All items" is the default selection.
- Produces (Task 13 relies on these):
  - `src/lib/study-log/export.ts`:
    - `type ExportKind = 'anki' | 'csv' | 'backup'`
    - `BACKUP_FORMAT = 'lingoflix-backup'` and `BACKUP_VERSION = 1`
    - `EXPORT_MIME: Record<ExportKind, string>`
    - `highlightHtml(line, text): string` and `sourceLabel(item): string`
    - `toAnki(items)`, `toCsv(items)`, `toBackup(items, explanations, now)`, `exportFileName(kind, now)`
  - `src/lib/download.ts`: `downloadText(fileName, text, mimeType, doc?)`.
  - `StudyLogExportMenu` with props `{ canExportView: boolean; canBackup: boolean; onExport(kind: ExportKind): void }`. Task 13 adds `onImport?(): void`.
  - `StudyLogTab`:
    - accepts the prop `download?: (fileName: string, text: string, mimeType: string) => void` (default `downloadText`);
    - holds a local `const exportMenu = <StudyLogExportMenu … />`, rendered in the toolbar's `actions`, or in the header row when there are no saved items.

- [ ] **Step 1: Write the failing tests for the export formats**

Create `tests/unit/study-log-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { exportFileName, highlightHtml, sourceLabel, toAnki, toBackup, toCsv } from '@/lib/study-log/export';
import type { Explanation, SavedItem } from '@/lib/study-log/types';

const item = (over: Partial<SavedItem> = {}): SavedItem => ({
  id: 'i1',
  type: 'idiom',
  text: 'call it a night',
  meaning: '그만 자러 가다',
  explanationId: 'e1',
  line: "I'm gonna call it a night.",
  lineTimeMs: 1_834_200,
  context: { before: ['Where are you going?'], after: ['Night.'] },
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  explanationLanguage: 'ko',
  savedAt: '2026-10-10T10:05:00.000Z',
  updatedAt: '2026-10-10T10:05:00.000Z',
  ...over,
});

const movieLine = item({
  id: 'i2',
  type: 'line',
  text: 'Where is everyone?',
  meaning: '',
  explanationId: null,
  line: 'Where is everyone?',
  lineTimeMs: 3_723_000,
  videoId: '80240715',
  kind: 'movie',
  seriesId: null,
  seriesTitle: 'Roma',
  seasonNumber: null,
  episodeNumber: null,
  episodeTitle: null,
  explanationLanguage: 'en',
});

const explanation: Explanation = {
  id: 'e1',
  phrase: "I'm gonna call it a night.",
  response: '## Meaning\nTime to sleep.',
  followUps: [{ question: 'Formal?', answer: 'No.' }],
  videoTimeMs: 1_834_200,
  savedAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: ['Where are you going?'], after: ['Night.'] },
  explanationLanguage: 'ko',
  model: 'claude-sonnet-5-5',
  suggestions: [{ type: 'idiom', text: 'call it a night', meaning: '그만 자러 가다' }],
};

const ANKI_HEADERS = [
  '#separator:Tab',
  '#html:true',
  '#notetype:Basic',
  '#deck:LingoFlix',
  '#tags column:3',
  '#columns:Front\tBack\tTags',
];

describe('highlightHtml', () => {
  it('bolds every occurrence, ignoring case, and escapes the rest', () => {
    expect(highlightHtml('Night, night. NIGHT!', 'night')).toBe('<b>Night</b>, <b>night</b>. <b>NIGHT</b>!');
    expect(highlightHtml('Tom & Jerry <3', 'tom & jerry')).toBe('<b>Tom &amp; Jerry</b> &lt;3');
  });

  it('matches across any whitespace and treats the text literally', () => {
    expect(highlightHtml('call it\na night', 'call it a night')).toBe('<b>call it\na night</b>');
    expect(highlightHtml('(laughs) Fine.', '(laughs)')).toBe('<b>(laughs)</b> Fine.');
    expect(highlightHtml('a.b axb', 'a.b')).toBe('<b>a.b</b> axb');
  });

  it('without text, is just the escaped line', () => {
    expect(highlightHtml('"Hi" <b>', '  ')).toBe('&quot;Hi&quot; &lt;b&gt;');
  });
});

describe('sourceLabel', () => {
  it('is "Series · S1 E3 · time", or "Title · time" for a movie', () => {
    expect(sourceLabel(item())).toBe('Stranger Things · S1 E3 · 30:34');
    expect(sourceLabel(movieLine)).toBe('Roma · 1:02:03');
  });
});

describe('toAnki', () => {
  it('writes the Anki headers, then one note per item: front, back, tags', () => {
    expect(toAnki([item(), movieLine])).toBe(
      [
        ...ANKI_HEADERS,
        "call it a night\t그만 자러 가다<br><br>I'm gonna <b>call it a night</b>.<br><small>Stranger Things · S1 E3 · 30:34</small>\tlingoflix idiom stranger_things",
        'Where is everyone?\tWhere is everyone?<br><small>Roma · 1:02:03</small>\tlingoflix line roma',
      ].join('\n') + '\n',
    );
  });

  it('with no items, is just the headers', () => {
    expect(toAnki([])).toBe(ANKI_HEADERS.join('\n') + '\n');
  });
});

describe('toCsv', () => {
  it('starts with a byte-order mark and the header row; every field is quoted; rows end with CRLF', () => {
    expect(toCsv([item(), movieLine])).toBe(
      '\uFEFF' +
        [
          '"Type","Text","Meaning","Line","Show","Season","Episode","Episode title","Time","Saved","Explanation language","Netflix link"',
          '"idiom","call it a night","그만 자러 가다","I\'m gonna call it a night.","Stranger Things","1","3","Holly, Jolly","30:34","2026-10-10T10:05:00.000Z","ko","https://www.netflix.com/watch/80077211"',
          '"line","Where is everyone?","","Where is everyone?","Roma","","","","1:02:03","2026-10-10T10:05:00.000Z","en","https://www.netflix.com/watch/80240715"',
        ].join('\r\n') +
        '\r\n',
    );
  });
});

describe('export escaping (Review Focus 5)', () => {
  it('escapes tabs, newlines, quotes, HTML and keeps non-Latin text', () => {
    const tricky = item({
      type: 'phrase',
      text: 'A & B',
      meaning: '"좋아" & <ok>',
      line: 'He said "A & B"\tthen <left>\nfor good',
      lineTimeMs: 61_000,
      videoId: '81234567',
      seriesTitle: '오징어 게임',
      seasonNumber: 2,
      episodeNumber: 1,
      episodeTitle: null,
    });

    const anki = toAnki([tricky]);
    const lines = anki.split('\n');
    expect(lines).toHaveLength(ANKI_HEADERS.length + 2); // headers, one note, and the final empty string
    const note = lines[ANKI_HEADERS.length]!;
    expect(note.split('\t')).toEqual([
      'A &amp; B',
      '&quot;좋아&quot; &amp; &lt;ok&gt;<br><br>He said &quot;<b>A &amp; B</b>&quot; then &lt;left&gt;<br>for good<br><small>오징어 게임 · S2 E1 · 1:01</small>',
      'lingoflix phrase 오징어_게임',
    ]);

    expect(toCsv([tricky]).split('\r\n')[1]).toBe(
      '"phrase","A & B","""좋아"" & <ok>","He said ""A & B""\tthen <left>\nfor good","오징어 게임","2","1","","1:01","2026-10-10T10:05:00.000Z","ko","https://www.netflix.com/watch/81234567"',
    );
  });
  it('keeps cells that look like formulas as text with a leading apostrophe (subtitle lines like "- What?")', () => {
    const dash = item({ type: 'line', text: '- What?', line: '- What?', meaning: '=SUM(A1)' });
    expect(toCsv([dash]).split('\r\n')[1]!.split(',').slice(1, 4)).toEqual(['"\'- What?"', '"\'=SUM(A1)"', '"\'- What?"']);
  });
});

describe('toBackup', () => {
  it('holds everything, versioned, pretty-printed', () => {
    const text = toBackup([item(), movieLine], [explanation], new Date('2026-10-10T21:41:00.000Z'));
    const parsed: unknown = JSON.parse(text);
    expect(parsed).toEqual({
      format: 'lingoflix-backup',
      version: 1,
      exportedAt: '2026-10-10T21:41:00.000Z',
      items: [item(), movieLine],
      explanations: [explanation],
    });
    expect(Object.keys(parsed as object)).toEqual(['format', 'version', 'exportedAt', 'items', 'explanations']);
    expect(text.startsWith('{\n  "format": "lingoflix-backup",')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
  });
});

describe('exportFileName', () => {
  it('uses the local date', () => {
    const lateEvening = new Date(2026, 9, 10, 23, 59); // local time
    expect(exportFileName('anki', lateEvening)).toBe('lingoflix-anki-2026-10-10.txt');
    expect(exportFileName('csv', lateEvening)).toBe('lingoflix-2026-10-10.csv');
    expect(exportFileName('backup', new Date(2026, 0, 5, 0, 1))).toBe('lingoflix-backup-2026-01-05.json');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/unit/study-log-export.test.ts`
Expected: FAIL. The file can't load: `Failed to resolve import "@/lib/study-log/export"`.

- [ ] **Step 3: Write the export functions**

Create `src/lib/study-log/export.ts`:

```ts
import { episodeCode, formatTimestamp } from './format';
import type { Explanation, SavedItem } from './types';

export type ExportKind = 'anki' | 'csv' | 'backup';

/** v2 spec §7.3: the backup file's identity and the version this LingoFlix writes and reads. */
export const BACKUP_FORMAT = 'lingoflix-backup';
export const BACKUP_VERSION = 1;

export const EXPORT_MIME: Record<ExportKind, string> = {
  anki: 'text/plain;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  backup: 'application/json',
};

/** v2 spec §7.1: Anki 2.1.54+ text-import headers. */
const ANKI_HEADERS = [
  '#separator:Tab',
  '#html:true',
  '#notetype:Basic',
  '#deck:LingoFlix',
  '#tags column:3',
  '#columns:Front\tBack\tTags',
];

const CSV_HEADER = [
  'Type',
  'Text',
  'Meaning',
  'Line',
  'Show',
  'Season',
  'Episode',
  'Episode title',
  'Time',
  'Saved',
  'Explanation language',
  'Netflix link',
];

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One Anki field: a raw tab would start a new field and a raw line break a new note. */
const ankiField = (html: string) => html.replace(/\t/g, ' ').replace(/\r\n|\r|\n/g, '<br>');

/** Lowercase, with every run of characters that aren't letters or digits (in any script) turned into "_". */
const tagSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');

/**
 * The line as HTML with every occurrence of `text` in bold: case-insensitive, any whitespace between words,
 * `text` taken literally. Each piece is escaped before it is wrapped, so the bold tags are the only HTML.
 */
export function highlightHtml(line: string, text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return escapeHtml(line);
  const pattern = new RegExp(words.map(escapeRegExp).join('\\s+'), 'giu');
  let html = '';
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    html += `${escapeHtml(line.slice(last, start))}<b>${escapeHtml(match[0])}</b>`;
    last = start + match[0].length;
  }
  return html + escapeHtml(line.slice(last));
}

/** "Stranger Things · S1 E3 · 30:34", or "Roma · 1:02:03" for a movie. */
export function sourceLabel(item: Pick<SavedItem, 'kind' | 'seriesTitle' | 'seasonNumber' | 'episodeNumber' | 'lineTimeMs'>): string {
  return [item.seriesTitle, episodeCode(item), formatTimestamp(item.lineTimeMs)].filter(Boolean).join(' · ');
}

/** v2 spec §7.1: front = the text; back = meaning, the line with the text in bold, where it's from; tags. */
export function toAnki(items: readonly SavedItem[]): string {
  const notes = items.map((item) => {
    const meaning = item.meaning.trim() ? `${escapeHtml(item.meaning.trim())}<br><br>` : '';
    const line = item.type === 'line' ? escapeHtml(item.line) : highlightHtml(item.line, item.text);
    const back = `${meaning}${line}<br><small>${escapeHtml(sourceLabel(item))}</small>`;
    const tags = ['lingoflix', item.type, tagSlug(item.seriesTitle)].filter(Boolean).join(' ');
    return [escapeHtml(item.text), back, tags].map(ankiField).join('\t');
  });
  return `${[...ANKI_HEADERS, ...notes].join('\n')}\n`;
}

/**
 * Excel and Sheets read a cell that starts with = + - @ (or a tab or carriage return) as a formula, so a subtitle
 * line like "- What?" would show an error. A leading apostrophe keeps it text (OWASP CSV injection guidance).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

const csvCell = (value: string | number | null) => {
  const text = String(value ?? '');
  return `"${(FORMULA_START.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};

/** v2 spec §7.2: RFC 4180, every field quoted, CRLF, UTF-8 with a byte-order mark for Excel. */
export function toCsv(items: readonly SavedItem[]): string {
  const rows = items.map((item) => [
    item.type,
    item.text,
    item.meaning,
    item.line,
    item.seriesTitle,
    item.seasonNumber,
    item.episodeNumber,
    item.episodeTitle,
    formatTimestamp(item.lineTimeMs),
    item.savedAt,
    item.explanationLanguage,
    `https://www.netflix.com/watch/${item.videoId}`,
  ]);
  return `\uFEFF${[CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** v2 spec §7.3: every saved item and every explanation. Never the API key or settings. */
export function toBackup(items: readonly SavedItem[], explanations: readonly Explanation[], now: Date): string {
  const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), items, explanations };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

const localDate = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export function exportFileName(kind: ExportKind, now: Date): string {
  const date = localDate(now);
  if (kind === 'anki') return `lingoflix-anki-${date}.txt`;
  if (kind === 'csv') return `lingoflix-${date}.csv`;
  return `lingoflix-backup-${date}.json`;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm vitest run tests/unit/study-log-export.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the download helper**

Create `tests/unit/download.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadText } from '@/lib/download';

afterEach(() => vi.useRealTimers());

describe('downloadText', () => {
  it('downloads the text through a temporary link and frees the Blob URL afterwards', async () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:lingoflix-1');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked: { href: string | null; download: string; connected: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href'), download: this.download, connected: this.isConnected });
    });

    downloadText('lingoflix-2026-10-10.csv', '\uFEFF"Type"\r\n', 'text/csv;charset=utf-8');

    expect(clicked).toEqual([{ href: 'blob:lingoflix-1', download: 'lingoflix-2026-10-10.csv', connected: true }]);
    expect(document.querySelector('a[download]')).toBeNull(); // the link is gone again
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:lingoflix-1');

    vi.useRealTimers(); // reading the Blob is async
    const blob = create.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf])); // UTF-8 BOM
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `pnpm vitest run tests/unit/download.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/download"`.

- [ ] **Step 7: Write the download helper**

Create `src/lib/download.ts`:

```ts
/**
 * Saves `text` as a file with the browser's own download: a Blob URL and a temporary link, so no
 * `downloads` permission is needed (v2 spec §7).
 */
export function downloadText(fileName: string, text: string, mimeType: string, doc: Document = document): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  // The download has started by now; free the Blob a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 8: Run it to see it pass**

Run: `pnpm vitest run tests/unit/download.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing tests for the Export menu and its place on the Study Log page**

Create `tests/unit/study-log-export-menu.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { StudyLogExportMenu } from '@/entrypoints/options/StudyLogExportMenu';
import { StudyLogTab } from '@/entrypoints/options/StudyLogTab';
import { MIGRATION_KEY, saveItem } from '@/lib/study-log/items';
import { saveExplanation } from '@/lib/study-log/store';
import type { NewExplanation } from '@/lib/study-log/types';

beforeEach(async () => {
  fakeBrowser.reset();
  // These tests seed items themselves: keep the one-time conversion (Task 2) from adding any.
  await fakeBrowser.storage.local.set({ [MIGRATION_KEY]: true });
});
afterEach(cleanup);

const newExplanation = (over: Partial<NewExplanation> = {}): NewExplanation => ({
  phrase: "I'm gonna call it a night.",
  response: '## Meaning\nTime to sleep.',
  videoTimeMs: 1_834_200,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: ['Where are you going?'], after: ['Night.'] },
  explanationLanguage: 'en',
  model: 'claude-sonnet-5-5',
  suggestions: [{ type: 'idiom', text: 'call it a night', meaning: 'stop for the night' }],
  ...over,
});

async function seedOneItem() {
  const explanation = await saveExplanation(newExplanation(), new Date('2026-10-10T10:00:00Z'), () => 'e1');
  await saveItem(explanation, explanation.suggestions[0]!, new Date('2026-10-10T10:05:00Z'), () => 'i1');
}

function renderMenu(props: { canExportView?: boolean; canBackup?: boolean } = {}) {
  const onExport = vi.fn();
  render(
    <div>
      <p>Outside</p>
      <StudyLogExportMenu canExportView={props.canExportView ?? true} canBackup={props.canBackup ?? true} onExport={onExport} />
    </div>,
  );
  return { onExport, trigger: screen.getByRole('button', { name: 'Export' }) };
}

describe('Export menu', () => {
  it('lists the three formats and exports the chosen one', () => {
    const { onExport, trigger } = renderMenu();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Anki (.txt)', 'CSV (.csv)', 'Full backup (.json)']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }));
    expect(onExport).toHaveBeenCalledWith('csv');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disables what would export nothing', () => {
    renderMenu({ canExportView: false, canBackup: true });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect((screen.getByRole('menuitem', { name: 'Anki (.txt)' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'CSV (.csv)' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'Full backup (.json)' }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    renderMenu({ canExportView: false, canBackup: false });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getAllByRole('menuitem').every((m) => (m as HTMLButtonElement).disabled)).toBe(true);
  });

  it('moves between items with the arrow keys; Escape closes and returns focus', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger);
    const [anki, csv, backup] = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(anki);
    fireEvent.keyDown(anki!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(csv);
    fireEvent.keyDown(csv!, { key: 'ArrowUp' });
    fireEvent.keyDown(anki!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(backup); // wraps around
    const page = vi.fn();
    document.addEventListener('keydown', page);
    fireEvent.keyDown(backup!, { key: 'Escape' });
    document.removeEventListener('keydown', page);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(page).not.toHaveBeenCalled(); // Escape stays in the menu: the detail view behind it stays open
  });

  it('closes on a press outside it', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Export on the Study Log page', () => {
  it('exports the current view as Anki and CSV, and everything as a backup', async () => {
    await seedOneItem();
    const download = vi.fn();
    render(<StudyLogTab download={download} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Anki (.txt)' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [ankiName, ankiText, ankiMime] = download.mock.calls[0]!;
    expect(ankiName).toMatch(/^lingoflix-anki-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(ankiMime).toBe('text/plain;charset=utf-8');
    expect(ankiText).toContain("call it a night\tstop for the night<br><br>I'm gonna <b>call it a night</b>.");

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    const [csvName, csvText, csvMime] = download.mock.calls[1]!;
    expect(csvName).toMatch(/^lingoflix-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csvMime).toBe('text/csv;charset=utf-8');
    expect(csvText).toContain('"idiom","call it a night","stop for the night"');

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Full backup (.json)' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(3));
    const [backupName, backupText, backupMime] = download.mock.calls[2]!;
    expect(backupName).toMatch(/^lingoflix-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(backupMime).toBe('application/json');
    const backup = JSON.parse(backupText as string) as { items: { id: string }[]; explanations: { id: string }[] };
    expect(backup.items.map((i) => i.id)).toEqual(['i1']);
    expect(backup.explanations.map((e) => e.id)).toEqual(['e1']);
    expect(backupText).not.toContain('apiKey');
  });

  it('with no saved items, still offers a backup of the explanation history', async () => {
    await saveExplanation(newExplanation(), new Date('2026-10-10T10:00:00Z'), () => 'e1');
    render(<StudyLogTab download={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    expect((screen.getByRole('menuitem', { name: 'Anki (.txt)' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'CSV (.csv)' }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((screen.getByRole('menuitem', { name: 'Full backup (.json)' }) as HTMLButtonElement).disabled).toBe(false));
  });
});
```

- [ ] **Step 10: Run it to see it fail**

Run: `pnpm vitest run tests/unit/study-log-export-menu.test.tsx`
Expected: FAIL with `Failed to resolve import "@/entrypoints/options/StudyLogExportMenu"`.

- [ ] **Step 11: Write the Export menu**

Create `src/entrypoints/options/StudyLogExportMenu.tsx`:

```tsx
import { ChevronDown, Download } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { buttonSecondary, card, focusRing } from '@/components/styles';
import type { ExportKind } from '@/lib/study-log/export';

export interface StudyLogExportMenuProps {
  /** Anki and CSV export the current view; off when it is empty. */
  canExportView: boolean;
  /** Full backup: off when there are no saved items and no explanations. */
  canBackup: boolean;
  onExport(kind: ExportKind): void;
}

const FORMATS: readonly { kind: ExportKind; label: string }[] = [
  { kind: 'anki', label: 'Anki (.txt)' },
  { kind: 'csv', label: 'CSV (.csv)' },
  { kind: 'backup', label: 'Full backup (.json)' },
];

const menuItem = `flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold text-ink hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${focusRing}`;

/** v2 spec §7: Export ▾ on the Study Log page. */
export function StudyLogExportMenu({ canExportView, canBackup, onExport }: StudyLogExportMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const enabledItems = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

  useEffect(() => {
    if (!open) return;
    enabledItems()[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // the detail view behind the menu closes on Escape too
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = enabledItems();
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className={buttonSecondary}>
        <Download size={14} strokeWidth={3} aria-hidden />
        Export
        <ChevronDown size={14} strokeWidth={3} className={open ? 'rotate-180' : ''} aria-hidden />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Export"
          className={`${card} absolute right-0 z-20 mt-2 flex w-56 flex-col gap-0.5 p-1.5 shadow-[0_4px_0_var(--lf-line)]`}
        >
          {FORMATS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              disabled={kind === 'backup' ? !canBackup : !canExportView}
              className={menuItem}
              onClick={() => {
                close();
                onExport(kind);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 12: Put the menu on the Study Log page**

In `src/entrypoints/options/StudyLogTab.tsx` (as Task 11 left it: it holds `data: { items, historyCount } | null`,
derives `items` (never null) and `visible` (the current view after tree selection, type filter and search), and
returns "Loading…" while `data === null`):

1. Add these imports, except any the file already has:

```tsx
import { downloadText } from '@/lib/download';
import { EXPORT_MIME, exportFileName, toAnki, toBackup, toCsv, type ExportKind } from '@/lib/study-log/export';
import { listItems } from '@/lib/study-log/items';
import { listExplanations } from '@/lib/study-log/store';
import { StudyLogExportMenu } from './StudyLogExportMenu';
```

2. Add a `download` prop beside `openAtMoment`. Replace the component's signature line:

```tsx
export function StudyLogTab({ openAtMoment = openInNetflix }: { openAtMoment?: (item: SavedItem) => Promise<void> } = {}) {
```

with:

```tsx
export function StudyLogTab({
  openAtMoment = openInNetflix,
  download = downloadText,
}: {
  openAtMoment?: (item: SavedItem) => Promise<void>;
  download?: (fileName: string, text: string, mimeType: string) => void;
} = {}) {
```

3. Directly after the line `if (data === null) return <p className="text-sm font-semibold text-mute">Loading…</p>;`, add
the export action and the menu element (not hooks, so after the early return is fine; `data` is loaded here):

```tsx
  const hasItems = items.length > 0;

  const exportAs = async (kind: ExportKind) => {
    const now = new Date();
    const text = kind === 'anki' ? toAnki(visible) : kind === 'csv' ? toCsv(visible) : toBackup(await listItems(), await listExplanations(), now);
    download(exportFileName(kind, now), text, EXPORT_MIME[kind]);
  };

  // Full backup also covers explanation history, which exists even with no saved items (v2 spec §7.3).
  const exportMenu = (
    <StudyLogExportMenu canExportView={visible.length > 0} canBackup={hasItems || data.historyCount > 0} onExport={(kind) => void exportAs(kind)} />
  );
```

4. Pass the menu to the toolbar. Replace:

```tsx
              <StudyLogToolbar type={type} onTypeChange={setType} query={query} onQueryChange={setQuery} />
```

with:

```tsx
              <StudyLogToolbar type={type} onTypeChange={setType} query={query} onQueryChange={setQuery} actions={exportMenu} />
```

5. With no saved items there is no toolbar, so show the menu in the page header row instead. In the header row,
replace the Reset all block:

```tsx
        {items.length + data.historyCount > 0 && (
          <button
```

through its closing `)}` (the whole conditional Reset all button, unchanged inside) with the same block wrapped,
the menu first:

```tsx
        <div className="flex flex-wrap items-center gap-2">
          {!hasItems && exportMenu}
          {items.length + data.historyCount > 0 && (
            <button
              type="button"
              className={buttonSecondary}
              onClick={() =>
                setPending({
                  title: 'Reset your Study Log?',
                  body: "Every saved item and every explanation in your history will be removed. This can't be undone.",
                  confirmLabel: 'Reset all',
                  run: resetStudyLog,
                })
              }
            >
              <RotateCcw size={14} strokeWidth={3} aria-hidden />
              Reset all
            </button>
          )}
        </div>
```

- [ ] **Step 13: Run the new tests to see them pass**

Run: `pnpm vitest run tests/unit/study-log-export.test.ts tests/unit/download.test.ts tests/unit/study-log-export-menu.test.tsx`
Expected: PASS.

- [ ] **Step 14: Run the whole suite and the type check**

Run: `pnpm test && pnpm compile`
Expected: every test file passes (Task 10's Study Log tests included); `tsc --noEmit` reports no errors.

- [ ] **Step 15: Commit**

```bash
git add src/lib/study-log/export.ts src/lib/download.ts src/entrypoints/options/StudyLogExportMenu.tsx src/entrypoints/options/StudyLogTab.tsx tests/unit/study-log-export.test.ts tests/unit/download.test.ts tests/unit/study-log-export-menu.test.tsx
git commit -m "feat: export the Study Log to Anki, CSV, and a full backup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 13: Import backup

Read v2 spec §7.4 and §9 ("Backup file wrong or damaged") first.

**Files:**
- Create: `src/lib/study-log/import.ts`
- Modify: `src/entrypoints/options/StudyLogExportMenu.tsx` (from Task 12)
- Modify: `src/entrypoints/options/StudyLogTab.tsx` (from Tasks 10 and 12)
- Test: `tests/unit/study-log-import.test.tsx`

**Interfaces:**
- Consumes:
  - `BACKUP_FORMAT`, `BACKUP_VERSION` and `toBackup(items, explanations, now)` from `src/lib/study-log/export.ts` (Task 12).
  - `EXPLANATION_PREFIX`, `explanationIndexKey(videoId, language, phrase)`, `saveExplanation`, `getExplanation`, `findExplanation` and `listExplanations` from `src/lib/study-log/store.ts` (Task 1).
  - `ITEM_PREFIX`, `itemIndexKey(videoId, line, type, text)`, `saveItem`, `getItem`, `listItems` and `MIGRATION_KEY` from `src/lib/study-log/items.ts` (Task 2).
  - `toExplanation(value)`, `isSavedItem(value)`, `Explanation`, `NewExplanation` and `SavedItem` from `src/lib/study-log/types.ts` (Tasks 1, 2).
  - From Task 12: `StudyLogExportMenu`'s props, and in `StudyLogTab` the `exportMenu` element and the page header row (the element holding `<h1>Study Log</h1>`).
- Produces:
  - `src/lib/study-log/import.ts`:
    - `ImportSummary`, `ImportResult` and `importBackup(text)` (exactly as the Interface Contract);
    - `importSummaryText(summary)`;
    - `IMPORT_ERROR_COPY: Record<'not-backup' | 'newer-version', string>` and `IMPORT_FAILED_COPY`.
  - `StudyLogExportMenu` gains `onImport?(): void`, shown as the menu item "Import backup…".

The text rules for `importSummaryText` (v2 spec §7.4, made exact):
- The first sentence is `Added {N item|items}.`, `Added {N explanation|explanations}.`, or `Added {N items} and {M explanations}.`. A part is left out when its count is 0. When both counts are 0, the sentence is `Nothing new to add.`.
- Then `Skipped {N} already in your Study Log.` when anything was skipped.
- Then `{N record|records} couldn't be read.` when anything was invalid.
- Sentences are joined by one space. Example: `Added 40 items and 52 explanations. Skipped 12 already in your Study Log. 3 records couldn't be read.`

Merge rules, beyond the spec:
- Duplicates within one file count as skipped.
- When a file explanation is skipped because this computer already has an explanation of the same line (same `logkey`), the file's items that point to it are re-pointed to the explanation already here. Otherwise their detail view would say the explanation is missing.
- Items whose explanation is in neither place are imported unchanged.
- Only the `SavedItem` fields are written: unknown fields in a file never reach storage.

A storage failure during import is the one case the spec's copy doesn't cover. It shows `Couldn't import this backup. Try again.` (`IMPORT_FAILED_COPY`), and so does a file the browser can't read.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/study-log-import.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { StudyLogExportMenu } from '@/entrypoints/options/StudyLogExportMenu';
import { StudyLogTab } from '@/entrypoints/options/StudyLogTab';
import { toBackup } from '@/lib/study-log/export';
import { importBackup, importSummaryText } from '@/lib/study-log/import';
import { MIGRATION_KEY, getItem, listItems, saveItem } from '@/lib/study-log/items';
import { findExplanation, getExplanation, listExplanations, saveExplanation } from '@/lib/study-log/store';
import type { Explanation, NewExplanation, SavedItem } from '@/lib/study-log/types';

beforeEach(async () => {
  fakeBrowser.reset();
  // Keep the one-time conversion (Task 2) from adding line items of its own.
  await fakeBrowser.storage.local.set({ [MIGRATION_KEY]: true });
});
afterEach(cleanup);

const LINE = "I'm gonna call it a night.";

const newExplanation = (over: Partial<NewExplanation> = {}): NewExplanation => ({
  phrase: LINE,
  response: '## Meaning\nTime to sleep.',
  videoTimeMs: 1_834_200,
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: ['Where are you going?'], after: ['Night.'] },
  explanationLanguage: 'en',
  model: 'claude-sonnet-5-5',
  suggestions: [{ type: 'idiom', text: 'call it a night', meaning: 'stop for the night' }],
  ...over,
});

/** An explanation as it appears in a backup file. */
const explanation = (over: Partial<Explanation> = {}): Explanation => ({
  ...newExplanation(),
  id: 'e1',
  followUps: [],
  savedAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  ...over,
});

/** A saved item as it appears in a backup file. */
const savedItem = (over: Partial<SavedItem> = {}): SavedItem => ({
  id: 'i1',
  type: 'idiom',
  text: 'call it a night',
  meaning: 'stop for the night',
  explanationId: 'e1',
  line: LINE,
  lineTimeMs: 1_834_200,
  context: { before: ['Where are you going?'], after: ['Night.'] },
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  explanationLanguage: 'en',
  savedAt: '2026-10-10T10:05:00.000Z',
  updatedAt: '2026-10-10T10:05:00.000Z',
  ...over,
});

const backupFile = (items: unknown[], explanations: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'lingoflix-backup', version: 1, exportedAt: '2026-10-10T21:41:00.000Z', items, explanations, ...extra });

/** What this computer already has: explanation e1 and its idiom item i1. */
async function seedLocal() {
  const e1 = await saveExplanation(newExplanation(), new Date('2026-10-10T10:00:00Z'), () => 'e1');
  await saveItem(e1, e1.suggestions[0]!, new Date('2026-10-10T10:05:00Z'), () => 'i1');
}

describe('importBackup', () => {
  it('refuses files that are not LingoFlix backups, or come from a newer LingoFlix, and changes nothing', async () => {
    const before = await fakeBrowser.storage.local.get(null);
    const notBackups = [
      'not json',
      '[]',
      'null',
      JSON.stringify({ format: 'something-else', version: 1, items: [], explanations: [] }),
      JSON.stringify({ format: 'lingoflix-backup', version: 1, items: [] }), // no explanations array
      JSON.stringify({ format: 'lingoflix-backup', version: '1', items: [], explanations: [] }),
      JSON.stringify({ format: 'lingoflix-backup', version: 0, items: [], explanations: [] }),
      JSON.stringify({ format: 'lingoflix-backup', version: 1.5, items: [], explanations: [] }),
    ];
    for (const text of notBackups) expect(await importBackup(text)).toEqual({ ok: false, error: 'not-backup' });
    expect(await importBackup(backupFile([savedItem()], [explanation()], { version: 2 }))).toEqual({ ok: false, error: 'newer-version' });
    expect(await fakeBrowser.storage.local.get(null)).toEqual(before);
  });

  it('adds a backup to an empty Study Log, index keys included', async () => {
    const result = await importBackup(toBackup([savedItem()], [explanation()], new Date('2026-10-10T21:41:00Z')));
    expect(result).toEqual({ ok: true, summary: { itemsAdded: 1, explanationsAdded: 1, skipped: 0, invalid: 0 } });
    expect((await findExplanation('80077211', 'en', LINE))?.id).toBe('e1');
    expect(await listItems()).toEqual([savedItem()]);
  });

  it('add-only merge with duplicates, invalid records and orphan items (Review Focus 4)', async () => {
    await seedLocal();
    const text = backupFile(
      [
        savedItem({ meaning: 'CHANGED' }), // i1: same id as the local item
        savedItem({ id: 'i2', type: 'line', text: 'Where are you going?', meaning: '', line: 'Where are you going?', lineTimeMs: 1000, explanationId: 'e2' }),
        savedItem({ id: 'i3', type: 'word', text: 'night', explanationId: 'gone' }), // its explanation is nowhere
        savedItem({ id: 'i4' }), // same line, type and text as the local i1: a duplicate by index key
        savedItem({ id: 'i5', type: 'word', text: 'gonna', explanationId: 'e3' }), // e3 is skipped as a copy of e1
        'not an item',
      ],
      [
        explanation({ response: 'CHANGED' }), // e1: same id as the local explanation
        explanation({ id: 'e2', phrase: 'Where are you going?', videoTimeMs: 1000, suggestions: [] }),
        explanation({ id: 'e3', response: 'Another take on the same line.' }), // same line as e1: a duplicate by index key
        { id: 'broken' },
      ],
    );

    expect(await importBackup(text)).toEqual({ ok: true, summary: { itemsAdded: 3, explanationsAdded: 1, skipped: 4, invalid: 2 } });

    // Nothing here was overwritten.
    expect((await getExplanation('e1'))?.response).toBe('## Meaning\nTime to sleep.');
    expect((await getItem('i1'))?.meaning).toBe('stop for the night');
    // Duplicates were not added.
    expect(await getExplanation('e3')).toBeNull();
    expect(await getItem('i4')).toBeNull();
    // New records came in, findable by their index keys.
    expect((await findExplanation('80077211', 'en', 'Where are you going?'))?.id).toBe('e2');
    expect((await listItems()).map((i) => i.id).sort()).toEqual(['i1', 'i2', 'i3', 'i5']);
    // An item of a skipped copy points to the explanation already here; an orphan keeps its id.
    expect((await getItem('i5'))?.explanationId).toBe('e1');
    expect((await getItem('i3'))?.explanationId).toBe('gone');
    expect((await listExplanations()).map((e) => e.id).sort()).toEqual(['e1', 'e2']);

    // Importing the same file again adds nothing.
    expect(await importBackup(text)).toEqual({ ok: true, summary: { itemsAdded: 0, explanationsAdded: 0, skipped: 8, invalid: 2 } });
  });

  it('counts a record repeated within one file once', async () => {
    const text = backupFile([savedItem(), savedItem()], [explanation(), explanation()]);
    expect(await importBackup(text)).toEqual({ ok: true, summary: { itemsAdded: 1, explanationsAdded: 1, skipped: 2, invalid: 0 } });
  });

  it('stores only the saved-item fields', async () => {
    await importBackup(backupFile([{ ...savedItem(), note: '<script>' }], [explanation()]));
    expect(await getItem('i1')).toEqual(savedItem());
  });
});

describe('importSummaryText', () => {
  it('reports what was added, skipped and unreadable', () => {
    expect(importSummaryText({ itemsAdded: 40, explanationsAdded: 52, skipped: 12, invalid: 0 })).toBe(
      'Added 40 items and 52 explanations. Skipped 12 already in your Study Log.',
    );
    expect(importSummaryText({ itemsAdded: 40, explanationsAdded: 52, skipped: 12, invalid: 3 })).toBe(
      "Added 40 items and 52 explanations. Skipped 12 already in your Study Log. 3 records couldn't be read.",
    );
    expect(importSummaryText({ itemsAdded: 1, explanationsAdded: 1, skipped: 0, invalid: 0 })).toBe('Added 1 item and 1 explanation.');
    expect(importSummaryText({ itemsAdded: 3, explanationsAdded: 0, skipped: 0, invalid: 1 })).toBe("Added 3 items. 1 record couldn't be read.");
    expect(importSummaryText({ itemsAdded: 0, explanationsAdded: 2, skipped: 1, invalid: 0 })).toBe(
      'Added 2 explanations. Skipped 1 already in your Study Log.',
    );
    expect(importSummaryText({ itemsAdded: 0, explanationsAdded: 0, skipped: 5, invalid: 0 })).toBe(
      'Nothing new to add. Skipped 5 already in your Study Log.',
    );
  });
});

describe('Import backup on the Study Log page', () => {
  const chooseFile = (contents: string) => {
    const input = screen.getByLabelText('Backup file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([contents], 'lingoflix-backup-2026-10-10.json', { type: 'application/json' })] } });
  };

  it('is always in the menu, even when nothing can be exported', () => {
    const onImport = vi.fn();
    render(<StudyLogExportMenu canExportView={false} canBackup={false} onExport={vi.fn()} onImport={onImport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const item = screen.getByRole('menuitem', { name: 'Import backup…' }) as HTMLButtonElement;
    expect(item.disabled).toBe(false);
    fireEvent.click(item);
    expect(onImport).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a file picker, adds the backup, and says what happened', async () => {
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import backup…' }));
    expect(pick).toHaveBeenCalled();

    chooseFile(toBackup([savedItem()], [explanation()], new Date('2026-10-10T21:41:00Z')));
    expect(await screen.findByText('Added 1 item and 1 explanation.')).toBeTruthy();
    expect((await screen.findAllByText('call it a night')).length).toBeGreaterThan(0); // the list shows it
  });

  it('explains a wrong file or a newer backup, and changes nothing', async () => {
    render(<StudyLogTab />);
    await screen.findByRole('button', { name: 'Export' });
    chooseFile('{"hello": "world"}');
    expect(await screen.findByText("This isn't a LingoFlix backup file.")).toBeTruthy();
    chooseFile(backupFile([savedItem()], [explanation()], { version: 2 }));
    expect(await screen.findByText('This backup was made by a newer LingoFlix.')).toBeTruthy();
    expect(await listItems()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/unit/study-log-import.test.tsx`
Expected: FAIL with `Failed to resolve import "@/lib/study-log/import"`.

- [ ] **Step 3: Write the import**

Create `src/lib/study-log/import.ts`:

```ts
import { browser } from '#imports';
import { BACKUP_FORMAT, BACKUP_VERSION } from './export';
import { ITEM_PREFIX, itemIndexKey } from './items';
import { EXPLANATION_PREFIX, explanationIndexKey } from './store';
import { isSavedItem, toExplanation, type Explanation, type SavedItem } from './types';

export interface ImportSummary {
  itemsAdded: number;
  explanationsAdded: number;
  skipped: number;
  invalid: number;
}

export type ImportResult = { ok: true; summary: ImportSummary } | { ok: false; error: 'not-backup' | 'newer-version' };

/** v2 spec §7.4. */
export const IMPORT_ERROR_COPY: Record<'not-backup' | 'newer-version', string> = {
  'not-backup': "This isn't a LingoFlix backup file.",
  'newer-version': 'This backup was made by a newer LingoFlix.',
};

/** The file was fine, but it couldn't be read or saved (not covered by the spec's copy). */
export const IMPORT_FAILED_COPY = "Couldn't import this backup. Try again.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Only the SavedItem fields: anything else in a file never reaches storage. */
function pickItem(item: SavedItem): SavedItem {
  return {
    id: item.id,
    type: item.type,
    text: item.text,
    meaning: item.meaning,
    explanationId: item.explanationId,
    line: item.line,
    lineTimeMs: item.lineTimeMs,
    context: { before: item.context.before, after: item.context.after },
    videoId: item.videoId,
    kind: item.kind,
    seriesId: item.seriesId,
    seriesTitle: item.seriesTitle,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
    episodeTitle: item.episodeTitle,
    explanationLanguage: item.explanationLanguage,
    savedAt: item.savedAt,
    updatedAt: item.updatedAt,
  };
}

const explanationKeys = (e: Explanation) => [`${EXPLANATION_PREFIX}${e.id}`, explanationIndexKey(e.videoId, e.explanationLanguage, e.phrase)] as const;
const itemKeys = (i: SavedItem) => [`${ITEM_PREFIX}${i.id}`, itemIndexKey(i.videoId, i.line, i.type, i.text)] as const;

/**
 * v2 spec §7.4: adds what a backup file has and this computer doesn't. Never deletes or overwrites:
 * a record is skipped when its id or its index key is already taken. Rejects with storage errors.
 */
export async function importBackup(text: string): Promise<ImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-backup' };
  }
  if (!isRecord(data) || data.format !== BACKUP_FORMAT || !Array.isArray(data.items) || !Array.isArray(data.explanations)) {
    return { ok: false, error: 'not-backup' };
  }
  const { version } = data;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, error: 'not-backup' };
  if (version > BACKUP_VERSION) return { ok: false, error: 'newer-version' };

  let invalid = 0;
  const explanations: Explanation[] = [];
  for (const raw of data.explanations) {
    const explanation = toExplanation(raw);
    if (explanation) explanations.push(explanation);
    else invalid++;
  }
  const items: SavedItem[] = [];
  for (const raw of data.items) {
    if (isSavedItem(raw)) items.push(pickItem(raw));
    else invalid++;
  }

  const stored = await browser.storage.local.get([...explanations.flatMap(explanationKeys), ...items.flatMap(itemKeys)]);
  /** Every key that is taken, here or earlier in this file, with its value (index keys hold ids). */
  // A requested key that doesn't exist may come back as undefined (WXT's fake browser does this): not taken.
  const taken = new Map<string, unknown>(Object.entries(stored).filter(([, value]) => value !== undefined));
  const writes: Record<string, unknown> = {};
  /** A skipped file explanation's id → the id of the explanation of the same line already here. */
  const sameLine = new Map<string, string>();
  let explanationsAdded = 0;
  let itemsAdded = 0;
  let skipped = 0;

  for (const explanation of explanations) {
    const [idKey, indexKey] = explanationKeys(explanation);
    if (taken.has(idKey) || taken.has(indexKey)) {
      skipped++;
      const owner = taken.get(indexKey);
      if (typeof owner === 'string' && owner !== explanation.id) sameLine.set(explanation.id, owner);
      continue;
    }
    writes[idKey] = explanation;
    writes[indexKey] = explanation.id;
    taken.set(idKey, explanation).set(indexKey, explanation.id);
    explanationsAdded++;
  }

  for (const fileItem of items) {
    const owner = fileItem.explanationId === null ? undefined : sameLine.get(fileItem.explanationId);
    const item = owner ? { ...fileItem, explanationId: owner } : fileItem;
    const [idKey, indexKey] = itemKeys(item);
    if (taken.has(idKey) || taken.has(indexKey)) {
      skipped++;
      continue;
    }
    writes[idKey] = item;
    writes[indexKey] = item.id;
    taken.set(idKey, item).set(indexKey, item.id);
    itemsAdded++;
  }

  if (Object.keys(writes).length > 0) await browser.storage.local.set(writes);
  return { ok: true, summary: { itemsAdded, explanationsAdded, skipped, invalid } };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Added 40 items and 52 explanations. Skipped 12 already in your Study Log. 3 records couldn't be read." */
export function importSummaryText(summary: ImportSummary): string {
  const added = [
    summary.itemsAdded > 0 ? count(summary.itemsAdded, 'item', 'items') : null,
    summary.explanationsAdded > 0 ? count(summary.explanationsAdded, 'explanation', 'explanations') : null,
  ].filter((part): part is string => part !== null);
  const sentences = [added.length > 0 ? `Added ${added.join(' and ')}.` : 'Nothing new to add.'];
  if (summary.skipped > 0) sentences.push(`Skipped ${summary.skipped} already in your Study Log.`);
  if (summary.invalid > 0) sentences.push(`${count(summary.invalid, 'record', 'records')} couldn't be read.`);
  return sentences.join(' ');
}
```

- [ ] **Step 4: Run the library tests to see them pass**

Run: `pnpm vitest run tests/unit/study-log-import.test.tsx -t "importBackup|importSummaryText"`
Expected: the `importBackup` and `importSummaryText` tests PASS. The page tests still FAIL: there is no "Import backup…" menu item yet.

- [ ] **Step 5: Add "Import backup…" to the menu**

In `src/entrypoints/options/StudyLogExportMenu.tsx`:

1. Add the prop to `StudyLogExportMenuProps`:

```tsx
  /** Offers "Import backup…" after the export formats. Always available: it is how a backup comes back after Reset all. */
  onImport?(): void;
```

2. Destructure it in the component signature:

```tsx
export function StudyLogExportMenu({ canExportView, canBackup, onExport, onImport }: StudyLogExportMenuProps) {
```

3. In the `role="menu"` element, after the `FORMATS.map(…)` block, add:

```tsx
          {onImport && (
            <>
              <div role="separator" className="my-1 h-0.5 rounded-full bg-soft" />
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={() => {
                  close();
                  onImport();
                }}
              >
                Import backup…
              </button>
            </>
          )}
```

- [ ] **Step 6: Wire the file picker and the status line into the Study Log page**

In `src/entrypoints/options/StudyLogTab.tsx`:

1. Add the imports. Add `useRef` to the existing `react` import, and add:

```tsx
import { IMPORT_ERROR_COPY, IMPORT_FAILED_COPY, importBackup, importSummaryText } from '@/lib/study-log/import';
```

2. Next to the other hooks (before any early `return`), add the state, the file input ref and the import action:

```tsx
  const [importStatus, setImportStatus] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** v2 spec §7.4: adds the chosen backup; the list reloads through watchStudyLog. */
  const importFile = async (file: File) => {
    try {
      const result = await importBackup(await file.text());
      setImportStatus(result.ok ? { tone: 'good', text: importSummaryText(result.summary) } : { tone: 'bad', text: IMPORT_ERROR_COPY[result.error] });
    } catch {
      setImportStatus({ tone: 'bad', text: IMPORT_FAILED_COPY });
    }
  };
```

3. Give Task 12's `exportMenu` element the import entry. Add `onImport` to its props:

```tsx
    <StudyLogExportMenu
      canExportView={visible.length > 0}
      canBackup={hasItems || data.historyCount > 0}
      onExport={(kind) => void exportAs(kind)}
      onImport={() => fileInput.current?.click()}
    />
```

4. In the page's returned JSX, directly after the page header row (the element holding `<h1>Study Log</h1>`), add the hidden file input and the status line. They render in both the empty state and the list state:

```tsx
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        aria-label="Backup file"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = ''; // choosing the same file again fires change again
          if (file) void importFile(file);
        }}
      />
      {/* Kept in the accessibility tree while empty (sr-only, not display: none), so its first message is announced. */}
      <p role="status" className={importStatus ? `text-sm font-bold ${importStatus.tone === 'bad' ? 'text-danger' : 'text-ink'}` : 'sr-only'}>
        {importStatus?.text ?? ''}
      </p>
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm vitest run tests/unit/study-log-import.test.tsx tests/unit/study-log-export-menu.test.tsx`
Expected: PASS. The Task 12 menu tests still pass, because `onImport` is optional and they don't pass it.

- [ ] **Step 8: Run the whole suite and the type check**

Run: `pnpm test && pnpm compile`
Expected: every test file passes; `tsc --noEmit` reports no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/study-log/import.ts src/entrypoints/options/StudyLogExportMenu.tsx src/entrypoints/options/StudyLogTab.tsx tests/unit/study-log-import.test.tsx
git commit -m "feat: import a Study Log backup without overwriting anything" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 14: Docs, build, live check

The v2 spec §10 calls for a live checklist on Netflix. This task also brings the user-facing docs and the main spec
in line with what now gets sent to Anthropic. It needs your human partner's logged-in Chrome and Claude API key.
Fix any failure with superpowers:systematic-debugging, and add a failing test before each fix.

**Files:**
- Modify: `README.md` (feature list and privacy paragraph)
- Modify: `docs/superpowers/specs/2026-10-09-lingoflix-design.md` (pointers to the v2 spec in §5.3, §5.5, §7.2, and the §10 privacy line)

**Interfaces:**
- Consumes: everything above.
- Produces: user-facing docs and a verified build.

- [ ] **Step 1: Build**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: all tests pass, no type errors, `.output/chrome-mv3` rebuilt.

- [ ] **Step 2: Update `README.md`**

Replace this bullet:

```markdown
- **Study Log.** Every explanation is saved on your computer, organized by show, season, and episode.
  Jump back to any line with one click.
```

with:

```markdown
- **Study Log.** Claude suggests the words, phrases, idioms and lines worth keeping from each line it
  explains; save the ones you want. Browse them by show, season and episode, filter and search them,
  open any one to see the scene and the explanation, jump back to that moment on Netflix, and export
  to Anki or CSV (or a full backup you can import again).
```

Replace this paragraph:

```markdown
LingoFlix uses your own Claude API key (you pay Anthropic directly for what you use). The key and
your Study Log stay on your computer; subtitle text is sent to Anthropic only when you ask for an
explanation.
```

with:

```markdown
LingoFlix uses your own Claude API key (you pay Anthropic directly for what you use). The key and
your Study Log stay on your computer. Only when you ask for an explanation or a follow-up does
LingoFlix send Anthropic the line, the dialogue around it, the episode's earlier subtitle lines (you
can turn this off in Settings), and a short list of what you've saved and explained before, so
Claude can build on it.
```

- [ ] **Step 3: Point the main spec at the v2 spec**

In `docs/superpowers/specs/2026-10-09-lingoflix-design.md`, add one line directly under each of these headings
(`### 5.3 Hover-to-explain and the explanation card`, `### 5.5 Study Log`, `### 7.2 Explanation request`):

```markdown
> Changed by `docs/superpowers/specs/2026-10-10-lingoflix-study-log-v2-design.md` (Study Log v2), which wins where they disagree.
```

In `## 10. Privacy and permissions`, replace:

```markdown
- Subtitle text, surrounding dialogue, and title info are sent to Anthropic only when the user requests an explanation or follow-up.
```

with:

```markdown
- Subtitle text, surrounding dialogue, title info, the episode's earlier subtitle lines (setting "Send the story so far", on by default), and a short learning history (recent saved items and explained lines) are sent to Anthropic only when the user requests an explanation or follow-up.
```

Check: `grep -c "Changed by \`docs/superpowers/specs/2026-10-10" docs/superpowers/specs/2026-10-09-lingoflix-design.md`
Expected: `3`

- [ ] **Step 4: Commit the docs**

```bash
git add README.md docs/superpowers/specs/2026-10-09-lingoflix-design.md
git commit -m "docs: README and main spec for Study Log v2 (suggestions, saved items, export, what is sent to Claude)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Human step: run the live checklist**

Ask your human partner to reload LingoFlix at `chrome://extensions`, refresh Netflix, and report the numbers of
any item that fails:

*On Netflix (a series episode, text subtitles on, API key set)*
1. Hover a line you haven't explained before. The explanation streams, then a **Save** section appears with up to
   6 rows (word, phrase, idiom badges) and **Whole line** last.
2. Tap **+** on two rows. Each shows a spinner, then **Saved**. Tap one again: it goes back to **+**.
3. Close the card and hover the same line again. It shows instantly with **Explained before**, and the row you kept
   still shows **Saved**.
4. **Regenerate.** A new explanation streams, the suggestions are replaced, and the saved row (if suggested again)
   still shows **Saved**.
5. Settings → Explanations: **Send the story so far** is on. Late in an episode, explanations mention earlier
   events when that helps. Turn it off: explanations still work.
6. Ask a follow-up question: it answers as before, and no new Save rows appear.

*Study Log page*
7. The Study Log opens on **All items**, newest first, with type badges, meanings and where each is from. The old
   explained lines from before the update are there as **LINE** items.
8. Filters (Words, Phrases, Idioms, Lines) and search narrow the list; **Clear filters** brings everything back.
9. Click an item. The detail view shows the text, its meaning, the full line with the item highlighted, the show,
   season, episode and time, the saved date, **Dialogue around it** and **Claude's explanation**.
10. **Open at this moment** opens the episode and jumps to the line.
11. Make the window narrow: the detail view replaces the list, and **Back** returns. Escape closes it too.
12. Delete an item, then an episode. Each asks first, and the explanation of that line still shows instantly as
    **Explained before** on Netflix.

*Export and import*
13. **Export → Anki (.txt)**, then in Anki **File → Import**: cards land in a **LingoFlix** deck with the text on
    the front, the meaning and the line (item in bold) on the back, and tags.
14. **Export → CSV (.csv)**: opens in Google Sheets or Excel with correct accents and non-Latin text.
15. **Export → Full backup (.json)**, then **Reset all**, then **Import backup…** with that file: everything comes
    back, and the summary counts match. Importing the same file again adds nothing ("Skipped …").

- [ ] **Step 6: Record and commit**

If anything failed and was fixed, each fix has its own failing test and commit. When all items pass, run:

Run: `pnpm test && pnpm compile && pnpm build`
Expected: all tests pass, no type errors, build succeeds.

No further commit is needed unless a fix was made.
