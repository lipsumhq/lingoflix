# LingoFlix — Design Spec

- **Date:** 2026-10-09
- **Status:** Draft for review
- **Author:** Jay Cho (with Claude)

## 1. Summary

LingoFlix is a free, open-source Chrome extension for studying languages while watching Netflix. It adds remappable playback shortcuts (e.g. ← rewinds 5 s instead of 10 s), a one-key subtitle toggle, hover-to-explain for subtitle lines powered by the user's own Claude API key (Sonnet 5.5), an automatically organized Study Log of everything explained, and voice shadowing (record yourself saying a line and compare it to the original; the recording is discarded immediately). The extension is free; a donation section links to Buy Me a Coffee and GitHub Sponsors.

## 2. Goals and success criteria

A learner watching Netflix can, without leaving the video:

1. Rewind/forward by an amount they choose, using keys they choose.
2. Hide/show subtitles with one key (listening practice).
3. Hover a subtitle line they don't understand and get an explanation that uses the surrounding dialogue as context: meaning and nuance, key expressions, and how to use them.
4. Ask follow-up questions about that line.
5. Find every line they've explained later, organized by series → season → episode, and jump back to that moment.
6. Record themselves saying a line and compare it to the original.

The extension works with only Netflix and an Anthropic API key — no LingoFlix server, no account.

## 3. Non-goals (v1)

- Other streaming sites (YouTube, Disney+, Prime Video).
- Word-level lookup, dual subtitles, or rendering our own subtitle overlay.
- Exporting the Study Log (Anki, CSV) or syncing it across devices.
- Firefox / Safari builds.
- Localizing the extension's own UI (UI is English; explanations are in the user's chosen language).
- Image-based subtitles (no text to read).
- Recording or saving scene audio/video, or saving voice recordings.
- A hosted backend or LingoFlix-provided API keys.

## 4. Users and distribution

- Published to the Chrome Web Store as **"LingoFlix — Understand every line on Netflix"**, open source (MIT), like SiteBlocker.
- Listing and About text include: "Not affiliated with or endorsed by Netflix."
- Free. Users bring their own Anthropic API key and pay Anthropic directly for usage.

## 5. Features

### 5.1 Shortcuts

All shortcuts are remappable in Settings. A binding is `{ code, ctrl, alt, shift, meta }` using `KeyboardEvent.code` (physical key), so bindings keep working with non-Latin keyboard layouts and an active IME (e.g. Korean input). A binding can be cleared (unbound).

| Action | Default | Behavior |
|---|---|---|
| Rewind | `ArrowLeft`, 5 s | Seek back N seconds (N configurable, 1–60), or one line when Rewind's mode is **One line** (§5.1.1) |
| Forward | `ArrowRight`, 5 s | Seek forward N seconds (N configurable, 1–60), or one line when Forward's mode is **One line** (§5.1.1) |
| Previous line | `KeyA` | Seek to the start of the previous line (§5.1.1) |
| Next line | `KeyD` | Seek to the start of the next line (§5.1.1) |
| Show / hide subtitles | `KeyC` | Hide/show Netflix subtitles (§5.2) |
| Replay line | `KeyR` | Seek to the start of the current line and play |
| Explain line | `KeyE` | Open the explanation card for the current line (§5.3) |
| Shadow line | `KeyV` | Start/stop voice recording for the current line (§5.6) |

Rules:
- LingoFlix's `keydown` listener is registered on `window` in the capture phase at `document_start`, so it runs before Netflix's handlers. For a bound key it calls `preventDefault()` and `stopImmediatePropagation()`; Netflix never sees it. Unbound keys pass through to Netflix untouched.
- Shortcuts are ignored when focus is in an input, textarea, or contenteditable element (including LingoFlix's follow-up box), when the extension is disabled, or when not on a `/watch/` page.
- The shortcut recorder in Settings refuses a binding already used by another LingoFlix action and shows a warning (not a block) when the binding overrides a Netflix default (`Space`, `Enter`, `KeyF`, `KeyM`, `KeyS`, `ArrowUp`, `ArrowDown`, `Escape`).
- "Current line" = the subtitle currently displayed; if none is displayed (between lines or subtitles hidden), the most recently displayed line.

#### 5.1.1 Line navigation

Added 2026-10-10 at the user's request: jumping by sentence, not only by a fixed number of seconds.

- Lines come from the captured subtitle file (§8.2) when it is valid; otherwise from the rolling history (lines already seen in this video, each starting 300 ms before it appeared).
- **Previous line:** if a line is on screen, go to the start of the line before it; between lines, go to the start of the most recent line.
- **Next line:** go to the start of the first line that starts after now.
- Rewind and Forward each have a mode, **Seconds** (default) or **One line**. In One line mode they behave like Previous line / Next line.
- Line jumps keep the current play/pause state, and holding the key repeats.
- When there is no line to jump to (before the first line, or the next line is unknown because there is no subtitle file and it hasn't been seen yet), the jump falls back to the Rewind/Forward seconds.

### 5.2 Subtitle toggle

- Toggling adds/removes a class on `<html>` that applies `opacity: 0 !important` to Netflix's subtitle layer (not `visibility: hidden`: hidden text has no `innerText`, which would glue two-line subtitles together). The subtitle DOM keeps updating, so "current line" still works while hidden.
- The hidden/shown state is persisted and applies to every episode until toggled again.
- While subtitles are hidden, hover-to-explain is inactive (nothing to hover), but the Explain, Replay, and Shadow shortcuts still work — listen first, then check.

### 5.3 Hover-to-explain and the explanation card

Flow:
1. The overlay tracks `mousemove` on the document and hit-tests the pointer against the bounding rects of the visible subtitle text (padded by 8 px). This does not depend on Netflix's subtitle elements receiving pointer events.
2. On entering a line: if **Pause on hover** is on (default: on) and the video is playing, LingoFlix pauses it and remembers that it did.
3. After the pointer dwells 400 ms on the line, LingoFlix explains it:
   1. Look up the Study Log for an entry with the same `videoId` + normalized line text + explanation language. If found, show it instantly — no API call. The card offers **↻ Regenerate**, which calls the API and replaces the saved entry's `response` and clears its `followUps` (they referred to the old response).
   2. Otherwise build an explanation request (§7.2), open the card in a loading state, and stream the response into it.
   3. When the stream completes successfully, save the entry to the Study Log (§5.5). Aborted or failed requests are not saved.
4. The card stays open while the pointer is on the line or the card. Leaving both closes it after a 300 ms grace period (so the pointer can travel from line to card). Closing aborts any in-flight request.
5. On close, playback resumes **only if LingoFlix paused it**.
6. A card stays on the line it was opened for. With Pause on hover off, the subtitle can change while the pointer is still over it; the card does not switch lines. To explain the new line, the user moves the pointer away and back.

Opening via the **Explain line** shortcut follows the same flow from step 3, applies the same pause rule, and keeps the card open until `Escape`, the Explain key again, or a click outside the card.

Card contents (Markdown rendered with `react-markdown`, no raw HTML):
- The line itself.
- Sections, each toggleable in Settings (all default on):
  - **Meaning** — natural translation plus what the line means in this scene: tone, nuance, sarcasm, slang, register.
  - **Key expressions** — idioms, phrasal verbs, slang in the line, each with a short definition.
  - **How to use it** — 2–3 everyday example sentences in the original language, each with a translation.
  - **Follow-up box** (§5.4).
- Buttons: Shadow (§5.6) and Regenerate, with Lucide icons (no emoji, §5.10).

The card mounts inside Netflix's player container so it is visible in fullscreen, positioned above the subtitle line, constrained to the player, and scrolls internally if tall.

### 5.4 Follow-up questions

- A text box under the card (shown when the Follow-up section is enabled).
- Sending a question calls Claude with the full conversation: initial request, explanation, prior follow-ups, new question.
- Answers stream into the card under the question. Each completed Q&A pair is appended to the line's Study Log entry.
- Keystrokes in the box are stopped from propagating to Netflix (Space types a space, not pause).

### 5.5 Study Log

Every successful explanation is saved automatically.

**Entry fields:**

| Field | Example | Notes |
|---|---|---|
| `id` | `"a1b2…"` | random UUID |
| `phrase` | `"I'm gonna call it a night."` | the subtitle line explained |
| `response` | Markdown text | the AI's explanation |
| `followUps` | `[{ question, answer }]` | appended as asked |
| `videoTimeMs` | `1834200` | where the line starts in the episode/movie (timestamp) |
| `savedAt` / `updatedAt` | ISO 8601 | when saved / last changed |
| `videoId` | `"81091396"` | Netflix ID of the episode or movie |
| `kind` | `"episode"` \| `"movie"` | |
| `seriesId`, `seriesTitle` | `"80057281"`, `"Stranger Things"` | movie: `seriesId` null, `seriesTitle` = movie title |
| `seasonNumber`, `episodeNumber`, `episodeTitle` | `1`, `3`, `"Holly, Jolly"` | null for movies |
| `context` | `{ before: string[], after: string[] }` | dialogue sent as context |
| `explanationLanguage` | `"ko"` | BCP 47 |
| `model` | `"claude-sonnet-5-5"` | model that produced `response` |

**Organization (Study Log tab):**
- Left: a tree **Series → Season → Episode** (each with an entry count), plus a **Movies** group (one node per movie). Series sorted by most recently updated; seasons and episodes in numeric order.
- Right: entries of the selected episode/movie in `videoTimeMs` order. Each shows the timestamp (e.g. `30:34`), the phrase, the collapsible response, and follow-ups.
- **Open at this moment** stores a pending seek `{ videoId, timeMs }` in `chrome.storage.session` and opens `https://www.netflix.com/watch/{videoId}`. When the Netflix content script sees that `videoId` playing (page bridge reports the player ready), it seeks to `timeMs` and clears the pending seek. A pending seek older than 2 minutes is ignored. (Netflix ignores `?t=`; verified 2026-10-10, see `docs/netflix-internals.md` row 7.)
- **Delete** on an entry, an episode, a season, or a series (each with a confirmation dialog).
- **Reset all** removes the entire Study Log after a confirmation dialog.

**Storage:** `chrome.storage.local` with the `unlimitedStorage` permission, one key per entry (`log:{id}`), so saving or deleting one entry never rewrites the others, plus one lookup key per line (`logkey:{videoId}|{language}|{normalized line}` → id) so a hover costs one read. The Study Log never leaves the machine.

### 5.6 Voice shadowing

1. **Shadow line** shortcut (`V`) or the 🎤 button on the card: the video pauses, recording starts, and a compact panel above the subtitles shows a red indicator and a timer.
2. Press `V` again (or the panel's stop button) to stop. Recording auto-stops at 15 s.
3. LingoFlix plays the **original line** (seek to line start, play, pause at line end), then plays **your recording**. Panel buttons: **▶ Original**, **▶ You**, **↻ Try again**, **✕ Close**.
4. The recording is discarded immediately when the panel closes, a new take starts, or the current line changes. It is never written to storage, never added to the Study Log, and never sent anywhere.
5. On panel close, playback resumes only if LingoFlix paused it for shadowing and no explanation card is still open (if one is, the card's pause rule applies when it closes).

Mechanics:
- Recording and playback of the user's voice happen in an **offscreen document** (`chrome.offscreen`, reasons `USER_MEDIA` and `AUDIO_PLAYBACK`), so the microphone permission belongs to the LingoFlix extension, not to netflix.com. Audio is held in memory (`MediaRecorder`, `audio/webm;codecs=opus`); discarding drops all references and revokes object URLs. The offscreen document closes after 60 s idle.
- **First use:** if the microphone permission isn't granted yet, LingoFlix opens its options page at `#/microphone`, which explains why and has an **Allow microphone** button that triggers Chrome's permission prompt. After granting, shadowing works from the Netflix tab.
- If permission is denied, the panel says so and links to that page.
- Line end time comes from the captured subtitle file (§8.2). If unavailable, the original plays for the time the line was observed on screen plus 0.5 s.

### 5.7 Popup

- **Enabled** toggle (master switch) in a status card: "You're all set!" / "Your shortcuts are live on Netflix." when on, "Taking a break" / "Netflix works like normal until you turn this back on." when off. The switch's accessible name stays "Enabled".
- **Pause on hover** toggle.
- API key status: "✓ Claude key set" or "⚠ Add your Claude API key" (links to Settings).
- Links: **Settings** (the yellow primary button), **Study Log**.
- Donation card, compact (§5.9).

### 5.8 Options page

Two tabs plus one hidden route. Layout (§5.10): a top bar with the logo and pill tabs; a main column; a right rail with a "Try this" study tip (one of a few, picked on each open; tips name actions, not keys) and the donation card. Below 1024 px wide the rail moves under the main column. "Not affiliated with or endorsed by Netflix." sits under the main column.

**Settings tab:**
- **Enabled** toggle and **Appearance** — Light / Dark / System (default System) — in a General card.
- **Claude API key** — password field, show/hide, **Save**, **Test key** (calls the free `GET /v1/models` endpoint; reports valid / rejected / network error), **Remove**. Copy explains where to get a key and that usage is billed by Anthropic.
- **Explanation language** — curated list of ~30 languages shown by native name; default from `chrome.i18n.getUILanguage()`.
- **Card sections** — four toggles (Meaning, Key expressions, How to use it, Follow-up box).
- **Pause on hover** toggle.
- **Shortcuts** — one row per action: an icon tile, the binding as a keycap (click it, then press a key combo; "Pick a key" when unbound), **Clear** (✕); for Rewind/Forward a **Seconds / One line** switch and, in Seconds mode, a `– N s +` stepper (the number can also be typed, 1–60); **Reset** (to defaults).

**Study Log tab:** §5.5.

**`#/microphone` route:** §5.6.

### 5.9 Donations

- Two buttons: **Buy Me a Coffee** → `https://buymeacoffee.com/jaycho1214`, **GitHub Sponsors** → `https://github.com/sponsors/jaycho1214`.
- A card titled "Enjoying LingoFlix?" with the copy "It's free forever. A coffee keeps it going." Shown in the popup (compact: buttons read **Coffee** / **Sponsor**, full names kept as their accessible names) and in the options page right rail.
- URLs and copy live in one config module (`src/lib/config.ts`).

### 5.10 Look and feel

Benchmarked on Duolingo's qualities — friendly, chunky, bright, encouraging — without its brand assets (no owl, no Duolingo green, no Feather font) and without Netflix red.

- **Color:** Popcorn yellow `#FFC800` primary with a darker edge (`#E0A800` light / `#B88A00` dark) and dark text on yellow (`#3A2E00`). Tokens live in `src/assets/tailwind.css` as `light-dark()` pairs.
- **Appearance:** Light / Dark / System setting (`theme` in Settings, default `system`). System follows the OS live; Light/Dark pin it via `<html data-theme>`. Applies to the popup and options page. On-Netflix UI (notices, the explanation card) always uses the dark tokens, sizes in px, and the font stack `ui-rounded, system-ui, sans-serif` (Nunito isn't loaded on Netflix: a shadow root can't use the extension's font files without exposing them to the page).
- **Type:** Nunito (variable), bundled with the extension via `@fontsource-variable/nunito` — no font requests to Google. Headings 900, labels 800.
- **Shapes:** 2 px borders, 16–18 px corner radius, cards instead of dividers.
- **Buttons:** primary = yellow with a 4 px bottom edge that disappears when pressed; secondary = card-colored with a 2 px border and 3 px edge. Uppercase, letter-spaced labels. Keycaps and the stepper's –/+ use a thick bottom border. Edges on controls inside a tight container (segmented control, switch) are drawn inset so the control stays centered.
- **Icons:** Lucide (`lucide-react`), stroke 2.5–3; no emoji in the UI.
- **Logo:** a yellow speech bubble with a dark play button (subtitles + video). `src/assets/icon.svg` is the source for the toolbar icons (`@wxt-dev/auto-icons`).
- **Copy:** short and encouraging ("You're all set!", "Pick a key", "Press any key…", "Test your ears, then peek.").

## 6. Architecture

### 6.1 Stack

- **WXT** (Manifest V3), **React 19**, **TypeScript**, **Tailwind CSS**, **pnpm**.
- `@anthropic-ai/sdk` in the background service worker (`dangerouslyAllowBrowser: true`, which sends the `anthropic-dangerous-direct-browser-access` header).
- `react-markdown` for rendering responses.
- **Vitest** (unit) and **Playwright** (extension end-to-end).

### 6.2 Components

| Component | Runs in | Responsibility | Depends on |
|---|---|---|---|
| **Page bridge** (`netflix-bridge.content.ts`) | Netflix page, MAIN world, `document_start` | Netflix player API calls (seek, play, pause, current time, current text track); captures subtitle file URLs and title metadata from Netflix's manifest/metadata responses | `window.netflix` internals |
| **Netflix overlay** (`netflix.content/`) | Isolated content script; React UI in a shadow root inside the player container | Shortcut handling, subtitle watcher (current line + rolling history), subtitle-file context, hover detection, explanation card, follow-ups, shadowing panel, one-time notices | Page bridge, background |
| **Background** (`background.ts`) | Service worker | Only reader of the API key; Claude calls with streaming; Study Log reads/writes; offscreen document lifecycle; opening the microphone page | Anthropic API, `chrome.storage`, offscreen |
| **Offscreen recorder** (`offscreen.html`) | Offscreen document | Mic capture, in-memory recording, playback, discard | — |
| **Popup** (`popup/`) | Toolbar popup | Quick toggles, key status, links, donations | settings |
| **Options** (`options/`) | Extension tab | Settings, Study Log, microphone permission page, donations | settings, background |

Pure logic lives in `src/lib/` with no Chrome or DOM dependencies where possible, so it can be unit-tested: settings schema and defaults, shortcut matching/conflicts, subtitle file parsing, context-window selection, prompt building, Study Log grouping.

### 6.3 Messaging

- **Overlay ↔ page bridge:** `CustomEvent`s on `document` with a LingoFlix-specific event name, request/response correlated by id. Bridge requests: `seek(ms)`, `play()`, `pause()`, `getState()` → `{ currentTimeMs, paused, videoId, textTrack }`, `getSubtitleSource()` → `{ videoId, trackId, language, url }`, `getTitle()` → title metadata. (Pulled on demand rather than pushed as events, so nothing is missed before the overlay listens; answers are shape-checked because they come from the page.) All bridge times are episode time — the clock Netflix's `seek()` takes (`getSegmentTime()`), which can differ from `getCurrentTime()` by a lead-in (`docs/netflix-internals.md`, "Two clocks").
- **Overlay ↔ background (explanations):** a `chrome.runtime` Port named `explain`, one per request. Overlay sends `{ type: "start", request }` or `{ type: "follow-up", entryId, question, sections }`; the background rebuilds the conversation from the saved entry. Background sends `{ type: "delta", text }`, `{ type: "done", entry }` (the saved Study Log entry), `{ type: "error", code, message }`. Disconnecting the port aborts the request.
- **Overlay ↔ background (other):** `chrome.runtime.sendMessage` for Study Log lookup, shadowing commands (`start`, `stop`, `play`, `discard`, forwarded to the offscreen document), and opening the options page.

### 6.4 Storage

| Data | Area | Notes |
|---|---|---|
| Settings (enabled, theme, pauseOnHover, explanationLanguage, cardSections, shortcuts, seek seconds, rewind/forward modes, subtitlesHidden) | `chrome.storage.sync` | small; follows the user's Chrome profile |
| API key | `chrome.storage.local` (`apiKey`) | never synced; read only by background |
| Study Log entries | `chrome.storage.local` (`log:{id}`) | `unlimitedStorage` |

Settings are read through one typed module that fills defaults for missing fields, so adding a setting later needs no migration.

## 7. Claude integration

### 7.1 Model and limits

- Model: `claude-sonnet-5-5` (single constant in `src/lib/config.ts`).
- `max_tokens`: 1024 for explanations and follow-ups. Streaming always on.

### 7.2 Explanation request

**System prompt** (assembled from enabled sections):

> You are a language tutor helping a learner understand dialogue from a show or film they are watching on Netflix. Write your entire answer in {explanation language}; quote words from the original line in their original language. Use the surrounding dialogue and the title information to work out the speaker, the tone, and what the line actually means in this scene. Text in square brackets is a sound description or speaker label, not dialogue. Be concise — the learner has paused the video. Use Markdown with exactly these sections, in this order, with headings written in {explanation language}: {enabled section list with one-sentence descriptions from §5.3}.

**User message:**

```
Title: Stranger Things — Season 1, Episode 3 "Holly, Jolly"   (or: Movie: <title>)
Dialogue (the line to explain is marked with >>>):
  <up to 6 lines before>
>>> I'm gonna call it a night.
  <up to 6 lines after>
```

### 7.3 Follow-up request

Same system prompt with an added instruction to answer the learner's question directly and briefly; messages are `[user: initial request, assistant: explanation, user: q1, assistant: a1, …, user: new question]`.

### 7.4 Errors

| Condition | Card shows |
|---|---|
| No key stored | "Add your Claude API key" + **Open Settings** (no request made) |
| 401 | "Your API key was rejected" + **Open Settings** |
| 429 / 529 | "Claude is busy right now" + **Retry** |
| Network failure / timeout (30 s without a stream event) | "Couldn't reach Claude" + **Retry** |
| Other API error | Anthropic's error message verbatim (e.g. insufficient credit) |

## 8. Netflix integration

### 8.1 Reading subtitles (always on)

A `MutationObserver` on Netflix's subtitle container emits the current line (text joined across spans) and when it appeared/disappeared (video time from the bridge). A rolling history keeps the last 50 lines of the current video. Line text is normalized (whitespace collapsed, trimmed) for comparisons.

### 8.2 Capturing the subtitle file (best effort, for context)

- The page bridge watches Netflix's manifest data for text tracks and their downloadable URLs, and reports the URL for the currently selected subtitle language (from the player's current text track).
- The overlay fetches and parses it (TTML/IMSC or WebVTT) into cues `{ startMs, endMs, text }`.
- **Validation:** the track is used only if the cue at the current time matches the line Netflix is displaying. On mismatch, it is discarded.
- **Context window:** up to 6 cues before and 6 after the target cue. Without a valid track: up to 6 lines before from rolling history, none after.
- Line start/end for Replay and Shadowing come from the cue; without a track, from observed appearance/disappearance times (start minus 300 ms).

### 8.3 Title metadata

From the player's video metadata via the page bridge (series ID/title, season, episode number/title, movie vs episode), falling back to the title shown in the player UI, then to `document.title`.

### 8.4 Seeking and playback

Through Netflix's internal player API via the page bridge. Setting `video.currentTime` directly is not used: it triggers a Netflix playback error. If the player API is unavailable, LingoFlix stops intercepting seek keys (they fall through to Netflix's default 10 s) and shows a one-time notice.

### 8.5 Navigation

Netflix is a single-page app. LingoFlix detects `videoId` changes (URL `/watch/{id}` and bridge state) and resets history, captured track, metadata, open card, and shadowing panel. The overlay remounts if the player container is replaced.

### 8.6 Things to verify first (implementation phase 0)

These depend on Netflix internals and are verified on real Netflix (requires the user's login) before building on them:

1. Current subtitle container selectors and DOM shape.
2. Player API path and methods for seek/play/pause/current time/current text track.
3. Where text-track download URLs appear, which formats are offered, and that the files can be fetched from the content script (otherwise the page bridge fetches them).
4. Where title metadata (series/season/episode) is exposed.
5. That a capture-phase `window` listener at `document_start` preempts Netflix's key handling.
6. Which element Netflix makes fullscreen (overlay must mount inside it).
7. ~~That `/watch/{id}?t={seconds}` starts playback at that time.~~ Verified 2026-10-10: it does not; §5.5 uses a pending seek instead.

If any check fails, the affected behavior uses the fallback already defined above; the spec is updated if a fallback is insufficient.

## 9. Error handling summary

| Situation | Behavior |
|---|---|
| No / rejected key, API busy, network, other API errors | §7.4 |
| Player API missing | Seek keys fall through to Netflix; one-time notice |
| Subtitle file capture fails or mismatches | Silent fallback to rolling history |
| Image-based subtitles / no subtitle text | Card: "This title's subtitles can't be read as text" |
| Mic permission missing / denied | Opens / links to `#/microphone` |
| New episode without reload | Full reset (§8.5) |
| Extension disabled | No listeners intercept anything; Netflix behaves normally |

## 10. Privacy and permissions

- **Permissions:** `storage`, `unlimitedStorage`, `offscreen`; host permissions `https://www.netflix.com/*` and `https://api.anthropic.com/*`. Microphone access is a runtime prompt on the extension's own page.
- The API key is stored in `chrome.storage.local`, read only by the background worker, and sent only to `api.anthropic.com`.
- Subtitle text, surrounding dialogue, and title info are sent to Anthropic only when the user requests an explanation or follow-up.
- Voice recordings exist only in memory and are discarded immediately.
- No analytics, no LingoFlix server. Study Log is local only.
- A privacy policy page (hosted on `jaycho1214.github.io`) states the above for the Chrome Web Store listing.

## 11. Testing

- **Unit (Vitest):** subtitle file parsing (TTML and WebVTT fixtures), context-window selection and track validation, shortcut matching and conflict detection, prompt building with each section on/off, Study Log grouping/sorting/delete/reset, settings defaults.
- **End-to-end (Playwright, built extension loaded in Chromium):** a test build adds `http://localhost/*` to content-script matches and points the API base URL at a local mock Anthropic server. A fake Netflix page reproduces the subtitle DOM and a mock player API. Covers: hover → pause → streamed card → saved to Study Log → instant on re-hover; shortcut overrides (seek amount, toggle, replay, explain); follow-up appended; Study Log tree and Reset all; error cards for missing key and 401.
- **Manual checklist on real Netflix:** phase-0 checks (§8.6), one series episode and one movie, fullscreen, next-episode navigation, shadowing round trip.

## 12. Project layout

```
lingoflix/
  wxt.config.ts
  package.json
  src/
    entrypoints/
      background.ts
      netflix-bridge.content.ts      # MAIN world
      netflix.content/               # isolated world + React overlay
      offscreen/                     # recorder
      popup/
      options/                       # Settings, Study Log, #/microphone
    lib/
      config.ts                      # model id, donation URLs, API base URL
      settings.ts
      shortcuts.ts
      subtitles/                     # watcher, track parser, context
      bridge/                        # protocol types + client
      claude/                        # prompt builder, streaming client
      study-log/                     # store, grouping
    components/                      # shared UI
  tests/
    unit/
    e2e/                             # fake Netflix page, mock Anthropic server
  docs/superpowers/specs/
```

## 13. Build order

Each step leaves a working, loadable extension:

0. **Verify Netflix internals** (§8.6) with a throwaway probe script; record findings in this spec.
1. **Scaffold** — WXT + React + Tailwind + Vitest; settings module; popup and options shells; donation buttons.
2. **Playback control** — page bridge (seek/play/pause/state); shortcut engine and recorder; rewind/forward; subtitle toggle.
3. **Subtitles** — watcher + rolling history; replay line; subtitle file capture, parsing, validation, context window; title metadata.
4. **Explain** — background Claude client with streaming; API key settings + Test key; hover detection and pause rules; explanation card; Explain shortcut; follow-ups; error cards.
5. **Study Log** — auto-save, instant lookup, Regenerate; Study Log tab with tree, open-at-moment, deletes, Reset all.
6. **Shadowing** — offscreen recorder, microphone permission page, shadowing panel and playback sequence.
7. **Hardening and release** — Playwright end-to-end suite, manual Netflix checklist, privacy policy page, store listing assets.
