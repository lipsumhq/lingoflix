# LingoFlix Plan 2 — Subtitles, Explain, and Study Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Netflix, hover a subtitle line (or press E) to get a streamed Claude explanation that uses the surrounding dialogue, ask follow-up questions, jump line by line (A/D, or ←/→ in "One line" mode), and find every explained line later in a Study Log organized by series → season → episode.

**Architecture:** The MAIN-world page bridge gains three things: it captures subtitle-file URLs from Netflix's manifest (a `JSON.parse`/`Response.json` hook installed at `document_start`), reads title metadata, and reports the current text track. The isolated content script watches the subtitle DOM into a rolling history, loads and validates the subtitle file for context and line timing, and renders a React overlay (WXT shadow-root UI) inside Netflix's player: a hover engine, the explanation card and follow-ups. The background service worker is the only reader of the API key. It streams Claude (`@anthropic-ai/sdk`) over an `explain` Port and owns Study Log writes. The options page gains API key and explanation settings, the Rewind/Forward mode switch, and the Study Log tab.

**Tech Stack:** Plan 1's stack (WXT 0.21.4, React 19.3.0, TypeScript 6.0.3, Tailwind 4.3.3, Vitest 5.0.3 + happy-dom + Testing Library, lucide-react 1.48.0, pnpm), plus `@anthropic-ai/sdk` 0.128.0 and `react-markdown` 10.1.0.

**Spec:** `docs/superpowers/specs/2026-10-09-lingoflix-design.md`. This plan implements build-order steps 3–5 of §13 and line navigation (§5.1.1, added 2026-10-10). Plan 3 covers shadowing (§5.6), the Playwright suite, and release.

## Global Constraints

- The spec is the authority; read the sections each task names. Netflix facts come from `docs/netflix-internals.md`.
- Model `claude-sonnet-5-5` (constant `CLAUDE_MODEL` in `src/lib/config.ts`), `max_tokens` 1024, streaming always on. A request with no stream event for 30 s is aborted and shown as "Couldn't reach Claude".
- **API key:** stored only in `chrome.storage.local` under `apiKey` and read only by the background worker. It is sent only to `https://api.anthropic.com` and is never logged, never posted to a content script, and never shown in full (masked `sk-ant-…abcd`).
- Prompts follow spec §7.2/§7.3 wording verbatim. Error copy follows §7.4 verbatim: "Add your Claude API key", "Your API key was rejected", "Claude is busy right now", "Couldn't reach Claude", or Anthropic's message verbatim.
- **Hover:** hit-test against subtitle text rects padded by 8 px; dwell 400 ms before explaining; 300 ms grace before closing. Pause on hover defaults to on. Playback resumes only if LingoFlix paused it.
- **Context:** up to 6 cues before and 6 after the target cue. Without a valid track, use up to 6 lines before from the rolling history (last 50 lines of this video) and none after. An observed line starts 300 ms before it appeared.
- **Times:** every time stored, compared, or seeked to is episode time — the bridge's clock (`getSegmentTime()`, see `docs/netflix-internals.md` "Two clocks"). Never read or set `<video>.currentTime`.
- **Study Log:** stored in `chrome.storage.local`, one key per entry `log:{id}`, plus a lookup index `logkey:{videoId}|{language}|{normalized phrase}` → id. Requires the `unlimitedStorage` permission and never leaves the machine.
- **Pending seek** ("Open at this moment"): `chrome.storage.session` key `pendingSeek` = `{ videoId, timeMs, createdAt }`, ignored after 2 minutes.
- **Manifest after this plan:** permissions `storage`, `unlimitedStorage`; host permissions `https://www.netflix.com/*`, `https://api.anthropic.com/*`. (`offscreen` arrives with Plan 3.)
- **Default shortcuts:** Rewind ← 5 s, Forward → 5 s, Show / hide subtitles C, Replay line R, Explain line E, Previous line A, Next line D. Rewind/Forward mode defaults to Seconds.
- **Markdown:** rendered with `react-markdown`, `skipHtml`, links rendered as plain text (nothing navigates the Netflix tab).
- **On-Netflix UI:** dark tokens only, font stack `ui-rounded, system-ui, sans-serif`. Sizes in px, because Netflix's root font size is not ours. Lucide icons; no emoji anywhere in the UI.
- **Look and feel** for the popup and options page: spec §5.10. Reuse `src/components/styles.ts` classes (`buttonPrimary`, `buttonSecondary`, `card`, `keycap`, `iconTile`, `focusRing`).
- **Dependencies:** pin exact versions (`pnpm add --save-exact`), and pick only releases at least 2 weeks old.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Typing a follow-up with a Korean/Japanese/Chinese IME.** The Enter that commits a composition must not send the question, and Space or letters typed in the box never reach Netflix (no pause, no seek). Tests: Task 11, "Enter during IME composition does not send"; Task 10, "keys and clicks inside the overlay never reach Netflix".
2. **Two speakers' lines on screen at once** (two cues shown together). The card explains the whole displayed text, the track still validates, and the context is centered on the first of the two cues. Test: Task 4, "matches when two cues are displayed together".
3. **Switching subtitle language mid-episode.** The next explanation and line jump use the new track (reloaded and re-validated), not the old one. Test: Task 6, "reloads the subtitle file when the text track changes".
4. **The background worker restarts, or the port drops mid-stream.** The card shows "Couldn't reach Claude" with Retry instead of spinning forever, and nothing half-written is saved. Tests: Task 11, "a dropped port shows Couldn't reach Claude"; Task 9, "disconnect aborts the request and saves nothing".
5. **Small (not fullscreen) player or a long explanation.** The card stays inside the player, never goes above its top edge, and scrolls internally. Test: Task 11, "keeps the card inside a small player".

---

## File Structure

```
scripts/netflix-probe-plan2.js                 # Task 1: subtitle-file, clock, and isolation probe
docs/netflix-internals.md                      # Task 1 (rows 3, 8–10), Task 14
src/
  assets/tokens.css, theme.css                 # Task 10: shared tokens + Tailwind theme map (split out of tailwind.css)
  assets/tailwind.css                          # Task 10: imports tokens/theme
  lib/
    languages.ts                               # Task 2: ~30 explanation languages, UI-language mapping
    shortcuts.ts, settings.ts                  # Task 2: new actions, modes, explanation settings, keep-unknown-fields writes
    subtitles/cue.ts                           # Task 3: Cue type, normalizeLine
    subtitles/ttml.ts, webvtt.ts, parse.ts     # Task 3: subtitle file parsers
    subtitles/history.ts                       # Task 4: rolling history of observed lines
    subtitles/context.ts                       # Task 4: cue matching, track validation, context window, line timing
    subtitles/navigation.ts                    # Task 4: previous/next line targets
    netflix/selectors.ts                       # Task 5/10: + player container selector
    netflix/manifest.ts                        # Task 5: text tracks from Netflix's manifest
    netflix/title.ts                           # Task 5: TitleInfo from metadata / DOM, prompt title line
    bridge/protocol.ts, player.ts              # Task 5: text track, subtitle source, title
    study-log/types.ts, store.ts               # Task 7: entries, lookup index, CRUD
    study-log/group.ts, format.ts              # Task 7: series → season → episode tree, timestamps
    config.ts                                  # Task 8: + Claude constants
    claude/prompt.ts, protocol.ts, errors.ts   # Task 8: prompts, port messages, error mapping
    claude/client.ts                           # Task 9: thin @anthropic-ai/sdk wrapper
    claude/explain-service.ts                  # Task 9: port handler (stream, timeout, abort, save)
    api-key.ts, pending-seek.ts                # Task 9
    messages.ts                                # Task 9: background request/response types + sendToBackground
    background/message-handler.ts              # Task 9
  components/Markdown.tsx                      # Task 11: safe Markdown (card + Study Log)
  components/ConfirmDialog.tsx                 # Task 13
  entrypoints/
    background.ts                              # Task 9
    netflix-bridge.content.ts                  # Task 5
    netflix.content/
      index.ts, controller.ts, keyboard.ts     # Tasks 2, 6, 10, 13
      subtitle-dom.ts                          # Task 6: read/watch the displayed subtitle
      subtitle-session.ts                      # Task 6: history + track loading + resolve/navigate
      pending-seek-runner.ts                   # Task 13
      overlay/overlay.css, mount.tsx           # Task 10: Netflix styles, shadow-root mount
      overlay/hit-test.ts, hover.ts            # Task 10: hover engine
      overlay/pause.ts, isolate.ts             # Task 10: pause rule, event isolation
      overlay/store.ts, card-state.ts          # Task 11
      overlay/positioning.ts                   # Task 11
      overlay/explain-port.ts                  # Task 11: one Port per request
      overlay/explain-controller.ts            # Task 11: lookup, stream, Regenerate, follow-ups
      overlay/runtime.ts                       # Task 11: hover/shortcut/Escape/click-outside rules
      overlay/Card.tsx, OverlayApp.tsx         # Task 11
    options/ApiKeyCard.tsx, ExplanationsCard.tsx                        # Task 12
    options/StudyLogTab.tsx, StudyLogTree.tsx, StudyLogEntries.tsx     # Task 13
    options/App.tsx, SettingsTab.tsx           # Tasks 2, 12, 13
    popup/App.tsx                              # Task 12
tests/unit/*.test.ts(x)
```

---
### Task 1: Verify the Netflix internals Plan 2 depends on

Spec §8.6 items 3 (text-track URLs, formats, fetchability) and the open questions from `docs/netflix-internals.md`:
- Do subtitle cue times use the episode clock?
- Can keys and clicks inside our overlay be kept away from Netflix?
- What is Netflix's root font size?

This task needs the user's logged-in Chrome. Ask your human partner to run the probe and paste the output. Tasks 2, 3, 4 and 7 don't depend on it and may proceed while you wait. **Do not start Task 5 (or anything after it) until this task's doc update is committed.**

**Files:**
- Create: `scripts/netflix-probe-plan2.js`
- Modify: `docs/netflix-internals.md`

**Interfaces:**
- Consumes: nothing.
- Produces: verified facts that Tasks 5, 6, 10 and 11 rely on. Record them in `docs/netflix-internals.md`:
  - row 3: manifest hook, track id key, profiles
  - row 8: cue clock
  - row 9: event isolation
  - row 10: root font size

- [ ] **Step 1: Write the probe**

`scripts/netflix-probe-plan2.js`:

```js
// LingoFlix — Netflix internals probe for Plan 2 (v3). Read-only, except a test box it adds and removes.
//
// 1. Open a SERIES episode at https://www.netflix.com/watch/<id>. Turn subtitles on (a text language, not "Off").
// 2. DevTools → Console → paste this whole file → Enter.
// 3. In the player, open the episode list and click a DIFFERENT episode (Netflix switches without reloading).
//    Let it play until a subtitle line is on screen, then pause with Space while the line is still visible.
// 4. Run:  await lfProbe.report()   → copy the JSON it prints.
// 5. Run:  lfProbe.isolationTest()  → click inside the yellow box at the top of the player, press Space twice,
//    then run:  lfProbe.isolationResult()  → copy what it prints.
// 6. Run:  lfProbe.restore()
(() => {
  const captured = [];
  const inspect = (value, via) => {
    try {
      const root = value && (value.result ?? value);
      if (root && Array.isArray(root.timedtexttracks)) {
        captured.push({ via, movieId: root.movieId ?? null, tracks: root.timedtexttracks });
      }
    } catch {}
  };

  const origParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const value = origParse.call(this, text, reviver);
    if (typeof text === 'string' && text.includes('timedtexttracks')) inspect(value, 'JSON.parse');
    return value;
  };
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    return origJson.call(this).then((value) => {
      inspect(value, 'Response.json');
      return value;
    });
  };

  const api = () => netflix.appContext.state.playerApp.getAPI().videoPlayer;
  const player = () => {
    const ids = api().getAllPlayerSessionIds().filter((s) => s.startsWith('watch'));
    return api().getVideoPlayerBySessionId(ids.at(-1));
  };
  const redact = (url) => {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}${u.pathname.slice(0, 40)}… (${u.search.length} query chars)`;
    } catch {
      return String(url).slice(0, 60);
    }
  };
  const urlsOf = (d) => [...(d?.urls ?? []).map((u) => u?.url ?? u), ...Object.values(d?.downloadUrls ?? {})].filter((u) => typeof u === 'string');
  const summarizeTrack = (t) => ({
    keys: Object.keys(t),
    new_track_id: t.new_track_id,
    id: t.id,
    trackId: t.trackId,
    language: t.language,
    languageDescription: t.languageDescription,
    rawTrackType: t.rawTrackType,
    trackType: t.trackType,
    isNoneTrack: t.isNoneTrack,
    isForcedNarrative: t.isForcedNarrative,
    isImageBased: t.isImageBased,
    downloadables: Object.fromEntries(
      Object.entries(t.ttDownloadables ?? {}).map(([profile, d]) => [
        profile,
        { keys: Object.keys(d ?? {}), firstUrl: urlsOf(d).slice(0, 1).map(redact), isImage: d?.isImage },
      ]),
    ),
  });

  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const compareClock = (body, displayed, p) => {
    const tickRate = Number(/tickRate="(\d+)"/.exec(body)?.[1] ?? 0);
    const toMs = (v) => {
      if (!v) return null;
      let m;
      if ((m = /^(\d+(?:\.\d+)?)t$/.exec(v))) return tickRate ? Math.round((Number(m[1]) / tickRate) * 1000) : null;
      if ((m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v))) return Math.round((+m[1] * 3600 + +m[2] * 60 + Number(m[3])) * 1000);
      if ((m = /^(\d+(?:\.\d+)?)(h|m|s|ms)$/.exec(v))) return Math.round(Number(m[1]) * { h: 3600000, m: 60000, s: 1000, ms: 1 }[m[2]]);
      return null;
    };
    const cues = [...body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].map(([, attrs, inner]) => ({
      begin: toMs(/\bbegin="([^"]+)"/.exec(attrs)?.[1]),
      end: toMs(/\bend="([^"]+)"/.exec(attrs)?.[1]),
      text: norm(inner.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')),
    }));
    const target = norm(displayed);
    const seg = p.getSegmentTime();
    const cur = p.getCurrentTime();
    const matches = cues.filter((c) => c.text && target && (c.text === target || target.includes(c.text)));
    const best = matches.sort((a, b) => Math.abs(a.begin - seg) - Math.abs(b.begin - seg))[0] ?? null;
    return {
      tickRate,
      cueCount: cues.length,
      firstCue: cues[0] ?? null,
      matchedCue: best,
      segmentTime: seg,
      currentTime: cur,
      segMinusCueBegin: best ? seg - best.begin : null,
      curMinusCueBegin: best ? cur - best.begin : null,
    };
  };

  let isolation = null;
  window.lfProbe = {
    async report() {
      const p = player();
      const current = p.getTimedTextTrack?.() ?? null;
      const displayed = [...document.querySelectorAll('.player-timedtext-text-container')].map((c) => c.innerText).join('\n');
      const last = captured.at(-1) ?? null;
      const match = last?.tracks.find((t) => current && [t.new_track_id, t.id, t.trackId].includes(current.trackId)) ?? null;
      const fetches = {};
      let clock = null;
      if (match) {
        for (const [profile, d] of Object.entries(match.ttDownloadables ?? {})) {
          const url = urlsOf(d)[0];
          if (!url) continue;
          try {
            const res = await fetch(url);
            const body = await res.text();
            fetches[profile] = { status: res.status, type: res.headers.get('content-type'), length: body.length, head: body.slice(0, 300) };
            if (!clock && /<tt[\s>]/.test(body)) clock = compareClock(body, displayed, p);
          } catch (e) {
            fetches[profile] = { error: String(e) };
          }
        }
      }
      const out = {
        probeVersion: 3,
        path: location.pathname,
        movieId: p.getMovieId?.(),
        captures: captured.map((c) => ({ via: c.via, movieId: c.movieId, trackCount: c.tracks.length })),
        currentTrack: current && {
          trackId: current.trackId,
          bcp47: current.bcp47,
          rawTrackType: current.rawTrackType,
          isImageBased: current.isImageBased,
          isNoneTrack: current.isNoneTrack,
        },
        displayed,
        matchedTrack: match ? summarizeTrack(match) : null,
        allTracks: last
          ? last.tracks.slice(0, 40).map((t) => ({
              new_track_id: t.new_track_id,
              language: t.language,
              rawTrackType: t.rawTrackType,
              isNoneTrack: t.isNoneTrack,
              isImageBased: t.isImageBased,
              profiles: Object.keys(t.ttDownloadables ?? {}),
            }))
          : null,
        fetches,
        clock,
        htmlFontSize: getComputedStyle(document.documentElement).fontSize,
        times: { segment: p.getSegmentTime(), current: p.getCurrentTime(), duration: p.getDuration() },
      };
      console.log(JSON.stringify(out, null, 2));
      return 'printed above';
    },

    isolationTest() {
      const anchor = document.querySelector('div.watch-video[data-uia="watch-video"]');
      if (!anchor) return 'no player container';
      const host = document.createElement('div');
      host.id = 'lf-probe-host';
      host.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML =
        '<input style="width:280px;padding:10px;border-radius:12px;border:3px solid #ffc800;background:#fff7d6;font:16px system-ui" placeholder="Click here, press Space twice">';
      // Same as WXT createShadowRootUi({ isolateEvents: [...] }): stop these events at the host as they bubble out.
      const stopped = ['keydown', 'keyup', 'keypress', 'click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel', 'contextmenu'];
      for (const type of stopped) host.addEventListener(type, (e) => e.stopPropagation());
      anchor.append(host);
      isolation = { pausedBefore: player().isPaused(), timeBefore: player().getSegmentTime() };
      return 'Click inside the yellow box, press Space twice, then run lfProbe.isolationResult()';
    },

    isolationResult() {
      const input = document.getElementById('lf-probe-host')?.shadowRoot?.querySelector('input');
      const out = {
        ...isolation,
        pausedAfter: player().isPaused(),
        timeAfter: player().getSegmentTime(),
        inputValue: JSON.stringify(input?.value ?? null),
      };
      console.log(JSON.stringify(out, null, 2));
      return 'printed above';
    },

    restore() {
      JSON.parse = origParse;
      Response.prototype.json = origJson;
      document.getElementById('lf-probe-host')?.remove();
      delete window.lfProbe;
      return 'restored';
    },
  };
  console.log('lfProbe ready. Switch to a different episode from the player, pause on a subtitle line, then: await lfProbe.report()');
})();
```

- [ ] **Step 2: Syntax-check it**

Run: `node --check scripts/netflix-probe-plan2.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit the probe**

```bash
git add scripts/netflix-probe-plan2.js
git commit -m "chore: add Plan 2 Netflix probe (subtitle files, cue clock, event isolation)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Human step — run the probe**

Send your human partner the six numbered steps from the probe's header, with the file path. Wait for both outputs: the `report()` JSON and the `isolationResult()` JSON.

- [ ] **Step 5: Record the findings**

In `docs/netflix-internals.md`, update the "Verified on" line and replace row 3. Add rows 8–10 to the table. Fill in the **Observed** and **OK?** cells from the pasted output, then apply these decision rules. Each rule that fires is a `Ruling:` line in your ledger.

| # | Item | LingoFlix assumes | Decision rule |
|---|------|-------------------|---------------|
| 3 | Text track download URLs | The manifest object with `timedtexttracks` passes through `JSON.parse` or `Response.json` (`captures[].via`). Each track has `new_track_id` equal to `getTimedTextTrack().trackId`. `ttDownloadables[profile]` holds the URLs in `urls[].url` or `downloadUrls{}`. At least one text profile (`dfxp*`, `imsc*`, `simplesdh`, `webvtt*`) is offered, and fetching it from the page returns 200. | Hook missing from `via` → Task 5 hooks only the one seen. Track id is under another key → add that key to `idsOf()` in Task 5. Fetch fails (CORS or a non-200 status) → Ruling: move the fetch into the background (`fetchText` message) and add host permission `https://*.nflxvideo.net/*`. That is the smallest change. |
| 8 | Cue clock | Cue times are in episode time: `clock.segMinusCueBegin` lands between 0 and the cue's duration while the line is on screen. | If instead `curMinusCueBegin` lands in that range, cues use the player clock. Ruling: Task 6's track loader shifts every cue by `−(getCurrentTime() − getSegmentTime())`, captured when the track loads. |
| 9 | Event isolation | Stopping key/click/pointer events at our shadow host (bubble phase) keeps them from Netflix: `pausedBefore === pausedAfter`, `inputValue === "\"  \""`, and `timeAfter − timeBefore` < 1000 while paused. | If playback toggled, Netflix listens in the capture phase. Ruling: Task 10 also registers a window capture `keydown`/`keyup` listener. For events whose path includes the overlay host, it calls `stopImmediatePropagation()`; it does not call `preventDefault()`. Default actions (typing) still happen. |
| 10 | Root font size | `htmlFontSize` | Informational: the overlay uses px sizes regardless (Task 10). |

Also paste the trimmed `report()` JSON under a new heading `## Raw probe output (v3, Plan 2)`. Shorten every URL and cut each `head` to 120 characters.

- [ ] **Step 6: Commit**

```bash
git add docs/netflix-internals.md
git commit -m "docs: record Plan 2 Netflix findings (subtitle files, cue clock, event isolation)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: Settings v2 — new actions, line modes, explanation settings, keep-unknown-fields writes

Spec §5.1 (new actions and defaults), §5.1.1 (Rewind/Forward modes), §5.3 (card sections, Pause on hover), §5.8 (Explanation language: ~30 languages by native name, default from the browser UI language), §6.4 (one typed settings module).

This task also fixes the deferred Plan 1 minor **M1**: saving dropped settings fields this version doesn't know, so an older LingoFlix on another computer would erase a newer one's settings through Chrome sync.

**Files:**
- Create: `src/lib/languages.ts`, `tests/unit/languages.test.ts`
- Modify: `src/lib/shortcuts.ts`, `src/lib/settings.ts`, `src/entrypoints/netflix.content/keyboard.ts`, `src/entrypoints/options/SettingsTab.tsx`
- Test: `tests/unit/settings.test.ts`, `tests/unit/shortcuts.test.ts`, `tests/unit/keyboard.test.ts`

**Interfaces:**
- Consumes: Plan 1's `Settings`, `normalizeSettings`, `updateSettings`, `saveSettings`, `ShortcutMap`.
- Produces:
  - `ActionId = 'rewind' | 'forward' | 'previousLine' | 'nextLine' | 'replayLine' | 'toggleSubtitles' | 'explainLine'`
  - `type SeekMode = 'seconds' | 'line'`
  - `interface CardSections { meaning: boolean; keyExpressions: boolean; howToUse: boolean; followUp: boolean }`
  - `CARD_SECTION_IDS`
  - `Settings` gains `rewindMode: SeekMode`, `forwardMode: SeekMode`, `pauseOnHover: boolean`, `explanationLanguage: string`, `cardSections: CardSections`
  - `normalizeSettings(raw: unknown, uiLanguage?: string): Settings`
  - `languages.ts`:
    - `interface ExplanationLanguage { code; nativeName; englishName }`
    - `EXPLANATION_LANGUAGES`
    - `isExplanationLanguage(code: unknown): code is string`
    - `languageForUi(uiLanguage: string): string`
    - `getExplanationLanguage(code: string): ExplanationLanguage`

- [ ] **Step 1: Write the failing language tests**

`tests/unit/languages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EXPLANATION_LANGUAGES, getExplanationLanguage, isExplanationLanguage, languageForUi } from '@/lib/languages';

describe('explanation languages', () => {
  it('offers about 30 languages with unique codes and native names', () => {
    expect(EXPLANATION_LANGUAGES.length).toBe(30);
    expect(new Set(EXPLANATION_LANGUAGES.map((l) => l.code)).size).toBe(30);
    expect(getExplanationLanguage('ko')).toEqual({ code: 'ko', nativeName: '한국어', englishName: 'Korean' });
  });

  it('maps a browser UI language to the closest supported one', () => {
    expect(languageForUi('ko-KR')).toBe('ko');
    expect(languageForUi('en_US')).toBe('en');
    expect(languageForUi('zh-TW')).toBe('zh-Hant');
    expect(languageForUi('zh-CN')).toBe('zh-Hans');
    expect(languageForUi('zh')).toBe('zh-Hans');
    expect(languageForUi('pt')).toBe('pt-BR');
    expect(languageForUi('pt-PT')).toBe('pt-PT');
    expect(languageForUi('nb-NO')).toBe('no');
    expect(languageForUi('fr-CA')).toBe('fr');
  });

  it('falls back to English for unknown or empty input', () => {
    expect(languageForUi('xx-YY')).toBe('en');
    expect(languageForUi('')).toBe('en');
    expect(getExplanationLanguage('klingon').code).toBe('en');
  });

  it('recognizes only listed codes', () => {
    expect(isExplanationLanguage('ja')).toBe(true);
    expect(isExplanationLanguage('JA')).toBe(false);
    expect(isExplanationLanguage(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run tests/unit/languages.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/languages"`.

- [ ] **Step 3: Implement `src/lib/languages.ts`**

```ts
export interface ExplanationLanguage {
  /** BCP 47 code stored in settings and in Study Log entries. */
  code: string;
  nativeName: string;
  englishName: string;
}

/** Languages Claude explains in (spec §5.8), shown by native name. */
export const EXPLANATION_LANGUAGES: readonly ExplanationLanguage[] = [
  { code: 'en', nativeName: 'English', englishName: 'English' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish' },
  { code: 'fr', nativeName: 'Français', englishName: 'French' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian' },
  { code: 'pt-BR', nativeName: 'Português (Brasil)', englishName: 'Brazilian Portuguese' },
  { code: 'pt-PT', nativeName: 'Português (Portugal)', englishName: 'European Portuguese' },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch' },
  { code: 'sv', nativeName: 'Svenska', englishName: 'Swedish' },
  { code: 'da', nativeName: 'Dansk', englishName: 'Danish' },
  { code: 'no', nativeName: 'Norsk', englishName: 'Norwegian' },
  { code: 'fi', nativeName: 'Suomi', englishName: 'Finnish' },
  { code: 'pl', nativeName: 'Polski', englishName: 'Polish' },
  { code: 'cs', nativeName: 'Čeština', englishName: 'Czech' },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian' },
  { code: 'uk', nativeName: 'Українська', englishName: 'Ukrainian' },
  { code: 'el', nativeName: 'Ελληνικά', englishName: 'Greek' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic' },
  { code: 'he', nativeName: 'עברית', englishName: 'Hebrew' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi' },
  { code: 'th', nativeName: 'ไทย', englishName: 'Thai' },
  { code: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese' },
  { code: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian' },
  { code: 'ms', nativeName: 'Bahasa Melayu', englishName: 'Malay' },
  { code: 'fil', nativeName: 'Filipino', englishName: 'Filipino' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean' },
  { code: 'zh-Hans', nativeName: '简体中文', englishName: 'Simplified Chinese' },
  { code: 'zh-Hant', nativeName: '繁體中文', englishName: 'Traditional Chinese' },
];

const BY_LOWER_CODE = new Map(EXPLANATION_LANGUAGES.map((l) => [l.code.toLowerCase(), l.code]));

/** Browser tags that don't match a listed code directly. */
const ALIASES: Record<string, string> = {
  pt: 'pt-BR',
  nb: 'no',
  nn: 'no',
  tl: 'fil',
  iw: 'he',
  in: 'id',
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
};

const lookup = (tag: string): string | undefined => BY_LOWER_CODE.get(tag) ?? ALIASES[tag];

export function isExplanationLanguage(code: unknown): code is string {
  return typeof code === 'string' && EXPLANATION_LANGUAGES.some((l) => l.code === code);
}

/** Closest supported language for a browser UI language such as "ko-KR" or "zh-TW"; English otherwise. */
export function languageForUi(uiLanguage: string): string {
  const tag = uiLanguage.trim().replace(/_/g, '-').toLowerCase();
  if (!tag) return 'en';
  return lookup(tag) ?? lookup(tag.split('-')[0]!) ?? 'en';
}

export function getExplanationLanguage(code: string): ExplanationLanguage {
  return EXPLANATION_LANGUAGES.find((l) => l.code === code) ?? EXPLANATION_LANGUAGES[0]!;
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `pnpm vitest run tests/unit/languages.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing shortcut, settings, and keyboard tests**

In `tests/unit/shortcuts.test.ts`, replace the `describe('defaults', …)` block:

```ts
describe('defaults', () => {
  it('binds ← → A D R C E', () => {
    expect(DEFAULT_SHORTCUTS).toEqual({
      rewind: key('ArrowLeft'),
      forward: key('ArrowRight'),
      previousLine: key('KeyA'),
      nextLine: key('KeyD'),
      replayLine: key('KeyR'),
      toggleSubtitles: key('KeyC'),
      explainLine: key('KeyE'),
    });
    expect(ACTION_IDS).toEqual(['rewind', 'forward', 'previousLine', 'nextLine', 'replayLine', 'toggleSubtitles', 'explainLine']);
  });
});
```

In `tests/unit/settings.test.ts`, add `key` to the existing `@/lib/shortcuts` import if it isn't there. Then append:

```ts
describe('explanation and line settings', () => {
  it('defaults: pause on hover on, every card section on, seconds mode, language from the browser UI', () => {
    const s = normalizeSettings(undefined, 'ko-KR');
    expect(s.pauseOnHover).toBe(true);
    expect(s.cardSections).toEqual({ meaning: true, keyExpressions: true, howToUse: true, followUp: true });
    expect(s.rewindMode).toBe('seconds');
    expect(s.forwardMode).toBe('seconds');
    expect(s.explanationLanguage).toBe('ko');
  });

  it('keeps valid values and repairs invalid ones field by field', () => {
    const s = normalizeSettings(
      {
        pauseOnHover: false,
        explanationLanguage: 'ja',
        rewindMode: 'line',
        forwardMode: 'sentence',
        cardSections: { meaning: false, howToUse: 'no', junk: 1 },
      },
      'en',
    );
    expect(s.pauseOnHover).toBe(false);
    expect(s.explanationLanguage).toBe('ja');
    expect(s.rewindMode).toBe('line');
    expect(s.forwardMode).toBe('seconds');
    expect(s.cardSections).toEqual({ meaning: false, keyExpressions: true, howToUse: true, followUp: true });
    expect(normalizeSettings({ explanationLanguage: 'klingon' }, 'fr-CA').explanationLanguage).toBe('fr');
  });

  it('gives existing users the new shortcuts unless the key is already theirs', () => {
    const fresh = normalizeSettings({ shortcuts: { rewind: key('ArrowLeft') } }, 'en');
    expect(fresh.shortcuts.explainLine).toEqual(key('KeyE'));
    expect(fresh.shortcuts.previousLine).toEqual(key('KeyA'));
    const taken = normalizeSettings({ shortcuts: { rewind: key('KeyE') } }, 'en');
    expect(taken.shortcuts.explainLine).toBeNull();
  });
});

describe('writing keeps fields from a newer LingoFlix (synced from another computer)', () => {
  const newer = {
    enabled: true,
    future: 42,
    shortcuts: { shadowLine: key('KeyV') },
    cardSections: { glossary: false },
  };

  it('updateSettings', async () => {
    await fakeBrowser.storage.sync.set({ settings: newer });
    await updateSettings((s) => ({ ...s, enabled: false }));
    const { settings: raw } = (await fakeBrowser.storage.sync.get('settings')) as { settings: Record<string, any> };
    expect(raw.enabled).toBe(false);
    expect(raw.future).toBe(42);
    expect(raw.shortcuts.shadowLine).toEqual(key('KeyV'));
    expect(raw.shortcuts.rewind).toEqual(key('ArrowLeft'));
    expect(raw.cardSections).toEqual({ glossary: false, meaning: true, keyExpressions: true, howToUse: true, followUp: true });
  });

  it('saveSettings', async () => {
    await fakeBrowser.storage.sync.set({ settings: newer });
    await saveSettings({ ...DEFAULT_SETTINGS, rewindSeconds: 3 });
    const { settings: raw } = (await fakeBrowser.storage.sync.get('settings')) as { settings: Record<string, any> };
    expect(raw.future).toBe(42);
    expect(raw.rewindSeconds).toBe(3);
    expect(raw.shortcuts.shadowLine).toEqual(key('KeyV'));
  });
});
```

In `tests/unit/keyboard.test.ts`:
- Change the `handlers` line in `setup` to:

  ```ts
  const handlers = { rewind: vi.fn(), forward: vi.fn(), toggleSubtitles: vi.fn(), replayLine: vi.fn(), explainLine: vi.fn(), nextLine: vi.fn() };
  ```

- Append this test inside `describe('keyboard shortcuts', …)`:

```ts
  it('auto-repeat: line jumps repeat, replay and explain do not', () => {
    const { handlers, press } = setup();
    press({ code: 'KeyD', key: 'd' });
    press({ code: 'KeyD', key: 'd', repeat: true });
    expect(handlers.nextLine).toHaveBeenCalledTimes(2);
    press({ code: 'KeyR', key: 'r' });
    press({ code: 'KeyR', key: 'r', repeat: true });
    press({ code: 'KeyE', key: 'e' });
    press({ code: 'KeyE', key: 'e', repeat: true });
    expect(handlers.replayLine).toHaveBeenCalledTimes(1);
    expect(handlers.explainLine).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 6: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/shortcuts.test.ts tests/unit/settings.test.ts tests/unit/keyboard.test.ts`
Expected: FAIL. The defaults test fails on the missing actions. The settings tests fail on `pauseOnHover` being undefined and `raw.future` being undefined. The keyboard test fails because `nextLine` isn't called (KeyD isn't bound).

- [ ] **Step 7: Implement the shortcut changes in `src/lib/shortcuts.ts`**

Replace the type, list, labels, and defaults at the top of the file:

```ts
export type ActionId =
  | 'rewind'
  | 'forward'
  | 'previousLine'
  | 'nextLine'
  | 'replayLine'
  | 'toggleSubtitles'
  | 'explainLine';

export interface Binding {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type ShortcutMap = Record<ActionId, Binding | null>;

export const ACTION_IDS: readonly ActionId[] = [
  'rewind',
  'forward',
  'previousLine',
  'nextLine',
  'replayLine',
  'toggleSubtitles',
  'explainLine',
];

export const ACTION_LABELS: Record<ActionId, string> = {
  rewind: 'Rewind',
  forward: 'Forward',
  previousLine: 'Previous line',
  nextLine: 'Next line',
  replayLine: 'Replay line',
  toggleSubtitles: 'Show / hide subtitles',
  explainLine: 'Explain line',
};

export function key(code: string, mods: Partial<Omit<Binding, 'code'>> = {}): Binding {
  return { code, ctrl: false, alt: false, shift: false, meta: false, ...mods };
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  rewind: key('ArrowLeft'),
  forward: key('ArrowRight'),
  previousLine: key('KeyA'),
  nextLine: key('KeyD'),
  replayLine: key('KeyR'),
  toggleSubtitles: key('KeyC'),
  explainLine: key('KeyE'),
};
```

Leave the rest of the file (`NETFLIX_DEFAULT_CODES` onward) unchanged.

- [ ] **Step 8: Rewrite `src/lib/settings.ts`**

```ts
import { browser, storage } from '#imports';
import { isExplanationLanguage, languageForUi } from './languages';
import { ACTION_IDS, DEFAULT_SHORTCUTS, sameBinding, type ActionId, type Binding, type ShortcutMap } from './shortcuts';

/** Popup and options page colors. `system` follows the OS light/dark setting. */
export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** Rewind/Forward jump by seconds or by one subtitle line (spec §5.1.1). */
export type SeekMode = 'seconds' | 'line';
export const SEEK_MODES: readonly SeekMode[] = ['seconds', 'line'];

/** Explanation card sections (spec §5.3). All on by default. */
export interface CardSections {
  meaning: boolean;
  keyExpressions: boolean;
  howToUse: boolean;
  followUp: boolean;
}
export const CARD_SECTION_IDS: readonly (keyof CardSections)[] = ['meaning', 'keyExpressions', 'howToUse', 'followUp'];

export interface Settings {
  enabled: boolean;
  theme: ThemePreference;
  shortcuts: ShortcutMap;
  rewindSeconds: number;
  forwardSeconds: number;
  rewindMode: SeekMode;
  forwardMode: SeekMode;
  subtitlesHidden: boolean;
  pauseOnHover: boolean;
  /** A code from src/lib/languages.ts. */
  explanationLanguage: string;
  cardSections: CardSections;
}

export const SEEK_SECONDS_MIN = 1;
export const SEEK_SECONDS_MAX = 60;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  theme: 'system',
  shortcuts: DEFAULT_SHORTCUTS,
  rewindSeconds: 5,
  forwardSeconds: 5,
  rewindMode: 'seconds',
  forwardMode: 'seconds',
  subtitlesHidden: false,
  pauseOnHover: true,
  explanationLanguage: 'en',
  cardSections: { meaning: true, keyExpressions: true, howToUse: true, followUp: true },
};

const SETTINGS_KEY = 'sync:settings';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function clampSeekSeconds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(SEEK_SECONDS_MAX, Math.max(SEEK_SECONDS_MIN, Math.round(value)));
}

function isBinding(value: unknown): value is Binding {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === 'string' &&
    value.code.length > 0 &&
    typeof value.ctrl === 'boolean' &&
    typeof value.alt === 'boolean' &&
    typeof value.shift === 'boolean' &&
    typeof value.meta === 'boolean'
  );
}

function normalizeShortcuts(raw: unknown): ShortcutMap {
  const source = isRecord(raw) ? raw : {};
  const result = {} as ShortcutMap;
  const missing: ActionId[] = [];

  for (const id of ACTION_IDS) {
    const value = source[id];
    if (value === null) result[id] = null;
    else if (isBinding(value))
      result[id] = { code: value.code, ctrl: value.ctrl, alt: value.alt, shift: value.shift, meta: value.meta };
    else missing.push(id);
  }

  // A default can collide with a key the user already assigned elsewhere; leave it unbound then.
  for (const id of missing) {
    const fallback = DEFAULT_SHORTCUTS[id];
    const taken =
      fallback !== null &&
      ACTION_IDS.some((other) => {
        const bound = result[other];
        return other !== id && bound != null && sameBinding(bound, fallback);
      });
    result[id] = taken ? null : fallback;
  }
  return result;
}

function normalizeCardSections(raw: unknown): CardSections {
  const source = isRecord(raw) ? raw : {};
  const result = { ...DEFAULT_SETTINGS.cardSections };
  for (const id of CARD_SECTION_IDS) {
    const value = source[id];
    if (typeof value === 'boolean') result[id] = value;
  }
  return result;
}

const seekMode = (value: unknown): SeekMode => (SEEK_MODES.includes(value as SeekMode) ? (value as SeekMode) : 'seconds');

/** The browser's UI language; `chrome.i18n` is missing in some test environments. */
function browserUiLanguage(): string {
  try {
    return browser.i18n.getUILanguage();
  } catch {
    return 'en';
  }
}

export function normalizeSettings(raw: unknown, uiLanguage: string = browserUiLanguage()): Settings {
  const r = isRecord(raw) ? raw : {};
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SETTINGS.enabled,
    theme: THEME_PREFERENCES.includes(r.theme as ThemePreference) ? (r.theme as ThemePreference) : DEFAULT_SETTINGS.theme,
    shortcuts: normalizeShortcuts(r.shortcuts),
    rewindSeconds: clampSeekSeconds(r.rewindSeconds, DEFAULT_SETTINGS.rewindSeconds),
    forwardSeconds: clampSeekSeconds(r.forwardSeconds, DEFAULT_SETTINGS.forwardSeconds),
    rewindMode: seekMode(r.rewindMode),
    forwardMode: seekMode(r.forwardMode),
    subtitlesHidden: typeof r.subtitlesHidden === 'boolean' ? r.subtitlesHidden : DEFAULT_SETTINGS.subtitlesHidden,
    pauseOnHover: typeof r.pauseOnHover === 'boolean' ? r.pauseOnHover : DEFAULT_SETTINGS.pauseOnHover,
    explanationLanguage: isExplanationLanguage(r.explanationLanguage) ? r.explanationLanguage : languageForUi(uiLanguage),
    cardSections: normalizeCardSections(r.cardSections),
  };
}

/**
 * Settings sync across the user's computers, which may run different LingoFlix versions. Keep the
 * fields (and one level of nested fields, e.g. shortcuts of newer actions) this version doesn't know.
 */
function mergeForWrite(stored: unknown, next: Settings): Record<string, unknown> {
  const base = isRecord(stored) ? stored : {};
  const out: Record<string, unknown> = { ...base };
  for (const [field, value] of Object.entries(next)) {
    const previous = base[field];
    out[field] = isRecord(value) && isRecord(previous) ? { ...previous, ...value } : value;
  }
  return out;
}

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await storage.getItem(SETTINGS_KEY));
}

export async function saveSettings(settings: Settings): Promise<void> {
  const stored = await storage.getItem(SETTINGS_KEY);
  await storage.setItem(SETTINGS_KEY, mergeForWrite(stored, normalizeSettings(settings)));
}

export async function updateSettings(update: (current: Settings) => Settings): Promise<Settings> {
  const stored = await storage.getItem(SETTINGS_KEY);
  const next = normalizeSettings(update(normalizeSettings(stored)));
  await storage.setItem(SETTINGS_KEY, mergeForWrite(stored, next));
  return next;
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return storage.watch(SETTINGS_KEY, (value) => callback(normalizeSettings(value)));
}
```

- [ ] **Step 9: Stop replay and explain from auto-repeating**

In `src/entrypoints/netflix.content/keyboard.ts`, replace the `NO_REPEAT` line:

```ts
/** Actions that must not auto-repeat while the key is held. Seeks and line jumps do repeat. */
const NO_REPEAT: ReadonlySet<ActionId> = new Set<ActionId>(['toggleSubtitles', 'replayLine', 'explainLine']);
```

- [ ] **Step 10: Give the new actions a row on the Settings page**

In `src/entrypoints/options/SettingsTab.tsx`:

1. Change the lucide import to:

   ```ts
   import {
     Captions,
     FastForward,
     MessageSquareText,
     Monitor,
     Moon,
     Repeat,
     Rewind,
     RotateCcw,
     SkipBack,
     SkipForward,
     Sun,
     type LucideIcon,
   } from 'lucide-react';
   ```

2. Replace `ACTION_ICONS` with:

```ts
const ACTION_ICONS: Record<ActionId, ReactNode> = {
  rewind: <Rewind size={20} strokeWidth={2.5} fill="currentColor" aria-hidden />,
  forward: <FastForward size={20} strokeWidth={2.5} fill="currentColor" aria-hidden />,
  previousLine: <SkipBack size={20} strokeWidth={2.5} fill="currentColor" aria-hidden />,
  nextLine: <SkipForward size={20} strokeWidth={2.5} fill="currentColor" aria-hidden />,
  replayLine: <Repeat size={20} strokeWidth={2.5} aria-hidden />,
  toggleSubtitles: <Captions size={20} strokeWidth={2.5} aria-hidden />,
  explainLine: <MessageSquareText size={20} strokeWidth={2.5} aria-hidden />,
};

const ACTION_HINTS: Partial<Record<ActionId, string>> = {
  previousLine: 'Back to the line before.',
  nextLine: 'On to the next line.',
  replayLine: 'Hear the current line again.',
  toggleSubtitles: 'Test your ears, then peek.',
  explainLine: 'Explain the current line.',
};
```

3. In `actionDetail`, replace the final `return 'Test your ears, then peek.';` with `return ACTION_HINTS[action] ?? null;`.

Task 12 adds the Seconds / One line switch to the Rewind and Forward rows.

- [ ] **Step 11: Run the tests to make sure they pass**

Run: `pnpm vitest run tests/unit/languages.test.ts tests/unit/shortcuts.test.ts tests/unit/settings.test.ts tests/unit/keyboard.test.ts`
Expected: PASS.

- [ ] **Step 12: Run the whole suite and the type-check**

Run: `pnpm test && pnpm compile`
Expected: all tests pass; `tsc` prints nothing.

- [ ] **Step 13: Commit**

```bash
git add src/lib/languages.ts src/lib/shortcuts.ts src/lib/settings.ts src/entrypoints/netflix.content/keyboard.ts src/entrypoints/options/SettingsTab.tsx tests/unit/languages.test.ts tests/unit/shortcuts.test.ts tests/unit/settings.test.ts tests/unit/keyboard.test.ts
git commit -m "feat: settings for line jumps, explanations, and new shortcuts; keep unknown synced fields" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Subtitle file parsing (TTML/IMSC and WebVTT)

Spec §8.2: "The overlay fetches and parses it (TTML/IMSC or WebVTT) into cues `{ startMs, endMs, text }`." This is pure string parsing with no DOM, so it runs in content scripts and tests alike. Netflix's DFXP uses tick times (`ttp:tickRate="10000000"`, `begin="25000000t"`); IMSC uses clock times.

**Files:**
- Create: `src/lib/subtitles/cue.ts`, `src/lib/subtitles/ttml.ts`, `src/lib/subtitles/webvtt.ts`, `src/lib/subtitles/parse.ts`
- Test: `tests/unit/subtitle-parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Cue { startMs: number; endMs: number; text: string }`. Text keeps line breaks as `\n`.
  - `normalizeLine(text: string): string`
  - `decodeEntities(text: string): string`
  - `parseTtmlTime(value: string | undefined, base: { tickRate: number; frameRate: number }): number | null`
  - `parseTtml(xml: string): Cue[]` and `parseWebVtt(text: string): Cue[]`, each sorted by `startMs`
  - `parseSubtitleFile(body: string): Cue[]`, which sniffs `WEBVTT`

- [ ] **Step 1: Write the failing tests**

`tests/unit/subtitle-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeLine } from '@/lib/subtitles/cue';
import { parseSubtitleFile } from '@/lib/subtitles/parse';
import { parseTtml, parseTtmlTime } from '@/lib/subtitles/ttml';
import { parseWebVtt } from '@/lib/subtitles/webvtt';

const NETFLIX_DFXP = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000" xml:lang="en">
<body><div>
<p begin="25000000t" end="43750000t" region="region_00" xml:id="subtitle0"><span style="style_0">Where are you going?</span></p>
<p begin="45000000t" end="61250000t" xml:id="subtitle1"><span>I'm gonna call it</span><br/><span>a night.</span></p>
<p begin="70000000t" end="82500000t"><span>Tom &amp; Jerry&#39;s &lt;place&gt;</span></p>
<p begin="90000000t" end="91000000t"><span>   </span></p>
</div></body></tt>`;

const IMSC = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="00:01:02.500" end="00:01:04.000">[door slams]</p>
<p begin="00:00:59.000" dur="1.5s">- Hi.<br/>- Hello.</p>
<p begin="00:01:10.000">no end</p>
</div></body></tt>`;

const VTT = `WEBVTT

NOTE produced by a test

1
00:00:01.000 --> 00:00:02.500 position:50% line:85%
<c.white>Hello</c> <i>there</i>
second line

01:01.250 --> 01:03.000
Fish &amp; chips
`;

describe('normalizeLine', () => {
  it('collapses line breaks and whitespace and drops zero-width characters', () => {
    expect(normalizeLine("  I'm gonna\ncall it​  a night. ")).toBe("I'm gonna call it a night.");
  });
});

describe('parseTtmlTime', () => {
  const base = { tickRate: 10_000_000, frameRate: 24 };
  it('reads ticks, offsets, and clock times', () => {
    expect(parseTtmlTime('25000000t', base)).toBe(2500);
    expect(parseTtmlTime('12.5s', base)).toBe(12_500);
    expect(parseTtmlTime('500ms', base)).toBe(500);
    expect(parseTtmlTime('1.5m', base)).toBe(90_000);
    expect(parseTtmlTime('00:01:02.250', base)).toBe(62_250);
    expect(parseTtmlTime('00:00:01:12', base)).toBe(1500); // 12 frames at 24 fps
  });
  it('rejects junk', () => {
    expect(parseTtmlTime('soon', base)).toBeNull();
    expect(parseTtmlTime(undefined, base)).toBeNull();
  });
});

describe('parseTtml', () => {
  it("parses Netflix's DFXP: tick times, <br/> line breaks, entities; drops empty cues", () => {
    expect(parseTtml(NETFLIX_DFXP)).toEqual([
      { startMs: 2500, endMs: 4375, text: 'Where are you going?' },
      { startMs: 4500, endMs: 6125, text: "I'm gonna call it\na night." },
      { startMs: 7000, endMs: 8250, text: "Tom & Jerry's <place>" },
    ]);
  });

  it('parses IMSC clock times and dur, sorts by start, skips cues without an end', () => {
    expect(parseTtml(IMSC)).toEqual([
      { startMs: 59_000, endMs: 60_500, text: '- Hi.\n- Hello.' },
      { startMs: 62_500, endMs: 64_000, text: '[door slams]' },
    ]);
  });

  it('handles prefixed tags and source formatting whitespace', () => {
    const xml = `<tt:tt xmlns:tt="http://www.w3.org/ns/ttml"><tt:body><tt:div>
<tt:p begin="1s" end="2s">
    <tt:span>Hello</tt:span>
    <tt:span>there</tt:span>
</tt:p></tt:div></tt:body></tt:tt>`;
    expect(parseTtml(xml)).toEqual([{ startMs: 1000, endMs: 2000, text: 'Hello there' }]);
  });
});

describe('parseWebVtt', () => {
  it('parses cues, strips tags and settings, decodes entities, skips NOTE blocks', () => {
    expect(parseWebVtt(VTT)).toEqual([
      { startMs: 1000, endMs: 2500, text: 'Hello there\nsecond line' },
      { startMs: 61_250, endMs: 63_000, text: 'Fish & chips' },
    ]);
  });
});

describe('parseSubtitleFile', () => {
  it('sniffs the format', () => {
    expect(parseSubtitleFile(VTT)).toHaveLength(2);
    expect(parseSubtitleFile(`﻿${VTT}`)).toHaveLength(2);
    expect(parseSubtitleFile(NETFLIX_DFXP)).toHaveLength(3);
    expect(parseSubtitleFile('not subtitles')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/subtitle-parse.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/subtitles/cue"`.

- [ ] **Step 3: Implement `src/lib/subtitles/cue.ts`**

```ts
/** One subtitle line from a subtitle file. Times are episode time in ms; `text` keeps line breaks as "\n". */
export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

/** Comparable form of a line: line breaks and whitespace runs become one space; zero-width characters go. */
export function normalizeLine(text: string): string {
  return text.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Implement `src/lib/subtitles/ttml.ts`**

```ts
import type { Cue } from './cue';

interface TimeBase {
  tickRate: number;
  frameRate: number;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** TTML time expressions: ticks ("25000000t"), offsets ("12.5s", "500ms", "1.5m", "2h", "30f"), clock ("00:01:02.250", "00:00:01:12"). */
export function parseTtmlTime(value: string | undefined, base: TimeBase): number | null {
  if (!value) return null;
  const v = value.trim();
  let m = /^(\d+(?:\.\d+)?)t$/.exec(v);
  if (m) return base.tickRate > 0 ? Math.round((Number(m[1]) / base.tickRate) * 1000) : null;
  m = /^(\d+(?:\.\d+)?)(h|m|s|ms|f)$/.exec(v);
  if (m) {
    const n = Number(m[1]);
    const unitMs = { h: 3_600_000, m: 60_000, s: 1000, ms: 1, f: 1000 / base.frameRate }[m[2] as 'h' | 'm' | 's' | 'ms' | 'f'];
    return Math.round(n * unitMs);
  }
  m = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+)|:(\d+(?:\.\d+)?))?$/.exec(v);
  if (m) {
    const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const fraction = m[4] ? Number(`0.${m[4]}`) : m[5] ? Number(m[5]) / base.frameRate : 0;
    return Math.round((seconds + fraction) * 1000);
  }
  return null;
}

/** Attribute value by local name, ignoring any namespace prefix (`ttp:tickRate`, `begin`). */
function attrValue(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[1] ?? m[2]) : undefined;
}

export function parseTtml(xml: string): Cue[] {
  const ttTag = /<(?:[\w.-]+:)?tt\b[^>]*>/.exec(xml)?.[0] ?? '';
  const base: TimeBase = {
    tickRate: Number(attrValue(ttTag, 'tickRate')) || 1,
    frameRate: Number(attrValue(ttTag, 'frameRate')) || 30,
  };
  const cues: Cue[] = [];
  const paragraph = /<(?:[\w.-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?p>/g;
  for (const [, attrs = '', inner = ''] of xml.matchAll(paragraph)) {
    const startMs = parseTtmlTime(attrValue(attrs, 'begin'), base);
    let endMs = parseTtmlTime(attrValue(attrs, 'end'), base);
    const durMs = parseTtmlTime(attrValue(attrs, 'dur'), base);
    if (endMs === null && startMs !== null && durMs !== null) endMs = startMs + durMs;
    if (startMs === null || endMs === null || endMs < startMs) continue;
    // Source whitespace is insignificant; <br/> is the only line break.
    const withBreaks = inner.replace(/\s+/g, ' ').replace(/<(?:[\w.-]+:)?br\b[^>]*>/g, '\n');
    const text = decodeEntities(withBreaks.replace(/<[^>]+>/g, ''))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    if (text) cues.push({ startMs, endMs, text });
  }
  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
```

- [ ] **Step 5: Implement `src/lib/subtitles/webvtt.ts`**

```ts
import type { Cue } from './cue';
import { decodeEntities } from './ttml';

const TIMING = /^((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/;

function vttTime(value: string): number {
  const parts = value.replace(',', '.').split(':').map(Number);
  const seconds = parts.pop() ?? 0;
  const minutes = parts.pop() ?? 0;
  const hours = parts.pop() ?? 0;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

export function parseWebVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex < 0) continue; // header, NOTE, STYLE, REGION
    const [, start = '', end = ''] = TIMING.exec(lines[timingIndex]!)!;
    const body = lines
      .slice(timingIndex + 1)
      .map((line) => decodeEntities(line.replace(/<[^>]+>/g, '')).trim())
      .filter(Boolean)
      .join('\n');
    if (body) cues.push({ startMs: vttTime(start), endMs: vttTime(end), text: body });
  }
  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
```

- [ ] **Step 6: Implement `src/lib/subtitles/parse.ts`**

```ts
import type { Cue } from './cue';
import { parseTtml } from './ttml';
import { parseWebVtt } from './webvtt';

/** Parses a downloaded subtitle file. WebVTT is recognized by its header; anything else is treated as TTML/IMSC. */
export function parseSubtitleFile(body: string): Cue[] {
  return /^﻿?WEBVTT/.test(body) ? parseWebVtt(body) : parseTtml(body);
}
```

- [ ] **Step 7: Run the tests to make sure they pass**

Run: `pnpm vitest run tests/unit/subtitle-parse.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/subtitles tests/unit/subtitle-parse.test.ts
git commit -m "feat: parse Netflix subtitle files (TTML/IMSC and WebVTT) into cues" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Line history, context selection, and line navigation (pure)

Spec sections this task implements:
- §8.1: rolling history of the last 50 lines; normalized comparisons.
- §8.2: track validation; a context window of 6 before and 6 after; the fallback to history; line start = appearance − 300 ms.
- §5.1 "current line".
- §5.1.1: Previous/Next line targets.

Everything here is pure: no DOM, no Chrome APIs.

**Files:**
- Create: `src/lib/subtitles/history.ts`, `src/lib/subtitles/context.ts`, `src/lib/subtitles/navigation.ts`
- Test: `tests/unit/subtitle-context.test.ts`

**Interfaces:**
- Consumes: `Cue`, `normalizeLine` (Task 3).
- Produces:
  - `interface ObservedLine { text: string; normalized: string; shownAtMs: number | null; hiddenAtMs: number | null }`
  - `interface LineHistory { observe(text, atMs); displayed(); current(); before(line, count); all(); clear() }` and `createLineHistory(limit = 50)`
  - `interface DialogueContext { before: string[]; after: string[] }`
  - `interface LineTiming { startMs: number; endMs: number | null }`
  - `interface LineDetails { context: DialogueContext; timing: LineTiming | null; fromTrack: boolean }`
  - `findCue(cues, normalizedLine, atMs, toleranceMs?): number`
  - `trackMatchesLine(cues, line): boolean`
  - `describeLine(line, cues | null, history): LineDetails`
  - `CONTEXT_LINES = 6` and `OBSERVED_START_LEAD_MS = 300`
  - `interface TimedLine { startMs: number; endMs: number }`
  - `cuesAsTimedLines(cues)` and `historyAsTimedLines(lines)`
  - `previousLineStart(lines, atMs): number | null` and `nextLineStart(lines, atMs): number | null`

- [ ] **Step 1: Write the failing tests**

`tests/unit/subtitle-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OBSERVED_START_LEAD_MS, describeLine, findCue, trackMatchesLine } from '@/lib/subtitles/context';
import type { Cue } from '@/lib/subtitles/cue';
import { createLineHistory } from '@/lib/subtitles/history';
import { cuesAsTimedLines, historyAsTimedLines, nextLineStart, previousLineStart } from '@/lib/subtitles/navigation';

// Line i runs from 1000 + 3000·i to 3000 + 3000·i.
const CUES: Cue[] = Array.from({ length: 15 }, (_, i) => ({ startMs: 1000 + i * 3000, endMs: 3000 + i * 3000, text: `Line ${i}` }));

function observeAll(texts: [string, number][]) {
  const history = createLineHistory();
  for (const [text, at] of texts) history.observe(text, at);
  return history;
}

describe('line history', () => {
  it('records each displayed line with when it appeared and disappeared', () => {
    const h = observeAll([
      ['Hello', 1000],
      ['', 2500],
      ['World\nagain', 3000],
    ]);
    expect(h.all().map((l) => [l.text, l.shownAtMs, l.hiddenAtMs])).toEqual([
      ['Hello', 1000, 2500],
      ['World\nagain', 3000, null],
    ]);
    expect(h.displayed()?.normalized).toBe('World again');
  });

  it('ignores repeated reports of the same text (Netflix re-renders the same line)', () => {
    const h = observeAll([
      ['Hello', 1000],
      ['Hello ', 1100],
      [' Hello', 1200],
    ]);
    expect(h.all()).toHaveLength(1);
  });

  it('current() is the displayed line, else the most recent one', () => {
    const h = observeAll([
      ['Hello', 1000],
      ['', 2000],
    ]);
    expect(h.displayed()).toBeNull();
    expect(h.current()?.text).toBe('Hello');
  });

  it('keeps the last 50 lines and lists earlier lines oldest first', () => {
    const h = createLineHistory();
    for (let i = 0; i < 60; i++) h.observe(`L${i}`, i * 1000);
    expect(h.all()).toHaveLength(50);
    expect(h.all()[0]!.text).toBe('L10');
    const last = h.current()!;
    expect(h.before(last, 3).map((l) => l.text)).toEqual(['L56', 'L57', 'L58']);
  });
});

describe('findCue / trackMatchesLine', () => {
  it('finds the cue with the same text around the observed time', () => {
    expect(findCue(CUES, 'Line 7', 22_100)).toBe(7);
  });

  it('does not match the same words much later in the episode', () => {
    const cues: Cue[] = [
      { startMs: 1000, endMs: 2000, text: 'Yes.' },
      { startMs: 50_000, endMs: 51_000, text: 'Yes.' },
    ];
    expect(findCue(cues, 'Yes.', 50_200)).toBe(1);
    expect(findCue(cues, 'No.', 1000)).toBe(-1);
  });

  it('a track is used only if it matches the displayed line', () => {
    const h = observeAll([['Line 7', 22_100]]);
    expect(trackMatchesLine(CUES, h.current()!)).toBe(true);
    const other = observeAll([['Something else', 22_100]]);
    expect(trackMatchesLine(CUES, other.current()!)).toBe(false);
    const untimed = observeAll([['Line 7', null as unknown as number]]);
    expect(trackMatchesLine(CUES, untimed.current()!)).toBe(false);
  });
});

describe('describeLine', () => {
  it('uses up to 6 cues before and after, and the cue timing', () => {
    const h = observeAll([['Line 7', 22_100]]);
    expect(describeLine(h.current()!, CUES, h)).toEqual({
      context: {
        before: ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6'],
        after: ['Line 8', 'Line 9', 'Line 10', 'Line 11', 'Line 12', 'Line 13'],
      },
      timing: { startMs: 22_000, endMs: 24_000 },
      fromTrack: true,
    });
  });

  it('matches when two cues are displayed together (two speakers)', () => {
    const cues: Cue[] = [
      { startMs: 1000, endMs: 3000, text: 'Hello.' },
      { startMs: 1200, endMs: 3200, text: 'Who is it?' },
      { startMs: 4000, endMs: 5000, text: 'Me.' },
    ];
    const h = observeAll([['Hello.\nWho is it?', 1300]]);
    expect(describeLine(h.current()!, cues, h)).toEqual({
      context: { before: [], after: ['Me.'] },
      timing: { startMs: 1000, endMs: 3200 },
      fromTrack: true,
    });
  });

  it('without a usable track: up to 6 history lines before, none after, start 300 ms early', () => {
    const h = createLineHistory();
    for (let i = 0; i < 8; i++) {
      h.observe(`Seen ${i}`, 10_000 + i * 2000);
      h.observe('', 11_000 + i * 2000);
    }
    const line = h.current()!;
    expect(describeLine(line, null, h)).toEqual({
      context: { before: ['Seen 1', 'Seen 2', 'Seen 3', 'Seen 4', 'Seen 5', 'Seen 6'], after: [] },
      timing: { startMs: 24_000 - OBSERVED_START_LEAD_MS, endMs: 25_000 },
      fromTrack: false,
    });
  });

  it('a line whose time is unknown has no timing', () => {
    const h = observeAll([['Hello', null as unknown as number]]);
    expect(describeLine(h.current()!, null, h).timing).toBeNull();
  });
});

describe('line navigation', () => {
  const lines = cuesAsTimedLines(CUES);

  it('previous: inside a line → the line before; between lines → the most recent line', () => {
    expect(previousLineStart(lines, 22_500)).toBe(19_000); // inside Line 7 → Line 6
    expect(previousLineStart(lines, 24_500)).toBe(22_000); // after Line 7 ended → Line 7
    expect(previousLineStart(lines, 22_000)).toBe(19_000); // just jumped to Line 7 → Line 6 (repeat presses walk back)
  });

  it('previous: nothing before the first line', () => {
    expect(previousLineStart(lines, 500)).toBeNull();
    expect(previousLineStart(lines, 1500)).toBeNull();
  });

  it('next: the first line that starts after now', () => {
    expect(nextLineStart(lines, 22_500)).toBe(25_000);
    expect(nextLineStart(lines, 22_000)).toBe(25_000); // just jumped to Line 7 → Line 8
    expect(nextLineStart(lines, 50_000)).toBeNull();
  });

  it('history lines start 300 ms early, merge rewatched duplicates, and skip untimed lines', () => {
    const h = createLineHistory();
    h.observe('A', 10_000);
    h.observe('B', 12_000);
    h.observe('', 15_000);
    h.observe('A', 10_100); // rewound and saw A again
    h.observe('Untimed', null as unknown as number);
    expect(historyAsTimedLines(h.all())).toEqual([
      { startMs: 9700, endMs: 12_000 },
      { startMs: 11_700, endMs: 15_000 },
    ]);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/subtitle-context.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/subtitles/context"`.

- [ ] **Step 3: Implement `src/lib/subtitles/history.ts`**

```ts
import { normalizeLine } from './cue';

/** A subtitle line as seen on screen. Times are episode ms from the page bridge, or null if it couldn't be read. */
export interface ObservedLine {
  /** As displayed, trimmed; line breaks kept. */
  text: string;
  normalized: string;
  shownAtMs: number | null;
  /** Null while still on screen. */
  hiddenAtMs: number | null;
}

export const HISTORY_LIMIT = 50;

export interface LineHistory {
  /** Report what Netflix displays now ("" for nothing). Repeats of the same text are ignored. */
  observe(text: string, atMs: number | null): void;
  /** The line on screen, or null between lines. */
  displayed(): ObservedLine | null;
  /** The line on screen, else the most recently displayed one (spec §5.1 "current line"). */
  current(): ObservedLine | null;
  /** Up to `count` lines shown before `line`, oldest first. */
  before(line: ObservedLine, count: number): ObservedLine[];
  all(): readonly ObservedLine[];
  clear(): void;
}

export function createLineHistory(limit = HISTORY_LIMIT): LineHistory {
  let lines: ObservedLine[] = [];
  let shown: ObservedLine | null = null;

  return {
    observe(text, atMs) {
      const normalized = normalizeLine(text);
      if (shown && shown.normalized === normalized) return;
      if (shown) {
        shown.hiddenAtMs = atMs;
        shown = null;
      }
      if (!normalized) return;
      shown = { text: text.trim(), normalized, shownAtMs: atMs, hiddenAtMs: null };
      lines.push(shown);
      if (lines.length > limit) lines = lines.slice(-limit);
    },
    displayed: () => shown,
    current: () => shown ?? lines.at(-1) ?? null,
    before(line, count) {
      const index = lines.indexOf(line);
      const end = index < 0 ? lines.length : index;
      return lines.slice(Math.max(0, end - count), end);
    },
    all: () => lines,
    clear() {
      lines = [];
      shown = null;
    },
  };
}
```

- [ ] **Step 4: Implement `src/lib/subtitles/context.ts`**

```ts
import { normalizeLine, type Cue } from './cue';
import type { LineHistory, ObservedLine } from './history';

export const CONTEXT_LINES = 6;
/** An observed line starts this much before it appeared (spec §8.2). */
export const OBSERVED_START_LEAD_MS = 300;
/** Slack when matching an observed time to a cue's time range. */
export const CUE_MATCH_TOLERANCE_MS = 1500;

export interface DialogueContext {
  before: string[];
  after: string[];
}

export interface LineTiming {
  startMs: number;
  endMs: number | null;
}

export interface LineDetails {
  context: DialogueContext;
  /** Null when the line's time couldn't be read from the player. */
  timing: LineTiming | null;
  /** True when context and timing came from the subtitle file. */
  fromTrack: boolean;
}

/**
 * Index of the cue Netflix displays as `normalizedLine` around `atMs`, or -1. Netflix may show two cues at
 * once (two speakers), so a cue contained in the displayed text also matches; an exact match wins,
 * otherwise the earliest contained cue.
 */
export function findCue(cues: readonly Cue[], normalizedLine: string, atMs: number, toleranceMs = CUE_MATCH_TOLERANCE_MS): number {
  if (!normalizedLine) return -1;
  let contained = -1;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]!;
    if (cue.startMs - toleranceMs > atMs) break; // cues are sorted by start
    if (cue.endMs + toleranceMs < atMs) continue;
    const text = normalizeLine(cue.text);
    if (text === normalizedLine) return i;
    if (contained < 0 && text && normalizedLine.includes(text)) contained = i;
  }
  return contained;
}

/** Spec §8.2 validation: a subtitle file is used only if it has the line Netflix displayed, at that time. */
export function trackMatchesLine(cues: readonly Cue[], line: ObservedLine): boolean {
  return line.shownAtMs !== null && findCue(cues, line.normalized, line.shownAtMs) >= 0;
}

/** Context and timing for a line: from the subtitle file when it matches, else from the rolling history. */
export function describeLine(line: ObservedLine, cues: readonly Cue[] | null, history: Pick<LineHistory, 'before'>): LineDetails {
  const at = line.shownAtMs;
  const first = cues && at !== null ? findCue(cues, line.normalized, at) : -1;
  if (cues && first >= 0) {
    // Include cues shown together with the first one (two speakers) in the line itself, not in "after".
    let last = first;
    while (last + 1 < cues.length) {
      const next = cues[last + 1]!;
      if (next.startMs > cues[last]!.endMs + CUE_MATCH_TOLERANCE_MS) break;
      if (!line.normalized.includes(normalizeLine(next.text))) break;
      last++;
    }
    return {
      context: {
        before: cues.slice(Math.max(0, first - CONTEXT_LINES), first).map((c) => c.text),
        after: cues.slice(last + 1, last + 1 + CONTEXT_LINES).map((c) => c.text),
      },
      timing: { startMs: cues[first]!.startMs, endMs: cues[last]!.endMs },
      fromTrack: true,
    };
  }
  return {
    context: { before: history.before(line, CONTEXT_LINES).map((l) => l.text), after: [] },
    timing: at === null ? null : { startMs: Math.max(0, at - OBSERVED_START_LEAD_MS), endMs: line.hiddenAtMs },
    fromTrack: false,
  };
}
```

- [ ] **Step 5: Implement `src/lib/subtitles/navigation.ts`**

```ts
import { OBSERVED_START_LEAD_MS } from './context';
import type { Cue } from './cue';
import type { ObservedLine } from './history';

/** A line with known timing, from the subtitle file or from what was seen on screen. Sorted by start. */
export interface TimedLine {
  startMs: number;
  endMs: number;
}

/** A seek that lands on a line's start counts as being on that line. */
const ON_LINE_SLACK_MS = 250;
/** Two observations of the same moment (e.g. after rewinding) closer than this are one line. */
const DUPLICATE_WITHIN_MS = 500;

export function cuesAsTimedLines(cues: readonly Cue[]): TimedLine[] {
  return cues.map(({ startMs, endMs }) => ({ startMs, endMs }));
}

/** Lines seen so far: start 300 ms before they appeared; the one still on screen runs open-ended. */
export function historyAsTimedLines(lines: readonly ObservedLine[]): TimedLine[] {
  const timed = lines
    .filter((l): l is ObservedLine & { shownAtMs: number } => l.shownAtMs !== null)
    .map((l) => ({
      startMs: Math.max(0, l.shownAtMs - OBSERVED_START_LEAD_MS),
      endMs: l.hiddenAtMs ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.startMs - b.startMs);
  const merged: TimedLine[] = [];
  for (const line of timed) {
    const last = merged.at(-1);
    if (last && line.startMs - last.startMs < DUPLICATE_WITHIN_MS) continue;
    merged.push(line);
  }
  return merged;
}

/** Spec §5.1.1 Previous line: inside a line → the line before it; between lines → the most recent line. */
export function previousLineStart(lines: readonly TimedLine[], atMs: number): number | null {
  let latest = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startMs <= atMs + ON_LINE_SLACK_MS) latest = i;
    else break;
  }
  if (latest < 0) return null;
  const onLine = atMs < lines[latest]!.endMs;
  const target = onLine ? lines[latest - 1] : lines[latest];
  return target ? target.startMs : null;
}

/** Spec §5.1.1 Next line: the first line that starts after now. */
export function nextLineStart(lines: readonly TimedLine[], atMs: number): number | null {
  for (const line of lines) if (line.startMs > atMs + ON_LINE_SLACK_MS) return line.startMs;
  return null;
}
```

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `pnpm vitest run tests/unit/subtitle-context.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/subtitles/history.ts src/lib/subtitles/context.ts src/lib/subtitles/navigation.ts tests/unit/subtitle-context.test.ts
git commit -m "feat: subtitle history, context window, track validation, and line navigation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Page bridge v2 — subtitle-file capture, title metadata, current text track

Spec §6.2 (the page bridge captures subtitle-file URLs and title metadata), §8.2, §8.3. Also `docs/netflix-internals.md` rows 3 and 4 (row 3 as recorded in Task 1). **Prerequisite:** Task 1's doc commit. If row 3 names a different track-id key or a single hook, apply that ruling here.

Two deviations from the spec's messaging section (§6.3), to record as rulings:
- The bridge *answers* `getSubtitleSource()` and `getTitle()` instead of emitting `track-available`/`metadata` events. Pulling never misses an event that fired before the overlay listened.
- Results crossing from the page are validated (`parseSubtitleSource`, `parseTitleInfo`). This is the Plan 1 carry-over "page scripts can forge bridge responses".

**Files:**
- Create: `src/lib/netflix/manifest.ts`, `src/lib/netflix/title.ts`
- Modify: `src/lib/bridge/protocol.ts`, `src/lib/bridge/player.ts`, `src/entrypoints/netflix-bridge.content.ts`
- Test: `tests/unit/manifest.test.ts`, `tests/unit/title.test.ts`, `tests/unit/bridge.test.ts`

**Interfaces:**
- Consumes: Plan 1's `createPlayerMethods`, `findPlayer`, `serveBridge`, and `PlayerState`.
- Produces:
  - `title.ts`:
    - `interface TitleInfo { videoId: string; kind: 'episode' | 'movie'; seriesId: string | null; seriesTitle: string; seasonNumber: number | null; episodeNumber: number | null; episodeTitle: string | null }`
    - `titleFromMetadata(video: unknown, videoId: string): TitleInfo | null`
    - `titleFromDom(doc: Document, videoId: string): TitleInfo | null`
  - `manifest.ts`:
    - `interface CapturedTrack { ids: string[]; language: string; isImageBased: boolean; isNone: boolean; urls: string[] }`
    - `interface CapturedManifest { movieId: string; tracks: CapturedTrack[] }`
    - `extractTextTracks(parsed: unknown): CapturedManifest | null`
    - `installManifestCapture(win, onManifest): () => void`
    - `createManifestStore(limit?)`
  - `protocol.ts`:
    - `interface TextTrackInfo { trackId: string; language: string; isImageBased: boolean; isNone: boolean }`
    - `PlayerState` gains `textTrack: TextTrackInfo | null`
    - `interface SubtitleSource { videoId: string; trackId: string; language: string; url: string }`
    - `BridgeMethods` gains `getSubtitleSource(): SubtitleSource | null` and `getTitle(): TitleInfo | null`
    - `parseSubtitleSource(value: unknown): SubtitleSource | null` and `parseTitleInfo(value: unknown): TitleInfo | null`
  - `player.ts`:
    - `interface PlayerSources { getManifest(movieId: string): CapturedManifest | undefined; getMetadataVideo(videoId: string): unknown; getDocument(): Document | null }`
    - `createPlayerMethods(getPlayer, getVideoId, sources?: PlayerSources)`
    - `metadataVideoFrom(netflix: unknown, videoId: string): unknown`

- [ ] **Step 1: Write the failing manifest and title tests**

`tests/unit/manifest.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createManifestStore, extractTextTracks, installManifestCapture } from '@/lib/netflix/manifest';

const MANIFEST = {
  result: {
    movieId: 82028220,
    timedtexttracks: [
      {
        new_track_id: 'T:1:0;1;en;1;1;0;',
        id: 'T:1:0;1;en;1;1;0;',
        language: 'en',
        rawTrackType: 'closedcaptions',
        isNoneTrack: false,
        ttDownloadables: {
          'nflx-cmisc': { isImage: true, urls: [{ url: 'https://ipv4-c1.oca.nflxvideo.net/img?o=1' }] },
          'imsc1.1': { urls: [{ cdn_id: 1, url: 'https://ipv4-c1.oca.nflxvideo.net/imsc?o=1' }] },
          'dfxp-ls-sdh': { downloadUrls: { 1: 'https://ipv4-c1.oca.nflxvideo.net/dfxp?o=1' } },
        },
      },
      {
        new_track_id: 'T:1:1;1;ja;0;0;0;',
        language: 'ja',
        isNoneTrack: false,
        ttDownloadables: { 'nflx-cmisc': { isImage: true, urls: [{ url: 'https://ipv4-c1.oca.nflxvideo.net/ja?o=1' }] } },
      },
      { new_track_id: 'T:1:2;1;none;0;0;0;', language: 'none', isNoneTrack: true, ttDownloadables: {} },
      { language: 'de' }, // no id → skipped
    ],
  },
};

describe('extractTextTracks', () => {
  it('lists text tracks with their ids and text-file URLs, best format first', () => {
    expect(extractTextTracks(MANIFEST)).toEqual({
      movieId: '82028220',
      tracks: [
        {
          ids: ['T:1:0;1;en;1;1;0;', 'T:1:0;1;en;1;1;0;'],
          language: 'en',
          isImageBased: false,
          isNone: false,
          urls: ['https://ipv4-c1.oca.nflxvideo.net/dfxp?o=1', 'https://ipv4-c1.oca.nflxvideo.net/imsc?o=1'],
        },
        { ids: ['T:1:1;1;ja;0;0;0;'], language: 'ja', isImageBased: true, isNone: false, urls: [] },
        { ids: ['T:1:2;1;none;0;0;0;'], language: 'none', isImageBased: false, isNone: true, urls: [] },
      ],
    });
  });

  it('accepts the manifest without the result wrapper and ignores everything else', () => {
    expect(extractTextTracks(MANIFEST.result)?.movieId).toBe('82028220');
    expect(extractTextTracks({ result: { movieId: 1 } })).toBeNull();
    expect(extractTextTracks('nope')).toBeNull();
    expect(extractTextTracks({ timedtexttracks: [] })).toBeNull(); // no movieId
  });
});

describe('installManifestCapture', () => {
  it('reports manifests that pass through JSON.parse and leaves other parsing alone', () => {
    const win = { JSON: { parse: JSON.parse } } as unknown as Parameters<typeof installManifestCapture>[0];
    const seen = vi.fn();
    const restore = installManifestCapture(win, seen);
    expect(win.JSON.parse('{"a":1}')).toEqual({ a: 1 });
    expect(seen).not.toHaveBeenCalled();
    win.JSON.parse(JSON.stringify(MANIFEST));
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ movieId: '82028220' }));
    expect(() => win.JSON.parse('{bad')).toThrow(SyntaxError);
    restore();
    expect(win.JSON.parse).toBe(JSON.parse);
  });

  it('reports manifests read with Response.json()', async () => {
    class FakeResponse {
      json() {
        return Promise.resolve(structuredClone(MANIFEST));
      }
    }
    const originalJson = FakeResponse.prototype.json;
    const win = { JSON: { parse: JSON.parse }, Response: FakeResponse } as unknown as Parameters<typeof installManifestCapture>[0];
    const seen = vi.fn();
    const restore = installManifestCapture(win, seen);
    expect(await new FakeResponse().json()).toEqual(MANIFEST);
    expect(seen).toHaveBeenCalledTimes(1);
    restore();
    expect(FakeResponse.prototype.json).toBe(originalJson);
  });

  it('a broken manifest never breaks Netflix', () => {
    const win = { JSON: { parse: JSON.parse } } as unknown as Parameters<typeof installManifestCapture>[0];
    installManifestCapture(win, () => {
      throw new Error('sink failed');
    });
    expect(() => win.JSON.parse(JSON.stringify(MANIFEST))).not.toThrow();
  });
});

describe('createManifestStore', () => {
  it('keeps the latest manifests by movie id', () => {
    const store = createManifestStore(2);
    store.add({ movieId: '1', tracks: [] });
    store.add({ movieId: '2', tracks: [] });
    store.add({ movieId: '3', tracks: [] });
    expect(store.get('1')).toBeUndefined();
    expect(store.get('3')).toEqual({ movieId: '3', tracks: [] });
  });
});
```

`tests/unit/title.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { titleFromDom, titleFromMetadata } from '@/lib/netflix/title';

afterEach(() => {
  document.body.innerHTML = '';
});

const SHOW = {
  title: 'Stranger Things',
  type: 'show',
  id: 80057281,
  currentEpisode: 80077211,
  seasons: [
    { seq: 1, episodes: [{ id: 80077209, seq: 1, title: 'The Vanishing of Will Byers' }, { id: 80077211, seq: 3, title: 'Holly, Jolly' }] },
  ],
};

describe('titleFromMetadata', () => {
  it('finds the series, season, and episode of the video being watched', () => {
    expect(titleFromMetadata(SHOW, '80077211')).toEqual({
      videoId: '80077211',
      kind: 'episode',
      seriesId: '80057281',
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      episodeTitle: 'Holly, Jolly',
    });
  });

  it('a movie is its own title', () => {
    expect(titleFromMetadata({ title: 'Roma', type: 'movie', id: 80240715 }, '80240715')).toEqual({
      videoId: '80240715',
      kind: 'movie',
      seriesId: null,
      seriesTitle: 'Roma',
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null,
    });
  });

  it('a show whose episode list lacks the video still names the series', () => {
    expect(titleFromMetadata(SHOW, '999')).toMatchObject({ kind: 'episode', seriesTitle: 'Stranger Things', seasonNumber: null });
  });

  it('returns null for missing or unexpected metadata', () => {
    expect(titleFromMetadata(undefined, '1')).toBeNull();
    expect(titleFromMetadata({ type: 'show' }, '1')).toBeNull();
  });
});

describe('titleFromDom', () => {
  it("reads the player's title block: series, S:E label, episode title", () => {
    document.body.innerHTML =
      '<div data-uia="video-title"><h4>Stranger Things</h4><span>S1:E3</span><span>Holly, Jolly</span></div>';
    expect(titleFromDom(document, '80077211')).toEqual({
      videoId: '80077211',
      kind: 'episode',
      seriesId: null,
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      episodeTitle: 'Holly, Jolly',
    });
  });

  it('a single-season show shows only "E1"', () => {
    document.body.innerHTML = '<div data-uia="video-title"><h4>A Different World</h4><span>E1</span><span>Pilot</span></div>';
    expect(titleFromDom(document, '1')).toMatchObject({ seasonNumber: null, episodeNumber: 1, episodeTitle: 'Pilot' });
  });

  it('a movie title has no heading', () => {
    document.body.innerHTML = '<div data-uia="video-title">Roma</div>';
    expect(titleFromDom(document, '2')).toMatchObject({ kind: 'movie', seriesTitle: 'Roma' });
  });

  it('returns null when the title block is not on the page', () => {
    expect(titleFromDom(document, '1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/manifest.test.ts tests/unit/title.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/netflix/manifest"` (and `title`).

- [ ] **Step 3: Implement `src/lib/netflix/title.ts`**

```ts
/** What the learner is watching (spec §5.5 entry fields, §8.3). */
export interface TitleInfo {
  videoId: string;
  kind: 'episode' | 'movie';
  seriesId: string | null;
  /** Series title, or the movie title. */
  seriesTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const idString = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : null;

/** From `videoMetadata[videoId]._metadataObject.video` (docs/netflix-internals.md row 4). */
export function titleFromMetadata(video: unknown, videoId: string): TitleInfo | null {
  if (!isRecord(video) || typeof video.title !== 'string' || !video.title) return null;
  if (video.type === 'movie') {
    return { videoId, kind: 'movie', seriesId: null, seriesTitle: video.title, seasonNumber: null, episodeNumber: null, episodeTitle: null };
  }
  if (video.type !== 'show') return null;
  const base: TitleInfo = {
    videoId,
    kind: 'episode',
    seriesId: idString(video.id),
    seriesTitle: video.title,
    seasonNumber: null,
    episodeNumber: null,
    episodeTitle: null,
  };
  for (const season of Array.isArray(video.seasons) ? video.seasons : []) {
    if (!isRecord(season) || !Array.isArray(season.episodes)) continue;
    for (const episode of season.episodes) {
      if (!isRecord(episode)) continue;
      if (idString(episode.id) !== videoId && idString(episode.episodeId) !== videoId) continue;
      return {
        ...base,
        seasonNumber: typeof season.seq === 'number' ? season.seq : null,
        episodeNumber: typeof episode.seq === 'number' ? episode.seq : null,
        episodeTitle: typeof episode.title === 'string' ? episode.title : null,
      };
    }
  }
  return base;
}

const EPISODE_LABEL = /^(?:S(\d+)\s*:\s*)?E(\d+)$/i;

/** Fallback: the player's title block `[data-uia="video-title"]` = h4 (series) + "S1:E3"/"E1" + episode title. */
export function titleFromDom(doc: Document, videoId: string): TitleInfo | null {
  const block = doc.querySelector('[data-uia="video-title"]');
  if (!block) return null;
  const heading = block.querySelector('h4')?.textContent?.trim();
  if (heading) {
    const spans = [...block.querySelectorAll('span')].map((s) => s.textContent?.trim() ?? '').filter(Boolean);
    const label = spans.map((s) => EPISODE_LABEL.exec(s)).find((m) => m !== null) ?? null;
    return {
      videoId,
      kind: 'episode',
      seriesId: null,
      seriesTitle: heading,
      seasonNumber: label?.[1] ? Number(label[1]) : null,
      episodeNumber: label?.[2] ? Number(label[2]) : null,
      episodeTitle: spans.find((s) => !EPISODE_LABEL.test(s)) ?? null,
    };
  }
  const text = block.textContent?.trim();
  return text
    ? { videoId, kind: 'movie', seriesId: null, seriesTitle: text, seasonNumber: null, episodeNumber: null, episodeTitle: null }
    : null;
}
```

- [ ] **Step 4: Implement `src/lib/netflix/manifest.ts`**

```ts
/** A subtitle track as listed in Netflix's manifest (docs/netflix-internals.md row 3). */
export interface CapturedTrack {
  /** Every id Netflix uses for the track; the player's `getTimedTextTrack().trackId` is one of them. */
  ids: string[];
  language: string;
  isImageBased: boolean;
  isNone: boolean;
  /** Text subtitle file URLs, best format first. */
  urls: string[];
}

export interface CapturedManifest {
  movieId: string;
  tracks: CapturedTrack[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text profiles we can parse, best first. Image profiles (e.g. `nflx-cmisc`) are not text. */
const TEXT_PROFILES = [/^dfxp/, /^imsc/, /^simplesdh/, /^webvtt/, /ttml/];

function idsOf(track: Record<string, unknown>): string[] {
  return ['new_track_id', 'id', 'trackId']
    .map((key) => track[key])
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .map(String);
}

function urlsOf(download: unknown): string[] {
  if (!isRecord(download)) return [];
  const listed = Array.isArray(download.urls) ? download.urls.map((u) => (isRecord(u) ? u.url : u)) : [];
  const mapped = isRecord(download.downloadUrls) ? Object.values(download.downloadUrls) : [];
  return [...listed, ...mapped].filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));
}

export function extractTextTracks(parsed: unknown): CapturedManifest | null {
  if (!isRecord(parsed)) return null;
  const root = isRecord(parsed.result) ? parsed.result : parsed;
  if (!Array.isArray(root.timedtexttracks)) return null;
  const movieId = root.movieId;
  if (typeof movieId !== 'string' && typeof movieId !== 'number') return null;

  const tracks: CapturedTrack[] = [];
  for (const raw of root.timedtexttracks) {
    if (!isRecord(raw)) continue;
    const ids = idsOf(raw);
    if (!ids.length) continue;
    const downloads = isRecord(raw.ttDownloadables) ? Object.entries(raw.ttDownloadables) : [];
    const text = downloads
      .map(([profile, d]) => ({
        rank: TEXT_PROFILES.findIndex((re) => re.test(profile)),
        image: isRecord(d) && d.isImage === true,
        urls: urlsOf(d),
      }))
      .filter((d) => d.rank >= 0 && !d.image && d.urls.length > 0)
      .sort((a, b) => a.rank - b.rank);
    tracks.push({
      ids,
      language: typeof raw.language === 'string' ? raw.language : '',
      isImageBased: raw.isImageBased === true || (downloads.length > 0 && text.length === 0),
      isNone: raw.isNoneTrack === true,
      urls: text.flatMap((d) => d.urls),
    });
  }
  return { movieId: String(movieId), tracks };
}

export interface ManifestWindow {
  JSON: { parse: typeof JSON.parse };
  Response?: { prototype: { json(): Promise<unknown> } };
}

/**
 * Watches Netflix parse its manifest (MAIN world, installed at document_start) and reports the text tracks.
 * Never throws into Netflix's code.
 */
export function installManifestCapture(win: ManifestWindow, onManifest: (manifest: CapturedManifest) => void): () => void {
  const report = (value: unknown) => {
    try {
      const manifest = extractTextTracks(value);
      if (manifest) onManifest(manifest);
    } catch {
      // A capture problem must never break playback.
    }
  };

  const originalParse = win.JSON.parse;
  win.JSON.parse = function (this: unknown, text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) {
    const value = originalParse.call(this, text, reviver as Parameters<typeof JSON.parse>[1]);
    if (typeof text === 'string' && text.includes('timedtexttracks')) report(value);
    return value;
  } as typeof JSON.parse;

  const proto = win.Response?.prototype;
  const originalJson = proto?.json;
  if (proto && originalJson) {
    proto.json = function (this: unknown) {
      return originalJson.call(this).then((value: unknown) => {
        report(value);
        return value;
      });
    };
  }

  return () => {
    win.JSON.parse = originalParse;
    if (proto && originalJson) proto.json = originalJson;
  };
}

/** The most recent manifests by movie id (Netflix also loads manifests for previews). */
export function createManifestStore(limit = 10) {
  const byMovie = new Map<string, CapturedManifest>();
  return {
    add(manifest: CapturedManifest) {
      byMovie.delete(manifest.movieId);
      byMovie.set(manifest.movieId, manifest);
      while (byMovie.size > limit) byMovie.delete(byMovie.keys().next().value!);
    },
    get(movieId: string): CapturedManifest | undefined {
      return byMovie.get(movieId);
    },
  };
}
```

- [ ] **Step 5: Run them to make sure they pass**

Run: `pnpm vitest run tests/unit/manifest.test.ts tests/unit/title.test.ts`
Expected: PASS (6 + 8 tests).

- [ ] **Step 6: Write the failing bridge tests**

In `tests/unit/bridge.test.ts`:

1. Change the import of `@/lib/bridge/player` to also import `metadataVideoFrom`. Change the protocol import to also import `parseSubtitleSource` and `parseTitleInfo`. Add `import { createManifestStore } from '@/lib/netflix/manifest';`.
2. In `class FakePlayer`, add a field `textTrack: unknown = undefined;` and this method:

   ```ts
   getTimedTextTrack() {
     return this.textTrack;
   }
   ```

3. Update the expectation in `it('returns player state', …)` to include `textTrack: null`:

   ```ts
       expect(await client.call('getState')).toEqual({
         currentTimeMs: 90_000,
         durationMs: 1_000_000,
         paused: true,
         videoId: '81091396',
         textTrack: null,
       });
   ```

4. Append:

```ts
describe('subtitle source and title (Plan 2)', () => {
  const EN = { trackId: 'T:1:0;1;en;1;1;0;', bcp47: 'en', isImageBased: false, isNoneTrack: false };

  function connectWithSources(player: FakePlayer, opts: { metadata?: unknown; doc?: Document | null } = {}) {
    const manifests = createManifestStore();
    manifests.add({
      movieId: '81091396',
      tracks: [
        { ids: [EN.trackId], language: 'en', isImageBased: false, isNone: false, urls: ['https://cdn.example/en.dfxp'] },
        { ids: ['T:ja'], language: 'ja', isImageBased: true, isNone: false, urls: [] },
      ],
    });
    const target = new EventTarget();
    const stop = serveBridge(
      target,
      createPlayerMethods(
        () => player,
        () => '81091396',
        {
          getManifest: manifests.get,
          getMetadataVideo: () => opts.metadata,
          getDocument: () => opts.doc ?? null,
        },
      ),
    );
    const client = createBridgeClient(target, 50);
    cleanups.push(stop, () => client.dispose());
    return client;
  }

  it('reports the current text track in getState', async () => {
    const player = new FakePlayer();
    player.textTrack = EN;
    const client = connectWithSources(player);
    expect((await client.call('getState')).textTrack).toEqual({
      trackId: EN.trackId,
      language: 'en',
      isImageBased: false,
      isNone: false,
    });
  });

  it('gives the file URL of the track being shown', async () => {
    const player = new FakePlayer();
    player.textTrack = EN;
    expect(await connectWithSources(player).call('getSubtitleSource')).toEqual({
      videoId: '81091396',
      trackId: EN.trackId,
      language: 'en',
      url: 'https://cdn.example/en.dfxp',
    });
  });

  it('no source for subtitles off, image-based subtitles, or an uncaptured track', async () => {
    for (const textTrack of [
      { ...EN, isNoneTrack: true },
      { trackId: 'T:ja', bcp47: 'ja', isImageBased: true },
      { trackId: 'T:unknown', bcp47: 'fr' },
      undefined,
    ]) {
      const player = new FakePlayer();
      player.textTrack = textTrack;
      expect(await connectWithSources(player).call('getSubtitleSource')).toBeNull();
    }
  });

  it('title comes from the metadata, else the player UI', async () => {
    const show = { title: 'Show', type: 'show', id: 1, seasons: [{ seq: 2, episodes: [{ id: 81091396, seq: 5, title: 'Ep' }] }] };
    expect(await connectWithSources(new FakePlayer(), { metadata: show }).call('getTitle')).toMatchObject({
      seriesTitle: 'Show',
      seasonNumber: 2,
      episodeNumber: 5,
    });
    const doc = document.implementation.createHTMLDocument('x');
    doc.body.innerHTML = '<div data-uia="video-title">A Movie</div>';
    expect(await connectWithSources(new FakePlayer(), { doc }).call('getTitle')).toMatchObject({ kind: 'movie', seriesTitle: 'A Movie' });
    expect(await connectWithSources(new FakePlayer()).call('getTitle')).toBeNull();
  });

  it('reads metadata at videoMetadata[id]._metadataObject.video', () => {
    const video = { title: 'T' };
    const netflix = {
      appContext: { state: { playerApp: { getState: () => ({ videoPlayer: { videoMetadata: { 42: { _metadataObject: { video } } } } }) } } },
    };
    expect(metadataVideoFrom(netflix, '42')).toBe(video);
    expect(metadataVideoFrom({}, '42')).toBeUndefined();
    expect(metadataVideoFrom({ appContext: { state: { playerApp: { getState: () => { throw new Error('x'); } } } } }, '42')).toBeUndefined();
  });
});

describe('validating what comes back from the page', () => {
  it('accepts only a well-formed https subtitle source', () => {
    const ok = { videoId: '1', trackId: 't', language: 'en', url: 'https://cdn.example/a' };
    expect(parseSubtitleSource(ok)).toEqual(ok);
    expect(parseSubtitleSource({ ...ok, url: 'http://cdn.example/a' })).toBeNull();
    expect(parseSubtitleSource({ ...ok, videoId: 1 })).toBeNull();
    expect(parseSubtitleSource(null)).toBeNull();
  });

  it('accepts only a well-formed title', () => {
    const ok = { videoId: '1', kind: 'episode', seriesId: null, seriesTitle: 'S', seasonNumber: 1, episodeNumber: 2, episodeTitle: null };
    expect(parseTitleInfo(ok)).toEqual(ok);
    expect(parseTitleInfo({ ...ok, kind: 'podcast' })).toBeNull();
    expect(parseTitleInfo({ ...ok, seriesTitle: '' })).toBeNull();
    expect(parseTitleInfo({ ...ok, seasonNumber: '1' })).toBeNull();
  });
});
```

5. Add `// @vitest-environment happy-dom` as the first line of `tests/unit/bridge.test.ts`; the title fallback test needs a DOM.

- [ ] **Step 7: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/bridge.test.ts`
Expected: FAIL. The `textTrack` field is missing from `getState`, `getSubtitleSource` is unknown (`bad-request`), and `metadataVideoFrom`/`parseSubtitleSource` aren't exported.

- [ ] **Step 8: Extend `src/lib/bridge/protocol.ts`**

Add `import type { TitleInfo } from '@/lib/netflix/title';` at the top. Replace `PlayerState` and `BridgeMethods`, and add the new types and validators:

```ts
/** The subtitle track Netflix is showing (from `getTimedTextTrack()`). */
export interface TextTrackInfo {
  trackId: string;
  /** BCP 47, e.g. "en". */
  language: string;
  isImageBased: boolean;
  /** True when subtitles are "Off". */
  isNone: boolean;
}

/** Times are ms from the start of the episode — the clock `seek` takes, so a saved time seeks back to it. */
export interface PlayerState {
  currentTimeMs: number;
  durationMs: number;
  paused: boolean;
  videoId: string | null;
  textTrack: TextTrackInfo | null;
}

/** Where to download the subtitle file being shown (captured from Netflix's manifest). */
export interface SubtitleSource {
  videoId: string;
  trackId: string;
  language: string;
  url: string;
}

export interface BridgeMethods {
  seekBy(deltaMs: number): void;
  seek(timeMs: number): void;
  play(): void;
  pause(): void;
  getState(): PlayerState;
  getSubtitleSource(): SubtitleSource | null;
  getTitle(): TitleInfo | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));
const isNullableString = (value: unknown) => value === null || typeof value === 'string';

/** Bridge answers come from the page; check their shape before trusting them. */
export function parseSubtitleSource(value: unknown): SubtitleSource | null {
  if (!isRecord(value)) return null;
  const { videoId, trackId, language, url } = value;
  if (typeof videoId !== 'string' || typeof trackId !== 'string' || typeof language !== 'string') return null;
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  return { videoId, trackId, language, url };
}

export function parseTitleInfo(value: unknown): TitleInfo | null {
  if (!isRecord(value)) return null;
  const v = value;
  if (typeof v.videoId !== 'string' || (v.kind !== 'episode' && v.kind !== 'movie')) return null;
  if (typeof v.seriesTitle !== 'string' || !v.seriesTitle) return null;
  if (!isNullableString(v.seriesId) || !isNullableString(v.episodeTitle)) return null;
  if (!isNullableNumber(v.seasonNumber) || !isNullableNumber(v.episodeNumber)) return null;
  return {
    videoId: v.videoId,
    kind: v.kind,
    seriesId: v.seriesId as string | null,
    seriesTitle: v.seriesTitle,
    seasonNumber: v.seasonNumber as number | null,
    episodeNumber: v.episodeNumber as number | null,
    episodeTitle: v.episodeTitle as string | null,
  };
}
```

- [ ] **Step 9: Extend `src/lib/bridge/player.ts`**

1. Add imports at the top:

   ```ts
   import type { CapturedManifest } from '@/lib/netflix/manifest';
   import { titleFromDom, titleFromMetadata } from '@/lib/netflix/title';
   ```

   Then change the protocol import to `import { BridgeError, type BridgeMethods, type PlayerState, type TextTrackInfo } from './protocol';`.

2. Add `getTimedTextTrack?(): unknown;` to `interface NetflixPlayer`. It is optional and not in `REQUIRED_PLAYER_METHODS`: seeking must keep working if Netflix renames it.

3. Add, before `createPlayerMethods`:

```ts
/** Where the bridge reads subtitle files and titles (wired to Netflix in netflix-bridge.content.ts). */
export interface PlayerSources {
  getManifest(movieId: string): CapturedManifest | undefined;
  getMetadataVideo(videoId: string): unknown;
  getDocument(): Document | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface MetadataGlobal {
  appContext?: {
    state?: {
      playerApp?: {
        getState?(): { videoPlayer?: { videoMetadata?: Record<string, { _metadataObject?: { video?: unknown } } | undefined> } };
      };
    };
  };
}

/** `playerApp.getState().videoPlayer.videoMetadata[videoId]._metadataObject.video` (docs/netflix-internals.md row 4). */
export function metadataVideoFrom(netflix: unknown, videoId: string): unknown {
  try {
    return (netflix as MetadataGlobal | undefined)?.appContext?.state?.playerApp?.getState?.()?.videoPlayer?.videoMetadata?.[videoId]
      ?._metadataObject?.video;
  } catch {
    return undefined;
  }
}

function readTextTrack(p: NetflixPlayer): TextTrackInfo | null {
  try {
    const t = p.getTimedTextTrack?.();
    if (!isRecord(t) || (typeof t.trackId !== 'string' && typeof t.trackId !== 'number')) return null;
    return {
      trackId: String(t.trackId),
      language: typeof t.bcp47 === 'string' ? t.bcp47 : '',
      isImageBased: t.isImageBased === true,
      isNone: t.isNoneTrack === true,
    };
  } catch {
    return null;
  }
}
```

4. Change `createPlayerMethods` to take the sources and add the new methods. Its full new version:

```ts
export function createPlayerMethods(
  getPlayer: () => NetflixPlayer,
  getVideoId: () => string | null,
  sources?: PlayerSources,
): BridgeMethods {
  return {
    seekBy(deltaMs) {
      requireFinite(deltaMs, 'deltaMs');
      const p = getPlayer();
      const { currentMs, durationMs } = readyTimes(p);
      p.seek(clampTime(currentMs + deltaMs, durationMs));
    },
    seek(timeMs) {
      requireFinite(timeMs, 'timeMs');
      const p = getPlayer();
      const { durationMs } = readyTimes(p);
      p.seek(clampTime(timeMs, durationMs));
    },
    play() {
      getPlayer().play();
    },
    pause() {
      getPlayer().pause();
    },
    getState(): PlayerState {
      const p = getPlayer();
      const { currentMs, durationMs } = episodeTimes(p);
      return {
        currentTimeMs: currentMs,
        durationMs,
        paused: p.isPaused(),
        videoId: getVideoId(),
        textTrack: readTextTrack(p),
      };
    },
    getSubtitleSource() {
      const videoId = getVideoId();
      const track = readTextTrack(getPlayer());
      if (!videoId || !track || track.isNone || track.isImageBased || !sources) return null;
      const captured = sources.getManifest(videoId)?.tracks.find((t) => t.ids.includes(track.trackId));
      const url = captured?.urls[0];
      if (!captured || !url) return null;
      return { videoId, trackId: track.trackId, language: track.language || captured.language, url };
    },
    getTitle() {
      const videoId = getVideoId();
      if (!videoId || !sources) return null;
      const doc = sources.getDocument();
      return titleFromMetadata(sources.getMetadataVideo(videoId), videoId) ?? (doc ? titleFromDom(doc, videoId) : null);
    },
  };
}
```

- [ ] **Step 10: Install the capture in `src/entrypoints/netflix-bridge.content.ts`**

```ts
import { defineContentScript } from '#imports';
import { createPlayerMethods, findPlayer, metadataVideoFrom } from '@/lib/bridge/player';
import { serveBridge } from '@/lib/bridge/server';
import { createManifestStore, installManifestCapture, type ManifestWindow } from '@/lib/netflix/manifest';
import { parseWatchVideoId } from '@/lib/netflix/video-id';

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    // Installed before Netflix's own scripts run, so the first manifest is seen too.
    const manifests = createManifestStore();
    installManifestCapture(window as unknown as ManifestWindow, manifests.add);

    const netflix = () => (window as { netflix?: unknown }).netflix;
    const videoId = () => parseWatchVideoId(location.pathname);
    serveBridge(
      document,
      createPlayerMethods(() => findPlayer(netflix(), videoId()), videoId, {
        getManifest: manifests.get,
        getMetadataVideo: (id) => metadataVideoFrom(netflix(), id),
        getDocument: () => document,
      }),
    );
  },
});
```

- [ ] **Step 11: Run the tests, the whole suite, and the type-check**

Run: `pnpm vitest run tests/unit/bridge.test.ts && pnpm test && pnpm compile`
Expected: all PASS; `tsc` prints nothing.

- [ ] **Step 12: Commit**

```bash
git add src/lib/netflix/manifest.ts src/lib/netflix/title.ts src/lib/bridge/protocol.ts src/lib/bridge/player.ts src/entrypoints/netflix-bridge.content.ts tests/unit/manifest.test.ts tests/unit/title.test.ts tests/unit/bridge.test.ts
git commit -m "feat: page bridge captures subtitle files, reads titles and the current text track" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Subtitles on Netflix — watcher, subtitle-file session, line jumps, Replay line

Spec sections:
- §8.1: a watcher with a rolling history.
- §8.2: fetch, parse and validate the subtitle file; line timing.
- §8.5: reset on a new video.
- §5.1: Replay line.
- §5.1.1: Previous/Next line, plus Rewind/Forward in One line mode, falling back to seconds.

If `docs/netflix-internals.md` row 8 recorded a player-clock ruling (Task 1), apply it in `loadTrack`: shift every cue by the recorded offset.

**Files:**
- Create: `src/entrypoints/netflix.content/subtitle-dom.ts`, `src/entrypoints/netflix.content/subtitle-session.ts`
- Modify: `src/lib/netflix/selectors.ts`, `src/entrypoints/netflix.content/controller.ts`, `src/entrypoints/netflix.content/index.ts`
- Test: `tests/unit/subtitle-dom.test.ts`, `tests/unit/subtitle-session.test.ts`, `tests/unit/controller.test.ts`

**Interfaces:**
- Consumes:
  - `createLineHistory`, `describeLine`, `trackMatchesLine`, `cuesAsTimedLines`, `historyAsTimedLines`, `previousLineStart`, `nextLineStart` (Task 4)
  - `parseSubtitleFile` (Task 3)
  - `parseSubtitleSource`, `PlayerState` (Task 5)
  - `Settings.rewindMode`/`forwardMode` (Task 2)
- Produces:
  - `selectors.ts`: `SUBTITLE_TEXT_SELECTOR = '.player-timedtext-text-container'` and `PLAYER_CONTAINER_SELECTOR = 'div.watch-video[data-uia="watch-video"]'`
  - `subtitle-dom.ts`:
    - `interface DisplayedSubtitle { text: string; rects: DOMRect[] }`
    - `readDisplayedSubtitle(doc)`
    - `watchSubtitles(doc, onChange): () => void`
  - `subtitle-session.ts`:
    - `interface SubtitleSession { onDisplayed(s); displayed(); currentLine(); describe(line): LineDetails; lineTarget(direction: 'previous' | 'next'): number | null; trackLanguage(): string | null; reset() }`
    - `createSubtitleSession({ bridge, fetchText, getVideoId })`
  - `ControllerDeps` gains `session: Pick<SubtitleSession, 'currentLine' | 'describe' | 'lineTarget'>`

- [ ] **Step 1: Write the failing DOM watcher tests**

`tests/unit/subtitle-dom.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDisplayedSubtitle, watchSubtitles } from '@/entrypoints/netflix.content/subtitle-dom';

afterEach(() => {
  document.body.innerHTML = '';
});

const layer = (...lines: string[]) =>
  `<div class="player-timedtext">${lines
    .map((l) => `<div class="player-timedtext-text-container"><span>${l}</span></div>`)
    .join('')}</div>`;

describe('subtitle DOM', () => {
  it('reads the text of every text container, one per line, with their rects', () => {
    document.body.innerHTML = layer('Hello.', 'Who is it?');
    const shown = readDisplayedSubtitle(document);
    expect(shown.text).toBe('Hello.\nWho is it?');
    expect(shown.rects).toHaveLength(2);
    document.body.innerHTML = '<div class="player-timedtext"></div>';
    expect(readDisplayedSubtitle(document)).toEqual({ text: '', rects: [] });
  });

  it('reports text changes (not identical re-renders) and follows a replaced or removed layer', async () => {
    const seen: string[] = [];
    const stop = watchSubtitles(document, (s) => seen.push(s.text));
    document.body.innerHTML = layer('One');
    await vi.waitFor(() => expect(seen).toEqual(['One']));
    document.querySelector('span')!.textContent = 'One';
    document.querySelector('.player-timedtext')!.innerHTML =
      '<div class="player-timedtext-text-container"><span>Two</span></div>';
    await vi.waitFor(() => expect(seen).toEqual(['One', 'Two']));
    document.body.innerHTML = layer('Three');
    await vi.waitFor(() => expect(seen).toEqual(['One', 'Two', 'Three']));
    document.body.innerHTML = '';
    await vi.waitFor(() => expect(seen).toEqual(['One', 'Two', 'Three', '']));
    stop();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/subtitle-dom.test.ts`
Expected: FAIL — `Failed to resolve import "@/entrypoints/netflix.content/subtitle-dom"`.

- [ ] **Step 3: Add the selectors and implement `subtitle-dom.ts`**

Append to `src/lib/netflix/selectors.ts`:

```ts
/** One block of visible subtitle text; two-line subtitles are one container (docs/netflix-internals.md). */
export const SUBTITLE_TEXT_SELECTOR = '.player-timedtext-text-container';

/** Netflix's player container, which is also the fullscreen element (docs/netflix-internals.md row 6). */
export const PLAYER_CONTAINER_SELECTOR = 'div.watch-video[data-uia="watch-video"]';
```

`src/entrypoints/netflix.content/subtitle-dom.ts`:

```ts
import { SUBTITLE_LAYER_SELECTOR, SUBTITLE_TEXT_SELECTOR } from '@/lib/netflix/selectors';

export interface DisplayedSubtitle {
  /** Visible text, one container per line; "" when nothing is shown. */
  text: string;
  /** Viewport rects of the text containers (for hover hit-testing). */
  rects: DOMRect[];
}

export function readDisplayedSubtitle(doc: Document): DisplayedSubtitle {
  const containers = [...doc.querySelectorAll<HTMLElement>(SUBTITLE_TEXT_SELECTOR)];
  const text = containers
    .map((c) => (c.innerText || c.textContent || '').trim())
    .filter(Boolean)
    .join('\n');
  return { text, rects: text ? containers.map((c) => c.getBoundingClientRect()) : [] };
}

/**
 * Calls `onChange` when the displayed subtitle text changes. Watches Netflix's subtitle layer closely and
 * the page only for the layer being added, replaced, or removed.
 */
export function watchSubtitles(doc: Document, onChange: (subtitle: DisplayedSubtitle) => void): () => void {
  let layer: Element | null = null;
  let lastText = '';

  const emit = () => {
    const current = readDisplayedSubtitle(doc);
    if (current.text === lastText) return;
    lastText = current.text;
    onChange(current);
  };

  const layerObserver = new MutationObserver(emit);
  const bind = () => {
    const found = doc.querySelector(SUBTITLE_LAYER_SELECTOR);
    if (found !== layer) {
      layerObserver.disconnect();
      layer = found;
      if (layer) layerObserver.observe(layer, { childList: true, subtree: true, characterData: true });
    }
    emit();
  };

  const pageObserver = new MutationObserver(() => {
    if (!layer || !layer.isConnected) bind();
  });
  pageObserver.observe(doc.documentElement, { childList: true, subtree: true });
  bind();

  return () => {
    pageObserver.disconnect();
    layerObserver.disconnect();
  };
}
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `pnpm vitest run tests/unit/subtitle-dom.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing session tests**

`tests/unit/subtitle-session.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSubtitleSession } from '@/entrypoints/netflix.content/subtitle-session';

// Cue i: 1000 + 3000·i … 3000 + 3000·i (tick rate 10 000 000 → 10 000 ticks per ms).
const dfxp = (texts: string[]) =>
  `<tt xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000"><body><div>${texts
    .map((t, i) => `<p begin="${(1000 + i * 3000) * 10_000}t" end="${(3000 + i * 3000) * 10_000}t">${t}</p>`)
    .join('')}</div></body></tt>`;
const EN = Array.from({ length: 15 }, (_, i) => `Line ${i}`);
const FR = Array.from({ length: 15 }, (_, i) => `Ligne ${i}`);
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(files: Record<string, string> = { 'https://cdn.example/en': dfxp(EN) }) {
  const state = {
    timeMs: 0,
    videoId: '81091396',
    track: { trackId: 'T:en', language: 'en', url: 'https://cdn.example/en' } as { trackId: string; language: string; url: string } | null,
  };
  const bridge = {
    callSync: vi.fn((method: string) => {
      if (method === 'getState') {
        return {
          ok: true,
          result: {
            currentTimeMs: state.timeMs,
            durationMs: 1_000_000,
            paused: false,
            videoId: state.videoId,
            textTrack: state.track && { trackId: state.track.trackId, language: state.track.language, isImageBased: false, isNone: false },
          },
        };
      }
      if (method === 'getSubtitleSource') {
        return {
          ok: true,
          result: state.track && { videoId: state.videoId, trackId: state.track.trackId, language: state.track.language, url: state.track.url },
        };
      }
      return { ok: true, result: null };
    }),
  };
  const fetchText = vi.fn(async (url: string) => {
    const body = files[url];
    if (body === undefined) throw new Error('404');
    return body;
  });
  const session = createSubtitleSession({ bridge: bridge as never, fetchText, getVideoId: () => state.videoId });
  const show = (text: string, atMs: number) => {
    state.timeMs = atMs;
    session.onDisplayed({ text, rects: [] });
  };
  return { state, fetchText, session, show };
}

describe('subtitle session', () => {
  it('records displayed lines with the player time', () => {
    const { session, show } = setup();
    show('Line 7', 22_100);
    expect(session.currentLine()).toMatchObject({ text: 'Line 7', shownAtMs: 22_100 });
    expect(session.displayed().text).toBe('Line 7');
  });

  it('loads the subtitle file once and uses it once it matches what Netflix shows', async () => {
    const { session, show, fetchText } = setup();
    show('Line 6', 19_100);
    show('Line 7', 22_100);
    await settle();
    const details = session.describe(session.currentLine()!);
    expect(details.fromTrack).toBe(true);
    expect(details.context.before).toEqual(['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6']);
    expect(details.context.after[0]).toBe('Line 8');
    expect(session.trackLanguage()).toBe('en');
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('ignores a subtitle file that does not match the screen', async () => {
    const { session, show } = setup({ 'https://cdn.example/en': dfxp(EN.map((l) => `Other ${l}`)) });
    show('Line 7', 22_100);
    await settle();
    expect(session.describe(session.currentLine()!).fromTrack).toBe(false);
    expect(session.trackLanguage()).toBeNull();
  });

  it('falls back to what was seen when the file cannot be fetched', async () => {
    const { session, show } = setup({});
    show('Seen 1', 1000);
    show('Seen 2', 4000);
    await settle();
    expect(session.describe(session.currentLine()!)).toMatchObject({
      fromTrack: false,
      context: { before: ['Seen 1'], after: [] },
    });
  });

  it('reloads the subtitle file when the text track changes', async () => {
    const { session, show, state, fetchText } = setup({
      'https://cdn.example/en': dfxp(EN),
      'https://cdn.example/fr': dfxp(FR),
    });
    show('Line 7', 22_100);
    await settle();
    expect(session.describe(session.currentLine()!).fromTrack).toBe(true);
    state.track = { trackId: 'T:fr', language: 'fr', url: 'https://cdn.example/fr' };
    show('Ligne 8', 25_100);
    await settle();
    expect(fetchText).toHaveBeenLastCalledWith('https://cdn.example/fr');
    const details = session.describe(session.currentLine()!);
    expect(details.fromTrack).toBe(true);
    expect(details.context.before.at(-1)).toBe('Ligne 7');
    expect(session.trackLanguage()).toBe('fr');
  });

  it('line targets come from the file, else from the lines already seen', async () => {
    const seen = setup({});
    seen.show('A', 10_000);
    seen.show('', 11_000);
    seen.show('B', 12_000);
    seen.state.timeMs = 12_500;
    expect(seen.session.lineTarget('previous')).toBe(9700);
    expect(seen.session.lineTarget('next')).toBeNull();

    const file = setup();
    file.show('Line 7', 22_100);
    await settle();
    file.state.timeMs = 22_500;
    expect(file.session.lineTarget('previous')).toBe(19_000);
    expect(file.session.lineTarget('next')).toBe(25_000);
  });

  it('starts over on a new video', async () => {
    const { session, show, state, fetchText } = setup();
    show('Line 7', 22_100);
    state.videoId = '99999999';
    show('Hello', 1000);
    expect(session.currentLine()?.text).toBe('Hello');
    expect(session.describe(session.currentLine()!).context.before).toEqual([]);
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 6: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/subtitle-session.test.ts`
Expected: FAIL — `Failed to resolve import "@/entrypoints/netflix.content/subtitle-session"`.

- [ ] **Step 7: Implement `src/entrypoints/netflix.content/subtitle-session.ts`**

```ts
import type { BridgeClient } from '@/lib/bridge/client';
import { parseSubtitleSource, type PlayerState } from '@/lib/bridge/protocol';
import { describeLine, trackMatchesLine, type LineDetails } from '@/lib/subtitles/context';
import type { Cue } from '@/lib/subtitles/cue';
import { createLineHistory, type ObservedLine } from '@/lib/subtitles/history';
import { cuesAsTimedLines, historyAsTimedLines, nextLineStart, previousLineStart } from '@/lib/subtitles/navigation';
import { parseSubtitleFile } from '@/lib/subtitles/parse';
import type { DisplayedSubtitle } from './subtitle-dom';

export interface SubtitleSessionDeps {
  bridge: Pick<BridgeClient, 'callSync'>;
  fetchText(url: string): Promise<string>;
  /** The video in the URL; a different one starts a fresh session (spec §8.5). */
  getVideoId(): string | null;
}

export interface SubtitleSession {
  /** Feed every change of the displayed subtitle (from watchSubtitles). */
  onDisplayed(subtitle: DisplayedSubtitle): void;
  displayed(): DisplayedSubtitle;
  /** Spec §5.1: the line on screen, else the most recent one. */
  currentLine(): ObservedLine | null;
  /** Context and timing: from the subtitle file when it matches the screen, else from history (spec §8.2). */
  describe(line: ObservedLine): LineDetails;
  /** Episode time of the previous/next line start (spec §5.1.1), or null when there is none. */
  lineTarget(direction: 'previous' | 'next'): number | null;
  /** Language of the subtitle file in use, or null when none is in use. */
  trackLanguage(): string | null;
  reset(): void;
}

type TrackState = 'loading' | 'unchecked' | 'valid' | 'invalid';

interface Track {
  key: string;
  language: string;
  cues: Cue[] | null;
  state: TrackState;
}

const NOTHING_SHOWN: DisplayedSubtitle = { text: '', rects: [] };

export function createSubtitleSession(deps: SubtitleSessionDeps): SubtitleSession {
  const history = createLineHistory();
  let shown = NOTHING_SHOWN;
  let videoId: string | null = null;
  let track: Track | null = null;

  const reset = () => {
    history.clear();
    track = null;
    shown = NOTHING_SHOWN;
  };

  const syncVideo = () => {
    const id = deps.getVideoId();
    if (id === videoId) return;
    videoId = id;
    reset();
  };

  const playerState = (): PlayerState | null => {
    const res = deps.bridge.callSync('getState');
    return res.ok ? res.result : null;
  };

  /** Starts loading the subtitle file for the track Netflix shows, unless it's already the loaded one. */
  const loadTrack = (state: PlayerState | null) => {
    const textTrack = state?.textTrack;
    if (!videoId || !textTrack || textTrack.isNone || textTrack.isImageBased) return;
    const key = `${videoId}|${textTrack.trackId}`;
    if (track?.key === key) return;
    const res = deps.bridge.callSync('getSubtitleSource');
    const source = res.ok ? parseSubtitleSource(res.result) : null;
    if (!source || source.trackId !== textTrack.trackId) return; // not captured yet; try again on the next line
    const loading: Track = { key, language: source.language, cues: null, state: 'loading' };
    track = loading;
    deps.fetchText(source.url).then(
      (body) => {
        const cues = parseSubtitleFile(body);
        loading.cues = cues;
        loading.state = cues.length > 0 ? 'unchecked' : 'invalid';
      },
      () => {
        loading.state = 'invalid';
      },
    );
  };

  /** The file's cues, checked once against a line Netflix displayed (spec §8.2). */
  const usableCues = (line: ObservedLine | null): Cue[] | null => {
    if (!track?.cues) return null;
    if (track.state === 'unchecked' && line && line.shownAtMs !== null) {
      track.state = trackMatchesLine(track.cues, line) ? 'valid' : 'invalid';
    }
    return track.state === 'valid' ? track.cues : null;
  };

  return {
    onDisplayed(subtitle) {
      syncVideo();
      shown = subtitle;
      const state = playerState();
      history.observe(subtitle.text, state ? state.currentTimeMs : null);
      loadTrack(state);
      usableCues(history.displayed());
    },
    displayed: () => shown,
    currentLine() {
      syncVideo();
      return history.current();
    },
    describe(line) {
      syncVideo();
      return describeLine(line, usableCues(line), history);
    },
    lineTarget(direction) {
      syncVideo();
      const state = playerState();
      if (!state) return null;
      const cues = usableCues(history.current());
      const lines = cues ? cuesAsTimedLines(cues) : historyAsTimedLines(history.all());
      return direction === 'previous'
        ? previousLineStart(lines, state.currentTimeMs)
        : nextLineStart(lines, state.currentTimeMs);
    },
    trackLanguage: () => (track?.state === 'valid' ? track.language : null),
    reset,
  };
}
```

- [ ] **Step 8: Run them to make sure they pass**

Run: `pnpm vitest run tests/unit/subtitle-session.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 9: Write the failing controller tests**

In `tests/unit/controller.test.ts`:

1. Add `import type { ObservedLine } from '@/lib/subtitles/history';`.
2. In `setup`, create a fake session before `createController`:

   ```ts
   const session = {
     currentLine: vi.fn((): ObservedLine | null => null),
     describe: vi.fn((line: ObservedLine) => ({
       context: { before: [], after: [] },
       timing: line.shownAtMs === null ? null : { startMs: line.shownAtMs - 300, endMs: null },
       fromTrack: false,
     })),
     lineTarget: vi.fn((_direction: 'previous' | 'next'): number | null => null),
   };
   ```

3. Pass `session` in the `createController({ … })` deps.
4. Add `session` to the object `setup` returns.
5. Append inside `describe('content controller', …)`:

```ts
  it('Previous/Next line (A/D) seek to the start of that line', () => {
    const { bridge, session, press } = setup();
    session.lineTarget.mockImplementation((direction) => (direction === 'previous' ? 19_000 : 25_000));
    press('KeyA', 'a');
    press('KeyD', 'd');
    expect(bridge.callSync.mock.calls).toEqual([
      ['seek', 19_000],
      ['seek', 25_000],
    ]);
  });

  it('in One line mode, ← and → jump by line', () => {
    const { bridge, session, press } = setup({ ...DEFAULT_SETTINGS, rewindMode: 'line', forwardMode: 'line' });
    session.lineTarget.mockReturnValue(30_000);
    press('ArrowLeft');
    press('ArrowRight');
    expect(session.lineTarget.mock.calls).toEqual([['previous'], ['next']]);
    expect(bridge.callSync.mock.calls).toEqual([
      ['seek', 30_000],
      ['seek', 30_000],
    ]);
  });

  it('with no line to jump to, falls back to the Rewind/Forward seconds', () => {
    const { bridge, press } = setup({ ...DEFAULT_SETTINGS, rewindSeconds: 3, forwardSeconds: 7 });
    press('KeyA', 'a');
    press('KeyD', 'd');
    expect(bridge.callSync.mock.calls).toEqual([
      ['seekBy', -3_000],
      ['seekBy', 7_000],
    ]);
  });

  it('Replay line (R) seeks to the start of the current line and plays', () => {
    const { bridge, session, press } = setup();
    session.currentLine.mockReturnValue({ text: 'Hi', normalized: 'Hi', shownAtMs: 19_300, hiddenAtMs: null });
    press('KeyR', 'r');
    expect(bridge.callSync.mock.calls).toEqual([['seek', 19_000], ['play']]);
  });

  it('Replay with no line yet says so, does not seek, and keeps R from Netflix', () => {
    const { bridge, notifier, netflix, press } = setup();
    const down = press('KeyR', 'r');
    expect(bridge.callSync).not.toHaveBeenCalled();
    expect(notifier.show).toHaveBeenCalledWith('No subtitle line yet.', 2000);
    expect(down.defaultPrevented).toBe(true);
    expect(netflix).not.toHaveBeenCalled();
  });

  it('a line jump hands the key to Netflix when the player cannot be reached', () => {
    const { netflix, session, state, press } = setup();
    session.lineTarget.mockReturnValue(19_000);
    state.seekResult = unavailable;
    const down = press('KeyA', 'a');
    expect(down.defaultPrevented).toBe(false);
    expect(netflix).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 10: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/controller.test.ts`
Expected: FAIL — A/D/R do nothing (no handlers), and the line-mode test sees `seekBy` calls.

- [ ] **Step 11: Rewrite `src/entrypoints/netflix.content/controller.ts`**

```ts
import type { BridgeClient } from '@/lib/bridge/client';
import type { Settings } from '@/lib/settings';
import { createKeyboardHandlers, type ActionHandlers } from './keyboard';
import type { Notifier } from './notice';
import type { SubtitleSession } from './subtitle-session';
import { applySubtitlesHidden } from './subtitle-visibility';

const PLAYER_UNAVAILABLE_MESSAGE =
  "LingoFlix can't reach Netflix's player right now, so Netflix's own seek keys apply. Reloading the page may help.";
const NO_LINE_MESSAGE = 'No subtitle line yet.';

export interface ControllerDeps {
  doc: Document;
  bridge: Pick<BridgeClient, 'callSync'>;
  notifier: Notifier;
  session: Pick<SubtitleSession, 'currentLine' | 'describe' | 'lineTarget'>;
  updateSettings(update: (current: Settings) => Settings): Promise<Settings>;
  isWatchPage(): boolean;
  getVideoId(): string | null;
  /** False once the extension was reloaded, updated, or disabled and this script is orphaned. */
  isValid(): boolean;
}

export interface Controller {
  applySettings(settings: Settings): void;
  onKeyDown(event: KeyboardEvent): void;
  onKeyUp(event: KeyboardEvent): void;
  /** Undo everything LingoFlix shows on the page. Safe to call more than once. */
  teardown(): void;
}

export function createController(deps: ControllerDeps): Controller {
  let settings: Settings | null = null;
  let tornDown = false;

  const applySettings = (next: Settings) => {
    if (tornDown) return;
    settings = next;
    applySubtitlesHidden(deps.doc, next.enabled && next.subtitlesHidden);
  };

  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    settings = null;
    applySubtitlesHidden(deps.doc, false);
    deps.notifier.dispose();
  };

  /** Explains once per video why Netflix's own keys apply; false hands the key back to Netflix. */
  const playerUnavailable = (): false => {
    deps.notifier.showOnce(`player-unavailable:${deps.getVideoId() ?? ''}`, PLAYER_UNAVAILABLE_MESSAGE);
    return false;
  };
  const seekBy = (deltaMs: number): boolean => deps.bridge.callSync('seekBy', deltaMs).ok || playerUnavailable();
  const seekTo = (timeMs: number): boolean => deps.bridge.callSync('seek', timeMs).ok || playerUnavailable();

  /** Spec §5.1.1: to the previous/next line, or by the Rewind/Forward seconds when there is no such line. */
  const jumpLine = (direction: 'previous' | 'next'): boolean => {
    if (!settings) return false;
    const target = deps.session.lineTarget(direction);
    if (target !== null) return seekTo(target);
    return seekBy(direction === 'previous' ? -settings.rewindSeconds * 1000 : settings.forwardSeconds * 1000);
  };

  const replayLine = (): boolean => {
    const line = deps.session.currentLine();
    const timing = line ? deps.session.describe(line).timing : null;
    if (!timing) {
      deps.notifier.show(NO_LINE_MESSAGE, 2000);
      return true;
    }
    if (!seekTo(timing.startMs)) return false;
    deps.bridge.callSync('play');
    return true;
  };

  const handlers: ActionHandlers = {
    rewind: () =>
      !!settings && (settings.rewindMode === 'line' ? jumpLine('previous') : seekBy(-settings.rewindSeconds * 1000)),
    forward: () =>
      !!settings && (settings.forwardMode === 'line' ? jumpLine('next') : seekBy(settings.forwardSeconds * 1000)),
    previousLine: () => jumpLine('previous'),
    nextLine: () => jumpLine('next'),
    replayLine,
    toggleSubtitles: () => {
      void deps.updateSettings((s) => ({ ...s, subtitlesHidden: !s.subtitlesHidden })).then((s) => {
        applySettings(s);
        deps.notifier.show(s.subtitlesHidden ? 'Subtitles hidden' : 'Subtitles shown', 1200);
      });
    },
  };

  const keys = createKeyboardHandlers({
    getSettings: () => {
      if (!deps.isValid()) {
        teardown();
        return null;
      }
      return settings;
    },
    isWatchPage: deps.isWatchPage,
    handlers,
  });

  return { applySettings, onKeyDown: keys.onKeyDown, onKeyUp: keys.onKeyUp, teardown };
}
```

- [ ] **Step 12: Wire it up in `src/entrypoints/netflix.content/index.ts`**

```ts
import { defineContentScript } from '#imports';
import { createBridgeClient } from '@/lib/bridge/client';
import { isWatchPath, parseWatchVideoId } from '@/lib/netflix/video-id';
import { loadSettings, updateSettings, watchSettings } from '@/lib/settings';
import { createController } from './controller';
import { createNotifier } from './notice';
import { watchSubtitles } from './subtitle-dom';
import { createSubtitleSession } from './subtitle-session';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Subtitle file: HTTP ${res.status}`);
  return res.text();
}

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  runAt: 'document_start',
  main(ctx) {
    const bridge = createBridgeClient(document);
    const notifier = createNotifier(document);
    const getVideoId = () => parseWatchVideoId(location.pathname);
    const session = createSubtitleSession({ bridge, fetchText, getVideoId });
    const controller = createController({
      doc: document,
      bridge,
      notifier,
      session,
      updateSettings,
      isWatchPage: () => isWatchPath(location.pathname),
      getVideoId,
      isValid: () => ctx.isValid,
    });

    void loadSettings().then(controller.applySettings);
    const unwatch = watchSettings(controller.applySettings);
    const stopSubtitles = watchSubtitles(document, session.onDisplayed);

    ctx.addEventListener(window, 'keydown', controller.onKeyDown, { capture: true });
    ctx.addEventListener(window, 'keyup', controller.onKeyUp, { capture: true });
    ctx.onInvalidated(() => {
      unwatch();
      stopSubtitles();
      bridge.dispose();
      controller.teardown();
    });
  },
});
```

- [ ] **Step 13: Run the tests, the whole suite, the type-check, and the build**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: all tests pass; `tsc` prints nothing; the build succeeds.

- [ ] **Step 14: Commit**

```bash
git add src/lib/netflix/selectors.ts src/entrypoints/netflix.content tests/unit/subtitle-dom.test.ts tests/unit/subtitle-session.test.ts tests/unit/controller.test.ts
git commit -m "feat: subtitle watcher and file session; previous/next/replay line and line mode for ←/→" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Study Log store and grouping

Spec sections:
- §5.5: entry fields; storage `log:{id}` with `unlimitedStorage`; Delete and Reset all; the series → season → episode tree with a Movies group, sorted as specified; `30:34` timestamps.
- §5.3 step 3.1: look up by `videoId` + normalized line text + explanation language.
- §5.3 Regenerate: replace `response` and clear `followUps`.
- §5.4: follow-ups appended.

Lookup uses an index key per line (`logkey:{videoId}|{language}|{normalized phrase}` → id), so a hover costs one read instead of scanning the whole log. Saving the same line again is how Regenerate works: it replaces the response, keeps the id and `savedAt`, and clears follow-ups.

**Files:**
- Create: `src/lib/study-log/types.ts`, `src/lib/study-log/store.ts`, `src/lib/study-log/group.ts`, `src/lib/study-log/format.ts`
- Test: `tests/unit/study-log.test.ts`

**Interfaces:**
- Consumes:
  - `normalizeLine` (Task 3)
  - `DialogueContext` (Task 4)
- Produces:
  - `types.ts`:
    - `interface FollowUp { question: string; answer: string }`
    - `interface StudyLogEntry` with the §5.5 fields
    - `type NewStudyLogEntry = Omit<StudyLogEntry, 'id' | 'followUps' | 'savedAt' | 'updatedAt'>`
    - `isStudyLogEntry(value): value is StudyLogEntry`
  - `store.ts`:
    - `ENTRY_PREFIX = 'log:'`, `INDEX_PREFIX = 'logkey:'`, `indexKey(videoId, language, phrase)`
    - `getEntry(id)`, `findEntry(videoId, language, phrase)`, `listEntries()`
    - `saveExplanation(fields, now?, newId?)`, `appendFollowUp(id, followUp, now?)`
    - `deleteEntries(ids)`, `resetStudyLog()`
    - `watchStudyLog(callback): () => void`
  - `group.ts`:
    - `groupStudyLog(entries): StudyLogTree`
    - Node types `SeriesNode`, `SeasonNode`, `EpisodeNode`, `MovieNode`
  - `format.ts`: `formatTimestamp(ms)`, `seasonLabel(n)`, `episodeLabel(node)`

- [ ] **Step 1: Write the failing tests**

`tests/unit/study-log.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { episodeLabel, formatTimestamp, seasonLabel } from '@/lib/study-log/format';
import { groupStudyLog } from '@/lib/study-log/group';
import {
  appendFollowUp,
  deleteEntries,
  findEntry,
  getEntry,
  listEntries,
  resetStudyLog,
  saveExplanation,
} from '@/lib/study-log/store';
import type { NewStudyLogEntry, StudyLogEntry } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());

const line = (over: Partial<NewStudyLogEntry> = {}): NewStudyLogEntry => ({
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
  ...over,
});

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('Study Log store', () => {
  it('saves an explanation and finds it again by video, language, and normalized line', async () => {
    const saved = await saveExplanation(line(), new Date('2026-10-10T10:00:00Z'), ids());
    expect(saved).toMatchObject({ id: 'id-1', followUps: [], savedAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z' });
    expect(await findEntry('80077211', 'ko', "I'm gonna\ncall it   a night.")).toEqual(saved);
    expect(await findEntry('80077211', 'en', "I'm gonna call it a night.")).toBeNull();
    expect(await findEntry('11111111', 'ko', "I'm gonna call it a night.")).toBeNull();
    expect(await getEntry('id-1')).toEqual(saved);
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
    expect(await listEntries()).toHaveLength(1);
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

  it('deletes entries and their lookup keys only', async () => {
    const next = ids();
    const a = await saveExplanation(line({ phrase: 'A' }), undefined, next);
    const b = await saveExplanation(line({ phrase: 'B' }), undefined, next);
    await deleteEntries([a.id]);
    expect(await findEntry(a.videoId, 'ko', 'A')).toBeNull();
    expect(await getEntry(a.id)).toBeNull();
    expect(await findEntry(b.videoId, 'ko', 'B')).toEqual(b);
  });

  it('Reset all removes the whole Study Log and nothing else', async () => {
    await fakeBrowser.storage.local.set({ apiKey: 'sk-ant-secret', other: 1 });
    const next = ids();
    await saveExplanation(line({ phrase: 'A' }), undefined, next);
    await saveExplanation(line({ phrase: 'B' }), undefined, next);
    await resetStudyLog();
    expect(await listEntries()).toEqual([]);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ apiKey: 'sk-ant-secret', other: 1 });
  });

  it('skips corrupt stored entries', async () => {
    await fakeBrowser.storage.local.set({ 'log:bad': { id: 'bad' }, 'log:worse': 'text' });
    await saveExplanation(line(), undefined, ids());
    expect((await listEntries()).map((e) => e.id)).toEqual(['id-1']);
  });
});

const entry = (over: Partial<StudyLogEntry>): StudyLogEntry => ({
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
  ...over,
});

describe('groupStudyLog', () => {
  const st = { seriesId: 'st', seriesTitle: 'Stranger Things' };
  const entries = [
    entry({ id: 'st-e3-late', ...st, videoId: 'e3', episodeNumber: 3, videoTimeMs: 2000, updatedAt: '2026-10-05T00:00:00Z' }),
    entry({ id: 'st-e3-early', ...st, videoId: 'e3', episodeNumber: 3, videoTimeMs: 1000, updatedAt: '2026-10-03T00:00:00Z' }),
    entry({ id: 'st-e1', ...st, videoId: 'e1', episodeNumber: 1, updatedAt: '2026-10-02T00:00:00Z' }),
    entry({ id: 'st-s2', ...st, videoId: 's2e1', seasonNumber: 2, episodeNumber: 1, updatedAt: '2026-10-01T00:00:00Z' }),
    entry({ id: 'dark', seriesId: 'dark', seriesTitle: 'Dark', videoId: 'd1', updatedAt: '2026-10-06T00:00:00Z' }),
    entry({ id: 'roma', kind: 'movie', seriesId: null, seriesTitle: 'Roma', videoId: 'm1', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-04T00:00:00Z' }),
    entry({ id: 'okja', kind: 'movie', seriesId: null, seriesTitle: 'Okja', videoId: 'm2', seasonNumber: null, episodeNumber: null, updatedAt: '2026-10-07T00:00:00Z' }),
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
      entry({ id: 'a', seasonNumber: null, episodeNumber: null, videoId: 'x' }),
      entry({ id: 'b', seasonNumber: 1, episodeNumber: 2, videoId: 'y' }),
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

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/study-log.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/study-log/format"`.

- [ ] **Step 3: Implement `src/lib/study-log/types.ts`**

```ts
import type { DialogueContext } from '@/lib/subtitles/context';

export interface FollowUp {
  question: string;
  answer: string;
}

/** One explained line (spec §5.5). Times are episode ms; dates are ISO 8601. */
export interface StudyLogEntry {
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
}

export type NewStudyLogEntry = Omit<StudyLogEntry, 'id' | 'followUps' | 'savedAt' | 'updatedAt'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown) => Array.isArray(value) && value.every((v) => typeof v === 'string');

export function isStudyLogEntry(value: unknown): value is StudyLogEntry {
  if (!isRecord(value)) return false;
  const v = value;
  return (
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
    isStringArray(v.context.after)
  );
}
```

- [ ] **Step 4: Implement `src/lib/study-log/store.ts`**

```ts
import { browser } from '#imports';
import { normalizeLine } from '@/lib/subtitles/cue';
import { isStudyLogEntry, type FollowUp, type NewStudyLogEntry, type StudyLogEntry } from './types';

/** `log:{id}` holds an entry (spec §5.5). */
export const ENTRY_PREFIX = 'log:';
/** `logkey:{videoId}|{language}|{normalized line}` holds the id of that line's entry. */
export const INDEX_PREFIX = 'logkey:';

const entryKey = (id: string) => `${ENTRY_PREFIX}${id}`;

export function indexKey(videoId: string, language: string, phrase: string): string {
  return `${INDEX_PREFIX}${videoId}|${language}|${normalizeLine(phrase)}`;
}

const indexKeyOf = (e: Pick<StudyLogEntry, 'videoId' | 'explanationLanguage' | 'phrase'>) =>
  indexKey(e.videoId, e.explanationLanguage, e.phrase);

export async function getEntry(id: string): Promise<StudyLogEntry | null> {
  const key = entryKey(id);
  const value = (await browser.storage.local.get(key))[key];
  return isStudyLogEntry(value) ? value : null;
}

/** Spec §5.3 step 3.1: the saved explanation of this line, in this language, in this video. */
export async function findEntry(videoId: string, language: string, phrase: string): Promise<StudyLogEntry | null> {
  const key = indexKey(videoId, language, phrase);
  const id = (await browser.storage.local.get(key))[key];
  return typeof id === 'string' ? getEntry(id) : null;
}

export async function listEntries(): Promise<StudyLogEntry[]> {
  const all = await browser.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ENTRY_PREFIX))
    .map(([, value]) => value)
    .filter(isStudyLogEntry);
}

/**
 * Saves a finished explanation. Saving a line that already has an entry replaces its response and clears
 * its follow-ups (they referred to the old response) but keeps its id and savedAt — that is Regenerate.
 */
export async function saveExplanation(
  fields: NewStudyLogEntry,
  now: Date = new Date(),
  newId: () => string = () => crypto.randomUUID(),
): Promise<StudyLogEntry> {
  const existing = await findEntry(fields.videoId, fields.explanationLanguage, fields.phrase);
  const stamp = now.toISOString();
  const entry: StudyLogEntry = existing
    ? { ...existing, ...fields, followUps: [], updatedAt: stamp }
    : { ...fields, id: newId(), followUps: [], savedAt: stamp, updatedAt: stamp };
  await browser.storage.local.set({ [entryKey(entry.id)]: entry, [indexKeyOf(entry)]: entry.id });
  return entry;
}

export async function appendFollowUp(id: string, followUp: FollowUp, now: Date = new Date()): Promise<StudyLogEntry | null> {
  const entry = await getEntry(id);
  if (!entry) return null;
  const next: StudyLogEntry = { ...entry, followUps: [...entry.followUps, followUp], updatedAt: now.toISOString() };
  await browser.storage.local.set({ [entryKey(id)]: next });
  return next;
}

export async function deleteEntries(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const keys = ids.map(entryKey);
  const stored = Object.values(await browser.storage.local.get(keys)).filter(isStudyLogEntry);
  const indexes = await browser.storage.local.get(stored.map(indexKeyOf));
  const ownIndexes = Object.entries(indexes)
    .filter(([, id]) => typeof id === 'string' && ids.includes(id))
    .map(([key]) => key);
  await browser.storage.local.remove([...keys, ...ownIndexes]);
}

/** Spec §5.5 Reset all: every entry and lookup key, nothing else (the API key stays). */
export async function resetStudyLog(): Promise<void> {
  const keys = Object.keys(await browser.storage.local.get(null)).filter(
    (key) => key.startsWith(ENTRY_PREFIX) || key.startsWith(INDEX_PREFIX),
  );
  if (keys.length > 0) await browser.storage.local.remove(keys);
}

/** Calls back whenever any entry is added, changed, or removed (e.g. from a Netflix tab). */
export function watchStudyLog(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(ENTRY_PREFIX))) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
```

- [ ] **Step 5: Implement `src/lib/study-log/group.ts`**

```ts
import type { StudyLogEntry } from './types';

export interface EpisodeNode {
  key: string;
  videoId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  entries: StudyLogEntry[];
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
  entries: StudyLogEntry[];
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

const newestFirst = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);
const byTime = (a: StudyLogEntry, b: StudyLogEntry) => a.videoTimeMs - b.videoTimeMs;

/** Spec §5.5: series by most recently updated; seasons and episodes in numeric order; Movies by most recent. */
export function groupStudyLog(entries: readonly StudyLogEntry[]): StudyLogTree {
  const series = new Map<string, SeriesNode>();
  const movies = new Map<string, MovieNode>();

  for (const e of entries) {
    if (e.kind === 'movie') {
      const movie = movies.get(e.videoId) ?? { key: `movie:${e.videoId}`, videoId: e.videoId, title: e.seriesTitle, entries: [], updatedAt: e.updatedAt };
      movie.entries.push(e);
      if (e.updatedAt > movie.updatedAt) movie.updatedAt = e.updatedAt;
      movies.set(e.videoId, movie);
      continue;
    }
    const seriesKey = `series:${e.seriesId ?? e.seriesTitle}`;
    const show = series.get(seriesKey) ?? { key: seriesKey, seriesId: e.seriesId, title: e.seriesTitle, seasons: [], count: 0, updatedAt: e.updatedAt };
    series.set(seriesKey, show);
    if (e.updatedAt > show.updatedAt) show.updatedAt = e.updatedAt;
    show.count++;

    let season = show.seasons.find((s) => s.seasonNumber === e.seasonNumber);
    if (!season) {
      season = { key: `${seriesKey}|season:${e.seasonNumber ?? 'none'}`, seasonNumber: e.seasonNumber, episodes: [], count: 0 };
      show.seasons.push(season);
    }
    season.count++;

    let episode = season.episodes.find((ep) => ep.videoId === e.videoId);
    if (!episode) {
      episode = { key: `episode:${e.videoId}`, videoId: e.videoId, episodeNumber: e.episodeNumber, episodeTitle: e.episodeTitle, entries: [] };
      season.episodes.push(episode);
    }
    episode.entries.push(e);
  }

  const sortedSeries = [...series.values()].sort(newestFirst);
  for (const show of sortedSeries) {
    show.seasons.sort((a, b) => byNumber(a.seasonNumber, b.seasonNumber));
    for (const season of show.seasons) {
      season.episodes.sort((a, b) => byNumber(a.episodeNumber, b.episodeNumber) || a.videoId.localeCompare(b.videoId));
      for (const episode of season.episodes) episode.entries.sort(byTime);
    }
  }
  const sortedMovies = [...movies.values()].sort(newestFirst);
  for (const movie of sortedMovies) movie.entries.sort(byTime);

  return { series: sortedSeries, movies: sortedMovies, total: entries.length };
}
```

- [ ] **Step 6: Implement `src/lib/study-log/format.ts`**

```ts
/** "30:34", or "1:02:03" past an hour — like Netflix's player. */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export function seasonLabel(seasonNumber: number | null): string {
  return seasonNumber === null ? 'Episodes' : `Season ${seasonNumber}`;
}

export function episodeLabel(episode: { episodeNumber: number | null; episodeTitle: string | null }): string {
  const parts = [episode.episodeNumber !== null ? `E${episode.episodeNumber}` : null, episode.episodeTitle];
  return parts.filter(Boolean).join(' · ') || 'Episode';
}
```

- [ ] **Step 7: Run the tests to make sure they pass**

Run: `pnpm vitest run tests/unit/study-log.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/study-log tests/unit/study-log.test.ts
git commit -m "feat: Study Log store with per-line lookup, follow-ups, deletes, reset, and grouping" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Claude core — prompts, port protocol, error mapping

Spec sections:
- §7.1: model and limits.
- §7.2: system prompt and user message, exactly as written (the spec now also says bracketed text is a sound description).
- §7.3: follow-ups.
- §7.4: error copy.
- §6.3: the `explain` Port messages.

All of this is pure code. The SDK is used here only for its error classes.

**Files:**
- Modify: `src/lib/config.ts`, `package.json` (add `@anthropic-ai/sdk`)
- Create: `src/lib/claude/prompt.ts`, `src/lib/claude/protocol.ts`, `src/lib/claude/errors.ts`
- Test: `tests/unit/claude.test.ts`

**Interfaces:**
- Consumes:
  - `TitleInfo`, `parseTitleInfo` (Task 5)
  - `DialogueContext` (Task 4)
  - `CardSections`, `CARD_SECTION_IDS` (Task 2)
  - `getExplanationLanguage`, `isExplanationLanguage` (Task 2)
  - `StudyLogEntry` (Task 7)
  - `normalizeLine` (Task 3)
- Produces:
  - `config.ts`: `CLAUDE_MODEL`, `CLAUDE_MAX_TOKENS = 1024`, `CLAUDE_API_BASE_URL`, `CLAUDE_IDLE_TIMEOUT_MS = 30_000`, `ANTHROPIC_KEYS_URL`
  - `prompt.ts`:
    - `interface ExplainRequest { phrase; context; title: TitleInfo | null; videoId; videoTimeMs; language; sections }`
    - `interface ChatMessage { role: 'user' | 'assistant'; content: string }`
    - `buildSystemPrompt(language, sections, followUp?)`
    - `titleLine(title)`
    - `buildUserMessage(req)`
    - `buildFollowUpMessages(entry, question)`
  - `protocol.ts`:
    - `EXPLAIN_PORT = 'explain'`
    - `ExplainClientMessage`, `ExplainServerMessage`, `ExplainErrorCode`
    - `parseClientMessage(value): ExplainClientMessage | null`
  - `protocol.ts` also: `ERROR_COPY: Record<ExplainErrorCode, string>` (no SDK import, so the content script can use it)
  - `errors.ts`: `toExplainError(err): { code; message }` (imports the SDK; background only)

- [ ] **Step 1: Add the SDK**

Run: `pnpm add --save-exact @anthropic-ai/sdk@0.128.0`
Expected: `+ @anthropic-ai/sdk 0.128.0` and "Lockfile passes supply-chain policies".

This version was chosen as the newest release at least 2 weeks old when the plan was written. If it can't be installed, run `pnpm view @anthropic-ai/sdk time --json` and pick the newest release at least 2 weeks old. Ledger that as a ruling.

- [ ] **Step 2: Write the failing tests**

`tests/unit/claude.test.ts`:

```ts
import { APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { toExplainError } from '@/lib/claude/errors';
import { buildFollowUpMessages, buildSystemPrompt, buildUserMessage, titleLine, type ExplainRequest } from '@/lib/claude/prompt';
import { parseClientMessage } from '@/lib/claude/protocol';
import type { TitleInfo } from '@/lib/netflix/title';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import type { StudyLogEntry } from '@/lib/study-log/types';

const ALL = DEFAULT_SETTINGS.cardSections;
const EPISODE: TitleInfo = {
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
};

describe('buildSystemPrompt', () => {
  it('is the spec §7.2 prompt in the chosen language with every enabled section', () => {
    const prompt = buildSystemPrompt('ko', ALL);
    expect(prompt).toContain(
      'You are a language tutor helping a learner understand dialogue from a show or film they are watching on Netflix. Write your entire answer in Korean (한국어); quote words from the original line in their original language.',
    );
    expect(prompt).toContain('Text in square brackets is a sound description or speaker label, not dialogue.');
    expect(prompt).toContain('Be concise — the learner has paused the video.');
    expect(prompt.endsWith(
      'with headings written in Korean (한국어):\n' +
        '1. Meaning — natural translation plus what the line means in this scene: tone, nuance, sarcasm, slang, register.\n' +
        '2. Key expressions — idioms, phrasal verbs, slang in the line, each with a short definition.\n' +
        '3. How to use it — 2–3 everyday example sentences in the original language, each with a translation.',
    )).toBe(true);
  });

  it('lists only the enabled sections, and falls back to Meaning when none are', () => {
    expect(buildSystemPrompt('en', { ...ALL, meaning: false, keyExpressions: false })).toMatch(/written in English:\n1\. How to use it — /);
    const none = buildSystemPrompt('en', { meaning: false, keyExpressions: false, howToUse: false, followUp: true });
    expect(none).toMatch(/written in English:\n1\. Meaning — /);
    expect(none).not.toContain('2.');
  });

  it('adds the follow-up instruction (spec §7.3)', () => {
    expect(buildSystemPrompt('ja', ALL, true)).toMatch(
      /The learner is now asking a follow-up question about this line\. Answer it directly and briefly in Japanese \(日本語\), without those sections\.$/,
    );
  });
});

describe('user message', () => {
  it('matches the spec §7.2 layout', () => {
    const request = {
      phrase: "I'm gonna call it\na night.",
      context: { before: ['Where are you going?', 'Home.'], after: ['Night, Mike.'] },
      title: EPISODE,
    };
    expect(buildUserMessage(request)).toBe(
      [
        'Title: Stranger Things — Season 1, Episode 3 "Holly, Jolly"',
        'Dialogue (the line to explain is marked with >>>):',
        '  Where are you going?',
        '  Home.',
        ">>> I'm gonna call it a night.",
        '  Night, Mike.',
      ].join('\n'),
    );
  });

  it('names movies and incomplete titles', () => {
    expect(titleLine({ ...EPISODE, kind: 'movie', seriesTitle: 'Roma', seasonNumber: null, episodeNumber: null, episodeTitle: null })).toBe('Movie: Roma');
    expect(titleLine({ ...EPISODE, seasonNumber: null, episodeTitle: null })).toBe('Title: Stranger Things — Episode 3');
    expect(titleLine({ ...EPISODE, seasonNumber: null, episodeNumber: null, episodeTitle: null })).toBe('Title: Stranger Things');
    expect(titleLine(null)).toBe('Title: unknown');
  });
});

describe('buildFollowUpMessages', () => {
  it('replays the conversation: request, explanation, earlier Q&A, new question', () => {
    const entry = {
      phrase: 'Line',
      response: 'Explanation',
      followUps: [{ question: 'Q1', answer: 'A1' }],
      context: { before: [], after: [] },
      ...EPISODE,
    } as unknown as StudyLogEntry;
    const messages = buildFollowUpMessages(entry, '  Q2  ');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(messages[0]!.content).toContain('>>> Line');
    expect(messages.slice(1).map((m) => m.content)).toEqual(['Explanation', 'Q1', 'A1', 'Q2']);
  });
});

describe('toExplainError', () => {
  const headers = new Headers();
  it('maps API failures to the card states of spec §7.4', () => {
    expect(toExplainError(APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'x', headers))).toEqual({
      code: 'bad-key',
      message: 'Your API key was rejected',
    });
    expect(toExplainError(APIError.generate(429, { error: { type: 'rate_limit_error', message: 'slow' } }, 'x', headers)).code).toBe('busy');
    expect(toExplainError(APIError.generate(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, 'x', headers)).code).toBe('busy');
    expect(toExplainError(new APIConnectionError({ message: 'fetch failed' })).code).toBe('network');
    expect(toExplainError(new APIConnectionTimeoutError()).code).toBe('network');
  });

  it("shows Anthropic's own message for other API errors", () => {
    const credit = APIError.generate(
      400,
      { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } },
      'x',
      headers,
    );
    expect(toExplainError(credit)).toEqual({ code: 'api', message: 'Your credit balance is too low to access the Anthropic API.' });
  });
});

describe('parseClientMessage', () => {
  const request: ExplainRequest = {
    phrase: 'Hi',
    context: { before: ['a'], after: [] },
    title: EPISODE,
    videoId: '80077211',
    videoTimeMs: 1000,
    language: 'ko',
    sections: ALL,
  };

  it('accepts well-formed start and follow-up messages', () => {
    expect(parseClientMessage({ type: 'start', request })).toEqual({ type: 'start', request });
    expect(parseClientMessage({ type: 'follow-up', entryId: 'e1', question: 'Why?', sections: ALL })).toEqual({
      type: 'follow-up',
      entryId: 'e1',
      question: 'Why?',
      sections: ALL,
    });
  });

  it('rejects malformed ones', () => {
    expect(parseClientMessage({ type: 'start', request: { ...request, phrase: '' } })).toBeNull();
    expect(parseClientMessage({ type: 'start', request: { ...request, language: 'xx' } })).toBeNull();
    expect(parseClientMessage({ type: 'start', request: { ...request, videoTimeMs: Number.NaN } })).toBeNull();
    expect(parseClientMessage({ type: 'start', request: { ...request, context: { before: [1], after: [] } } })).toBeNull();
    expect(parseClientMessage({ type: 'follow-up', entryId: 'e1', question: '   ', sections: ALL })).toBeNull();
    expect(parseClientMessage({ type: 'nope' })).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/claude.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/claude/errors"`.

- [ ] **Step 4: Add the Claude constants to `src/lib/config.ts`**

Append:

```ts
/** Spec §7.1: one constant for the model. */
export const CLAUDE_MODEL = 'claude-sonnet-5-5';
export const CLAUDE_MAX_TOKENS = 1024;
export const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';
/** Spec §7.4: a stream silent this long is treated as a network failure. */
export const CLAUDE_IDLE_TIMEOUT_MS = 30_000;
/** Where users create an API key. */
export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';
```

- [ ] **Step 5: Implement `src/lib/claude/prompt.ts`**

```ts
import { getExplanationLanguage } from '@/lib/languages';
import type { TitleInfo } from '@/lib/netflix/title';
import type { CardSections } from '@/lib/settings';
import type { StudyLogEntry } from '@/lib/study-log/types';
import type { DialogueContext } from '@/lib/subtitles/context';
import { normalizeLine } from '@/lib/subtitles/cue';

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
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type ContentSection = 'meaning' | 'keyExpressions' | 'howToUse';
const CONTENT_SECTIONS: readonly ContentSection[] = ['meaning', 'keyExpressions', 'howToUse'];

/** One-sentence descriptions from spec §5.3. */
const SECTION_TEXT: Record<ContentSection, string> = {
  meaning: 'Meaning — natural translation plus what the line means in this scene: tone, nuance, sarcasm, slang, register.',
  keyExpressions: 'Key expressions — idioms, phrasal verbs, slang in the line, each with a short definition.',
  howToUse: 'How to use it — 2–3 everyday example sentences in the original language, each with a translation.',
};

function languageName(code: string): string {
  const l = getExplanationLanguage(code);
  return l.englishName === l.nativeName ? l.englishName : `${l.englishName} (${l.nativeName})`;
}

/** Spec §7.2 (and §7.3 when `followUp`). With every content section off, Meaning is still asked for. */
export function buildSystemPrompt(language: string, sections: CardSections, followUp = false): string {
  const lang = languageName(language);
  const enabled = CONTENT_SECTIONS.filter((id) => sections[id]);
  const list = (enabled.length > 0 ? enabled : (['meaning'] as const)).map((id, i) => `${i + 1}. ${SECTION_TEXT[id]}`).join('\n');
  const prompt =
    'You are a language tutor helping a learner understand dialogue from a show or film they are watching on Netflix. ' +
    `Write your entire answer in ${lang}; quote words from the original line in their original language. ` +
    'Use the surrounding dialogue and the title information to work out the speaker, the tone, and what the line actually means in this scene. ' +
    'Text in square brackets is a sound description or speaker label, not dialogue. ' +
    'Be concise — the learner has paused the video. ' +
    `Use Markdown with exactly these sections, in this order, with headings written in ${lang}:\n${list}`;
  return followUp
    ? `${prompt}\n\nThe learner is now asking a follow-up question about this line. Answer it directly and briefly in ${lang}, without those sections.`
    : prompt;
}

/** `Title: Stranger Things — Season 1, Episode 3 "Holly, Jolly"` or `Movie: Roma`. */
export function titleLine(title: TitleInfo | null): string {
  if (!title) return 'Title: unknown';
  if (title.kind === 'movie') return `Movie: ${title.seriesTitle}`;
  const numbers = [
    title.seasonNumber !== null ? `Season ${title.seasonNumber}` : null,
    title.episodeNumber !== null ? `Episode ${title.episodeNumber}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const detail = [numbers, title.episodeTitle ? `"${title.episodeTitle}"` : null].filter(Boolean).join(' ');
  return detail ? `Title: ${title.seriesTitle} — ${detail}` : `Title: ${title.seriesTitle}`;
}

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

const titleOf = (entry: StudyLogEntry): TitleInfo => ({
  videoId: entry.videoId,
  kind: entry.kind,
  seriesId: entry.seriesId,
  seriesTitle: entry.seriesTitle,
  seasonNumber: entry.seasonNumber,
  episodeNumber: entry.episodeNumber,
  episodeTitle: entry.episodeTitle,
});

/** Spec §7.3: [user: initial request, assistant: explanation, user: q1, assistant: a1, …, user: new question]. */
export function buildFollowUpMessages(entry: StudyLogEntry, question: string): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'user', content: buildUserMessage({ phrase: entry.phrase, context: entry.context, title: titleOf(entry) }) },
    { role: 'assistant', content: entry.response },
  ];
  for (const followUp of entry.followUps) {
    messages.push({ role: 'user', content: followUp.question }, { role: 'assistant', content: followUp.answer });
  }
  messages.push({ role: 'user', content: question.trim() });
  return messages;
}
```

- [ ] **Step 6: Implement `src/lib/claude/protocol.ts`**

```ts
import { parseTitleInfo } from '@/lib/bridge/protocol';
import { isExplanationLanguage } from '@/lib/languages';
import { CARD_SECTION_IDS, type CardSections } from '@/lib/settings';
import type { StudyLogEntry } from '@/lib/study-log/types';
import type { ExplainRequest } from './prompt';

/** One Port per request (spec §6.3); disconnecting aborts it. */
export const EXPLAIN_PORT = 'explain';

export type ExplainClientMessage =
  | { type: 'start'; request: ExplainRequest }
  | { type: 'follow-up'; entryId: string; question: string; sections: CardSections };

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

export type ExplainServerMessage =
  | { type: 'delta'; text: string }
  | { type: 'done'; entry: StudyLogEntry }
  | { type: 'error'; code: ExplainErrorCode; message: string };

const MAX_LINE_CHARS = 2000;
const MAX_QUESTION_CHARS = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isLine = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_LINE_CHARS;
const isLines = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 6 && value.every(isLine);

function parseSections(value: unknown): CardSections | null {
  if (!isRecord(value) || !CARD_SECTION_IDS.every((id) => typeof value[id] === 'boolean')) return null;
  return { meaning: !!value.meaning, keyExpressions: !!value.keyExpressions, howToUse: !!value.howToUse, followUp: !!value.followUp };
}

function parseRequest(value: unknown): ExplainRequest | null {
  if (!isRecord(value)) return null;
  const { phrase, context, title, videoId, videoTimeMs, language, sections } = value;
  if (!isLine(phrase) || !phrase.trim()) return null;
  if (!isRecord(context) || !isLines(context.before) || !isLines(context.after)) return null;
  if (typeof videoId !== 'string' || !/^\d+$/.test(videoId)) return null;
  if (typeof videoTimeMs !== 'number' || !Number.isFinite(videoTimeMs) || videoTimeMs < 0) return null;
  if (!isExplanationLanguage(language)) return null;
  const parsedSections = parseSections(sections);
  const parsedTitle = title === null ? null : parseTitleInfo(title);
  if (!parsedSections || (title !== null && !parsedTitle)) return null;
  return {
    phrase,
    context: { before: context.before, after: context.after },
    title: parsedTitle,
    videoId,
    videoTimeMs,
    language,
    sections: parsedSections,
  };
}

export function parseClientMessage(value: unknown): ExplainClientMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === 'start') {
    const request = parseRequest(value.request);
    return request ? { type: 'start', request } : null;
  }
  if (value.type === 'follow-up') {
    const { entryId, question } = value;
    const sections = parseSections(value.sections);
    if (typeof entryId !== 'string' || !entryId || !sections) return null;
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_CHARS) return null;
    return { type: 'follow-up', entryId, question, sections };
  }
  return null;
}
```

- [ ] **Step 7: Implement `src/lib/claude/errors.ts`**

```ts
import { APIConnectionError, APIError, AuthenticationError, RateLimitError } from '@anthropic-ai/sdk';
import { ERROR_COPY, type ExplainErrorCode } from './protocol';

const failure = (code: ExplainErrorCode) => ({ code, message: ERROR_COPY[code] });

function anthropicMessage(err: APIError): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  return typeof message === 'string' && message ? message : err.message;
}

export function toExplainError(err: unknown): { code: ExplainErrorCode; message: string } {
  if (err instanceof AuthenticationError) return failure('bad-key');
  if (err instanceof RateLimitError) return failure('busy');
  if (err instanceof APIConnectionError) return failure('network'); // includes timeouts
  if (err instanceof APIError) {
    if (err.status === 529 || err.type === 'overloaded_error') return failure('busy');
    return { code: 'api', message: anthropicMessage(err) };
  }
  return { code: 'api', message: err instanceof Error ? err.message : String(err) };
}
```

- [ ] **Step 8: Run the tests to make sure they pass**

Run: `pnpm vitest run tests/unit/claude.test.ts && pnpm compile`
Expected: PASS (10 tests); `tsc` prints nothing.

The test file needs `Headers` and the SDK's error classes, both available in Vitest's Node environment.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/config.ts src/lib/claude tests/unit/claude.test.ts
git commit -m "feat: Claude prompts, explain port protocol, and error mapping" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Background worker — API key, streaming explanations, messages, permissions

Spec sections:
- §6.2: the background is the only reader of the API key; it runs the Claude calls and writes the Study Log.
- §6.3: the Port and `sendMessage` protocols.
- §7.1–7.4.
- §5.8 Test key (`GET /v1/models`).
- §5.5 pending seek.
- §10: permissions; the key is sent only to `api.anthropic.com`.

Rule: aborted or failed requests are never saved (§5.3 step 3.3).

**Files:**
- Create:
  - `src/lib/claude/client.ts`, `src/lib/claude/explain-service.ts`
  - `src/lib/api-key.ts`, `src/lib/pending-seek.ts`, `src/lib/messages.ts`
  - `src/lib/background/message-handler.ts`, `src/entrypoints/background.ts`
- Modify: `wxt.config.ts`
- Test: `tests/unit/explain-service.test.ts`, `tests/unit/background-messages.test.ts`

**Interfaces:**
- Consumes:
  - From Task 8: `buildSystemPrompt`, `buildUserMessage`, `buildFollowUpMessages`, `parseClientMessage`, `EXPLAIN_PORT`, `ExplainServerMessage`, `ERROR_COPY` (from `protocol.ts`), `toExplainError`, the `CLAUDE_*` constants
  - From Task 7: `saveExplanation`, `getEntry`, `appendFollowUp`, `findEntry`
- Produces:
  - `client.ts`:
    - `interface StreamParams { model; maxTokens; system; messages }`
    - `interface ClaudeClient { streamText(params, onText, signal): Promise<string>; checkKey(): Promise<void> }`
    - `createSdkClient(apiKey)`
  - `explain-service.ts`:
    - `interface ExplainPort { postMessage; onMessage.addListener; onDisconnect.addListener }`
    - `interface ExplainServiceDeps`
    - `serveExplainPort(port, deps): void`
  - `api-key.ts`: `getApiKey()`, `setApiKey(key)`, `removeApiKey()`, `maskApiKey(key)`
  - `pending-seek.ts`: `PENDING_SEEK_MAX_AGE_MS`, `setPendingSeek(videoId, timeMs, now?)`, `takePendingSeek(videoId, now?)`
  - `messages.ts`:
    - `BackgroundRequests` map, `BackgroundRequest<T>`, `BackgroundResponse<T>`
    - `KeyTestResult = 'valid' | 'rejected' | 'network' | 'error'`
    - `sendToBackground(message)`
  - `message-handler.ts`: `createMessageHandler(deps): (message: unknown) => Promise<unknown>`

- [ ] **Step 1: Write the failing explain-service tests**

`tests/unit/explain-service.test.ts`:

```ts
import { APIError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ClaudeClient, StreamParams } from '@/lib/claude/client';
import { serveExplainPort, type ExplainPort, type ExplainServiceDeps } from '@/lib/claude/explain-service';
import type { ExplainRequest } from '@/lib/claude/prompt';
import type { ExplainServerMessage } from '@/lib/claude/protocol';
import { CLAUDE_MODEL } from '@/lib/config';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { appendFollowUp, findEntry, getEntry, listEntries, saveExplanation } from '@/lib/study-log/store';

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
  videoTimeMs: 1_834_200,
  language: 'ko',
  sections: DEFAULT_SETTINGS.cardSections,
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

function fakeClient(script: { deltas?: string[]; error?: unknown; hang?: boolean } = {}) {
  const calls: StreamParams[] = [];
  const signals: AbortSignal[] = [];
  const client: ClaudeClient = {
    async streamText(params, onText, signal) {
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
      return (script.deltas ?? []).join('');
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
    getEntry,
    appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
    ...over,
  };
}

describe('explain service', () => {
  it('streams deltas, saves the explanation, and finishes with the saved entry', async () => {
    const { client, calls } = fakeClient({ deltas: ['## 의미\n', '잘 시간이야.'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(sent.slice(0, 2)).toEqual([
      { type: 'delta', text: '## 의미\n' },
      { type: 'delta', text: '잘 시간이야.' },
    ]);
    const done = sent.at(-1) as Extract<ExplainServerMessage, { type: 'done' }>;
    expect(done.entry).toMatchObject({
      phrase: REQUEST.phrase,
      response: '## 의미\n잘 시간이야.',
      videoTimeMs: 1_834_200,
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      explanationLanguage: 'ko',
      model: CLAUDE_MODEL,
      context: REQUEST.context,
    });
    expect(await findEntry('80077211', 'ko', REQUEST.phrase)).toEqual(done.entry);
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5-5', maxTokens: 1024 });
    expect(calls[0]!.system).toContain('Korean (한국어)');
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: expect.stringContaining(">>> I'm gonna call it a night.") }]);
  });

  it('without a key, asks for one and makes no request', async () => {
    const createClient = vi.fn();
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(fakeClient().client, { getApiKey: async () => null, createClient }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'no-key', message: 'Add your Claude API key' }]));
    expect(createClient).not.toHaveBeenCalled();
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
    expect(await listEntries()).toEqual([]);
  });

  it("a silent stream times out as Couldn't reach Claude", async () => {
    const { client } = fakeClient({ hang: true });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client, { idleTimeoutMs: 20 }));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'network', message: "Couldn't reach Claude" }]));
    expect(await listEntries()).toEqual([]);
  });

  it('maps API errors to card states and saves nothing', async () => {
    const rejected = APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'x', new Headers());
    const { client } = fakeClient({ deltas: [], error: rejected });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'error', code: 'bad-key', message: 'Your API key was rejected' }]));
    expect(await listEntries()).toEqual([]);
  });

  it('an empty answer is an error, not an entry', async () => {
    const { client } = fakeClient({ deltas: ['  '] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'start', request: REQUEST });
    await vi.waitFor(() => expect(sent.at(-1)).toEqual({ type: 'error', code: 'api', message: 'Claude returned an empty answer.' }));
    expect(await listEntries()).toEqual([]);
  });

  it('follow-up: replays the conversation and appends the Q&A to the entry', async () => {
    const saved = await saveExplanation({
      phrase: REQUEST.phrase,
      response: 'Explanation',
      videoTimeMs: 1000,
      videoId: '80077211',
      kind: 'episode',
      seriesId: '1',
      seriesTitle: 'Stranger Things',
      seasonNumber: 1,
      episodeNumber: 3,
      episodeTitle: null,
      context: { before: [], after: [] },
      explanationLanguage: 'ko',
      model: CLAUDE_MODEL,
    });
    const { client, calls } = fakeClient({ deltas: ['아니요.'] });
    const { port, sent, send } = fakePort();
    serveExplainPort(port, deps(client));
    send({ type: 'follow-up', entryId: saved.id, question: ' Is it formal? ', sections: DEFAULT_SETTINGS.cardSections });
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('done'));
    expect(calls[0]!.system).toContain('follow-up question');
    expect(calls[0]!.messages.map((m) => m.content).slice(1)).toEqual(['Explanation', 'Is it formal?']);
    expect((await getEntry(saved.id))?.followUps).toEqual([{ question: 'Is it formal?', answer: '아니요.' }]);
  });

  it('follow-up on a deleted entry, malformed messages, and second messages are handled', async () => {
    const { client } = fakeClient({ deltas: ['x'] });
    const a = fakePort();
    serveExplainPort(a.port, deps(client));
    a.send({ type: 'follow-up', entryId: 'gone', question: 'Why?', sections: DEFAULT_SETTINGS.cardSections });
    await vi.waitFor(() => expect(a.sent).toEqual([{ type: 'error', code: 'api', message: 'This explanation is no longer in your Study Log.' }]));

    const b = fakePort();
    serveExplainPort(b.port, deps(client));
    b.send({ type: 'start', request: { ...REQUEST, phrase: '' } });
    b.send({ type: 'start', request: REQUEST }); // ignored: one request per port
    await vi.waitFor(() => expect(b.sent).toEqual([{ type: 'error', code: 'api', message: 'LingoFlix sent a request it could not read.' }]));
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/explain-service.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/claude/client"`.

- [ ] **Step 3: Implement `src/lib/claude/client.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_API_BASE_URL } from '@/lib/config';
import type { ChatMessage } from './prompt';

export interface StreamParams {
  model: string;
  maxTokens: number;
  system: string;
  messages: ChatMessage[];
}

/** The slice of the Anthropic SDK LingoFlix uses. Tests substitute a fake. */
export interface ClaudeClient {
  /** Streams text deltas to `onText` and resolves with the full text; rejects with the SDK's errors. */
  streamText(params: StreamParams, onText: (delta: string) => void, signal: AbortSignal): Promise<string>;
  /** The cheapest authenticated call, `GET /v1/models` (spec §5.8 Test key). */
  checkKey(): Promise<void>;
}

const KEY_CHECK_TIMEOUT_MS = 15_000;

export function createSdkClient(apiKey: string): ClaudeClient {
  // Runs in the extension's service worker; the key only ever goes to api.anthropic.com.
  const client = new Anthropic({ apiKey, baseURL: CLAUDE_API_BASE_URL, dangerouslyAllowBrowser: true });
  return {
    async streamText(params, onText, signal) {
      const stream = client.messages.stream(
        { model: params.model, max_tokens: params.maxTokens, system: params.system, messages: params.messages },
        { signal },
      );
      stream.on('text', (delta) => onText(delta));
      const message = await stream.finalMessage();
      return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    },
    async checkKey() {
      await client.models.list({ limit: 1 }, { timeout: KEY_CHECK_TIMEOUT_MS, maxRetries: 0 });
    },
  };
}
```

- [ ] **Step 4: Implement `src/lib/claude/explain-service.ts`**

```ts
import { CLAUDE_IDLE_TIMEOUT_MS, CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from '@/lib/config';
import type { FollowUp, NewStudyLogEntry, StudyLogEntry } from '@/lib/study-log/types';
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
  saveExplanation(fields: NewStudyLogEntry): Promise<StudyLogEntry>;
  getEntry(id: string): Promise<StudyLogEntry | null>;
  appendFollowUp(id: string, followUp: FollowUp): Promise<StudyLogEntry | null>;
  idleTimeoutMs?: number;
}

const UNREADABLE = 'LingoFlix sent a request it could not read.';
const ENTRY_GONE = 'This explanation is no longer in your Study Log.';
const EMPTY_ANSWER = 'Claude returned an empty answer.';

function entryFields(request: ExplainRequest, response: string): NewStudyLogEntry {
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
    void run(raw);
  });

  async function run(raw: unknown): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message) return fail('api', UNREADABLE);
    const apiKey = await deps.getApiKey();
    if (!apiKey) return fail('no-key');
    if (disconnected) return;

    let system: string;
    let messages: ChatMessage[];
    let finish: (text: string) => Promise<StudyLogEntry | null>;
    if (message.type === 'start') {
      const { request } = message;
      system = buildSystemPrompt(request.language, request.sections);
      messages = [{ role: 'user', content: buildUserMessage(request) }];
      finish = (text) => deps.saveExplanation(entryFields(request, text));
    } else {
      const entry = await deps.getEntry(message.entryId);
      if (!entry) return fail('api', ENTRY_GONE);
      system = buildSystemPrompt(entry.explanationLanguage, message.sections, true);
      messages = buildFollowUpMessages(entry, message.question);
      finish = (text) => deps.appendFollowUp(entry.id, { question: message.question.trim(), answer: text });
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
      const entry = await finish(text);
      if (!entry) return fail('api', ENTRY_GONE);
      post({ type: 'done', entry });
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

- [ ] **Step 5: Run them to make sure they pass**

Run: `pnpm vitest run tests/unit/explain-service.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Write the failing message-handler tests**

`tests/unit/background-messages.test.ts`:

```ts
import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getApiKey, maskApiKey, removeApiKey, setApiKey } from '@/lib/api-key';
import { createMessageHandler, type MessageHandlerDeps } from '@/lib/background/message-handler';
import type { ClaudeClient } from '@/lib/claude/client';
import { PENDING_SEEK_MAX_AGE_MS, setPendingSeek, takePendingSeek } from '@/lib/pending-seek';
import { findEntry, saveExplanation } from '@/lib/study-log/store';

beforeEach(() => fakeBrowser.reset());

const KEY = 'sk-ant-api03-abcdefghijklmnop-wxyz';

function handlerWith(checkKey: ClaudeClient['checkKey'] = async () => {}, over: Partial<MessageHandlerDeps> = {}) {
  const createClient = vi.fn((_key: string): ClaudeClient => ({ streamText: async () => '', checkKey }));
  const openOptions = vi.fn(async (_hash?: string) => {});
  const handle = createMessageHandler({
    getApiKey,
    setApiKey,
    removeApiKey,
    createClient,
    findEntry,
    takePendingSeek: (videoId) => takePendingSeek(videoId),
    openOptions,
    ...over,
  });
  return { handle, createClient, openOptions };
}

describe('API key requests', () => {
  it('stores, reports (masked), and removes the key — never echoing it back', async () => {
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

  it('refuses keys that are empty or contain spaces', async () => {
    const { handle } = handlerWith();
    expect(await handle({ type: 'api-key:set', key: '   ' })).toEqual({ ok: false });
    expect(await handle({ type: 'api-key:set', key: 'two words' })).toEqual({ ok: false });
    expect(await getApiKey()).toBeNull();
  });

  it('Test key: valid, rejected, or network — using the typed key, else the saved one', async () => {
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

describe('Study Log lookup and pending seek', () => {
  it('finds a saved explanation for a line', async () => {
    const saved = await saveExplanation({
      phrase: 'Hi there.',
      response: 'r',
      videoTimeMs: 1,
      videoId: '1',
      kind: 'movie',
      seriesId: null,
      seriesTitle: 'M',
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null,
      context: { before: [], after: [] },
      explanationLanguage: 'en',
      model: 'm',
    });
    const { handle } = handlerWith();
    expect(await handle({ type: 'log:find', videoId: '1', language: 'en', phrase: 'Hi  there.' })).toEqual({ entry: saved });
    expect(await handle({ type: 'log:find', videoId: '1', language: 'ko', phrase: 'Hi there.' })).toEqual({ entry: null });
  });

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

  it('rejects unknown requests', async () => {
    const { handle } = handlerWith();
    await expect(handle({ type: 'nope' })).rejects.toThrow(/Unknown request/);
    await expect(handle('nope')).rejects.toThrow(/Unknown request/);
  });
});
```

- [ ] **Step 7: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/background-messages.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/api-key"`.

- [ ] **Step 8: Implement `src/lib/api-key.ts`**

```ts
import { storage } from '#imports';

/** chrome.storage.local `apiKey` — never synced; read only by the background worker (spec §6.4). */
const API_KEY = 'local:apiKey';

export async function getApiKey(): Promise<string | null> {
  const value = await storage.getItem<string>(API_KEY);
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function setApiKey(key: string): Promise<void> {
  await storage.setItem(API_KEY, key.trim());
}

export async function removeApiKey(): Promise<void> {
  await storage.removeItem(API_KEY);
}

/** "sk-ant-…wxyz": enough to recognize the key, never enough to use it. */
export function maskApiKey(key: string): string {
  return key.length <= 12 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`;
}
```

- [ ] **Step 9: Implement `src/lib/pending-seek.ts`**

```ts
import { storage } from '#imports';

/** "Open at this moment" (spec §5.5): kept in chrome.storage.session until the watch page takes it. */
export interface PendingSeek {
  videoId: string;
  timeMs: number;
  createdAt: number;
}

export const PENDING_SEEK_MAX_AGE_MS = 120_000;
const PENDING_SEEK_KEY = 'session:pendingSeek';

export async function setPendingSeek(videoId: string, timeMs: number, now: number = Date.now()): Promise<void> {
  await storage.setItem<PendingSeek>(PENDING_SEEK_KEY, { videoId, timeMs, createdAt: now });
}

/** The time to seek to if a fresh pending seek is for this video; it is consumed when taken, dropped when stale. */
export async function takePendingSeek(videoId: string, now: number = Date.now()): Promise<number | null> {
  const pending = await storage.getItem<PendingSeek>(PENDING_SEEK_KEY);
  if (!pending || typeof pending.timeMs !== 'number' || typeof pending.createdAt !== 'number') return null;
  if (now - pending.createdAt > PENDING_SEEK_MAX_AGE_MS) {
    await storage.removeItem(PENDING_SEEK_KEY);
    return null;
  }
  if (pending.videoId !== videoId) return null;
  await storage.removeItem(PENDING_SEEK_KEY);
  return pending.timeMs;
}
```

- [ ] **Step 10: Implement `src/lib/messages.ts`**

```ts
import { browser } from '#imports';
import type { StudyLogEntry } from '@/lib/study-log/types';

export type KeyTestResult = 'valid' | 'rejected' | 'network' | 'error';

/** Requests answered by the background worker (spec §6.3), with their responses. */
export interface BackgroundRequests {
  'api-key:status': { request: object; response: { set: boolean; masked: string | null } };
  'api-key:set': { request: { key: string }; response: { ok: boolean } };
  'api-key:remove': { request: object; response: { ok: true } };
  'api-key:test': { request: { key?: string }; response: { result: KeyTestResult; message: string } };
  'log:find': { request: { videoId: string; language: string; phrase: string }; response: { entry: StudyLogEntry | null } };
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

- [ ] **Step 11: Implement `src/lib/background/message-handler.ts`**

```ts
import { maskApiKey } from '@/lib/api-key';
import type { ClaudeClient } from '@/lib/claude/client';
import { toExplainError } from '@/lib/claude/errors';
import type { BackgroundResponse } from '@/lib/messages';
import type { StudyLogEntry } from '@/lib/study-log/types';

export interface MessageHandlerDeps {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  removeApiKey(): Promise<void>;
  createClient(apiKey: string): ClaudeClient;
  findEntry(videoId: string, language: string, phrase: string): Promise<StudyLogEntry | null>;
  takePendingSeek(videoId: string): Promise<number | null>;
  openOptions(hash: string): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A pasted key: no spaces, a sane length. Anthropic's own check happens in Test key. */
const looksLikeKey = (key: string) => key.length > 0 && key.length <= 300 && !/\s/.test(key);
const OPTIONS_ROUTE = /^#\/[a-z-]*$/;

export function createMessageHandler(deps: MessageHandlerDeps): (message: unknown) => Promise<unknown> {
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

  return async (message) => {
    const type = isRecord(message) ? message.type : undefined;
    const m = isRecord(message) ? message : {};
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
        return testKey(typed || (await deps.getApiKey()));
      }
      case 'log:find': {
        const { videoId, language, phrase } = m;
        if (typeof videoId !== 'string' || typeof language !== 'string' || typeof phrase !== 'string') return { entry: null };
        return { entry: await deps.findEntry(videoId, language, phrase) } satisfies BackgroundResponse<'log:find'>;
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

- [ ] **Step 12: Run them to make sure they pass**

Run: `pnpm vitest run tests/unit/background-messages.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 13: Write the background entrypoint `src/entrypoints/background.ts`**

```ts
import { browser, defineBackground } from '#imports';
import { getApiKey, removeApiKey, setApiKey } from '@/lib/api-key';
import { createMessageHandler } from '@/lib/background/message-handler';
import { createSdkClient } from '@/lib/claude/client';
import { serveExplainPort, type ExplainPort } from '@/lib/claude/explain-service';
import { EXPLAIN_PORT } from '@/lib/claude/protocol';
import { takePendingSeek } from '@/lib/pending-seek';
import { appendFollowUp, findEntry, getEntry, saveExplanation } from '@/lib/study-log/store';

export default defineBackground(() => {
  const handle = createMessageHandler({
    getApiKey,
    setApiKey,
    removeApiKey,
    createClient: createSdkClient,
    findEntry,
    takePendingSeek: (videoId) => takePendingSeek(videoId),
    openOptions: async (hash) => {
      await browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}${hash}` });
    },
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return undefined; // only LingoFlix's own pages and scripts
    handle(message).then(sendResponse, (err: unknown) => sendResponse({ error: String(err) }));
    return true; // respond asynchronously
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EXPLAIN_PORT || port.sender?.id !== browser.runtime.id) return;
    serveExplainPort(port as unknown as ExplainPort, {
      getApiKey,
      createClient: createSdkClient,
      saveExplanation: (fields) => saveExplanation(fields),
      getEntry,
      appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
    });
  });
});
```

- [ ] **Step 14: Update the manifest in `wxt.config.ts`**

Replace the `permissions: ['storage'],` line with:

```ts
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: ['https://www.netflix.com/*', 'https://api.anthropic.com/*'],
```

- [ ] **Step 15: Run the whole suite, the type-check, and the build; inspect the manifest**

Run: `pnpm test && pnpm compile && pnpm build && cat .output/chrome-mv3/manifest.json`
Expected:
- All tests pass, `tsc` prints nothing, and the build succeeds.
- The manifest contains `"background": { "service_worker": "background.js"` and `"permissions": ["storage","unlimitedStorage"]`.
- `host_permissions` includes `https://api.anthropic.com/*`.

- [ ] **Step 16: Commit**

```bash
git add src/lib/claude/client.ts src/lib/claude/explain-service.ts src/lib/api-key.ts src/lib/pending-seek.ts src/lib/messages.ts src/lib/background src/entrypoints/background.ts wxt.config.ts tests/unit/explain-service.test.ts tests/unit/background-messages.test.ts
git commit -m "feat: background worker streams Claude explanations, keeps the API key, answers lookups" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Overlay foundations — styles on Netflix, hover engine, pause rule, event isolation, shadow-root mount

Spec sections:
- §5.3 flow steps 1–5: hit-test padded by 8 px, pause on entering, dwell 400 ms, grace 300 ms, resume only if LingoFlix paused.
- §5.3: the card mounts inside Netflix's player container.
- §5.4: keystrokes in the follow-up box never reach Netflix.
- §5.10: on-Netflix UI uses dark tokens, px sizes, and `ui-rounded`.

`docs/netflix-internals.md` row 9 (Task 1) says whether stopping events at our shadow host is enough. If row 9 recorded the capture-phase ruling, also add the window capture listener it describes in Step 9.

The card uses `position: fixed` with viewport coordinates, so the shadow host needs no layout. WXT resets the host with `all: initial !important`, which no inline style can beat. In fullscreen, the player container is the top layer, so fixed coordinates are still viewport coordinates.

**Files:**
- Create:
  - `src/assets/tokens.css`, `src/assets/theme.css`
  - `src/entrypoints/netflix.content/overlay/overlay.css`
  - `src/entrypoints/netflix.content/overlay/hit-test.ts`, `src/entrypoints/netflix.content/overlay/hover.ts`
  - `src/entrypoints/netflix.content/overlay/pause.ts`, `src/entrypoints/netflix.content/overlay/isolate.ts`
  - `src/entrypoints/netflix.content/overlay/mount.tsx`
- Modify: `src/assets/tailwind.css`
- Test: `tests/unit/overlay-basics.test.ts`

**Interfaces:**
- Consumes: `BridgeClient.callSync` (Plan 1), `PLAYER_CONTAINER_SELECTOR` (Task 6).
- Produces:
  - `pointInRects(x, y, rects, pad = 8): boolean`
  - `createHoverTracker(deps): HoverTracker`, where `HoverTracker = { update(onLine: boolean, onCard: boolean): void; reset(): void; phase(): 'idle' | 'hovering' | 'open' }` and `deps = { onEnter(); onDwell(); onLeave(); dwellMs?; graceMs?; setTimer?; clearTimer? }`
  - `createPauseGuard(bridge): { pause(): void; resume(): void; forget(): void }`
  - `ISOLATED_EVENTS` and `isolateEvents(host): () => void`
  - `mountOverlay(ctx, app: ReactNode): Promise<OverlayHandle>`, where `OverlayHandle = { contains(target: EventTarget | null): boolean; playerRect(): DOMRect | null; remove(): void }`

- [ ] **Step 1: Write the failing tests**

`tests/unit/overlay-basics.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pointInRects } from '@/entrypoints/netflix.content/overlay/hit-test';
import { createHoverTracker } from '@/entrypoints/netflix.content/overlay/hover';
import { isolateEvents } from '@/entrypoints/netflix.content/overlay/isolate';
import { createPauseGuard } from '@/entrypoints/netflix.content/overlay/pause';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('pointInRects', () => {
  const rect = { left: 100, top: 500, right: 400, bottom: 560 } as DOMRect;
  it('hits inside the subtitle text, padded by 8 px', () => {
    expect(pointInRects(200, 530, [rect])).toBe(true);
    expect(pointInRects(93, 530, [rect])).toBe(true);
    expect(pointInRects(91, 530, [rect])).toBe(false);
    expect(pointInRects(200, 569, [rect])).toBe(false);
    expect(pointInRects(200, 530, [])).toBe(false);
  });
});

describe('hover tracker (spec §5.3 steps 2–4)', () => {
  function setup() {
    vi.useFakeTimers();
    const calls: string[] = [];
    const tracker = createHoverTracker({
      onEnter: () => calls.push('enter'),
      onDwell: () => calls.push('dwell'),
      onLeave: () => calls.push('leave'),
    });
    return { tracker, calls };
  }

  it('pauses on entering, explains after 400 ms on the line', () => {
    const { tracker, calls } = setup();
    tracker.update(true, false);
    expect(calls).toEqual(['enter']);
    vi.advanceTimersByTime(399);
    expect(calls).toEqual(['enter']);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['enter', 'dwell']);
    expect(tracker.phase()).toBe('open');
  });

  it('keeps the card while the pointer travels from line to card within 300 ms', () => {
    const { tracker, calls } = setup();
    tracker.update(true, false);
    vi.advanceTimersByTime(400);
    tracker.update(false, false); // in the gap between line and card
    vi.advanceTimersByTime(250);
    tracker.update(false, true); // on the card
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(['enter', 'dwell']);
  });

  it('closes 300 ms after leaving both line and card', () => {
    const { tracker, calls } = setup();
    tracker.update(true, false);
    vi.advanceTimersByTime(400);
    tracker.update(false, false);
    vi.advanceTimersByTime(299);
    expect(calls).toEqual(['enter', 'dwell']);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['enter', 'dwell', 'leave']);
    expect(tracker.phase()).toBe('idle');
  });

  it('leaving before the dwell never explains, but still resumes', () => {
    const { tracker, calls } = setup();
    tracker.update(true, false);
    vi.advanceTimersByTime(200);
    tracker.update(false, false);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(['enter', 'leave']);
  });

  it('reset forgets the hover without calling back', () => {
    const { tracker, calls } = setup();
    tracker.update(true, false);
    tracker.reset();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(['enter']);
    expect(tracker.phase()).toBe('idle');
  });
});

describe('pause guard (spec §5.3 steps 2 and 5)', () => {
  function bridgeWith(paused: boolean) {
    const calls: string[] = [];
    const bridge = {
      callSync: vi.fn((method: string) => {
        calls.push(method);
        return method === 'getState' ? { ok: true, result: { paused } } : { ok: true, result: null };
      }),
    };
    return { bridge: bridge as never, calls };
  }

  it('pauses a playing video and resumes it afterwards', () => {
    const { bridge, calls } = bridgeWith(false);
    const guard = createPauseGuard(bridge);
    guard.pause();
    guard.pause(); // no double pause
    guard.resume();
    guard.resume(); // no double play
    expect(calls).toEqual(['getState', 'pause', 'play']);
  });

  it('never resumes a video the user had paused', () => {
    const { bridge, calls } = bridgeWith(true);
    const guard = createPauseGuard(bridge);
    guard.pause();
    guard.resume();
    expect(calls).toEqual(['getState']);
  });

  it('forget() drops the promise to resume', () => {
    const { bridge, calls } = bridgeWith(false);
    const guard = createPauseGuard(bridge);
    guard.pause();
    guard.forget();
    guard.resume();
    expect(calls).toEqual(['getState', 'pause']);
  });
});

describe('isolateEvents', () => {
  it('keys and clicks inside the overlay never reach Netflix, but LingoFlix still sees keys first', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('textarea');
    const button = document.createElement('button');
    shadow.append(input, button);
    isolateEvents(host);

    const netflix = vi.fn();
    const lingoflixCapture = vi.fn();
    for (const type of ['keydown', 'keyup', 'click', 'pointerdown', 'dblclick']) document.addEventListener(type, netflix);
    window.addEventListener('keydown', lingoflixCapture, { capture: true });

    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, composed: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, composed: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));

    expect(netflix).not.toHaveBeenCalled();
    expect(lingoflixCapture).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', lingoflixCapture, { capture: true });
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/overlay-basics.test.ts`
Expected: FAIL — `Failed to resolve import "@/entrypoints/netflix.content/overlay/hit-test"`.

- [ ] **Step 3: Implement the four small modules**

`src/entrypoints/netflix.content/overlay/hit-test.ts`:

```ts
/** Spec §5.3 step 1: is the pointer on the subtitle text (each rect padded by `pad` px)? */
export function pointInRects(
  x: number,
  y: number,
  rects: readonly Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[],
  pad = 8,
): boolean {
  return rects.some((r) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad);
}
```

`src/entrypoints/netflix.content/overlay/hover.ts`:

```ts
export type HoverPhase = 'idle' | 'hovering' | 'open';

export interface HoverTrackerDeps {
  /** Pointer entered a subtitle line (spec §5.3 step 2: pause). */
  onEnter(): void;
  /** Pointer stayed on the line long enough (step 3: explain). */
  onDwell(): void;
  /** Pointer left line and card for the grace period (steps 4–5: close and resume). */
  onLeave(): void;
  dwellMs?: number;
  graceMs?: number;
  setTimer?(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer?(handle: ReturnType<typeof setTimeout>): void;
}

export interface HoverTracker {
  /** Report where the pointer is: on the subtitle line and/or on the card. */
  update(onLine: boolean, onCard: boolean): void;
  /** Forget the current hover without calling back (e.g. the card was closed another way). */
  reset(): void;
  phase(): HoverPhase;
}

export const HOVER_DWELL_MS = 400;
export const HOVER_GRACE_MS = 300;

export function createHoverTracker(deps: HoverTrackerDeps): HoverTracker {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
  let phase: HoverPhase = 'idle';
  let dwell: ReturnType<typeof setTimeout> | null = null;
  let grace: ReturnType<typeof setTimeout> | null = null;

  const stop = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer !== null) clearTimer(timer);
    return null;
  };

  return {
    update(onLine, onCard) {
      if (onLine || onCard) {
        grace = stop(grace);
        if (phase === 'idle' && onLine) {
          phase = 'hovering';
          deps.onEnter();
          dwell = setTimer(() => {
            dwell = null;
            phase = 'open';
            deps.onDwell();
          }, deps.dwellMs ?? HOVER_DWELL_MS);
        }
        return;
      }
      if (phase !== 'idle' && grace === null) {
        grace = setTimer(() => {
          grace = null;
          dwell = stop(dwell);
          phase = 'idle';
          deps.onLeave();
        }, deps.graceMs ?? HOVER_GRACE_MS);
      }
    },
    reset() {
      dwell = stop(dwell);
      grace = stop(grace);
      phase = 'idle';
    },
    phase: () => phase,
  };
}
```

`src/entrypoints/netflix.content/overlay/pause.ts`:

```ts
import type { BridgeClient } from '@/lib/bridge/client';

/** Spec §5.3: pause for the card, and resume afterwards only if LingoFlix was the one who paused. */
export function createPauseGuard(bridge: Pick<BridgeClient, 'callSync'>) {
  let pausedByUs = false;
  return {
    pause() {
      if (pausedByUs) return;
      const state = bridge.callSync('getState');
      if (state.ok && !state.result.paused && bridge.callSync('pause').ok) pausedByUs = true;
    },
    resume() {
      if (!pausedByUs) return;
      pausedByUs = false;
      bridge.callSync('play');
    },
    /** The video changed or the user took over: don't resume later. */
    forget() {
      pausedByUs = false;
    },
  };
}

export type PauseGuard = ReturnType<typeof createPauseGuard>;
```

`src/entrypoints/netflix.content/overlay/isolate.ts`:

```ts
/**
 * Events stopped at the overlay's shadow host on their way out, so Netflix never sees typing in the
 * follow-up box (spec §5.4) or clicks on the card (Netflix toggles playback on click, fullscreen on
 * double-click). LingoFlix's own window capture listener still runs first. `mousemove` is not stopped:
 * the hover engine needs it.
 */
export const ISOLATED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'wheel',
  'contextmenu',
] as const;

export function isolateEvents(host: HTMLElement): () => void {
  const stop = (event: Event) => event.stopPropagation();
  for (const type of ISOLATED_EVENTS) host.addEventListener(type, stop);
  return () => {
    for (const type of ISOLATED_EVENTS) host.removeEventListener(type, stop);
  };
}
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `pnpm vitest run tests/unit/overlay-basics.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Split the style tokens so the overlay can share them**

Create `src/assets/tokens.css` with the `:root { … }`, `:root[data-theme='light']` and `:root[data-theme='dark']` blocks moved verbatim from `src/assets/tailwind.css`, under the same header comment.

Create `src/assets/theme.css` with the `@theme inline { … }` block moved verbatim from `src/assets/tailwind.css`.

Then `src/assets/tailwind.css` becomes:

```css
@import 'tailwindcss';
@import '@fontsource-variable/nunito';
@import './tokens.css';
@import './theme.css';

@layer base {
  body {
    @apply bg-page font-sans text-ink antialiased;
  }
}
```

Run: `pnpm build && pnpm test`
Expected: the build succeeds and every test passes. The popup and options page look unchanged, since the same CSS is only in different files.

- [ ] **Step 6: Write the overlay stylesheet**

`src/entrypoints/netflix.content/overlay/overlay.css`:

```css
@import 'tailwindcss';
@import '../../../assets/tokens.css';
@import '../../../assets/theme.css';

/*
 * On Netflix (spec §5.10): always the dark tokens, px sizes (Netflix's root font size is not ours, and rem
 * units would follow it), and no Nunito (the extension's font files aren't exposed to the page, so the
 * stack falls through to ui-rounded / system-ui). WXT rewrites :root to :host inside the shadow root.
 */
:root {
  color-scheme: dark;
  font-family: ui-rounded, system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.45;
  color: var(--lf-ink);
}

@theme {
  --spacing: 4px;
  --text-xs: 12px;
  --text-xs--line-height: 16px;
  --text-sm: 14px;
  --text-sm--line-height: 20px;
  --text-base: 16px;
  --text-base--line-height: 24px;
  --text-lg: 18px;
  --text-lg--line-height: 26px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
}
```

- [ ] **Step 7: Implement `src/entrypoints/netflix.content/overlay/mount.tsx`**

```tsx
import { createShadowRootUi, type ContentScriptContext } from '#imports';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PLAYER_CONTAINER_SELECTOR } from '@/lib/netflix/selectors';
import { isolateEvents } from './isolate';
import './overlay.css';

export interface OverlayHandle {
  /** True when the event target is inside LingoFlix's overlay. */
  contains(target: EventTarget | null): boolean;
  /** The player container's viewport rect (the card stays inside it). */
  playerRect(): DOMRect | null;
  remove(): void;
}

/**
 * Mounts the React overlay in a shadow root inside Netflix's player container (spec §5.3: visible in
 * fullscreen). autoMount follows the container as Netflix adds, replaces, or removes it (spec §8.5).
 */
export async function mountOverlay(ctx: ContentScriptContext, app: ReactNode): Promise<OverlayHandle> {
  let host: HTMLElement | null = null;
  let anchor: Element | null = null;
  const ui = await createShadowRootUi<{ root: Root; release: () => void }>(ctx, {
    name: 'lingoflix-overlay',
    position: 'inline',
    anchor: () => document.querySelector(PLAYER_CONTAINER_SELECTOR),
    append: 'last',
    onMount(container, _shadow, shadowHost) {
      host = shadowHost;
      anchor = shadowHost.parentElement;
      const release = isolateEvents(shadowHost);
      const root = createRoot(container);
      root.render(app);
      return { root, release };
    },
    onRemove(mounted) {
      mounted?.release();
      mounted?.root.unmount();
      host = null;
      anchor = null;
    },
  });
  ui.autoMount();
  return {
    contains: (target) => !!host && target instanceof Node && (target === host || host.contains(target)),
    playerRect: () => (anchor?.isConnected ? anchor.getBoundingClientRect() : null),
    remove: () => ui.remove(),
  };
}
```

In `src/entrypoints/netflix.content/index.ts`, add `cssInjectionMode: 'ui',` to the `defineContentScript({ … })` options, next to `runAt`. This keeps the overlay CSS out of Netflix's page and inside our shadow root. Task 11 calls `mountOverlay`.

- [ ] **Step 8: Type-check and build**

Run: `pnpm compile && pnpm build`
Expected: `tsc` prints nothing; the build succeeds. Nothing imports `mount.tsx` yet, so the overlay CSS first appears in Task 11's build.

- [ ] **Step 9: Only if `docs/netflix-internals.md` row 9 recorded the capture-phase ruling**

In `src/entrypoints/netflix.content/controller.ts`, give `ControllerDeps` an optional `isInOverlay?(target: EventTarget | null): boolean`. At the top of `onKeyDown`/`onKeyUp` (wrap the keyboard handlers), add:

```ts
if (deps.isInOverlay?.(event.composedPath()[0] ?? null) && isTypingTarget(event)) {
  event.stopImmediatePropagation(); // Netflix listens in the capture phase; typing still happens (no preventDefault)
  return;
}
```

Add a controller test that dispatches Space on a textarea inside a shadow host, with `isInOverlay` returning true, and asserts the Netflix stand-in listener isn't called. Otherwise skip this step and ledger "row 9: bubble-phase isolation sufficient".

- [ ] **Step 10: Commit**

```bash
git add src/assets src/entrypoints/netflix.content/overlay src/entrypoints/netflix.content/index.ts src/entrypoints/netflix.content/controller.ts tests/unit/overlay-basics.test.ts tests/unit/controller.test.ts
git commit -m "feat: overlay foundations — Netflix styles, hover engine, pause rule, event isolation, shadow-root mount" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: The explanation card — lookup, streaming, Regenerate, follow-ups, errors, hover and shortcut wiring

Spec sections:
- §5.3, the whole flow:
  - Study Log first, otherwise stream; save only on success.
  - Grace and close; resume only if LingoFlix paused.
  - The card stays on its line.
  - Shortcut-opened cards close on Escape, the Explain key, or a click outside.
  - The card mounts in the player above the line and scrolls internally.
- §5.4 follow-ups (Enter sends).
- §7.4 error cards.
- §9: the "can't be read as text" card.
- §8.5: a new video closes the card.

**Files:**
- Create:
  - `src/components/Markdown.tsx`
  - `src/entrypoints/netflix.content/overlay/store.ts`, `card-state.ts`, `positioning.ts`
  - `src/entrypoints/netflix.content/overlay/explain-port.ts`, `explain-controller.ts`, `runtime.ts`
  - `src/entrypoints/netflix.content/overlay/Card.tsx`, `OverlayApp.tsx`
- Modify: `package.json` (add `react-markdown`), `src/entrypoints/netflix.content/controller.ts`, `src/entrypoints/netflix.content/index.ts`
- Test: `tests/unit/explain-flow.test.ts`, `tests/unit/card.test.tsx`, `tests/unit/overlay-runtime.test.ts`, `tests/unit/controller.test.ts`

**Interfaces:**
- Consumes:
  - From Task 10: `createHoverTracker`, `pointInRects`, `createPauseGuard`/`PauseGuard`, `mountOverlay`/`OverlayHandle`
  - From Task 8: `EXPLAIN_PORT`, `ExplainClientMessage`, `ExplainServerMessage`, `ExplainErrorCode`, `ERROR_COPY`, `ExplainRequest`
  - `parseTitleInfo` (Task 5)
  - `SubtitleSession` (Task 6)
  - `readDisplayedSubtitle` (Task 6)
  - `sendToBackground` (Task 9)
  - `StudyLogEntry` (Task 7)
  - `LogoMark` (Plan 1 redesign)
- Produces:
  - `Markdown({ children })`: shared by the card and the Study Log tab (Task 13)
  - `createStore<T>(initial)` / `useStore(store)`
  - `card-state.ts`: `CardState`, `FollowUpView`, `Box`, `unionBox(rects)`, `IMAGE_SUBTITLES_MESSAGE`
  - `placeCard(anchor, player, cardHeight): { left; top; width; maxHeight }`
  - `explain-port.ts`: `type Connect`, `connectExplainPort`, `streamExplanation(connect, message, handlers): () => void`
  - `createExplainController(deps): ExplainController`, where `ExplainController = { open(by): boolean; regenerate(); retry(); askFollowUp(q); close(); isOpen(); openedBy() }`
  - `createOverlayRuntime(deps): OverlayRuntime`, where `OverlayRuntime = { onMouseMove; onPointerDown; onKeyDown(e): boolean; explainShortcut(): boolean; onVideoChange(); teardown() }`
  - `ControllerDeps.overlay?: Pick<OverlayRuntime, 'explainShortcut' | 'onKeyDown'>`

- [ ] **Step 1: Add react-markdown**

Run: `pnpm add --save-exact react-markdown@10.1.0`
Expected: `+ react-markdown 10.1.0` and "Lockfile passes supply-chain policies".

- [ ] **Step 2: Write the failing flow tests (positioning, port, explain controller)**

`tests/unit/explain-flow.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { CardState } from '@/entrypoints/netflix.content/overlay/card-state';
import { createExplainController } from '@/entrypoints/netflix.content/overlay/explain-controller';
import { streamExplanation, type Connect } from '@/entrypoints/netflix.content/overlay/explain-port';
import { placeCard } from '@/entrypoints/netflix.content/overlay/positioning';
import { createStore } from '@/entrypoints/netflix.content/overlay/store';
import type { TitleInfo } from '@/lib/netflix/title';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import type { StudyLogEntry } from '@/lib/study-log/types';
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
  it('posts the request, streams deltas, finishes with the entry, then disconnects', () => {
    const fake = fakePort();
    const onDelta = vi.fn();
    const onDone = vi.fn();
    streamExplanation(() => fake.port, { type: 'follow-up', entryId: 'e', question: 'q', sections: DEFAULT_SETTINGS.cardSections }, {
      onDelta,
      onDone,
      onError: vi.fn(),
    });
    expect(fake.posted).toHaveLength(1);
    fake.receive({ type: 'delta', text: 'Hi' });
    fake.receive({ type: 'done', entry: { id: 'e' } });
    expect(onDelta).toHaveBeenCalledWith('Hi');
    expect(onDone).toHaveBeenCalledWith({ id: 'e' });
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
const SAVED = {
  id: 'e1',
  phrase: LINE.text,
  response: '## 의미\n잘 시간.',
  followUps: [{ question: 'Formal?', answer: 'No.' }],
} as StudyLogEntry;

function setupExplain(over: { entry?: StudyLogEntry | null; imageBased?: boolean; line?: ObservedLine | null } = {}) {
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
  const findEntry = vi.fn(async () => over.entry ?? null);
  const settings = { ...DEFAULT_SETTINGS, explanationLanguage: 'ko' };
  const explain = createExplainController({
    store,
    session: session as never,
    bridge: bridge as never,
    pause,
    connect,
    findEntry,
    getSettings: () => settings,
    getVideoId: () => '80077211',
    subtitleRects: () => [{ left: 100, top: 500, right: 400, bottom: 560, width: 300, height: 60 } as DOMRect],
  });
  return { store, ports, explain, findEntry, pause, settings };
}

describe('explain controller', () => {
  it('shows a saved explanation instantly, without asking Claude', async () => {
    const { store, ports, explain, findEntry } = setupExplain({ entry: SAVED });
    expect(explain.open('hover')).toBe(true);
    await vi.waitFor(() => expect(store.get()?.status).toBe('done'));
    expect(store.get()).toMatchObject({
      line: LINE.text,
      response: SAVED.response,
      fromStudyLog: true,
      followUps: [{ question: 'Formal?', answer: 'No.', status: 'done', error: null }],
    });
    expect(findEntry).toHaveBeenCalledWith('80077211', 'ko', LINE.text);
    expect(ports).toHaveLength(0);
  });

  it('streams a new explanation with the line, its context, the title, and the line start', async () => {
    const { store, ports, explain, settings } = setupExplain();
    explain.open('hover');
    expect(store.get()).toMatchObject({ status: 'loading', anchor: { left: 100, top: 500, width: 300, height: 60 } });
    await vi.waitFor(() => expect(ports).toHaveLength(1));
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
      },
    });
    ports[0]!.receive({ type: 'delta', text: 'Hel' });
    ports[0]!.receive({ type: 'delta', text: 'lo' });
    expect(store.get()).toMatchObject({ status: 'streaming', response: 'Hello' });
    ports[0]!.receive({ type: 'done', entry: { ...SAVED, response: 'Hello', followUps: [] } });
    expect(store.get()).toMatchObject({ status: 'done', response: 'Hello', entry: { id: 'e1' } });
  });

  it('Regenerate streams again and clears follow-ups', async () => {
    const { store, ports, explain } = setupExplain({ entry: SAVED });
    explain.open('hover');
    await vi.waitFor(() => expect(store.get()?.status).toBe('done'));
    explain.regenerate();
    expect(store.get()).toMatchObject({ status: 'loading', response: '', followUps: [], fromStudyLog: false });
    expect(ports[0]!.posted[0]).toMatchObject({ type: 'start' });
  });

  it('a follow-up streams under its question and keeps the updated entry', async () => {
    const { store, ports, explain, settings } = setupExplain({ entry: { ...SAVED, followUps: [] } });
    explain.open('hover');
    await vi.waitFor(() => expect(store.get()?.status).toBe('done'));
    explain.askFollowUp('  Is it formal?  ');
    explain.askFollowUp('ignored while busy');
    expect(store.get()?.followUps).toEqual([{ question: 'Is it formal?', answer: '', status: 'streaming', error: null }]);
    expect(ports).toHaveLength(1);
    expect(ports[0]!.posted[0]).toEqual({ type: 'follow-up', entryId: 'e1', question: 'Is it formal?', sections: settings.cardSections });
    ports[0]!.receive({ type: 'delta', text: 'No' });
    expect(store.get()?.followUps[0]?.answer).toBe('No');
    ports[0]!.receive({ type: 'done', entry: { ...SAVED, followUps: [{ question: 'Is it formal?', answer: 'No.' }] } });
    expect(store.get()).toMatchObject({ followUpBusy: false, followUps: [{ answer: 'No.', status: 'done' }] });
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

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/explain-flow.test.ts`
Expected: FAIL — `Failed to resolve import "@/entrypoints/netflix.content/overlay/explain-controller"`.

- [ ] **Step 4: Implement store, card state, and positioning**

`src/entrypoints/netflix.content/overlay/store.ts`:

```ts
import { useSyncExternalStore } from 'react';

/** A tiny observable value shared by the overlay's logic (plain TS) and its React view. */
export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (current: T) => T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => value,
    set,
    update: (fn) => set(fn(value)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
```

`src/entrypoints/netflix.content/overlay/card-state.ts`:

```ts
import type { ExplainErrorCode } from '@/lib/claude/protocol';
import type { CardSections } from '@/lib/settings';
import type { StudyLogEntry } from '@/lib/study-log/types';

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
  /** The Study Log entry once saved or found. */
  entry: StudyLogEntry | null;
  error: { code: CardErrorCode; message: string } | null;
  followUps: FollowUpView[];
  followUpBusy: boolean;
  sections: CardSections;
  fromStudyLog: boolean;
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

`src/entrypoints/netflix.content/overlay/positioning.ts`:

```ts
import type { Box } from './card-state';

export interface CardPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export const CARD_MAX_WIDTH = 520;
const MARGIN = 12;
const MIN_HEIGHT = 140;
/** Without a line to sit on, stay above Netflix's controls. */
const CONTROLS_CLEARANCE = 72;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/** Spec §5.3: above the line, constrained to the player, scrolling internally when taller than the room. */
export function placeCard(anchor: Box | null, player: Box, cardHeight: number): CardPlacement {
  const width = Math.min(CARD_MAX_WIDTH, Math.max(0, player.width - 2 * MARGIN));
  const centerX = anchor ? anchor.left + anchor.width / 2 : player.left + player.width / 2;
  const left = clamp(centerX - width / 2, player.left + MARGIN, player.left + player.width - MARGIN - width);
  const bottom = anchor ? anchor.top - MARGIN : player.top + player.height - CONTROLS_CLEARANCE;
  const maxHeight = Math.max(MIN_HEIGHT, bottom - (player.top + MARGIN));
  const top = Math.max(player.top + MARGIN, bottom - Math.min(cardHeight, maxHeight));
  return { left, top, width, maxHeight };
}
```

- [ ] **Step 5: Implement `src/entrypoints/netflix.content/overlay/explain-port.ts`**

```ts
import { browser } from '#imports';
import {
  ERROR_COPY,
  EXPLAIN_PORT,
  type ExplainClientMessage,
  type ExplainErrorCode,
  type ExplainServerMessage,
} from '@/lib/claude/protocol';
import type { StudyLogEntry } from '@/lib/study-log/types';

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
  onDone(entry: StudyLogEntry): void;
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
      handlers.onDone(m.entry);
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

- [ ] **Step 6: Implement `src/entrypoints/netflix.content/overlay/explain-controller.ts`**

```ts
import type { BridgeClient } from '@/lib/bridge/client';
import { parseTitleInfo } from '@/lib/bridge/protocol';
import type { ExplainRequest } from '@/lib/claude/prompt';
import type { Settings } from '@/lib/settings';
import type { StudyLogEntry } from '@/lib/study-log/types';
import type { SubtitleSession } from '../subtitle-session';
import { IMAGE_SUBTITLES_MESSAGE, unionBox, type CardState, type FollowUpView } from './card-state';
import { streamExplanation, type Connect } from './explain-port';
import type { PauseGuard } from './pause';
import type { Store } from './store';

export interface ExplainControllerDeps {
  store: Store<CardState | null>;
  session: Pick<SubtitleSession, 'currentLine' | 'describe'>;
  bridge: Pick<BridgeClient, 'callSync'>;
  pause: Pick<PauseGuard, 'resume'>;
  connect: Connect;
  findEntry(videoId: string, language: string, phrase: string): Promise<StudyLogEntry | null>;
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
      onDone: (entry) => update(key, (c) => ({ ...c, status: 'done', response: entry.response, entry, error: null })),
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
      entry: null,
      error: null,
      followUps: [],
      followUpBusy: false,
      sections: settings.cardSections,
      fromStudyLog: false,
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
    };
    request = req;
    deps.store.set(base);
    deps.findEntry(videoId, req.language, req.phrase).then(
      (entry) => {
        if (deps.store.get()?.key !== key) return;
        if (!entry) return stream(key, req);
        update(key, (c) => ({
          ...c,
          status: 'done',
          response: entry.response,
          entry,
          fromStudyLog: true,
          followUps: entry.followUps.map((f) => ({ ...f, status: 'done', error: null })),
        }));
      },
      () => {
        if (deps.store.get()?.key === key) stream(key, req);
      },
    );
    return true;
  };

  /** Regenerate and Retry: ask Claude again for the same line; the saved entry is replaced on success. */
  const restart = () => {
    const card = deps.store.get();
    if (!card || !request) return;
    cancelFollowUp?.();
    cancelFollowUp = null;
    deps.store.set({ ...card, status: 'loading', response: '', error: null, followUps: [], followUpBusy: false, fromStudyLog: false });
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
      if (!card?.entry || card.followUpBusy || !text || !settings) return;
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
        { type: 'follow-up', entryId: card.entry.id, question: text, sections: settings.cardSections },
        {
          onDelta: (delta) => setFollowUp((f) => ({ ...f, answer: f.answer + delta })),
          onDone: (entry) =>
            setFollowUp((f) => ({ ...f, status: 'done', answer: entry.followUps[index]?.answer ?? f.answer }), {
              entry,
              followUpBusy: false,
            }),
          onError: (_code, message) => setFollowUp((f) => ({ ...f, status: 'error', error: message }), { followUpBusy: false }),
        },
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

- [ ] **Step 7: Run the flow tests to make sure they pass**

Run: `pnpm vitest run tests/unit/explain-flow.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 8: Write the failing card and runtime tests**

`tests/unit/card.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Card } from '@/entrypoints/netflix.content/overlay/Card';
import type { CardState } from '@/entrypoints/netflix.content/overlay/card-state';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import type { StudyLogEntry } from '@/lib/study-log/types';

afterEach(cleanup);

const BASE: CardState = {
  key: 1,
  line: "I'm gonna call it\na night.",
  anchor: null,
  openedBy: 'hover',
  status: 'done',
  response: '## Meaning\nTime to **sleep**. See [this](https://example.com).\n\nPlain <b>bold</b> text.\n\n<script>alert(1)</script>',
  entry: { id: 'e1' } as StudyLogEntry,
  error: null,
  followUps: [],
  followUpBusy: false,
  sections: DEFAULT_SETTINGS.cardSections,
  fromStudyLog: true,
};

function renderCard(over: Partial<CardState> = {}) {
  const handlers = { onRegenerate: vi.fn(), onRetry: vi.fn(), onFollowUp: vi.fn(), onClose: vi.fn(), onOpenSettings: vi.fn() };
  render(<Card card={{ ...BASE, ...over }} player={{ left: 0, top: 0, width: 1280, height: 720 }} {...handlers} />);
  return handlers;
}

describe('explanation card', () => {
  it('shows the line and the explanation as Markdown — no links, no raw HTML', () => {
    renderCard();
    expect(screen.getByRole('dialog', { name: 'LingoFlix explanation' }).textContent).toContain("I'm gonna call it");
    expect(screen.getByRole('heading', { name: 'Meaning' })).toBeTruthy();
    expect(screen.getByText('sleep').tagName).toBe('STRONG');
    expect(screen.getByText('this')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('b, script')).toBeNull(); // raw HTML is dropped, its text stays plain
    expect(dialog.textContent).not.toContain('alert(1)');
    expect(screen.getByText('From your Study Log')).toBeTruthy();
  });

  it('Regenerate and Close call back', () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(h.onRegenerate).toHaveBeenCalled();
    expect(h.onClose).toHaveBeenCalled();
  });

  it('shows "Thinking…" while loading, without Regenerate', () => {
    renderCard({ status: 'loading', response: '', entry: null, fromStudyLog: false });
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
  });

  it('error cards follow spec §7.4', () => {
    const noKey = renderCard({ status: 'error', response: '', error: { code: 'no-key', message: 'Add your Claude API key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(noKey.onOpenSettings).toHaveBeenCalled();
    cleanup();
    const offline = renderCard({ status: 'error', response: '', error: { code: 'network', message: "Couldn't reach Claude" } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(offline.onRetry).toHaveBeenCalled();
    cleanup();
    renderCard({ status: 'error', response: '', error: { code: 'api', message: 'Your credit balance is too low.' } });
    expect(screen.getByRole('alert').textContent).toBe('Your credit balance is too low.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    cleanup();
    renderCard({ status: 'error', line: '', response: '', entry: null, error: { code: 'image-subs', message: "This title's subtitles can't be read as text" } });
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
  });
});
```

`tests/unit/overlay-runtime.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOverlayRuntime } from '@/entrypoints/netflix.content/overlay/runtime';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

afterEach(() => vi.useRealTimers());

const LINE = { left: 100, top: 500, right: 400, bottom: 560 } as DOMRect;
const INSIDE = {} as EventTarget;
const OUTSIDE = {} as EventTarget;

function setup(over: Partial<Settings> = {}) {
  vi.useFakeTimers();
  let open: 'hover' | 'shortcut' | null = null;
  const order: string[] = [];
  const explain = {
    open: vi.fn((by: 'hover' | 'shortcut') => {
      open = by;
      return true;
    }),
    close: vi.fn(() => {
      order.push('close');
      open = null;
    }),
    isOpen: () => open !== null,
    openedBy: () => open,
  };
  const pause = { pause: vi.fn(), forget: vi.fn(() => order.push('forget')) };
  const settings: Settings = { ...DEFAULT_SETTINGS, ...over };
  const runtime = createOverlayRuntime({
    explain,
    pause,
    getSettings: () => settings,
    isWatchPage: () => true,
    subtitleRects: () => [LINE],
    cardElement: () => null,
    isInOverlay: (t) => t === INSIDE,
    schedule: (fn) => fn(),
  });
  const move = (x: number, y: number) => runtime.onMouseMove({ clientX: x, clientY: y } as MouseEvent);
  return { runtime, explain, pause, move, order };
}

describe('overlay runtime', () => {
  it('hovering a line pauses, explains after 400 ms, and closes 300 ms after leaving', () => {
    const { explain, pause, move } = setup();
    move(200, 530);
    expect(pause.pause).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(explain.open).toHaveBeenCalledWith('hover');
    move(10, 10);
    vi.advanceTimersByTime(300);
    expect(explain.close).toHaveBeenCalledTimes(1);
  });

  it('with Pause on hover off, explains without pausing', () => {
    const { explain, pause, move } = setup({ pauseOnHover: false });
    move(200, 530);
    vi.advanceTimersByTime(400);
    expect(pause.pause).not.toHaveBeenCalled();
    expect(explain.open).toHaveBeenCalledWith('hover');
  });

  it('hover does nothing while subtitles are hidden or LingoFlix is off', () => {
    for (const over of [{ subtitlesHidden: true }, { enabled: false }]) {
      const { explain, pause, move } = setup(over);
      move(200, 530);
      vi.advanceTimersByTime(1000);
      expect(pause.pause).not.toHaveBeenCalled();
      expect(explain.open).not.toHaveBeenCalled();
    }
  });

  it('the Explain shortcut opens for the current line; pressing it again closes', () => {
    const { runtime, explain, pause } = setup();
    expect(runtime.explainShortcut()).toBe(true);
    expect(pause.pause).toHaveBeenCalled();
    expect(explain.open).toHaveBeenCalledWith('shortcut');
    runtime.explainShortcut();
    expect(explain.close).toHaveBeenCalledTimes(1);
  });

  it('Escape closes an open card and keeps the key from Netflix', () => {
    const { runtime, explain } = setup();
    const idle = new KeyboardEvent('keydown', { code: 'Escape', cancelable: true });
    expect(runtime.onKeyDown(idle)).toBe(false);
    runtime.explainShortcut();
    const esc = new KeyboardEvent('keydown', { code: 'Escape', cancelable: true });
    expect(runtime.onKeyDown(esc)).toBe(true);
    expect(esc.defaultPrevented).toBe(true);
    expect(explain.close).toHaveBeenCalled();
  });

  it('a click outside closes a shortcut card; a click inside does not', () => {
    const { runtime, explain } = setup();
    runtime.explainShortcut();
    runtime.onPointerDown({ composedPath: () => [INSIDE] } as unknown as Event);
    expect(explain.close).not.toHaveBeenCalled();
    runtime.onPointerDown({ composedPath: () => [OUTSIDE] } as unknown as Event);
    expect(explain.close).toHaveBeenCalledTimes(1);
  });

  it('after closing with a key, hover waits until the pointer leaves the line', () => {
    const { runtime, explain, move } = setup();
    move(200, 530);
    vi.advanceTimersByTime(400);
    runtime.explainShortcut(); // closes the hover card
    move(210, 530);
    vi.advanceTimersByTime(1000);
    expect(explain.open).toHaveBeenCalledTimes(1);
    move(10, 10);
    move(200, 530);
    vi.advanceTimersByTime(400);
    expect(explain.open).toHaveBeenCalledTimes(2);
  });

  it('a new video forgets the pause before closing, so the old video is not resumed', () => {
    const { runtime, order } = setup();
    runtime.onVideoChange();
    expect(order).toEqual(['forget', 'close']);
  });
});
```

- [ ] **Step 9: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/card.test.tsx tests/unit/overlay-runtime.test.ts`
Expected: FAIL — `Failed to resolve import "@/entrypoints/netflix.content/overlay/Card"` (and `runtime`).

- [ ] **Step 10: Implement `src/components/Markdown.tsx`**

```tsx
import ReactMarkdown, { type Components } from 'react-markdown';

const heading = 'mt-3 mb-1 text-[13px] font-black tracking-wide text-tint-ink uppercase first:mt-0';

/** Claude's answers: Markdown without raw HTML; links shown as text so nothing navigates away (spec §5.3). */
const components: Components = {
  h1: ({ node: _node, ...props }) => <h3 className={heading} {...props} />,
  h2: ({ node: _node, ...props }) => <h3 className={heading} {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className={heading} {...props} />,
  h4: ({ node: _node, ...props }) => <h4 className="mt-2 mb-1 text-[14px] font-extrabold" {...props} />,
  p: ({ node: _node, ...props }) => <p className="my-1.5 text-[14px] leading-relaxed" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="my-1.5 list-disc space-y-1 pl-5 text-[14px]" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="my-1.5 list-decimal space-y-1 pl-5 text-[14px]" {...props} />,
  li: ({ node: _node, ...props }) => <li className="leading-relaxed" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-extrabold" {...props} />,
  code: ({ node: _node, ...props }) => <code className="rounded bg-soft px-1 py-0.5 text-[13px]" {...props} />,
  blockquote: ({ node: _node, ...props }) => <blockquote className="my-1.5 border-l-4 border-line pl-3 text-mute" {...props} />,
  a: ({ children }) => <span className="underline decoration-dotted">{children}</span>,
  img: () => null,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="break-words">
      <ReactMarkdown skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 11: Implement `src/entrypoints/netflix.content/overlay/Card.tsx`**

```tsx
import { ArrowUp, BookOpen, Loader2, RotateCcw, Settings as SettingsIcon, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { LogoMark } from '@/components/Logo';
import { Markdown } from '@/components/Markdown';
import type { Box, CardState } from './card-state';
import { placeCard } from './positioning';

export interface CardProps {
  card: CardState;
  /** The player's viewport rect; null falls back to the bottom-right corner. */
  player: Box | null;
  onRegenerate(): void;
  onRetry(): void;
  onFollowUp(question: string): void;
  onClose(): void;
  onOpenSettings(): void;
  cardRef?(element: HTMLElement | null): void;
}

const secondaryButton =
  'inline-flex items-center gap-1.5 rounded-xl border-2 border-line bg-card px-3 py-1.5 text-[12px] font-extrabold tracking-wide text-ink uppercase shadow-[0_3px_0_var(--lf-line)] hover:bg-soft active:translate-y-[3px] active:shadow-none disabled:opacity-40';
const primaryButton =
  'inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-[12px] font-extrabold tracking-wide text-on-brand uppercase shadow-[0_3px_0_var(--lf-brand-edge)] active:translate-y-[3px] active:shadow-none';

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

/** The explanation card (spec §5.3–5.4), styled with the dark tokens (spec §5.10). */
export function Card({ card, player, onRegenerate, onRetry, onFollowUp, onClose, onOpenSettings, cardRef }: CardProps) {
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

      {card.sections.followUp && card.status === 'done' && card.entry && <FollowUpBox busy={card.followUpBusy} onSend={onFollowUp} />}

      {card.status === 'done' && (
        <footer className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-mute">
            {card.fromStudyLog && (
              <>
                <BookOpen size={14} aria-hidden />
                From your Study Log
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

`src/entrypoints/netflix.content/overlay/OverlayApp.tsx`:

```tsx
import { Card } from './Card';
import type { Box, CardState } from './card-state';
import type { ExplainController } from './explain-controller';
import { useStore, type Store } from './store';

export interface OverlayAppProps {
  store: Store<CardState | null>;
  explain: Pick<ExplainController, 'regenerate' | 'retry' | 'askFollowUp' | 'close'>;
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
      onClose={explain.close}
      onOpenSettings={openSettings}
      cardRef={onCardElement}
    />
  );
}
```

- [ ] **Step 12: Implement `src/entrypoints/netflix.content/overlay/runtime.ts`**

```ts
import type { Settings } from '@/lib/settings';
import type { ExplainController } from './explain-controller';
import { pointInRects } from './hit-test';
import { createHoverTracker } from './hover';
import type { PauseGuard } from './pause';

export interface OverlayRuntimeDeps {
  explain: Pick<ExplainController, 'open' | 'close' | 'isOpen' | 'openedBy'>;
  pause: Pick<PauseGuard, 'pause' | 'forget'>;
  getSettings(): Settings | null;
  isWatchPage(): boolean;
  subtitleRects(): readonly Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[];
  cardElement(): HTMLElement | null;
  isInOverlay(target: EventTarget | null): boolean;
  /** Defaults to requestAnimationFrame (one hit-test per frame). */
  schedule?(fn: () => void): void;
}

export interface OverlayRuntime {
  onMouseMove(event: MouseEvent): void;
  onPointerDown(event: Event): void;
  /** Escape closes an open card. True when it handled the key. */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Explain line shortcut: opens a card for the current line, or closes the open one. False when there is no line. */
  explainShortcut(): boolean;
  /** Spec §8.5: a new video closes the card without resuming the old one. */
  onVideoChange(): void;
  teardown(): void;
}

/** Spec §5.3: hover and shortcut behavior around the explanation card. */
export function createOverlayRuntime(deps: OverlayRuntimeDeps): OverlayRuntime {
  const schedule = deps.schedule ?? ((fn: () => void) => void requestAnimationFrame(() => fn()));
  let x = 0;
  let y = 0;
  let queued = false;
  /** After a card is closed with a key or a click, hover waits until the pointer has left the line. */
  let waitForLeave = false;

  const hover = createHoverTracker({
    onEnter: () => {
      if (deps.getSettings()?.pauseOnHover) deps.pause.pause();
    },
    onDwell: () => {
      deps.explain.open('hover');
    },
    onLeave: () => deps.explain.close(),
  });

  const hoverEnabled = () => {
    const s = deps.getSettings();
    return !!s?.enabled && !s.subtitlesHidden && deps.isWatchPage() && deps.explain.openedBy() !== 'shortcut';
  };

  const check = () => {
    queued = false;
    if (!hoverEnabled()) return;
    const onLine = pointInRects(x, y, deps.subtitleRects());
    const card = deps.cardElement();
    const onCard = !!card && pointInRects(x, y, [card.getBoundingClientRect()], 0);
    if (waitForLeave) {
      if (onLine || onCard) return;
      waitForLeave = false;
    }
    hover.update(onLine, onCard);
  };

  const closeByUser = () => {
    hover.reset();
    deps.explain.close();
    waitForLeave = true;
  };

  return {
    onMouseMove(event) {
      x = event.clientX;
      y = event.clientY;
      if (queued) return;
      queued = true;
      schedule(check);
    },
    onPointerDown(event) {
      if (deps.explain.openedBy() !== 'shortcut') return;
      if (!deps.isInOverlay(event.composedPath()[0] ?? null)) closeByUser();
    },
    onKeyDown(event) {
      if (event.code !== 'Escape' || !deps.explain.isOpen()) return false;
      event.preventDefault();
      event.stopImmediatePropagation(); // Netflix would also leave fullscreen
      closeByUser();
      return true;
    },
    explainShortcut() {
      if (deps.explain.isOpen()) {
        closeByUser();
        return true;
      }
      hover.reset();
      if (deps.getSettings()?.pauseOnHover) deps.pause.pause();
      const opened = deps.explain.open('shortcut');
      if (!opened) deps.explain.close(); // resumes if we just paused
      return opened;
    },
    onVideoChange() {
      hover.reset();
      waitForLeave = false;
      deps.pause.forget();
      deps.explain.close();
    },
    teardown() {
      hover.reset();
      deps.explain.close();
    },
  };
}
```

- [ ] **Step 13: Run the card and runtime tests to make sure they pass**

Run: `pnpm vitest run tests/unit/card.test.tsx tests/unit/overlay-runtime.test.ts`
Expected: PASS (7 + 8 tests).

- [ ] **Step 14: Give the controller the Explain key and let the overlay see keys first**

In `tests/unit/controller.test.ts`:
- Let `setup` take an optional second parameter `overlay?: { explainShortcut(): boolean; onKeyDown(e: KeyboardEvent): boolean }` and pass it into `createController({ … overlay })`.
- Append:

```ts
  it('Explain line (E) goes to the overlay; with no line it says so', () => {
    const overlay = { explainShortcut: vi.fn(() => false), onKeyDown: vi.fn(() => false) };
    const { notifier, netflix, press } = setup(DEFAULT_SETTINGS, overlay);
    const down = press('KeyE', 'e');
    expect(overlay.explainShortcut).toHaveBeenCalledTimes(1);
    expect(notifier.show).toHaveBeenCalledWith('No subtitle line to explain yet.', 2000);
    expect(down.defaultPrevented).toBe(true);
    expect(netflix).not.toHaveBeenCalled();
  });

  it('the overlay sees every keydown first (Escape closes the card)', () => {
    const overlay = { explainShortcut: vi.fn(() => true), onKeyDown: vi.fn((e: KeyboardEvent) => e.code === 'Escape') };
    const { bridge, press } = setup(DEFAULT_SETTINGS, overlay);
    press('Escape');
    press('ArrowLeft');
    expect(overlay.onKeyDown).toHaveBeenCalledTimes(2);
    expect(bridge.callSync.mock.calls).toEqual([['seekBy', -5_000]]);
  });
```

Run: `pnpm vitest run tests/unit/controller.test.ts`
Expected: FAIL — E isn't handled (no `explainLine` handler), and `overlay.onKeyDown` is never called.

In `src/entrypoints/netflix.content/controller.ts`:

1. Add `import type { OverlayRuntime } from './overlay/runtime';`.
2. Add to `ControllerDeps`:

   ```ts
     /** The explanation overlay; it sees every keydown first (Escape closes its card). */
     overlay?: Pick<OverlayRuntime, 'explainShortcut' | 'onKeyDown'>;
   ```

3. Add to `handlers`:

   ```ts
       explainLine: () => {
         if (!deps.overlay) return false;
         if (!deps.overlay.explainShortcut()) deps.notifier.show('No subtitle line to explain yet.', 2000);
         return true;
       },
   ```

4. Replace the `return { applySettings, onKeyDown: keys.onKeyDown, onKeyUp: keys.onKeyUp, teardown };` line with:

   ```ts
     const onKeyDown = (event: KeyboardEvent) => {
       if (!tornDown && deps.overlay?.onKeyDown(event)) return;
       keys.onKeyDown(event);
     };

     return { applySettings, onKeyDown, onKeyUp: keys.onKeyUp, teardown };
   ```

Run: `pnpm vitest run tests/unit/controller.test.ts`
Expected: PASS.

- [ ] **Step 15: Wire everything in `src/entrypoints/netflix.content/index.ts`**

```ts
import { defineContentScript } from '#imports';
import { createElement } from 'react';
import { createBridgeClient } from '@/lib/bridge/client';
import { sendToBackground } from '@/lib/messages';
import { isWatchPath, parseWatchVideoId } from '@/lib/netflix/video-id';
import { loadSettings, updateSettings, watchSettings, type Settings } from '@/lib/settings';
import { createController } from './controller';
import { createNotifier } from './notice';
import type { CardState } from './overlay/card-state';
import { createExplainController } from './overlay/explain-controller';
import { connectExplainPort } from './overlay/explain-port';
import { mountOverlay, type OverlayHandle } from './overlay/mount';
import { OverlayApp } from './overlay/OverlayApp';
import { createPauseGuard } from './overlay/pause';
import { createOverlayRuntime } from './overlay/runtime';
import { createStore } from './overlay/store';
import { readDisplayedSubtitle, watchSubtitles } from './subtitle-dom';
import { createSubtitleSession } from './subtitle-session';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Subtitle file: HTTP ${res.status}`);
  return res.text();
}

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  main(ctx) {
    const bridge = createBridgeClient(document);
    const notifier = createNotifier(document);
    const getVideoId = () => parseWatchVideoId(location.pathname);
    const isWatchPage = () => isWatchPath(location.pathname);
    const session = createSubtitleSession({ bridge, fetchText, getVideoId });
    const subtitleRects = () => readDisplayedSubtitle(document).rects;

    let settings: Settings | null = null;
    let overlay: OverlayHandle | null = null;
    let cardElement: HTMLElement | null = null;

    const store = createStore<CardState | null>(null);
    const pause = createPauseGuard(bridge);
    const explain = createExplainController({
      store,
      session,
      bridge,
      pause,
      connect: connectExplainPort,
      findEntry: async (videoId, language, phrase) =>
        (await sendToBackground({ type: 'log:find', videoId, language, phrase })).entry,
      getSettings: () => settings,
      getVideoId,
      subtitleRects,
    });
    const runtime = createOverlayRuntime({
      explain,
      pause,
      getSettings: () => settings,
      isWatchPage,
      subtitleRects,
      cardElement: () => cardElement,
      isInOverlay: (target) => overlay?.contains(target) ?? false,
    });
    const controller = createController({
      doc: document,
      bridge,
      notifier,
      session,
      overlay: runtime,
      updateSettings,
      isWatchPage,
      getVideoId,
      isValid: () => ctx.isValid,
    });

    const applySettings = (next: Settings) => {
      settings = next;
      controller.applySettings(next);
      if (!next.enabled) runtime.teardown();
    };
    void loadSettings().then(applySettings);
    const unwatch = watchSettings(applySettings);
    const stopSubtitles = watchSubtitles(document, session.onDisplayed);

    ctx.addEventListener(window, 'keydown', controller.onKeyDown, { capture: true });
    ctx.addEventListener(window, 'keyup', controller.onKeyUp, { capture: true });
    ctx.addEventListener(document, 'mousemove', runtime.onMouseMove, { passive: true });
    ctx.addEventListener(document, 'pointerdown', runtime.onPointerDown);
    let lastVideoId = getVideoId();
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      const videoId = getVideoId();
      if (videoId === lastVideoId) return;
      lastVideoId = videoId;
      runtime.onVideoChange();
    });

    void mountOverlay(
      ctx,
      createElement(OverlayApp, {
        store,
        explain,
        playerRect: () => overlay?.playerRect() ?? null,
        openSettings: () => void sendToBackground({ type: 'open-options', hash: '#/settings' }),
        onCardElement: (element) => {
          cardElement = element;
        },
      }),
    ).then((handle) => {
      overlay = handle;
    });

    ctx.onInvalidated(() => {
      unwatch();
      stopSubtitles();
      runtime.teardown();
      bridge.dispose();
      controller.teardown();
    });
  },
});
```

- [ ] **Step 16: Run the whole suite, the type-check, and the build**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: all tests pass; `tsc` prints nothing; the build succeeds.

Then check that the SDK stayed out of the content script:

Run: `grep -l "dangerous-direct-browser-access" .output/chrome-mv3/content-scripts/*.js || echo "SDK not in content scripts"`
Expected: `SDK not in content scripts`.

Run: `ls .output/chrome-mv3/content-scripts/ && grep -o '"web_accessible_resources":\[[^]]*\]' .output/chrome-mv3/manifest.json`
Expected:
- `netflix.css` sits next to `netflix.js`.
- `web_accessible_resources` lists `content-scripts/netflix.css` for `https://www.netflix.com/*`. WXT adds it for `cssInjectionMode: 'ui'` so the shadow root can load the stylesheet.

- [ ] **Step 17: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/Markdown.tsx src/entrypoints/netflix.content tests/unit/explain-flow.test.ts tests/unit/card.test.tsx tests/unit/overlay-runtime.test.ts tests/unit/controller.test.ts
git commit -m "feat: explanation card on Netflix — Study Log first, streaming, Regenerate, follow-ups, error cards" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Settings page and popup — API key, explanation settings, line mode

Spec sections:
- §5.8 Settings tab:
  - Claude API key: password field, show/hide, Save, Test key, Remove; copy explaining where to get a key and that usage is billed by Anthropic.
  - Explanation language: by native name.
  - Card sections: four toggles.
  - Pause on hover.
  - Rewind/Forward: a Seconds / One line switch, with the stepper only in Seconds mode.
- §5.7 Popup: Pause on hover, API key status (links to Settings), Study Log link.
- §5.10: look and feel, with Lucide icons and no emoji. The spec's "✓ Claude key set" / "⚠ Add your Claude API key" become a check icon or a warning icon plus the text.

The options page never reads the saved key back. It only sees `{ set, masked }` from the background (Global Constraints).

**Files:**
- Create: `src/entrypoints/options/ApiKeyCard.tsx`, `src/entrypoints/options/ExplanationsCard.tsx`
- Modify: `src/entrypoints/options/SettingsTab.tsx`, `src/entrypoints/popup/App.tsx`
- Test: `tests/unit/settings-ui.test.tsx`, `tests/unit/popup.test.tsx`

**Interfaces:**
- Consumes:
  - `sendToBackground` and `BackgroundRequest`/`BackgroundResponse` (Task 9)
  - `EXPLANATION_LANGUAGES` (Task 2)
  - `CardSections`, `SeekMode` (Task 2)
  - `ANTHROPIC_KEYS_URL` (Task 8)
  - `SegmentedControl`, `Toggle`, styles (Plan 1 redesign)
- Produces:
  - `type Send = typeof sendToBackground`
  - `ApiKeyCard({ send? })`
  - `ExplanationsCard({ settings, update })`
  - `SettingsTab({ send? })`
  - Popup `App({ send? })`

- [ ] **Step 1: Write the failing tests**

`tests/unit/settings-ui.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ApiKeyCard } from '@/entrypoints/options/ApiKeyCard';
import { SettingsTab } from '@/entrypoints/options/SettingsTab';
import type { sendToBackground } from '@/lib/messages';
import { loadSettings } from '@/lib/settings';

beforeEach(() => fakeBrowser.reset());
afterEach(cleanup);

/** Stands in for the background worker's API key handling. */
function fakeBackground(initialKey: string | null = null) {
  let key = initialKey;
  const send = vi.fn(async (m: { type: string; key?: string }) => {
    switch (m.type) {
      case 'api-key:status':
        return { set: key !== null, masked: key ? `sk-ant-…${key.slice(-4)}` : null };
      case 'api-key:set': {
        const next = m.key?.trim() ?? '';
        if (!next || /\s/.test(next)) return { ok: false };
        key = next;
        return { ok: true };
      }
      case 'api-key:remove':
        key = null;
        return { ok: true };
      case 'api-key:test':
        return (m.key ?? key ?? '').includes('good')
          ? { result: 'valid', message: 'Your key works.' }
          : { result: 'rejected', message: 'Anthropic rejected this key.' };
      default:
        throw new Error(`unexpected ${m.type}`);
    }
  });
  return { send: send as unknown as typeof sendToBackground, calls: send.mock.calls };
}

describe('Claude API key card', () => {
  it('explains where to get a key and saves one without ever showing it again', async () => {
    const { send } = fakeBackground();
    render(<ApiKeyCard send={send} />);
    expect(await screen.findByText('No key saved yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'console.anthropic.com' }).getAttribute('href')).toBe('https://console.anthropic.com/settings/keys');
    expect(screen.getByText(/billed to your Anthropic account/)).toBeTruthy();
    const input = screen.getByLabelText('Claude API key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(input.type).toBe('text');
    fireEvent.change(input, { target: { value: 'sk-ant-good-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Key saved.')).toBeTruthy();
    expect(await screen.findByText('sk-ant-…1234')).toBeTruthy();
    expect(input.value).toBe('');
  });

  it('tests the saved key and reports the result', async () => {
    const { send } = fakeBackground('sk-ant-bad-0000');
    render(<ApiKeyCard send={send} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test key' }));
    expect(await screen.findByText('Anthropic rejected this key.')).toBeTruthy();
  });

  it('removes the key and refuses junk', async () => {
    const { send } = fakeBackground('sk-ant-good-9999');
    render(<ApiKeyCard send={send} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('No key saved yet.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Claude API key'), { target: { value: 'two words' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("That doesn't look like an API key.")).toBeTruthy();
  });

  it('says so when the key status cannot be read', async () => {
    const send = vi.fn(async () => {
      throw new Error('no background');
    }) as unknown as typeof sendToBackground;
    render(<ApiKeyCard send={send} />);
    expect(await screen.findByText("Couldn't check the saved key.")).toBeTruthy();
  });
});

describe('explanation and line settings', () => {
  it('saves the explanation language, card sections, and Pause on hover', async () => {
    render(<SettingsTab send={fakeBackground().send} />);
    fireEvent.change(await screen.findByLabelText('Explain in'), { target: { value: 'ja' } });
    await waitFor(async () => expect((await loadSettings()).explanationLanguage).toBe('ja'));
    expect(screen.getByRole('option', { name: '日本語' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Key expressions' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Pause on hover' }));
    await waitFor(async () => {
      const s = await loadSettings();
      expect(s.cardSections.keyExpressions).toBe(false);
      expect(s.pauseOnHover).toBe(false);
    });
  });

  it('Rewind can jump by one line; the seconds stepper hides in that mode', async () => {
    render(<SettingsTab send={fakeBackground().send} />);
    const group = await screen.findByRole('radiogroup', { name: 'Rewind jumps by' });
    expect(screen.getByLabelText('Rewind seconds')).toBeTruthy();
    fireEvent.click(group.querySelector('[role="radio"]:last-child')!);
    await waitFor(async () => expect((await loadSettings()).rewindMode).toBe('line'));
    await waitFor(() => expect(screen.queryByLabelText('Rewind seconds')).toBeNull());
    expect(screen.getByLabelText('Forward seconds')).toBeTruthy();
  });
});
```

In `tests/unit/popup.test.tsx`:
1. Add `import type { sendToBackground } from '@/lib/messages';`.
2. Add a helper:

   ```tsx
   const send = (set: boolean) =>
     vi.fn(async () => ({ set, masked: set ? 'sk-ant-…1234' : null })) as unknown as typeof sendToBackground;
   ```

3. Change every `render(<App />)` to `render(<App send={send(true)} />)`.
4. Append:

```tsx
  it('shows the key status and links to Settings when the key is missing', async () => {
    const open = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue();
    render(<App send={send(false)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add your Claude API key' }));
    expect(open).toHaveBeenCalled();
    cleanup();
    render(<App send={send(true)} />);
    expect(await screen.findByText('Claude key set')).toBeTruthy();
  });

  it('toggles Pause on hover and opens the Study Log', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    render(<App send={send(true)} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Pause on hover' }));
    await waitFor(async () => expect((await loadSettings()).pauseOnHover).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Study Log' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ url: expect.stringMatching(/options\.html#\/study-log$/) }));
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/settings-ui.test.tsx tests/unit/popup.test.tsx`
Expected: FAIL — `Failed to resolve import "@/entrypoints/options/ApiKeyCard"`; the popup tests fail on the missing Pause on hover switch.

- [ ] **Step 3: Implement `src/entrypoints/options/ApiKeyCard.tsx`**

```tsx
import { Eye, EyeOff, KeyRound, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { buttonSecondary, card, focusRing, iconTile } from '@/components/styles';
import { ANTHROPIC_KEYS_URL } from '@/lib/config';
import { sendToBackground } from '@/lib/messages';

export type Send = typeof sendToBackground;

type KeyStatus = { set: boolean; masked: string | null } | 'unknown' | null;
type Note = { tone: 'good' | 'bad' | 'info'; text: string };

const NOTE_COLOR: Record<Note['tone'], string> = { good: 'text-tint-ink', bad: 'text-danger', info: 'text-mute' };

/** Spec §5.8: the key goes to the background worker; this page only ever sees whether one is set (masked). */
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
    const res = await send({ type: 'api-key:set', key: draft });
    if (!res.ok) {
      setNote({ tone: 'bad', text: "That doesn't look like an API key." });
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
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    await send({ type: 'api-key:remove' });
    setNote({ tone: 'info', text: 'Key removed.' });
    await refresh();
  };

  const saved = typeof status === 'object' && status?.set === true;

  return (
    <section aria-labelledby="api-key-heading" className={`${card} px-5 py-4`}>
      <div className="flex items-start gap-3.5">
        <span className={iconTile}>
          <KeyRound size={20} strokeWidth={2.5} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="api-key-heading" className="text-[19px] font-black">
            Claude API key
          </h2>
          <p className="mt-0.5 text-sm font-semibold text-mute">
            LingoFlix asks Claude with your own key. Create one at{' '}
            <a href={ANTHROPIC_KEYS_URL} target="_blank" rel="noopener noreferrer" className={`underline ${focusRing}`}>
              console.anthropic.com
            </a>
            . Usage is billed to your Anthropic account. The key stays on this computer and is sent only to Anthropic.
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm font-bold">
        {status === null && 'Checking…'}
        {status === 'unknown' && "Couldn't check the saved key."}
        {typeof status === 'object' && status !== null && !status.set && 'No key saved yet.'}
        {saved && (
          <>
            Saved key: <code className="rounded bg-soft px-1.5 py-0.5 text-[13px]">{(status as { masked: string }).masked}</code>
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <input
            type={show ? 'text' : 'password'}
            aria-label="Claude API key"
            placeholder={saved ? 'Paste a new key to replace it' : 'sk-ant-…'}
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

- [ ] **Step 4: Implement `src/entrypoints/options/ExplanationsCard.tsx`**

```tsx
import { useId } from 'react';
import { Toggle } from '@/components/Toggle';
import { card } from '@/components/styles';
import { EXPLANATION_LANGUAGES } from '@/lib/languages';
import { CARD_SECTION_IDS, type CardSections, type Settings } from '@/lib/settings';

const SECTION_COPY: Record<keyof CardSections, { label: string; description: string }> = {
  meaning: { label: 'Meaning', description: 'Translation, tone, and nuance in this scene.' },
  keyExpressions: { label: 'Key expressions', description: 'Idioms and slang, each defined.' },
  howToUse: { label: 'How to use it', description: 'Everyday example sentences.' },
  followUp: { label: 'Follow-up box', description: 'Ask Claude more about the line.' },
};

interface ExplanationsCardProps {
  settings: Settings;
  update(fn: (s: Settings) => Settings): Promise<void>;
}

/** Spec §5.8: explanation language, card sections, Pause on hover. */
export function ExplanationsCard({ settings, update }: ExplanationsCardProps) {
  const languageId = useId();
  const languageHint = useId();
  return (
    <section aria-labelledby="explanations-heading" className={`${card} px-5 py-4`}>
      <h2 id="explanations-heading" className="text-[19px] font-black">
        Explanations
      </h2>
      <p className="mt-0.5 text-sm font-semibold text-mute">How the card on Netflix explains a line.</p>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <label htmlFor={languageId} className="block text-base font-extrabold">
            Explain in
          </label>
          <p id={languageHint} className="text-[13px] font-semibold text-mute">
            Claude answers in this language.
          </p>
        </div>
        <select
          id={languageId}
          aria-describedby={languageHint}
          value={settings.explanationLanguage}
          onChange={(e) => void update((s) => ({ ...s, explanationLanguage: e.target.value }))}
          className="rounded-xl border-2 border-line bg-card px-3 py-2 text-sm font-bold text-ink outline-none focus:border-brand"
        >
          {EXPLANATION_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName}
            </option>
          ))}
        </select>
      </div>

      <div className="border-t-2 border-soft py-3">
        <Toggle
          label="Pause on hover"
          description="Pause the video while you read the card."
          checked={settings.pauseOnHover}
          onChange={(pauseOnHover) => void update((s) => ({ ...s, pauseOnHover }))}
        />
      </div>

      <fieldset className="border-t-2 border-soft pt-3">
        <legend className="sr-only">Card sections</legend>
        <p className="text-base font-extrabold">Card sections</p>
        <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {CARD_SECTION_IDS.map((id) => (
            <Toggle
              key={id}
              label={SECTION_COPY[id].label}
              description={SECTION_COPY[id].description}
              checked={settings.cardSections[id]}
              onChange={(on) => void update((s) => ({ ...s, cardSections: { ...s.cardSections, [id]: on } }))}
            />
          ))}
        </div>
      </fieldset>
    </section>
  );
}
```

- [ ] **Step 5: Update `src/entrypoints/options/SettingsTab.tsx`**

1. Add imports:

   ```ts
   import { AlignLeft, Timer } from 'lucide-react';
   import type { Send } from './ApiKeyCard';
   import { ApiKeyCard } from './ApiKeyCard';
   import { ExplanationsCard } from './ExplanationsCard';
   ```

   Add `type SeekMode` to the `@/lib/settings` import.

2. Add next to `THEME_OPTIONS`:

```ts
const SEEK_MODE_OPTIONS = [
  { value: 'seconds', label: 'Seconds', icon: Timer },
  { value: 'line', label: 'One line', icon: AlignLeft },
] as const satisfies readonly { value: SeekMode; label: string; icon: LucideIcon }[];
```

3. Change the signature to `export function SettingsTab({ send }: { send?: Send } = {}) {`.

4. Replace the `rewind` and `forward` branches of `actionDetail` with:

```tsx
    if (action === 'rewind')
      return (
        <>
          <SegmentedControl
            label="Rewind jumps by"
            value={s.rewindMode}
            options={SEEK_MODE_OPTIONS}
            onChange={(rewindMode) => void update((cur) => ({ ...cur, rewindMode }))}
          />
          {s.rewindMode === 'seconds' && (
            <SecondsStepper
              label="Rewind seconds"
              value={s.rewindSeconds}
              onCommit={(rewindSeconds) => void update((cur) => ({ ...cur, rewindSeconds }))}
            />
          )}
        </>
      );
    if (action === 'forward')
      return (
        <>
          <SegmentedControl
            label="Forward jumps by"
            value={s.forwardMode}
            options={SEEK_MODE_OPTIONS}
            onChange={(forwardMode) => void update((cur) => ({ ...cur, forwardMode }))}
          />
          {s.forwardMode === 'seconds' && (
            <SecondsStepper
              label="Forward seconds"
              value={s.forwardSeconds}
              onCommit={(forwardSeconds) => void update((cur) => ({ ...cur, forwardSeconds }))}
            />
          )}
        </>
      );
```

5. Make the detail line wrap: change its class from `mt-1 flex items-center gap-2 …` to `mt-1 flex flex-wrap items-center gap-2 …`.

6. Insert between the General card's closing `</section>` and the Shortcuts `<section>`:

```tsx
      <ApiKeyCard send={send} />
      <ExplanationsCard settings={settings} update={update} />
```

7. In the Reset button, also reset the modes: add `rewindMode: DEFAULT_SETTINGS.rewindMode, forwardMode: DEFAULT_SETTINGS.forwardMode,` to the object passed to `update`.

- [ ] **Step 6: Update the popup `src/entrypoints/popup/App.tsx`**

```tsx
import { browser } from '#imports';
import { AlertTriangle, BookOpen, CheckCircle2, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DonationCard } from '@/components/DonationCard';
import { Logo } from '@/components/Logo';
import { Toggle } from '@/components/Toggle';
import { buttonPrimary, buttonSecondary, card, focusRing } from '@/components/styles';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { sendToBackground } from '@/lib/messages';

type Send = typeof sendToBackground;

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
  ) : (
    <button
      type="button"
      onClick={() => void browser.runtime.openOptionsPage()}
      className={`flex items-center gap-1.5 text-left text-[13px] font-extrabold text-danger underline-offset-2 hover:underline ${focusRing}`}
    >
      <AlertTriangle size={16} strokeWidth={2.5} aria-hidden />
      Add your Claude API key
    </button>
  );
}

export function App({ send = sendToBackground }: { send?: Send } = {}) {
  const { settings, update } = useSettings();
  useTheme(settings?.theme);

  const openStudyLog = () => void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#/study-log` });

  return (
    <main className="flex w-80 flex-col gap-3.5 p-4">
      <header className="flex items-center gap-2">
        <Logo />
        <span className="ml-auto rounded-full border-2 border-line px-2 text-[11px] font-extrabold text-mute">
          v{browser.runtime.getManifest().version}
        </span>
      </header>

      <section className={`${card} p-3.5`}>
        {settings ? (
          <>
            <Toggle
              name="Enabled"
              label={settings.enabled ? "You're all set!" : 'Taking a break'}
              description={
                settings.enabled
                  ? 'Your shortcuts are live on Netflix.'
                  : 'Netflix works like normal until you turn this back on.'
              }
              checked={settings.enabled}
              onChange={(enabled) => void update((s) => ({ ...s, enabled }))}
            />
            <div className="mt-3 border-t-2 border-soft pt-3">
              <Toggle
                label="Pause on hover"
                description="Pause while you read an explanation."
                checked={settings.pauseOnHover}
                onChange={(pauseOnHover) => void update((s) => ({ ...s, pauseOnHover }))}
              />
            </div>
            <div className="mt-3 border-t-2 border-soft pt-3">
              <KeyStatus send={send} />
            </div>
          </>
        ) : (
          <p className="text-sm font-semibold text-mute">Loading…</p>
        )}
      </section>

      <button type="button" onClick={() => void browser.runtime.openOptionsPage()} className={`${buttonPrimary} w-full`}>
        <SettingsIcon size={18} strokeWidth={2.75} aria-hidden />
        Settings
      </button>
      <button type="button" onClick={openStudyLog} className={`${buttonSecondary} w-full py-2.5`}>
        <BookOpen size={16} strokeWidth={2.75} aria-hidden />
        Study Log
      </button>

      <DonationCard compact />
    </main>
  );
}
```

- [ ] **Step 7: Run the tests to make sure they pass**

Run: `pnpm vitest run tests/unit/settings-ui.test.tsx tests/unit/popup.test.tsx tests/unit/options.test.tsx`
Expected: PASS.

`options.test.tsx` renders the real `ApiKeyCard`. With no background in the test, it shows "Couldn't check the saved key." and must not throw.

- [ ] **Step 8: Run the whole suite, the type-check, and the build**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: all tests pass; `tsc` prints nothing; the build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/entrypoints/options src/entrypoints/popup tests/unit/settings-ui.test.tsx tests/unit/popup.test.tsx
git commit -m "feat: API key, explanation settings, line mode, and popup key status" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: Study Log tab and "Open at this moment"

Spec §5.5, Organization:
- Left: a tree of Series → Season → Episode with counts, plus a Movies group.
- Right: the selected episode's lines in time order, each with its timestamp, phrase, collapsible response, and follow-ups.
- **Open at this moment:** a pending seek in `chrome.storage.session`, then open `/watch/{id}`. The content script seeks once the player is ready; a pending seek older than 2 minutes is ignored.
- **Delete** on an entry, an episode, a season, or a series, each behind a confirmation dialog.
- **Reset all**, also behind a confirmation.

Spec §5.8 also adds the Study Log tab, and the `#/study-log` route the popup links to.

Netflix resumes an episode at its own bookmark (`docs/netflix-internals.md` row 7). The runner therefore checks once, 1.5 s after seeking, and seeks again if Netflix moved the position.

**Files:**
- Create:
  - `src/components/ConfirmDialog.tsx`
  - `src/entrypoints/options/StudyLogTab.tsx`, `src/entrypoints/options/StudyLogTree.tsx`, `src/entrypoints/options/StudyLogEntries.tsx`
  - `src/entrypoints/netflix.content/pending-seek-runner.ts`
- Modify: `src/entrypoints/options/App.tsx`, `src/entrypoints/netflix.content/index.ts`
- Test: `tests/unit/study-log-tab.test.tsx`, `tests/unit/pending-seek-runner.test.ts`, `tests/unit/options.test.tsx`

**Interfaces:**
- Consumes:
  - From Task 7: `listEntries`, `deleteEntries`, `resetStudyLog`, `watchStudyLog`, `groupStudyLog`, `formatTimestamp`, `seasonLabel`, `episodeLabel`, `StudyLogEntry`
  - `setPendingSeek` (Task 9)
  - `sendToBackground` (`pending-seek:take`, Task 9)
  - `Markdown` (Task 11)
  - `BridgeClient.callSync`
- Produces:
  - `ConfirmDialog({ title, body, confirmLabel?, onConfirm, onCancel })`
  - `StudyLogTab({ openAtMoment? })`
  - `runPendingSeek(videoId, deps): () => void`

- [ ] **Step 1: Write the failing pending-seek runner tests**

`tests/unit/pending-seek-runner.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPendingSeek } from '@/entrypoints/netflix.content/pending-seek-runner';

afterEach(() => vi.useRealTimers());

function player(videoId = '80077211') {
  const state = { ready: false, timeMs: 0, videoId, seeks: [] as number[] };
  const bridge = {
    callSync: vi.fn((method: string, ...args: unknown[]) => {
      if (method === 'getState') {
        return state.ready
          ? { ok: true, result: { currentTimeMs: state.timeMs, durationMs: 1_000_000, paused: false, videoId: state.videoId, textTrack: null } }
          : { ok: false, error: { code: 'player-unavailable' } };
      }
      if (method === 'seek') {
        if (!state.ready) return { ok: false, error: { code: 'player-unavailable' } };
        state.timeMs = args[0] as number;
        state.seeks.push(args[0] as number);
        return { ok: true, result: null };
      }
      return { ok: true, result: null };
    }),
  };
  return { state, bridge: bridge as never };
}

describe('runPendingSeek (Open at this moment)', () => {
  it('seeks to the saved moment once the player for that video is ready', async () => {
    vi.useFakeTimers();
    const { state, bridge } = player();
    runPendingSeek('80077211', { take: async () => 1_834_200, bridge });
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.seeks).toEqual([]);
    state.ready = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(state.seeks).toEqual([1_834_200]);
  });

  it('seeks again once if Netflix jumps to its own resume point', async () => {
    vi.useFakeTimers();
    const { state, bridge } = player();
    state.ready = true;
    runPendingSeek('80077211', { take: async () => 1_834_200, bridge });
    await vi.advanceTimersByTimeAsync(0);
    state.timeMs = 600_000; // Netflix's bookmark
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.seeks).toEqual([1_834_200, 1_834_200]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.seeks).toHaveLength(2);
  });

  it('does nothing when nothing is pending for this video', async () => {
    vi.useFakeTimers();
    const { state, bridge } = player();
    state.ready = true;
    runPendingSeek('80077211', { take: async () => null, bridge });
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.seeks).toEqual([]);
  });

  it('gives up after 30 s, and cancelling stops it', async () => {
    vi.useFakeTimers();
    const slow = player();
    runPendingSeek('80077211', { take: async () => 5000, bridge: slow.bridge });
    await vi.advanceTimersByTimeAsync(31_000);
    slow.state.ready = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(slow.state.seeks).toEqual([]);

    const cancelled = player();
    const cancel = runPendingSeek('80077211', { take: async () => 5000, bridge: cancelled.bridge });
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    cancelled.state.ready = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(cancelled.state.seeks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/pending-seek-runner.test.ts`
Expected: FAIL — `Failed to resolve import "@/entrypoints/netflix.content/pending-seek-runner"`.

- [ ] **Step 3: Implement `src/entrypoints/netflix.content/pending-seek-runner.ts`**

```ts
import type { BridgeClient } from '@/lib/bridge/client';

export interface PendingSeekDeps {
  /** Takes this video's pending seek from the background (null if none or stale). */
  take(videoId: string): Promise<number | null>;
  bridge: Pick<BridgeClient, 'callSync'>;
}

const RETRY_MS = 500;
const GIVE_UP_MS = 30_000;
const VERIFY_AFTER_MS = 1500;
const VERIFY_SLACK_MS = 3000;

/**
 * Spec §5.5 Open at this moment: once the player for `videoId` is ready, seek to the saved moment. Netflix
 * may apply its own resume point right after loading, so check once and seek again if it moved.
 */
export function runPendingSeek(videoId: string, deps: PendingSeekDeps): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUpAt = Date.now() + GIVE_UP_MS;

  const later = (fn: () => void, ms: number) => {
    timer = setTimeout(fn, ms);
  };

  // A reloaded extension can't answer; that just means there is nothing to seek to.
  void deps.take(videoId).catch(() => null).then((timeMs) => {
    if (cancelled || timeMs === null) return;

    const verify = () => {
      if (cancelled) return;
      const state = deps.bridge.callSync('getState');
      if (state.ok && Math.abs(state.result.currentTimeMs - timeMs) > VERIFY_SLACK_MS) deps.bridge.callSync('seek', timeMs);
    };

    const attempt = () => {
      if (cancelled) return;
      const state = deps.bridge.callSync('getState');
      const ready = state.ok && state.result.videoId === videoId;
      if (ready && deps.bridge.callSync('seek', timeMs).ok) {
        later(verify, VERIFY_AFTER_MS);
        return;
      }
      if (Date.now() < giveUpAt) later(attempt, RETRY_MS);
    };

    attempt();
  });

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `pnpm vitest run tests/unit/pending-seek-runner.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run it on watch pages in `src/entrypoints/netflix.content/index.ts`**

1. Add `import { runPendingSeek } from './pending-seek-runner';`.
2. After `let lastVideoId = getVideoId();`, add:

```ts
    let cancelPendingSeek: (() => void) | null = null;
    const startPendingSeek = (videoId: string | null) => {
      cancelPendingSeek?.();
      cancelPendingSeek = videoId
        ? runPendingSeek(videoId, {
            take: async (id) => (await sendToBackground({ type: 'pending-seek:take', videoId: id })).timeMs,
            bridge,
          })
        : null;
    };
    startPendingSeek(lastVideoId);
```

3. In the `wxt:locationchange` listener, after `runtime.onVideoChange();`, add `startPendingSeek(videoId);`.
4. In `ctx.onInvalidated`, add `cancelPendingSeek?.();`.

Run: `pnpm vitest run tests/unit/pending-seek-runner.test.ts && pnpm compile`
Expected: PASS; `tsc` prints nothing.

- [ ] **Step 6: Write the failing Study Log tab tests**

`tests/unit/study-log-tab.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { StudyLogTab } from '@/entrypoints/options/StudyLogTab';
import { takePendingSeek } from '@/lib/pending-seek';
import { listEntries, saveExplanation } from '@/lib/study-log/store';
import type { NewStudyLogEntry } from '@/lib/study-log/types';

beforeEach(() => fakeBrowser.reset());
afterEach(cleanup);

const line = (over: Partial<NewStudyLogEntry>): NewStudyLogEntry => ({
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
  ...over,
});

async function seed() {
  await saveExplanation(line({ phrase: "I'm gonna call it a night.", videoTimeMs: 1_834_200 }));
  await saveExplanation(line({ phrase: 'Where are you going?', videoTimeMs: 1000 }));
  await saveExplanation(line({ phrase: 'Pilot line', videoId: '80077209', episodeNumber: 1, episodeTitle: 'The Vanishing of Will Byers' }));
  await saveExplanation(
    line({ phrase: 'Movie line', videoId: '80240715', kind: 'movie', seriesId: null, seriesTitle: 'Roma', seasonNumber: null, episodeNumber: null, episodeTitle: null }),
  );
}

describe('Study Log tab', () => {
  it('invites a first explanation when empty', async () => {
    render(<StudyLogTab />);
    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
  });

  it('shows series → season → episode with counts, and the selected episode’s lines in time order', async () => {
    await seed();
    render(<StudyLogTab />);
    const tree = await screen.findByRole('navigation', { name: 'Shows and movies' });
    expect(within(tree).getByText('Stranger Things')).toBeTruthy();
    expect(within(tree).getByText('Season 1')).toBeTruthy();
    expect(within(tree).getByRole('button', { name: 'Roma, 1 line' })).toBeTruthy();
    expect(await screen.findByText('Pilot line')).toBeTruthy(); // first episode selected by default
    fireEvent.click(within(tree).getByRole('button', { name: 'E3 · Holly, Jolly, 2 lines' }));
    const lines = await screen.findByRole('list', { name: 'Explained lines' });
    const items = within(lines).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('p')?.textContent)).toEqual(['Where are you going?', "I'm gonna call it a night."]);
    expect(within(items[0]!).getByText('0:01')).toBeTruthy();
    expect(within(items[1]!).getByText('30:34')).toBeTruthy();
  });

  it('expands an explanation', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show explanation' }));
    expect(screen.getByRole('heading', { name: 'Meaning' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide explanation' })).toBeTruthy();
  });

  it('Open at this moment leaves a pending seek and opens the episode on Netflix', async () => {
    await seed();
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    render(<StudyLogTab />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Shows and movies' })).getByRole('button', { name: 'E3 · Holly, Jolly, 2 lines' }));
    const night = (await screen.findByText("I'm gonna call it a night.")).closest('li')!;
    fireEvent.click(within(night).getByRole('button', { name: 'Open at this moment' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ url: 'https://www.netflix.com/watch/80077211' }));
    expect(await takePendingSeek('80077211')).toBe(1_834_200);
  });

  it('deleting a line asks first; Cancel keeps it', async () => {
    await seed();
    render(<StudyLogTab />);
    const pilot = (await screen.findByText('Pilot line')).closest('li')!;
    fireEvent.click(within(pilot).getByRole('button', { name: 'Delete line' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this line?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await listEntries()).toHaveLength(4);
    fireEvent.click(within(pilot).getByRole('button', { name: 'Delete line' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await listEntries()).toHaveLength(3));
    await waitFor(() => expect(screen.queryByText('Pilot line')).toBeNull());
  });

  it('deletes a whole season after confirming', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Stranger Things Season 1' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await listEntries()).map((e) => e.phrase)).toEqual(['Movie line']));
  });

  it('Reset all empties the Study Log after confirming', async () => {
    await seed();
    render(<StudyLogTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reset all' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Reset your Study Log?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset all' }));
    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
    expect(await listEntries()).toEqual([]);
  });

  it('shows a line saved from a Netflix tab without reloading', async () => {
    render(<StudyLogTab />);
    await screen.findByText('Nothing here yet');
    await saveExplanation(line({ phrase: 'Fresh line' }));
    expect(await screen.findByText('Fresh line')).toBeTruthy();
  });
});
```

In `tests/unit/options.test.tsx`, append inside the `describe`:

```tsx
  it('#/study-log opens the Study Log tab', async () => {
    location.hash = '#/study-log';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Study Log', level: 1 })).toBeTruthy();
    location.hash = '';
  });
```

- [ ] **Step 7: Run them to make sure they fail**

Run: `pnpm vitest run tests/unit/study-log-tab.test.tsx tests/unit/options.test.tsx`
Expected: FAIL — `Failed to resolve import "@/entrypoints/options/StudyLogTab"`.

- [ ] **Step 8: Implement `src/components/ConfirmDialog.tsx`**

```tsx
import { useEffect, useId, useRef } from 'react';
import { buttonSecondary, card, focusRing } from './styles';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm(): void;
  onCancel(): void;
}

/** Spec §5.5: every delete and Reset all asks first. Cancel has focus, so Enter never deletes by accident. */
export function ConfirmDialog({ title, body, confirmLabel = 'Delete', onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} className={`${card} w-full max-w-sm p-5`}>
        <h2 id={titleId} className="text-lg font-black">
          {title}
        </h2>
        <p id={bodyId} className="mt-1 text-sm font-semibold text-mute">
          {body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancel} type="button" onClick={onCancel} className={buttonSecondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex items-center rounded-2xl bg-danger px-4 py-2 text-xs font-extrabold tracking-wider text-white uppercase shadow-[0_3px_0_rgb(0_0_0/0.25)] active:translate-y-[3px] active:shadow-none ${focusRing}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Implement `src/entrypoints/options/StudyLogTree.tsx`**

```tsx
import { Film, Trash2 } from 'lucide-react';
import { focusRing } from '@/components/styles';
import { episodeLabel, seasonLabel } from '@/lib/study-log/format';
import type { SeasonNode, SeriesNode, StudyLogTree as Tree } from '@/lib/study-log/group';

const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;

const countPill = 'ml-auto rounded-full bg-soft px-2 text-[11px] font-extrabold text-mute';
const trashButton = `grid size-7 shrink-0 place-items-center rounded-lg text-mute hover:bg-soft hover:text-danger ${focusRing}`;

interface StudyLogTreeProps {
  tree: Tree;
  selected: string | null;
  onSelect(key: string): void;
  onDeleteSeries(series: SeriesNode): void;
  onDeleteSeason(series: SeriesNode, season: SeasonNode): void;
}

function NodeButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={`${label}, ${lines(count)}`}
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

/** Spec §5.5: Series → Season → Episode with counts, plus Movies. */
export function StudyLogTree({ tree, selected, onSelect, onDeleteSeries, onDeleteSeason }: StudyLogTreeProps) {
  return (
    <nav aria-label="Shows and movies" className="flex flex-col gap-4">
      {tree.series.map((series) => (
        <div key={series.key}>
          <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate text-[15px] font-black">{series.title}</p>
            <button type="button" aria-label={`Delete ${series.title}`} onClick={() => onDeleteSeries(series)} className={trashButton}>
              <Trash2 size={14} strokeWidth={2.5} aria-hidden />
            </button>
          </div>
          {series.seasons.map((season) => (
            <div key={season.key} className="mt-1.5">
              <div className="flex items-center gap-1 pl-1">
                <p className="flex-1 text-[12px] font-extrabold tracking-wide text-mute uppercase">{seasonLabel(season.seasonNumber)}</p>
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
                      count={episode.entries.length}
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
                <NodeButton label={movie.title} count={movie.entries.length} active={selected === movie.key} onClick={() => onSelect(movie.key)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
```

- [ ] **Step 10: Implement `src/entrypoints/options/StudyLogEntries.tsx`**

```tsx
import { ChevronDown, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { buttonSecondary, card, focusRing } from '@/components/styles';
import { formatTimestamp } from '@/lib/study-log/format';
import type { StudyLogEntry } from '@/lib/study-log/types';

interface StudyLogEntriesProps {
  heading: string;
  subheading: string;
  entries: StudyLogEntry[];
  deleteLabel: string;
  onDeleteAll(): void;
  onDeleteEntry(entry: StudyLogEntry): void;
  onOpenAtMoment(entry: StudyLogEntry): void;
}

function EntryItem({ entry, onDelete, onOpen }: { entry: StudyLogEntry; onDelete(): void; onOpen(): void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`${card} px-4 py-3`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-lg bg-tint px-2 py-0.5 text-[12px] font-black text-tint-ink">{formatTimestamp(entry.videoTimeMs)}</span>
        <p className="min-w-0 flex-1 text-[15px] font-extrabold whitespace-pre-line">{entry.phrase}</p>
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`mt-2 inline-flex items-center gap-1 text-[13px] font-extrabold text-mute hover:text-ink ${focusRing}`}
      >
        <ChevronDown size={14} strokeWidth={3} className={open ? 'rotate-180' : ''} aria-hidden />
        {open ? 'Hide explanation' : 'Show explanation'}
      </button>
      {open && (
        <div className="mt-2 border-t-2 border-soft pt-2">
          <Markdown>{entry.response}</Markdown>
          {entry.followUps.map((f, i) => (
            <div key={i} className="mt-3 border-t-2 border-soft pt-2">
              <p className="text-[13px] font-extrabold text-tint-ink">{f.question}</p>
              <Markdown>{f.answer}</Markdown>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onOpen} className={buttonSecondary}>
          <Play size={14} strokeWidth={3} fill="currentColor" aria-hidden />
          Open at this moment
        </button>
        <button type="button" onClick={onDelete} className={buttonSecondary}>
          <Trash2 size={14} strokeWidth={3} aria-hidden />
          Delete line
        </button>
      </div>
    </li>
  );
}

/** Spec §5.5: the selected episode's lines in time order. */
export function StudyLogEntries({ heading, subheading, entries, deleteLabel, onDeleteAll, onDeleteEntry, onOpenAtMoment }: StudyLogEntriesProps) {
  return (
    <section aria-labelledby="study-log-entries-heading" className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="study-log-entries-heading" className="text-[19px] font-black">
            {heading}
          </h2>
          <p className="text-sm font-semibold text-mute">{subheading}</p>
        </div>
        <button type="button" onClick={onDeleteAll} className={buttonSecondary}>
          <Trash2 size={14} strokeWidth={3} aria-hidden />
          {deleteLabel}
        </button>
      </header>
      <ol aria-label="Explained lines" className="flex flex-col gap-3">
        {entries.map((entry) => (
          <EntryItem key={entry.id} entry={entry} onDelete={() => onDeleteEntry(entry)} onOpen={() => onOpenAtMoment(entry)} />
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 11: Implement `src/entrypoints/options/StudyLogTab.tsx`**

```tsx
import { browser } from '#imports';
import { BookOpen, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { buttonSecondary, card, iconTile } from '@/components/styles';
import { setPendingSeek } from '@/lib/pending-seek';
import { episodeLabel, seasonLabel } from '@/lib/study-log/format';
import { groupStudyLog, type StudyLogTree as Tree } from '@/lib/study-log/group';
import { deleteEntries, listEntries, resetStudyLog, watchStudyLog } from '@/lib/study-log/store';
import type { StudyLogEntry } from '@/lib/study-log/types';
import { StudyLogEntries } from './StudyLogEntries';
import { StudyLogTree } from './StudyLogTree';

interface Selectable {
  key: string;
  heading: string;
  subheading: string;
  deleteLabel: string;
  entries: StudyLogEntry[];
}

interface PendingDelete {
  title: string;
  body: string;
  confirmLabel?: string;
  run(): Promise<void>;
}

const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;

/** Episodes in tree order, then movies — what the right-hand panel can show. */
function selectable(tree: Tree): Selectable[] {
  const episodes = tree.series.flatMap((series) =>
    series.seasons.flatMap((season) =>
      season.episodes.map((episode) => ({
        key: episode.key,
        heading: series.title,
        subheading: `${seasonLabel(season.seasonNumber)} · ${episodeLabel(episode)}`,
        deleteLabel: 'Delete episode',
        entries: episode.entries,
      })),
    ),
  );
  const movies = tree.movies.map((movie) => ({
    key: movie.key,
    heading: movie.title,
    subheading: 'Movie',
    deleteLabel: 'Delete movie',
    entries: movie.entries,
  }));
  return [...episodes, ...movies];
}

/** Spec §5.5 Open at this moment: leave a pending seek, then open the episode on Netflix. */
async function openInNetflix(entry: StudyLogEntry): Promise<void> {
  await setPendingSeek(entry.videoId, entry.videoTimeMs);
  await browser.tabs.create({ url: `https://www.netflix.com/watch/${entry.videoId}` });
}

export function StudyLogTab({ openAtMoment = openInNetflix }: { openAtMoment?: (entry: StudyLogEntry) => Promise<void> } = {}) {
  const [entries, setEntries] = useState<StudyLogEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      void listEntries().then((list) => {
        if (active) setEntries(list);
      });
    load();
    const unwatch = watchStudyLog(load);
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  const tree = useMemo(() => groupStudyLog(entries ?? []), [entries]);
  const nodes = useMemo(() => selectable(tree), [tree]);
  const current = nodes.find((n) => n.key === selected) ?? nodes[0] ?? null;

  const confirmDelete = (title: string, body: string, ids: string[]) =>
    setPending({ title, body, run: () => deleteEntries(ids) });

  if (entries === null) return <p className="text-sm font-semibold text-mute">Loading…</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-black tracking-tight">Study Log</h1>
          <p className="mt-1 text-[15px] font-semibold text-mute">Every line you've explained, by show and episode.</p>
        </div>
        {tree.total > 0 && (
          <button
            type="button"
            className={buttonSecondary}
            onClick={() =>
              setPending({
                title: 'Reset your Study Log?',
                body: "Every saved line and explanation will be removed. This can't be undone.",
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

      {tree.total === 0 ? (
        <section className={`${card} flex items-start gap-3.5 px-5 py-5`}>
          <span className={iconTile}>
            <BookOpen size={20} strokeWidth={2.5} aria-hidden />
          </span>
          <div>
            <h2 className="text-[19px] font-black">Nothing here yet</h2>
            <p className="mt-0.5 text-sm font-semibold text-mute">
              Hover a subtitle on Netflix to explain your first line. It lands here automatically.
            </p>
          </div>
        </section>
      ) : (
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <StudyLogTree
            tree={tree}
            selected={current?.key ?? null}
            onSelect={setSelected}
            onDeleteSeries={(series) =>
              confirmDelete(
                `Delete ${series.title}?`,
                `All ${lines(series.count)} from this show will be removed.`,
                series.seasons.flatMap((s) => s.episodes.flatMap((e) => e.entries.map((x) => x.id))),
              )
            }
            onDeleteSeason={(series, season) =>
              confirmDelete(
                `Delete ${series.title} ${seasonLabel(season.seasonNumber)}?`,
                `All ${lines(season.count)} from this season will be removed.`,
                season.episodes.flatMap((e) => e.entries.map((x) => x.id)),
              )
            }
          />
          {current && (
            <StudyLogEntries
              heading={current.heading}
              subheading={current.subheading}
              entries={current.entries}
              deleteLabel={current.deleteLabel}
              onDeleteAll={() =>
                confirmDelete(
                  `${current.deleteLabel}?`,
                  `All ${lines(current.entries.length)} from ${current.subheading === 'Movie' ? 'this movie' : 'this episode'} will be removed.`,
                  current.entries.map((e) => e.id),
                )
              }
              onDeleteEntry={(entry) =>
                confirmDelete('Delete this line?', `“${entry.phrase}” and its explanation will be removed from your Study Log.`, [entry.id])
              }
              onOpenAtMoment={(entry) => void openAtMoment(entry)}
            />
          )}
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

- [ ] **Step 12: Add the tab to `src/entrypoints/options/App.tsx`**

1. Change the lucide import to `import { BookOpen, Settings as SettingsIcon } from 'lucide-react';`.
2. Add `import { StudyLogTab } from './StudyLogTab';`.
3. Replace `TABS`:

   ```ts
   const TABS = [
     { id: 'settings', label: 'Settings', icon: SettingsIcon },
     { id: 'study-log', label: 'Study Log', icon: BookOpen },
   ] as const;
   ```

4. Below `{tab === 'settings' && <SettingsTab />}`, add `{tab === 'study-log' && <StudyLogTab />}`.

- [ ] **Step 13: Run the tests to make sure they pass**

Run: `pnpm vitest run tests/unit/study-log-tab.test.tsx tests/unit/options.test.tsx tests/unit/pending-seek-runner.test.ts`
Expected: PASS.

- [ ] **Step 14: Run the whole suite, the type-check, and the build**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: all tests pass; `tsc` prints nothing; the build succeeds.

- [ ] **Step 15: Commit**

```bash
git add src/components/ConfirmDialog.tsx src/entrypoints/options src/entrypoints/netflix.content/pending-seek-runner.ts src/entrypoints/netflix.content/index.ts tests/unit/study-log-tab.test.tsx tests/unit/pending-seek-runner.test.ts tests/unit/options.test.tsx
git commit -m "feat: Study Log tab with tree, deletes, Reset all, and Open at this moment" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 14: Live check on Netflix, docs, README

Spec §11 calls for a manual checklist on real Netflix, and §8.6 needs the remaining facts recorded. This task needs your human partner's logged-in Chrome and a Claude API key. Fix any failure with superpowers:systematic-debugging, and add a failing test before each fix.

**Files:**
- Modify: `docs/netflix-internals.md`, `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: verified facts and user-facing docs.

- [ ] **Step 1: Build**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: all green; `.output/chrome-mv3` rebuilt.

- [ ] **Step 2: Human step — run the checklist**

Ask your human partner to reload LingoFlix at `chrome://extensions`, refresh Netflix, and report the numbers of any item that fails:

*Key and settings*
1. Settings → Claude API key: paste a key, then **Save**. **Test key** says "Your key works." The popup shows "Claude key set".
2. Pick an **Explain in** language other than English.

*Hover to explain (a series episode, text subtitles on)*

3. Hover a subtitle line. The video pauses, and after about half a second a card above the line streams an explanation in that language, with Meaning, Key expressions, and How to use it.
4. Move the pointer from the line onto the card: it stays. Move away: it closes 0.3 s later, and the video plays again.
5. Hover the same line again: the card shows instantly, marked "From your Study Log".
6. **Regenerate** streams a new explanation.
7. In the follow-up box, turn on the Korean IME and type a question. Space doesn't pause the video, and the Enter that finishes a syllable doesn't send. A second Enter sends, and the answer streams under the question.
8. Settings → Pause on hover off: hovering no longer pauses, and the card still appears.

*Shortcuts*

9. **E** explains the current line; **E** again or **Escape** closes it, and Escape doesn't leave fullscreen. Clicking outside also closes it.
10. **A** / **D** jump to the previous / next line. **R** replays the current line from its start. Holding **D** walks forward line by line.
11. Settings → Rewind → **One line**, Forward → **One line**: ← / → now jump by line. Switch back to Seconds: ← / → jump 5 s.
12. **C** hides subtitles: hovering does nothing, but **E** still explains the current line.

*Netflix situations*

13. Fullscreen (F): hovering and the card work, and the card stays inside the screen.
14. A small, non-fullscreen window: the card fits inside the player and scrolls if long.
15. Change the subtitle language mid-episode, then explain a line. The context matches the new language's lines.
16. Play the next episode without reloading. Explaining a line there files it under the new episode.
17. A movie: explain a line. The Study Log shows it under **Movies**.
18. Settings → Claude API key → **Remove**, then explain a new line. The card says "Add your Claude API key" with **Open Settings**.

*Study Log*

19. Popup → **Study Log** opens the tab. The tree shows Series → Season → Episode with counts, and lines are listed in time order with timestamps.
20. **Open at this moment** opens the episode on Netflix and jumps to the line, not to Netflix's resume point.
21. Delete a line, then an episode, then a season. Each asks first, and **Cancel** keeps it. **Reset all** asks first, then empties the log.

- [ ] **Step 3: Record what live Netflix confirmed**

In `docs/netflix-internals.md`, update the "Verified on" line, and mark rows 3, 8 and 9 ✅ or ❌ with what the checklist showed. Items 3–7 and 15 exercise rows 3, 8 and 9.

Add this row:

| 11 | Overlay mount | A shadow host appended to `div.watch-video[data-uia="watch-video"]` shows a `position: fixed` card in and out of fullscreen | (from items 13–14) | ✅/❌ | `src/entrypoints/netflix.content/overlay/mount.tsx` |

- [ ] **Step 4: Update `README.md`**

Replace the first paragraph (the three lines starting "Understand every line on Netflix.") with:

```markdown
Understand every line on Netflix. LingoFlix is a free, open-source Chrome extension for
studying languages with Netflix:

- **Explain any line.** Hover a subtitle (or press E) and Claude explains what it means in this
  scene, the key expressions, and how to use them, using the surrounding dialogue. Ask follow-up
  questions right in the card.
- **Study Log.** Every explanation is saved on your computer, organized by show, season, and episode.
  Jump back to any line with one click.
- **Line by line.** Jump to the previous or next line (A / D), replay the current one (R), or make
  ← / → move by line instead of seconds.
- **Your keys.** Rewind/forward by the seconds you choose, hide subtitles with one key, and remap
  every shortcut.

LingoFlix uses your own Claude API key (you pay Anthropic directly for what you use). The key and
your Study Log stay on your computer; subtitle text is sent to Anthropic only when you ask for an
explanation.
```

- [ ] **Step 5: Commit**

```bash
git add docs/netflix-internals.md README.md
git commit -m "docs: record Plan 2 live checks; describe explanations, Study Log, and line jumps" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
