# LingoFlix Study Log v2: saved words, phrases, idioms and lines

Date: 2026-10-10 · Status: approved in conversation, pending written review
Builds on: `docs/superpowers/specs/2026-10-09-lingoflix-design.md` (the main spec) and Plan 2 (merged to `main`).
Where this document and the main spec disagree, this document wins; §12 lists the main-spec sections it replaces.

## 1. Summary

Today every explained line is saved to the Study Log automatically, and only whole lines can be saved.
Study Log v2 turns the Study Log into the learner's own list:

- **Claude suggests what to save.** Every explanation ends with up to 6 suggestions taken from the line: single
  **words**, **phrases**, **idioms**, and the **whole line**, each with a short meaning. The learner taps Save on
  the ones they want. **Whole line** can always be saved, even when there are no suggestions.
- **Only saved items appear in the Study Log.** Every explanation is still kept automatically, behind the scenes,
  as **explanation history**: hovering a line again shows it instantly at no cost, saved items link to it, and
  Claude learns from it.
- **Claude gets more context:** the **story so far** in the episode (never anything after the 6 lines shown after
  the target line) and the learner's **learning history** (recent saved items and explained lines), with prompt
  caching to keep the cost down.
- **A detail view** for every saved item: the full line with the item highlighted, show, season, episode, time,
  saved date, the dialogue around it, and Claude's explanation with follow-ups.
- **Export** to Anki, CSV, and a full JSON backup; **import** of that backup.

## 2. Decisions (from the brainstorm, 2026-10-10)

| Topic | Decision |
|---|---|
| Scope of this version | The list first: saving, the Study Log list, the detail view, export/import. Flashcards were later dropped (study reminders spec §2). |
| How items are picked | Claude suggests items (word, phrase, idiom, whole line); the learner taps Save. No manual text selection. |
| Auto-save | Only what the learner saves appears in the Study Log. Every explanation is kept automatically as history and reused when the same line is explained again. |
| Context for Claude | Both the story so far and the learning history. |
| Suggestions mechanism | One streamed request; Claude finishes by calling a `suggest_saves` tool. |
| Duplicates | One saved item per (line, type, text). The same word saved from another line is a separate item. |
| Existing Study Log entries | Each becomes a saved **whole line** item; nothing disappears. |
| Deleting | Deleting items, episodes, seasons or shows removes saved items only; explanation history stays. **Reset all** clears both. |
| Export formats | Anki, CSV, full JSON backup (with import). Not Quizlet. |
| Story-so-far toggle | New setting "Send the story so far", on by default. |

## 3. Data model and storage

All data stays in `chrome.storage.local` (the `unlimitedStorage` permission is already granted). The background
service worker owns writes coming from Netflix; the options page reads and writes directly, as today.

### 3.1 Explanations (automatic history)

The Plan 2 `StudyLogEntry` becomes **`Explanation`** in code (`src/lib/study-log/types.ts`). Storage keys stay
`log:{id}` and the lookup index `logkey:{videoId}|{language}|{normalized phrase}`, so existing data needs no move.
One new field:

| Field | Type | Notes |
|---|---|---|
| `suggestions` | `SaveSuggestion[]` | From the `suggest_saves` tool, validated (§5.4). `[]` when Claude sent none and for records written before v2. |

`SaveSuggestion = { type: ItemType; text: string; meaning: string }` with `ItemType = 'word' | 'phrase' | 'idiom' | 'line'`.

Explanations are still written only when a stream completes successfully, and **Regenerate** still overwrites the
record for that line (response, suggestions, follow-ups cleared as today).

### 3.2 Saved items (the Study Log)

New record **`SavedItem`**, key `item:{id}`, plus a lookup index
`itemkey:{videoId}|{normalized line}|{type}|{normalized text}` → id (normalization as `normalizeLine`, lowercased).

| Field | Type | Notes |
|---|---|---|
| `id` | string | random UUID |
| `type` | `ItemType` | |
| `text` | string | the word/phrase/idiom as it appears in the line; for `line`, the whole line |
| `meaning` | string | short meaning in the explanation language; may be `''` (a whole line saved without a `line` suggestion, or migrated) |
| `explanationId` | string \| null | the `Explanation` it came from; null if that record is gone or was never imported |
| `line` | string | the full subtitle line |
| `lineTimeMs` | number | episode time where the line starts |
| `context` | `{ before: string[]; after: string[] }` | the dialogue around the line (as sent to Claude) |
| `videoId`, `kind`, `seriesId`, `seriesTitle`, `seasonNumber`, `episodeNumber`, `episodeTitle` | as `Explanation` | copied so the item stands alone (detail view, exports) |
| `explanationLanguage` | string | language of `meaning` |
| `savedAt`, `updatedAt` | ISO 8601 | |

Saving an item whose index key already exists returns the existing item (no duplicate). Unsaving deletes the item and
its index key.

### 3.3 One-time conversion of existing data

The first time v2 runs (background `runtime.onInstalled` with reason `update`, and again lazily before the Study Log
is listed if the marker is missing), every `log:` record written before v2 (it has no stored `suggestions` field)
gets a saved item of type `line` (`text` = `line` = the phrase, `meaning` = `''`, `explanationId` = the record's id,
other fields copied).
A marker key `migration:study-log-v2` = `true` records completion. Running it twice never creates duplicates
(the item index makes it idempotent).

### 3.4 Reset all

Removes every `item:`, `itemkey:`, `log:` and `logkey:` key (not settings, not the API key), after a confirmation
dialog that says both the Study Log and the explanation history will be deleted.

## 4. On Netflix: the explanation card

### 4.1 Layout

```
┌─────────────────────────────────────────────┐
│ "I'm gonna call it a night."              ✕ │
│ Meaning · Key expressions · How to use it   │  ← streams as today
│ ── Save ─────────────────────────────────── │
│ [+] call it a night   IDIOM   end the evening│
│ [+] gonna             WORD    going to (casual)│
│ [+] Whole line        LINE                   │
│ Regenerate        Ask a follow-up…           │
└─────────────────────────────────────────────┘
```

- The **Save** section appears when the stream finishes. Rows follow Claude's order, except that the `line`
  suggestion (or the fallback **Whole line** row) is always last. Each row: a Save toggle, the text, a type badge
  (WORD, PHRASE, IDIOM, LINE), and the meaning.
- **Whole line** is always offered. If Claude suggested a `line` item, that row carries its meaning; otherwise the
  row reads "Whole line" with no meaning.
- **Save toggle:** `+` → saving (spinner) → `Saved ✓`. Tapping `Saved ✓` removes the item (back to `+`).
  A failed save shows "Couldn't save" on that row; tapping it again retries.
- **Explained before:** when the line already has an explanation, the card shows it instantly with the label
  "Explained before" (was "From your Study Log"), its stored suggestions, and which of them are saved.
- **Regenerate** streams a new explanation and replaces the suggestions. Items already saved stay saved; rows for
  suggestions that match a saved item show `Saved ✓`.
- Follow-up questions work as today and never add suggestions.
- On-Netflix look and feel rules from main spec §5.10 apply (dark tokens, px sizes, Lucide icons, no emoji).

### 4.2 Messages

- The `explain` port's `done` message carries the stored `Explanation` (now with `suggestions`) and
  `savedKeys: string[]`: the item index keys (§3.2) of this line that are already saved.
- Background requests (`src/lib/messages.ts`, served by `src/lib/background/message-handler.ts`, accepted
  from the Netflix content script and extension pages):
  - `explanation:find { videoId, language, phrase }` → `{ explanation, savedKeys }` (replaces `log:find`; used
    when a stored explanation is shown).
  - `item:save { explanationId, suggestion }` → `{ key }` (creates or keeps the existing item; source fields
    come from the stored `Explanation`, never from the page).
  - `item:remove { explanationId, suggestion }` → `{ key }`.
  - Both accept only a suggestion that is one of that explanation's card rows (§4.1); anything else is refused.

## 5. Claude integration changes

### 5.1 Request shape

One streamed Messages request per explanation (model and timeouts unchanged from main spec §7.1, except
`max_tokens`):

| Part | Content | Cache |
|---|---|---|
| `system[0]` | Instructions (main spec §7.2 text, plus §5.3 below) | none |
| `system[1]` | **Story so far**, chunk A (§5.2) | `cache_control: { type: 'ephemeral' }` |
| `system[2]` | **Learning history** (§5.2) | `cache_control: { type: 'ephemeral' }` |
| `messages[0]` (user) | Story so far, chunk B; then the title line, the 6 lines before, the target line, the 6 lines after (as today) | none |
| `tools` | `suggest_saves` (§5.3) | |
| `tool_choice` | `auto` (a forced tool would suppress the explanation text) | |
| `max_tokens` | **1536** (was 1024) so the tool call fits after the explanation | |

Empty parts are left out (an empty block is never sent). Follow-up requests send the same story so far and
learning history blocks when available, no `tools`, and `max_tokens` 1024 as today. Their prefix differs from an
explanation's (no `tools`, a different `system[0]`), so they reuse only caches written by earlier follow-ups.

### 5.2 Context blocks

**Story so far.** The Netflix content script sends `storySoFar: Array<{ startMs: number; text: string }>` with each
`start` and `follow-up` message: every subtitle line whose start is before the first of the 6 lines before the target.
The source is the validated subtitle file (Plan 2 `subtitle-session`), else the rolling history of observed lines,
whose capacity grows from 50 to 600 lines. Nothing at or after the target line's context window is ever included,
so Claude never sees beyond the 6 lines after the target (no spoilers). The content script sends at most the last
1000 such lines. When the setting "Send the story so far" is off, `storySoFar` is `[]`.

The background splits it at the last 5-minute boundary before the target line (`floor(targetStartMs / 300000) * 300000`):

- **chunk A** = lines starting before the boundary, rendered as `system[1]`:
  `Story so far in this episode (subtitle lines before the dialogue below, oldest first):` followed by one line each.
  Its text is identical for every request in the same 5-minute window, so it is read from cache.
- **chunk B** = the remaining lines, placed at the top of the user message under `Just before:`.

Caps are applied after the split, so chunk A stays identical within a window: chunk A keeps its last 600 lines and
at most 48 000 characters (oldest dropped first); chunk B keeps its last 200 lines.

Prompt caching only applies above the model's minimum cacheable length; shorter prefixes are simply sent uncached.

**Learning history.** Built in the background from storage, rendered as `system[2]`:

```
What this learner has studied (most recent first). Connect to it when useful, don't re-explain basics they already
saved, and don't suggest items they already saved.
Saved:
- call it a night (idiom): end the evening's activities [Stranger Things S1 E3]
Recently explained lines:
- "Where's Will?" [Stranger Things S1 E3]
```

Limits: the last 100 saved items and the last 30 explained lines (by `updatedAt`, leaving out the line being
explained), each text cut at 120 characters
and each meaning at 80. Omitted entirely when both lists are empty.

### 5.3 The `suggest_saves` tool

```json
{
  "name": "suggest_saves",
  "description": "Save suggestions for the learner: items from the subtitle line worth studying.",
  "input_schema": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "maxItems": 6,
        "items": {
          "type": "object",
          "properties": {
            "type": { "type": "string", "enum": ["word", "phrase", "idiom", "line"] },
            "text": { "type": "string" },
            "meaning": { "type": "string" }
          },
          "required": ["type", "text", "meaning"]
        }
      }
    },
    "required": ["items"]
  }
}
```

Added to the instructions (`system[0]`):

> After the explanation, call suggest_saves once with up to 6 items from the subtitle line that are worth studying:
> single words, phrases, idioms, and the whole line if it is worth keeping as a sentence. Use the exact text as it
> appears in the line. Give each a meaning of at most 12 words in {language}. Leave out items the learner already
> saved. Don't mention the tool or the suggestions in your explanation.

### 5.4 Validating suggestions

Applied in the background before anything is stored or shown; invalid items are dropped silently:

- `type` must be one of the four values.
- `text` is trimmed, non-empty, at most 120 characters. For `word`/`phrase`/`idiom` it must appear in the line
  (case-insensitive, whitespace-normalized); for `line` it is replaced by the line itself.
- `meaning` is trimmed, at most 200 characters (longer is cut, not dropped).
- Duplicates (same type and normalized text) keep the first; at most 6 items; at most one `line` item.

If the stream ends without a tool call (for example `stop_reason` `max_tokens`), `suggestions` is `[]`.
The explanation itself is saved and shown exactly as today.

### 5.5 Client interface

`ClaudeClient.streamText` becomes `stream(params, onText, signal) → { text: string; toolCalls: Array<{ name: string;
input: unknown }> }`, where `params.system` is `string | Array<{ text: string; cache: boolean }>` and `params.tools`
is optional. The SDK wrapper maps `cache: true` to `cache_control: { type: 'ephemeral' }`, keeps `maxRetries: 0`, and
reads tool calls from the final message's `tool_use` blocks; when the message stopped at `max_tokens`, it returns
no tool calls (a cut-off call is only partly parsed). Error mapping (main spec §7.4) is unchanged.

## 6. The Study Log page

### 6.1 Layout

```
┌───────────────┬──────────────────────────────────────────────┬──────────────────────┐
│ All items  42 │ [All][Words][Phrases][Idioms][Lines] 🔍 Export ▾ │                      │
│ Stranger Th.. │ IDIOM call it a night  end the evening  S1 E3 30:34 │  detail view (§6.2)  │
│  Season 1  12 │ WORD  gonna            going to         S1 E3 30:34 │                      │
│   E3 Holly 5  │ LINE  "Where's Will?"                   S1 E3 12:02 │                      │
│ Movies        │ …                                            │                      │
└───────────────┴──────────────────────────────────────────────┴──────────────────────┘
```

- **Tree** (left): **All items** first (all saved items, newest first), then Series → Season → Episode and Movies
  as today, with saved-item counts. Sorting rules from main spec §5.5 stay.
- **Toolbar:** type filter (All, Words, Phrases, Idioms, Lines, single choice), a search box (case-insensitive,
  matches `text` and `meaning`), and **Export ▾** (§7).
- **Rows:** type badge, text, meaning, and where it's from (`S1 E3 30:34`, or the movie title). Inside an episode
  or movie, rows are in `lineTimeMs` order (ties: `savedAt`); in **All items**, newest `savedAt` first.
- Empty states: no items at all ("Hover a line on Netflix and save words, phrases, idioms or whole lines."),
  nothing matches the filters ("Nothing matches. Clear filters").
- **Clicking a row** opens the detail view: in a third column on wide windows (≥ 1100 px), otherwise in place of
  the list with a **Back** button. The selected row is highlighted. Escape closes the detail view.

### 6.2 Detail view

- Type badge, the **text** (large) and its **meaning**.
- The **full line**, with every occurrence of the item's text highlighted (whole-line items: no highlight).
- **Series · Season · Episode "title" · time** (movie: title · time) and **Open at this moment** (pending seek,
  main spec §5.5, unchanged).
- **Saved** date and time in the browser's locale.
- **Dialogue around it** (collapsed by default): the 6 lines before, the line (highlighted), the 6 lines after.
- **Claude's explanation** (collapsed by default when the item has a meaning, open otherwise): the linked
  `Explanation`'s response and follow-ups rendered with the existing safe Markdown component. If `explanationId` is
  null or the record is missing: "Claude's explanation isn't available for this item."
- **Delete** (confirmation dialog, as today).

### 6.3 Deleting

- An item, or all items of an episode, season, series or movie (the existing tree actions): removes **saved items
  only**; explanation history stays. Confirmation text says "saved items".
- **Reset all**: §3.4.

## 7. Export and import

All files are built in the options page and downloaded with an `<a download>` link to a Blob URL (no new
permission). File names: `lingoflix-anki-YYYY-MM-DD.txt`, `lingoflix-YYYY-MM-DD.csv`,
`lingoflix-backup-YYYY-MM-DD.json` (local date). Export items are disabled when they would export nothing.

### 7.1 Anki (`.txt`)

Exports the items in the **current view** (tree selection + type filter + search), in list order. Anki 2.1.54+
file headers, tab-separated, HTML on:

```
#separator:Tab
#html:true
#notetype:Basic
#deck:LingoFlix
#tags column:3
#columns:Front	Back	Tags
```

- **Front:** the item text (for `line` items, the whole line).
- **Back:** the meaning (if any), then `<br><br>` and the full line with the item's text wrapped in `<b>…</b>`,
  then `<br><small>Series · S1 E3 · 30:34</small>` (movie: `Title · 1:02:03`).
- **Tags:** `lingoflix`, the type, and the show title as a tag (lowercase; runs of non-letters/digits become `_`).
- Every field is HTML-escaped (`& < > "`); tabs become spaces and newlines `<br>`. UTF-8, `\n` line endings.

### 7.2 CSV (`.csv`)

Exports the **current view**. RFC 4180: comma-separated, every field quoted, `"` doubled, CRLF line endings,
UTF-8 with a byte-order mark (so Excel reads non-Latin text correctly). Header row and columns:

`Type, Text, Meaning, Line, Show, Season, Episode, Episode title, Time, Saved, Explanation language, Netflix link`

Time as `m:ss` or `h:mm:ss`; Saved as ISO 8601; Netflix link `https://www.netflix.com/watch/{videoId}`;
empty cells for missing season/episode values.

### 7.3 Full backup (`.json`)

Always **everything**:

```json
{ "format": "lingoflix-backup", "version": 1, "exportedAt": "2026-10-10T21:41:00.000Z",
  "items": [ /* SavedItem */ ], "explanations": [ /* Explanation */ ] }
```

Never the API key, settings, or any other storage key.

### 7.4 Import backup

**Import backup…** in the Export menu opens a file picker (`.json`).

- The file must parse and have `format: "lingoflix-backup"` and a `version` LingoFlix supports (1); otherwise
  nothing changes and the page says "This isn't a LingoFlix backup file." (or "…was made by a newer LingoFlix.").
- Each record is checked with the same validators as storage reads (`isSavedItem`, `isExplanation`); invalid
  records are skipped and counted.
- Import **adds only**: an explanation is skipped if its `id` or `logkey` index key exists; an item is skipped if
  its `id` or `itemkey` index key exists. Index keys are written for everything added. Nothing is ever deleted
  or overwritten.
- Summary: "Added 40 items and 52 explanations. Skipped 12 already in your Study Log." (plus
  "3 records couldn't be read." when any were invalid).

## 8. Settings

One new field in `sync:settings` (the Plan 2 keep-unknown-fields write rules apply): `sendStorySoFar: boolean`,
default `true`, shown in the Explanations card as **Send the story so far**, with the hint "Better explanations;
more tokens late in an episode."

## 9. Errors

| Situation | Behavior |
|---|---|
| No `suggest_saves` call, or every suggestion invalid | No suggestion rows; **Whole line** still offered |
| Explanation stream fails | Error card with Retry as today; nothing stored |
| `item:save` / `item:remove` fails | That row shows "Couldn't save" / stays `Saved ✓`; tapping retries |
| Linked explanation missing | Detail view says so; everything else still shows |
| Conversion (§3.3) interrupted | Runs again next time; never duplicates |
| Backup file wrong or damaged | Nothing changes; clear message |
| Storage read finds an invalid record | Skipped (as today) |

## 10. Testing

Unit tests (Vitest), each written to fail first:

- **Suggestions:** validation rules of §5.4 (types, text-in-line, `line` replacement, lengths, duplicates, limits),
  and the no-tool-call path.
- **Prompt building:** system blocks and their cache markers, empty parts omitted, story split at the 5-minute
  boundary (chunk A identical within a window), caps (600 lines, 48 000 characters, history limits), and a test that
  no line at or after the context window ever appears in the request.
- **Client:** tool input read from the final message; `cache: true` mapped to `cache_control`.
- **Item store:** save (idempotent), unsave, saved keys per explanation, delete scopes (items only), Reset all
  (both), conversion (idempotent, fields copied).
- **Messages:** `item:save` takes source fields from the stored explanation, not the request.
- **Card:** Save section after `done`, toggles and failure retry, Whole line fallback, "Explained before" with saved
  state, Regenerate keeps saved state.
- **Study Log page:** All items, filters, search, ordering, detail view contents (highlight, missing explanation),
  narrow-window Back, deletes.
- **Export/import:** Anki headers and escaping (tabs, newlines, quotes, `&<>`, non-Latin), CSV quoting/BOM/CRLF,
  backup shape, import validation, add-only merge, summary counts.

Live checklist on Netflix: suggestions appear and save; hovering again shows `Saved ✓`; the detail view and Open at
this moment; an Anki import; the CSV opened in Sheets or Excel; backup export → Reset all → import restores
everything.

## 11. Out of scope

Flashcards and other study modes (dropped: study reminders spec §2), spaced repetition, reminders/notifications
(later added: study reminders spec), Quizlet export, the Stripe subscription, editing an item's text or meaning,
manual text selection on Netflix.

## 12. Main spec sections this replaces or amends

- §5.3 (card): adds the Save section and the "Explained before" label (§4 here).
- §5.5 (Study Log): entries become saved items; explanations become history (§3, §6).
- §6.3 (messaging): new `item:*` requests and the `done` payload (§4.2).
- §6.4 (storage): `item:`/`itemkey:` keys and the migration marker (§3).
- §7.1/§7.2/§7.3 (Claude): `max_tokens` 1536 for explanations, system blocks with caching, the tool (§5).
- §5.8 (options page): the new setting (§8) and the Study Log page (§6, §7).
