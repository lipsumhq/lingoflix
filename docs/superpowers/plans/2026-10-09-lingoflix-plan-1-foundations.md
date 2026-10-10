# LingoFlix Plan 1 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A loadable LingoFlix Chrome extension where, on Netflix, remappable shortcuts rewind/forward by a chosen number of seconds and toggle subtitles, configured from a popup and an options page that both show the donation links.

**Architecture:** WXT (MV3) extension. A MAIN-world content script (the *page bridge*) wraps Netflix's internal player API and answers requests sent as `CustomEvent`s on `document`. An isolated-world content script owns the keyboard (capture-phase listener at `document_start`), calls the bridge, and toggles a CSS rule that hides Netflix's subtitle layer. Settings live in `chrome.storage.sync` behind one normalizing module shared by the content script, popup, and options page.

**Tech Stack:** WXT 0.21.4, React 19.3.0, TypeScript 6.0.3, Tailwind CSS 4.3.3, Vite 8.3.4, Vitest 5.0.3 + happy-dom 20.14.6 + Testing Library, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-09-lingoflix-design.md` (this plan implements build-order steps 0–2 of §13; Plans 2 and 3 cover steps 3–7).

## Global Constraints

- Product name `LingoFlix`; manifest `name` is `LingoFlix — Understand every line on Netflix`, `short_name` is `LingoFlix`. All UI copy is English. The options page header says "Not affiliated with or endorsed by Netflix."
- License MIT; author `Jay Cho <jaycho1214@gmail.com>`.
- Chrome Manifest V3 via WXT. Pin exact dependency versions listed in Task 2.
- Never set `video.currentTime`. Seek only through Netflix's player API via the page bridge (spec §8.4).
- A shortcut binding is `{ code, ctrl, alt, shift, meta }` using `KeyboardEvent.code`; matching requires all four modifiers to be equal (spec §5.1).
- Default shortcuts: Rewind `ArrowLeft` 5 s, Forward `ArrowRight` 5 s, Toggle subtitles `KeyC`.
- Seek seconds are integers from 1 to 60.
- Shortcuts are ignored when focus is in an input, textarea, select, or contenteditable element (including inside shadow roots), when LingoFlix is disabled, or when the path is not `/watch/{id}`. A bound key is fully swallowed (Netflix sees neither keydown nor keyup); an unbound key passes through untouched.
- Netflix-default keys that trigger an override warning: `Space`, `Enter`, `KeyF`, `KeyM`, `KeyS`, `ArrowUp`, `ArrowDown`, `Escape`.
- Settings are stored in `chrome.storage.sync` under key `settings` and normalized with defaults on every read.
- Donation links: Buy Me a Coffee → `https://buymeacoffee.com/jaycho1214`, GitHub Sponsors → `https://github.com/sponsors/jaycho1214`. Copy: "LingoFlix is free. If it helps you learn, you can support it."
- Permissions in this plan: `storage` only. Content scripts match `https://www.netflix.com/*`.
- Visual identity: dark neutral UI with subtitle-yellow accent (Tailwind `yellow-400`). Do not use Netflix red.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Korean/Japanese IME active while pressing a shortcut** (keydown reports `key: "Process"`) → the shortcut still fires, because matching uses `code`. Test: Task 5, "fires with an IME active".
2. **Browser/OS combos on bound keys** (e.g. `⌘←`, `Ctrl+C`) → not intercepted, because modifiers must match exactly. Tests: Task 2, "requires exact modifiers"; Task 5, "lets modified combos through".
3. **Holding a key down** (auto-repeat) → seek repeats; the subtitle toggle does not flicker. Test: Task 5, "auto-repeat".
4. **Seeking near the start or end** → clamps to 0, and never closer than 1 s to the end (so Netflix doesn't jump to the next episode). Tests: Task 4, "clamps seeks near the start and the end" and "clamps seeks to [0, duration - END_GUARD_MS]".
5. **Navigating browse → watch or episode → episode without reload** → shortcuts start working on the watch page, and the bridge talks to the new player session. Tests: Task 4, "re-resolves the player on every call"; Task 5, "re-checks the watch page on every key".

---

## File Structure

```
lingoflix/
  package.json, wxt.config.ts, tsconfig.json, vitest.config.ts, .gitignore, LICENSE, README.md
  scripts/netflix-probe.js                    # Task 1: re-runnable Netflix internals probe
  docs/netflix-internals.md                   # Task 1: verified Netflix facts
  src/
    assets/tailwind.css                       # Tailwind entry
    lib/
      config.ts                               # donation links + copy
      shortcuts.ts                            # binding types, defaults, matching, conflicts, labels
      settings.ts                             # Settings type, defaults, normalize, load/save/update/watch
      netflix/selectors.ts                    # Netflix DOM selectors
      netflix/video-id.ts                     # /watch/{id} parsing
      bridge/protocol.ts                      # event names, message types, BridgeError, encode/decode
      bridge/player.ts                        # Netflix player adapter (MAIN world)
      bridge/server.ts                        # answers bridge requests (MAIN world)
      bridge/client.ts                        # sends bridge requests (isolated world)
    hooks/useSettings.ts                      # React hook over settings
    components/Toggle.tsx                     # accessible switch
    components/DonationLinks.tsx              # donation section
    entrypoints/
      netflix-bridge.content.ts               # MAIN world, document_start
      netflix.content/index.ts                # isolated world, document_start: wiring
      netflix.content/keyboard.ts             # keydown/keyup handlers
      netflix.content/subtitle-visibility.ts  # hide/show subtitle layer
      netflix.content/notice.ts               # small toast in a shadow root
      popup/{index.html,main.tsx,App.tsx}
      options/{index.html,main.tsx,App.tsx,SettingsTab.tsx,ShortcutRecorder.tsx,SecondsInput.tsx}
  tests/unit/*.test.ts(x)
```

---

### Task 1: Verify Netflix internals

This task needs a logged-in Netflix session in Chrome. Ask your human partner to run the probe, or, with their explicit permission, run it yourself through the browser tools on a tab they open. Do not start Task 4 until this task's doc exists.

**Files:**
- Create: `scripts/netflix-probe.js`
- Create: `docs/netflix-internals.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/netflix-internals.md`, which Tasks 4 and 5 read. If an observed value differs from the "LingoFlix assumes" column, Tasks 4 and 5 use the observed value instead of the value written in this plan (the affected constants are `SUBTITLE_LAYER_SELECTOR` in `src/lib/netflix/selectors.ts` and the API path and method names in `src/lib/bridge/player.ts`).

- [ ] **Step 1: Commit the spec and this plan**

```bash
git add docs/superpowers/specs/2026-10-09-lingoflix-design.md docs/superpowers/plans/2026-10-09-lingoflix-plan-1-foundations.md
git commit -m "docs: add LingoFlix design spec and plan 1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Write the probe script**

Create `scripts/netflix-probe.js`:

```js
// LingoFlix — Netflix internals probe.
// Paste into the DevTools console on a playing https://www.netflix.com/watch/<id> page
// (subtitles ON, a line visible). Run once normally and once while fullscreen (press F first).
// Prints a JSON report and returns it.
(() => {
  const report = { url: location.href, at: new Date().toISOString(), userAgent: navigator.userAgent };
  const q = (s) => document.querySelector(s);
  const describe = (el) =>
    el && { tag: el.tagName, id: el.id || null, className: String(el.className || '') || null };
  const shallow = (o) =>
    o &&
    Object.fromEntries(
      Object.entries(o).filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v)),
    );
  const methodsOf = (obj) => {
    const names = new Set();
    for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const k of Object.getOwnPropertyNames(o)) {
        if (k === 'constructor') continue;
        try {
          if (typeof obj[k] === 'function') names.add(k);
        } catch {}
      }
    }
    return [...names].sort();
  };

  // 1. Subtitle layer
  const layer = q('.player-timedtext');
  report.subtitles = {
    playerTimedtext: describe(layer),
    textContainer: describe(q('.player-timedtext-text-container')),
    currentText: layer ? layer.innerText : null,
    outerHTMLSample: layer ? layer.outerHTML.slice(0, 800) : null,
  };

  // 2. Player API
  try {
    const vp = netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const ids = vp.getAllPlayerSessionIds();
    const id = ids.find((s) => s.startsWith('watch')) ?? ids[0];
    const p = vp.getVideoPlayerBySessionId(id);
    const video = q('video');
    report.player = {
      sessionIds: ids,
      chosenSessionId: id,
      methods: methodsOf(p),
      getCurrentTime: p.getCurrentTime(),
      videoElementCurrentTimeSeconds: video ? video.currentTime : null,
      getDuration: p.getDuration(),
      videoElementDurationSeconds: video ? video.duration : null,
      isPaused: p.isPaused(),
      movieId: typeof p.getMovieId === 'function' ? p.getMovieId() : null,
      timedTextTrack: typeof p.getTimedTextTrack === 'function' ? shallow(p.getTimedTextTrack()) : null,
      timedTextTrackList:
        typeof p.getTimedTextTrackList === 'function' ? (p.getTimedTextTrackList() || []).map(shallow) : null,
    };
  } catch (e) {
    report.player = { error: String(e) };
  }

  // 4. Title metadata
  try {
    const state = netflix.appContext.state.playerApp.getState();
    const vm = state.videoPlayer && state.videoPlayer.videoMetadata;
    const movieId = (location.pathname.match(/\/watch\/(\d+)/) || [])[1];
    const entry = vm && movieId && vm[movieId];
    const video = entry && ((entry._metadata && entry._metadata.video) || null);
    report.metadata = {
      videoMetadataKeys: vm ? Object.keys(vm) : null,
      entryKeys: entry ? Object.keys(entry) : null,
      video: video
        ? {
            ...shallow(video),
            seasons: Array.isArray(video.seasons)
              ? video.seasons.map((s) => ({
                  ...shallow(s),
                  episodes: (s.episodes || []).slice(0, 3).map(shallow),
                }))
              : null,
          }
        : null,
    };
  } catch (e) {
    report.metadata = { error: String(e) };
  }
  const titleEl = q('[data-uia="video-title"]');
  report.titleDom = { videoTitle: titleEl ? titleEl.innerText : null, documentTitle: document.title };

  // 6. Fullscreen
  const fs = document.fullscreenElement;
  report.fullscreen = fs
    ? { element: describe(fs), containsSubtitles: !!(layer && fs.contains(layer)) }
    : 'not fullscreen — press F and run again';

  console.log(JSON.stringify(report, null, 2));
  return report;
})();
```

- [ ] **Step 3: Run the probe on a series episode**

In Chrome: open any series episode at `https://www.netflix.com/watch/<id>`, turn subtitles on, let a subtitle line appear, pause. Open DevTools → Console, paste the whole script, press Enter. Copy the JSON. Press `F` (fullscreen), run it again, copy the `fullscreen` part.

Expected: `subtitles.playerTimedtext` is non-null and `currentText` matches the visible line; `player.methods` includes `seek`, `play`, `pause`, `getCurrentTime`, `getDuration`, `isPaused`; `player.getCurrentTime` ≈ `videoElementCurrentTimeSeconds × 1000` (confirms milliseconds).

- [ ] **Step 4: Check the `?t=` deep link**

Note the episode ID from the URL. Visit `https://www.netflix.com/watch/<id>?t=120`.
Expected: playback starts at about 2:00. Record what actually happens.

- [ ] **Step 5: Write `docs/netflix-internals.md`**

Fill the "Observed" and "OK?" columns from Steps 3–4. Items 3 and 5 are verified later (Plan 2 and Task 5); leave their Observed cell as written below.

````markdown
# Netflix internals (verified)

LingoFlix depends on Netflix internals that can change without notice. Re-run
`scripts/netflix-probe.js` (instructions at the top of the file) and update this
table whenever something stops working.

Verified on: 2026-10-__ · Chrome <version from userAgent> · <series title> S<season>E<episode> (`/watch/<id>`)

| # | Item | LingoFlix assumes | Observed | OK? | Code that depends on it |
|---|------|-------------------|----------|-----|-------------------------|
| 1 | Subtitle layer | `.player-timedtext` contains the visible subtitle text | | | `src/lib/netflix/selectors.ts` |
| 2 | Player API | `netflix.appContext.state.playerApp.getAPI().videoPlayer` → `getAllPlayerSessionIds()` (pick the id starting with `watch`) → `getVideoPlayerBySessionId(id)` with `seek(ms)`, `play()`, `pause()`, `getCurrentTime()` (ms), `getDuration()` (ms), `isPaused()` | | | `src/lib/bridge/player.ts` |
| 3 | Text track download URLs | Verified in Plan 2 (needs the extension's `document_start` hook) | Plan 2 | — | Plan 2 |
| 4 | Title metadata | `playerApp.getState().videoPlayer.videoMetadata[videoId]._metadata.video` has series title, type, seasons → episodes | | | Plan 2 |
| 5 | Key preemption | A capture-phase `window` keydown listener registered at `document_start` runs before Netflix's handlers | Plan 1 Task 5 | — | `src/entrypoints/netflix.content/keyboard.ts` |
| 6 | Fullscreen element | Some element that contains `.player-timedtext` | | | Plan 2 overlay mount |
| 7 | `?t=` deep link | `/watch/{id}?t={seconds}` starts playback at that time | | | Plan 2 Study Log |

## Raw probe output

```json
<paste the Step 3 JSON here, then the fullscreen JSON>
```
````

Replace every `<...>` and `__` with real values before committing; the committed file must contain only observed facts.

- [ ] **Step 6: Commit**

```bash
git add scripts/netflix-probe.js docs/netflix-internals.md
git commit -m "docs: record verified Netflix internals and add probe script" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Scaffold the project and the shortcut engine

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `README.md`
- Create: `src/assets/tailwind.css`, `src/entrypoints/popup/index.html`, `src/entrypoints/popup/main.tsx`, `src/entrypoints/popup/App.tsx`
- Create: `src/lib/shortcuts.ts`
- Test: `tests/unit/shortcuts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/lib/shortcuts.ts`):
  - `type ActionId = 'rewind' | 'forward' | 'toggleSubtitles'`
  - `interface Binding { code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }`
  - `type ShortcutMap = Record<ActionId, Binding | null>`
  - `const ACTION_IDS: readonly ActionId[]`, `const ACTION_LABELS: Record<ActionId, string>`
  - `const DEFAULT_SHORTCUTS: ShortcutMap`, `const NETFLIX_DEFAULT_CODES: ReadonlySet<string>`
  - `function key(code: string, mods?: Partial<Omit<Binding, 'code'>>): Binding`
  - `type KeyLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>`
  - `function bindingFromEvent(e: KeyLike): Binding | null`
  - `function sameBinding(a: Binding, b: Binding): boolean`
  - `function matchAction(e: KeyLike, shortcuts: ShortcutMap): ActionId | null`
  - `function findConflict(shortcuts: ShortcutMap, binding: Binding, except: ActionId): ActionId | null`
  - `function overridesNetflix(binding: Binding): boolean`
  - `function formatBinding(binding: Binding | null, platform?: 'mac' | 'other'): string`

- [ ] **Step 1: Create the project config files**

`package.json`:

```json
{
  "name": "lingoflix",
  "version": "0.1.0",
  "description": "Understand every line on Netflix: custom shortcuts, subtitle toggle and AI explanations.",
  "private": true,
  "type": "module",
  "license": "MIT",
  "author": "Jay Cho <jaycho1214@gmail.com>",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@wxt-dev/module-react": "1.2.2",
    "happy-dom": "20.14.6",
    "tailwindcss": "4.3.3",
    "typescript": "6.0.3",
    "vite": "8.3.4",
    "vitest": "5.0.3",
    "wxt": "0.21.4"
  },
  "packageManager": "pnpm@11.20.0"
}
```

`wxt.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'LingoFlix — Understand every line on Netflix',
    short_name: 'LingoFlix',
    description:
      'Understand every line on Netflix: custom shortcuts, subtitle toggle and AI explanations. Not affiliated with Netflix.',
    permissions: ['storage'],
  },
});
```

`tsconfig.json`:

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "jsx": "react-jsx"
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
```

`.gitignore`:

```
node_modules
.output
.wxt
*.log
.DS_Store
web-ext.config.ts
```

`LICENSE`:

```
MIT License

Copyright (c) 2026 Jay Cho

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`README.md`:

````markdown
# LingoFlix

Understand every line on Netflix. LingoFlix is a free, open-source Chrome extension for
studying languages with Netflix: remappable rewind/forward shortcuts, a one-key subtitle
toggle, and (coming next) AI explanations of any subtitle line with your own Claude API key.

Not affiliated with or endorsed by Netflix.

## Development

```bash
pnpm install
pnpm test        # unit tests
pnpm compile     # type-check
pnpm build       # production build → .output/chrome-mv3
```

To try it on Netflix, load the build into your normal Chrome profile (WXT's dev browser
has no Netflix login or DRM): `chrome://extensions` → Developer mode → **Load unpacked** →
select `.output/chrome-mv3`. After rebuilding, press the reload icon on the extension card
and refresh the Netflix tab.

## Support

LingoFlix is free. If it helps you learn, you can support it:
[Buy Me a Coffee](https://buymeacoffee.com/jaycho1214) ·
[GitHub Sponsors](https://github.com/sponsors/jaycho1214)

## License

[MIT](./LICENSE)
````

- [ ] **Step 2: Create the minimal popup entrypoint (so WXT has an entrypoint to build)**

`src/assets/tailwind.css`:

```css
@import 'tailwindcss';
```

`src/entrypoints/popup/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LingoFlix</title>
  </head>
  <body class="bg-neutral-950">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/entrypoints/popup/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/assets/tailwind.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/entrypoints/popup/App.tsx`:

```tsx
import { browser } from '#imports';

export function App() {
  return (
    <main className="w-80 bg-neutral-950 p-4 text-neutral-100">
      <header className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold">LingoFlix</h1>
        <span className="text-xs text-neutral-500">v{browser.runtime.getManifest().version}</span>
      </header>
    </main>
  );
}
```

- [ ] **Step 3: Install dependencies**

Run: `pnpm install`
Expected: installs without errors and the `postinstall` step prints WXT's "Generated types" message, creating `.wxt/`. If pnpm reports ignored build scripts, run `pnpm approve-builds`, approve `esbuild`, and run `pnpm install` again.

- [ ] **Step 4: Write the failing shortcut tests**

`tests/unit/shortcuts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ACTION_IDS,
  DEFAULT_SHORTCUTS,
  bindingFromEvent,
  findConflict,
  formatBinding,
  key,
  matchAction,
  overridesNetflix,
} from '@/lib/shortcuts';

const ev = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe('defaults', () => {
  it('binds rewind ←, forward →, toggle subtitles C', () => {
    expect(DEFAULT_SHORTCUTS).toEqual({
      rewind: key('ArrowLeft'),
      forward: key('ArrowRight'),
      toggleSubtitles: key('KeyC'),
    });
    expect(ACTION_IDS).toEqual(['rewind', 'forward', 'toggleSubtitles']);
  });
});

describe('bindingFromEvent', () => {
  it('captures code and all modifiers', () => {
    expect(bindingFromEvent(ev('KeyJ', { shift: true, meta: true }))).toEqual({
      code: 'KeyJ',
      ctrl: false,
      alt: false,
      shift: true,
      meta: true,
    });
  });

  it('returns null for modifier-only keys and empty codes', () => {
    for (const code of ['ShiftLeft', 'ControlRight', 'AltLeft', 'MetaRight', 'CapsLock', '']) {
      expect(bindingFromEvent(ev(code))).toBeNull();
    }
  });
});

describe('matchAction', () => {
  it('matches the bound action', () => {
    expect(matchAction(ev('ArrowLeft'), DEFAULT_SHORTCUTS)).toBe('rewind');
    expect(matchAction(ev('KeyC'), DEFAULT_SHORTCUTS)).toBe('toggleSubtitles');
  });

  it('requires exact modifiers', () => {
    expect(matchAction(ev('ArrowLeft', { meta: true }), DEFAULT_SHORTCUTS)).toBeNull();
    expect(matchAction(ev('KeyC', { ctrl: true }), DEFAULT_SHORTCUTS)).toBeNull();
    const shifted = { ...DEFAULT_SHORTCUTS, rewind: key('KeyJ', { shift: true }) };
    expect(matchAction(ev('KeyJ'), shifted)).toBeNull();
    expect(matchAction(ev('KeyJ', { shift: true }), shifted)).toBe('rewind');
  });

  it('skips unbound actions', () => {
    expect(matchAction(ev('KeyC'), { ...DEFAULT_SHORTCUTS, toggleSubtitles: null })).toBeNull();
  });
});

describe('findConflict', () => {
  it('reports the other action using the same binding', () => {
    expect(findConflict(DEFAULT_SHORTCUTS, key('ArrowRight'), 'rewind')).toBe('forward');
  });

  it('ignores the action being edited and unbound actions', () => {
    expect(findConflict(DEFAULT_SHORTCUTS, key('ArrowLeft'), 'rewind')).toBeNull();
    expect(findConflict({ ...DEFAULT_SHORTCUTS, forward: null }, key('ArrowRight'), 'rewind')).toBeNull();
  });
});

describe('overridesNetflix', () => {
  it('flags unmodified Netflix default keys', () => {
    for (const code of ['Space', 'Enter', 'KeyF', 'KeyM', 'KeyS', 'ArrowUp', 'ArrowDown', 'Escape']) {
      expect(overridesNetflix(key(code))).toBe(true);
    }
  });

  it('does not flag other keys, the default seek arrows, or modified combos', () => {
    expect(overridesNetflix(key('KeyJ'))).toBe(false);
    expect(overridesNetflix(key('ArrowLeft'))).toBe(false);
    expect(overridesNetflix(key('KeyF', { ctrl: true }))).toBe(false);
  });
});

describe('formatBinding', () => {
  it('formats keys readably', () => {
    expect(formatBinding(key('ArrowLeft'))).toBe('←');
    expect(formatBinding(key('KeyC'))).toBe('C');
    expect(formatBinding(key('Digit5'))).toBe('5');
    expect(formatBinding(key('Space'))).toBe('Space');
    expect(formatBinding(key('KeyJ', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+J');
    expect(formatBinding(key('KeyJ', { meta: true, shift: true }), 'mac')).toBe('⇧⌘J');
    expect(formatBinding(null)).toBe('Not set');
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm test tests/unit/shortcuts.test.ts`
Expected: FAIL — cannot resolve `@/lib/shortcuts`.

- [ ] **Step 6: Implement `src/lib/shortcuts.ts`**

```ts
export type ActionId = 'rewind' | 'forward' | 'toggleSubtitles';

export interface Binding {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type ShortcutMap = Record<ActionId, Binding | null>;

export const ACTION_IDS: readonly ActionId[] = ['rewind', 'forward', 'toggleSubtitles'];

export const ACTION_LABELS: Record<ActionId, string> = {
  rewind: 'Rewind',
  forward: 'Forward',
  toggleSubtitles: 'Toggle subtitles',
};

export function key(code: string, mods: Partial<Omit<Binding, 'code'>> = {}): Binding {
  return { code, ctrl: false, alt: false, shift: false, meta: false, ...mods };
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  rewind: key('ArrowLeft'),
  forward: key('ArrowRight'),
  toggleSubtitles: key('KeyC'),
};

/** Unmodified keys Netflix's player uses; binding one of them overrides Netflix (warn, don't block). */
export const NETFLIX_DEFAULT_CODES: ReadonlySet<string> = new Set([
  'Space',
  'Enter',
  'KeyF',
  'KeyM',
  'KeyS',
  'ArrowUp',
  'ArrowDown',
  'Escape',
]);

const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'Fn',
  'FnLock',
]);

export type KeyLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

export function bindingFromEvent(e: KeyLike): Binding | null {
  if (!e.code || MODIFIER_CODES.has(e.code)) return null;
  return { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
}

export function sameBinding(a: Binding, b: Binding): boolean {
  return a.code === b.code && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta;
}

export function matchAction(e: KeyLike, shortcuts: ShortcutMap): ActionId | null {
  const pressed = bindingFromEvent(e);
  if (!pressed) return null;
  for (const id of ACTION_IDS) {
    const bound = shortcuts[id];
    if (bound && sameBinding(bound, pressed)) return id;
  }
  return null;
}

export function findConflict(shortcuts: ShortcutMap, binding: Binding, except: ActionId): ActionId | null {
  for (const id of ACTION_IDS) {
    if (id === except) continue;
    const bound = shortcuts[id];
    if (bound && sameBinding(bound, binding)) return id;
  }
  return null;
}

export function overridesNetflix(binding: Binding): boolean {
  return !binding.ctrl && !binding.alt && !binding.meta && NETFLIX_DEFAULT_CODES.has(binding.code);
}

const CODE_LABELS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

function codeLabel(code: string): string {
  const label = CODE_LABELS[code];
  if (label) return label;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function formatBinding(binding: Binding | null, platform: 'mac' | 'other' = 'other'): string {
  if (!binding) return 'Not set';
  const mac = platform === 'mac';
  const parts: string[] = [];
  if (binding.ctrl) parts.push(mac ? '⌃' : 'Ctrl');
  if (binding.alt) parts.push(mac ? '⌥' : 'Alt');
  if (binding.shift) parts.push(mac ? '⇧' : 'Shift');
  if (binding.meta) parts.push(mac ? '⌘' : 'Win');
  parts.push(codeLabel(binding.code));
  return parts.join(mac ? '' : '+');
}
```

- [ ] **Step 7: Run tests, type-check, and build**

Run: `pnpm test tests/unit/shortcuts.test.ts`
Expected: PASS (all tests).

Run: `pnpm compile`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds and `.output/chrome-mv3/manifest.json` exists with `"short_name": "LingoFlix"` and `"permissions": ["storage"]`.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml wxt.config.ts tsconfig.json vitest.config.ts .gitignore LICENSE README.md src tests
git commit -m "feat: scaffold WXT project and shortcut engine" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If `pnpm approve-builds` created `pnpm-workspace.yaml`, add it to the same commit.

---

### Task 3: Settings module

**Files:**
- Create: `src/lib/settings.ts`
- Test: `tests/unit/settings.test.ts`

**Interfaces:**
- Consumes (Task 2): `ACTION_IDS`, `DEFAULT_SHORTCUTS`, `sameBinding`, `ActionId`, `Binding`, `ShortcutMap` from `@/lib/shortcuts`.
- Produces (`src/lib/settings.ts`):
  - `interface Settings { enabled: boolean; shortcuts: ShortcutMap; rewindSeconds: number; forwardSeconds: number; subtitlesHidden: boolean }`
  - `const DEFAULT_SETTINGS: Settings`, `const SEEK_SECONDS_MIN = 1`, `const SEEK_SECONDS_MAX = 60`
  - `function clampSeekSeconds(value: unknown, fallback: number): number`
  - `function normalizeSettings(raw: unknown): Settings`
  - `function loadSettings(): Promise<Settings>`
  - `function saveSettings(settings: Settings): Promise<void>`
  - `function updateSettings(update: (current: Settings) => Settings): Promise<Settings>`
  - `function watchSettings(callback: (settings: Settings) => void): () => void`

- [ ] **Step 1: Write the failing tests**

`tests/unit/settings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { key } from '@/lib/shortcuts';
import {
  DEFAULT_SETTINGS,
  clampSeekSeconds,
  loadSettings,
  normalizeSettings,
  saveSettings,
  updateSettings,
  watchSettings,
  type Settings,
} from '@/lib/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('clampSeekSeconds', () => {
  it('rounds and clamps to 1–60, falling back on non-numbers', () => {
    expect(clampSeekSeconds(5, 10)).toBe(5);
    expect(clampSeekSeconds(0, 10)).toBe(1);
    expect(clampSeekSeconds(-3, 10)).toBe(1);
    expect(clampSeekSeconds(100, 10)).toBe(60);
    expect(clampSeekSeconds(2.6, 10)).toBe(3);
    expect(clampSeekSeconds('7', 10)).toBe(10);
    expect(clampSeekSeconds(Number.NaN, 10)).toBe(10);
    expect(clampSeekSeconds(undefined, 10)).toBe(10);
  });
});

describe('normalizeSettings', () => {
  it('returns defaults for missing or garbage input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and fixes invalid ones field by field', () => {
    const s = normalizeSettings({
      enabled: false,
      rewindSeconds: 0,
      forwardSeconds: 15,
      subtitlesHidden: 'yes',
      shortcuts: { rewind: key('KeyJ'), forward: { code: 42 }, toggleSubtitles: null },
    });
    expect(s.enabled).toBe(false);
    expect(s.rewindSeconds).toBe(1);
    expect(s.forwardSeconds).toBe(15);
    expect(s.subtitlesHidden).toBe(false);
    expect(s.shortcuts.rewind).toEqual(key('KeyJ'));
    expect(s.shortcuts.forward).toEqual(key('ArrowRight')); // invalid → default
    expect(s.shortcuts.toggleSubtitles).toBeNull(); // explicitly unbound stays unbound
  });

  it('leaves a missing action unbound when its default is already taken', () => {
    const s = normalizeSettings({ shortcuts: { rewind: key('KeyC'), forward: key('ArrowRight') } });
    expect(s.shortcuts.rewind).toEqual(key('KeyC'));
    expect(s.shortcuts.toggleSubtitles).toBeNull();
  });

  it('drops unknown fields', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, extra: 1 });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
});

describe('storage', () => {
  it('loads defaults when nothing is stored', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips saved settings through chrome.storage.sync', async () => {
    const custom: Settings = { ...DEFAULT_SETTINGS, rewindSeconds: 3, subtitlesHidden: true };
    await saveSettings(custom);
    expect(await loadSettings()).toEqual(custom);
    expect(await fakeBrowser.storage.sync.get('settings')).toEqual({ settings: custom });
  });

  it('updateSettings applies a change and returns the normalized result', async () => {
    const next = await updateSettings((s) => ({ ...s, subtitlesHidden: !s.subtitlesHidden, forwardSeconds: 99 }));
    expect(next.subtitlesHidden).toBe(true);
    expect(next.forwardSeconds).toBe(60);
    expect(await loadSettings()).toEqual(next);
  });

  it('watchSettings reports normalized changes', async () => {
    const seen: Settings[] = [];
    const unwatch = watchSettings((s) => seen.push(s));
    await updateSettings((s) => ({ ...s, enabled: false }));
    await vi.waitFor(() => expect(seen.at(-1)?.enabled).toBe(false));
    unwatch();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/unit/settings.test.ts`
Expected: FAIL — cannot resolve `@/lib/settings`.

- [ ] **Step 3: Implement `src/lib/settings.ts`**

```ts
import { storage } from '#imports';
import { ACTION_IDS, DEFAULT_SHORTCUTS, sameBinding, type ActionId, type Binding, type ShortcutMap } from './shortcuts';

export interface Settings {
  enabled: boolean;
  shortcuts: ShortcutMap;
  rewindSeconds: number;
  forwardSeconds: number;
  subtitlesHidden: boolean;
}

export const SEEK_SECONDS_MIN = 1;
export const SEEK_SECONDS_MAX = 60;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  shortcuts: DEFAULT_SHORTCUTS,
  rewindSeconds: 5,
  forwardSeconds: 5,
  subtitlesHidden: false,
};

const SETTINGS_KEY = 'sync:settings';

export function clampSeekSeconds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(SEEK_SECONDS_MAX, Math.max(SEEK_SECONDS_MIN, Math.round(value)));
}

function isBinding(value: unknown): value is Binding {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.code === 'string' &&
    b.code.length > 0 &&
    typeof b.ctrl === 'boolean' &&
    typeof b.alt === 'boolean' &&
    typeof b.shift === 'boolean' &&
    typeof b.meta === 'boolean'
  );
}

function normalizeShortcuts(raw: unknown): ShortcutMap {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
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

export function normalizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SETTINGS.enabled,
    shortcuts: normalizeShortcuts(r.shortcuts),
    rewindSeconds: clampSeekSeconds(r.rewindSeconds, DEFAULT_SETTINGS.rewindSeconds),
    forwardSeconds: clampSeekSeconds(r.forwardSeconds, DEFAULT_SETTINGS.forwardSeconds),
    subtitlesHidden: typeof r.subtitlesHidden === 'boolean' ? r.subtitlesHidden : DEFAULT_SETTINGS.subtitlesHidden,
  };
}

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await storage.getItem(SETTINGS_KEY));
}

export async function saveSettings(settings: Settings): Promise<void> {
  await storage.setItem(SETTINGS_KEY, normalizeSettings(settings));
}

export async function updateSettings(update: (current: Settings) => Settings): Promise<Settings> {
  const next = normalizeSettings(update(await loadSettings()));
  await storage.setItem(SETTINGS_KEY, next);
  return next;
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return storage.watch(SETTINGS_KEY, (value) => callback(normalizeSettings(value)));
}
```

- [ ] **Step 4: Run tests and type-check**

Run: `pnpm test tests/unit/settings.test.ts`
Expected: PASS.

Run: `pnpm compile`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts tests/unit/settings.test.ts
git commit -m "feat: add settings module with defaults and normalization" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Page bridge (Netflix player access)

Read `docs/netflix-internals.md` first. If row 2 (Player API) observed a different path or method names, use the observed ones in `findPlayer` and `NetflixPlayer` below.

**Files:**
- Create: `src/lib/netflix/video-id.ts`, `src/lib/netflix/selectors.ts`
- Create: `src/lib/bridge/protocol.ts`, `src/lib/bridge/player.ts`, `src/lib/bridge/server.ts`, `src/lib/bridge/client.ts`
- Create: `src/entrypoints/netflix-bridge.content.ts`
- Test: `tests/unit/video-id.test.ts`, `tests/unit/bridge.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `src/lib/netflix/video-id.ts`: `parseWatchVideoId(pathname: string): string | null`, `isWatchPath(pathname: string): boolean`
  - `src/lib/netflix/selectors.ts`: `SUBTITLE_LAYER_SELECTOR: string`
  - `src/lib/bridge/protocol.ts`: `BRIDGE_REQUEST_EVENT`, `BRIDGE_RESPONSE_EVENT`, `interface PlayerState { currentTimeMs: number; durationMs: number; paused: boolean; videoId: string | null }`, `interface BridgeMethods { seekBy(deltaMs: number): void; seek(timeMs: number): void; play(): void; pause(): void; getState(): PlayerState }`, `type BridgeMethod = keyof BridgeMethods`, `type BridgeErrorCode = 'player-unavailable' | 'timeout' | 'bad-request' | 'internal'`, `class BridgeError extends Error { code: BridgeErrorCode }`, `encode(value: unknown): string`, `decode<T>(detail: unknown): T | null`
  - `src/lib/bridge/player.ts`: `interface NetflixPlayer`, `findPlayer(netflix: unknown): NetflixPlayer`, `END_GUARD_MS = 1000`, `clampTime(timeMs: number, durationMs: number): number`, `createPlayerMethods(getPlayer: () => NetflixPlayer, getVideoId: () => string | null): BridgeMethods`
  - `src/lib/bridge/server.ts`: `serveBridge(target: EventTarget, methods: BridgeMethods): () => void`
  - `src/lib/bridge/client.ts`: `interface BridgeClient { call<M extends BridgeMethod>(method: M, ...args: Parameters<BridgeMethods[M]>): Promise<ReturnType<BridgeMethods[M]>>; dispose(): void }`, `createBridgeClient(target: EventTarget, timeoutMs?: number): BridgeClient`

- [ ] **Step 1: Write the failing tests**

`tests/unit/video-id.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isWatchPath, parseWatchVideoId } from '@/lib/netflix/video-id';

describe('watch path parsing', () => {
  it('extracts the numeric video id from /watch/{id}', () => {
    expect(parseWatchVideoId('/watch/81091396')).toBe('81091396');
    expect(parseWatchVideoId('/watch/81091396/')).toBe('81091396');
    expect(isWatchPath('/watch/81091396')).toBe(true);
  });

  it('rejects non-watch pages', () => {
    for (const path of ['/browse', '/title/80057281', '/watch/', '/watch/abc', '/']) {
      expect(parseWatchVideoId(path)).toBeNull();
      expect(isWatchPath(path)).toBe(false);
    }
  });
});
```

`tests/unit/bridge.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createBridgeClient, type BridgeClient } from '@/lib/bridge/client';
import { END_GUARD_MS, clampTime, createPlayerMethods, findPlayer, type NetflixPlayer } from '@/lib/bridge/player';
import { BRIDGE_REQUEST_EVENT, BRIDGE_RESPONSE_EVENT, BridgeError, decode, encode } from '@/lib/bridge/protocol';
import { serveBridge } from '@/lib/bridge/server';

class FakePlayer implements NetflixPlayer {
  constructor(
    public time = 60_000,
    public duration = 1_200_000,
    public paused = false,
  ) {}
  seek(t: number) {
    this.time = t;
  }
  play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  getCurrentTime() {
    return this.time;
  }
  getDuration() {
    return this.duration;
  }
  isPaused() {
    return this.paused;
  }
}

function fakeNetflix(players: Record<string, NetflixPlayer>) {
  return {
    appContext: {
      state: {
        playerApp: {
          getAPI: () => ({
            videoPlayer: {
              getAllPlayerSessionIds: () => Object.keys(players),
              getVideoPlayerBySessionId: (id: string) => players[id],
            },
          }),
        },
      },
    },
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function connect(netflixRef: { current: unknown }, videoId: string | null = '81091396'): BridgeClient {
  const target = new EventTarget();
  const stop = serveBridge(
    target,
    createPlayerMethods(
      () => findPlayer(netflixRef.current),
      () => videoId,
    ),
  );
  const client = createBridgeClient(target, 50);
  cleanups.push(stop, () => client.dispose());
  return client;
}

describe('protocol encoding', () => {
  it('round-trips through a JSON string and rejects junk', () => {
    expect(decode(encode({ a: 1 }))).toEqual({ a: 1 });
    expect(decode('{not json')).toBeNull();
    expect(decode({ a: 1 })).toBeNull();
  });
});

describe('findPlayer', () => {
  it('prefers the session whose id starts with "watch"', () => {
    const preview = new FakePlayer(1);
    const main = new FakePlayer(2);
    expect(findPlayer(fakeNetflix({ 'motion-billboard-1': preview, 'watch-abc': main }))).toBe(main);
  });

  it('throws player-unavailable when Netflix internals are missing', () => {
    for (const netflix of [undefined, {}, { appContext: { state: {} } }, fakeNetflix({})]) {
      expect(() => findPlayer(netflix)).toThrowError(BridgeError);
      try {
        findPlayer(netflix);
      } catch (e) {
        expect((e as BridgeError).code).toBe('player-unavailable');
      }
    }
  });

  it('throws player-unavailable when getAPI itself throws', () => {
    const broken = { appContext: { state: { playerApp: { getAPI: () => { throw new Error('boom'); } } } } };
    expect(() => findPlayer(broken)).toThrowError(/player/i);
  });
});

describe('clampTime', () => {
  it('clamps seeks to [0, duration - END_GUARD_MS]', () => {
    expect(clampTime(-5_000, 100_000)).toBe(0);
    expect(clampTime(50_000.4, 100_000)).toBe(50_000);
    expect(clampTime(200_000, 100_000)).toBe(100_000 - END_GUARD_MS);
    expect(clampTime(500, 800)).toBe(0); // duration shorter than the guard
  });
});

describe('bridge round trip', () => {
  it('returns player state', async () => {
    const player = new FakePlayer(90_000, 1_000_000, true);
    const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
    expect(await client.call('getState')).toEqual({
      currentTimeMs: 90_000,
      durationMs: 1_000_000,
      paused: true,
      videoId: '81091396',
    });
  });

  it('seekBy moves relative to the current time', async () => {
    const player = new FakePlayer(60_000);
    const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
    await client.call('seekBy', -5_000);
    expect(player.time).toBe(55_000);
    await client.call('seekBy', 10_000);
    expect(player.time).toBe(65_000);
  });

  it('clamps seeks near the start and the end', async () => {
    const player = new FakePlayer(2_000, 100_000);
    const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
    await client.call('seekBy', -5_000);
    expect(player.time).toBe(0);
    await client.call('seek', 99_900);
    expect(player.time).toBe(100_000 - END_GUARD_MS);
  });

  it('play and pause reach the player', async () => {
    const player = new FakePlayer(0, 100_000, false);
    const client = connect({ current: fakeNetflix({ 'watch-1': player }) });
    await client.call('pause');
    expect(player.paused).toBe(true);
    await client.call('play');
    expect(player.paused).toBe(false);
  });

  it('re-resolves the player on every call (episode change without reload)', async () => {
    const first = new FakePlayer(10_000);
    const second = new FakePlayer(20_000);
    const ref: { current: unknown } = { current: fakeNetflix({ 'watch-1': first }) };
    const client = connect(ref);
    expect((await client.call('getState')).currentTimeMs).toBe(10_000);
    ref.current = fakeNetflix({ 'watch-2': second });
    expect((await client.call('getState')).currentTimeMs).toBe(20_000);
  });

  it('rejects with player-unavailable when Netflix has no player', async () => {
    const client = connect({ current: undefined });
    await expect(client.call('seekBy', 1000)).rejects.toMatchObject({ code: 'player-unavailable' });
  });

  it('rejects with timeout when no bridge answers', async () => {
    const client = createBridgeClient(new EventTarget(), 20);
    cleanups.push(() => client.dispose());
    await expect(client.call('getState')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('answers unknown or inherited method names with bad-request', async () => {
    const target = new EventTarget();
    cleanups.push(serveBridge(target, createPlayerMethods(() => new FakePlayer(), () => null)));
    const responses: unknown[] = [];
    target.addEventListener(BRIDGE_RESPONSE_EVENT, (e) => responses.push(decode((e as CustomEvent).detail)));
    for (const method of ['explode', 'toString']) {
      target.dispatchEvent(
        new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: encode({ id: method, method, args: [] }) }),
      );
    }
    expect(responses).toEqual([
      { id: 'explode', ok: false, code: 'bad-request', message: 'Unknown method explode' },
      { id: 'toString', ok: false, code: 'bad-request', message: 'Unknown method toString' },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/unit/video-id.test.ts tests/unit/bridge.test.ts`
Expected: FAIL — cannot resolve `@/lib/netflix/video-id` and `@/lib/bridge/...`.

- [ ] **Step 3: Implement the Netflix helpers**

`src/lib/netflix/video-id.ts`:

```ts
const WATCH_PATH = /^\/watch\/(\d+)(?:\/|$)/;

export function parseWatchVideoId(pathname: string): string | null {
  return WATCH_PATH.exec(pathname)?.[1] ?? null;
}

export function isWatchPath(pathname: string): boolean {
  return WATCH_PATH.test(pathname);
}
```

`src/lib/netflix/selectors.ts` (use the observed selector from `docs/netflix-internals.md` row 1):

```ts
/** Netflix's subtitle layer. Verified in docs/netflix-internals.md (row 1). */
export const SUBTITLE_LAYER_SELECTOR = '.player-timedtext';
```

- [ ] **Step 4: Implement the protocol**

`src/lib/bridge/protocol.ts`:

```ts
export const BRIDGE_REQUEST_EVENT = 'lingoflix:bridge-request';
export const BRIDGE_RESPONSE_EVENT = 'lingoflix:bridge-response';

export interface PlayerState {
  currentTimeMs: number;
  durationMs: number;
  paused: boolean;
  videoId: string | null;
}

export interface BridgeMethods {
  seekBy(deltaMs: number): void;
  seek(timeMs: number): void;
  play(): void;
  pause(): void;
  getState(): PlayerState;
}

export type BridgeMethod = keyof BridgeMethods;

export type BridgeErrorCode = 'player-unavailable' | 'timeout' | 'bad-request' | 'internal';

export interface BridgeRequest {
  id: string;
  method: string;
  args: unknown[];
}

export type BridgeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; code: BridgeErrorCode; message: string };

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

/** Event details cross the isolated/main world boundary as JSON strings. */
export function encode(value: unknown): string {
  return JSON.stringify(value);
}

export function decode<T>(detail: unknown): T | null {
  if (typeof detail !== 'string') return null;
  try {
    return JSON.parse(detail) as T;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Implement the player adapter**

`src/lib/bridge/player.ts` (use the observed API path and method names from `docs/netflix-internals.md` row 2):

```ts
import { BridgeError, type BridgeMethods, type PlayerState } from './protocol';

/** The part of Netflix's internal player LingoFlix uses (docs/netflix-internals.md, row 2). Times are ms. */
export interface NetflixPlayer {
  seek(timeMs: number): void;
  play(): void;
  pause(): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
}

interface NetflixVideoPlayerApi {
  getAllPlayerSessionIds(): string[];
  getVideoPlayerBySessionId(id: string): NetflixPlayer | undefined;
}

interface NetflixGlobal {
  appContext?: { state?: { playerApp?: { getAPI?(): { videoPlayer?: NetflixVideoPlayerApi } | undefined } } };
}

export function findPlayer(netflix: unknown): NetflixPlayer {
  let api: NetflixVideoPlayerApi | undefined;
  try {
    api = (netflix as NetflixGlobal | undefined)?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  } catch {
    api = undefined;
  }
  if (!api) throw new BridgeError('player-unavailable', 'Netflix player API not found');
  const ids = api.getAllPlayerSessionIds();
  const id = ids.find((s) => s.startsWith('watch')) ?? ids[0];
  const player = id ? api.getVideoPlayerBySessionId(id) : undefined;
  if (!player) throw new BridgeError('player-unavailable', 'No active Netflix player session');
  return player;
}

/** Seeks stay this far from the end so Netflix doesn't roll over to the next episode. */
export const END_GUARD_MS = 1000;

export function clampTime(timeMs: number, durationMs: number): number {
  const max = Math.max(0, durationMs - END_GUARD_MS);
  return Math.min(max, Math.max(0, Math.round(timeMs)));
}

export function createPlayerMethods(getPlayer: () => NetflixPlayer, getVideoId: () => string | null): BridgeMethods {
  return {
    seekBy(deltaMs) {
      const p = getPlayer();
      p.seek(clampTime(p.getCurrentTime() + deltaMs, p.getDuration()));
    },
    seek(timeMs) {
      const p = getPlayer();
      p.seek(clampTime(timeMs, p.getDuration()));
    },
    play() {
      getPlayer().play();
    },
    pause() {
      getPlayer().pause();
    },
    getState(): PlayerState {
      const p = getPlayer();
      return {
        currentTimeMs: p.getCurrentTime(),
        durationMs: p.getDuration(),
        paused: p.isPaused(),
        videoId: getVideoId(),
      };
    },
  };
}
```

- [ ] **Step 6: Implement the server and client**

`src/lib/bridge/server.ts`:

```ts
import {
  BRIDGE_REQUEST_EVENT,
  BRIDGE_RESPONSE_EVENT,
  BridgeError,
  decode,
  encode,
  type BridgeMethods,
  type BridgeRequest,
  type BridgeResponse,
} from './protocol';

export function serveBridge(target: EventTarget, methods: BridgeMethods): () => void {
  const onRequest = (event: Event) => {
    const req = decode<BridgeRequest>((event as CustomEvent).detail);
    if (!req || typeof req.id !== 'string') return;

    let res: BridgeResponse;
    const fn = Object.hasOwn(methods, req.method) ? (methods as unknown as Record<string, unknown>)[req.method] : undefined;
    if (typeof fn !== 'function' || !Array.isArray(req.args)) {
      res = { id: req.id, ok: false, code: 'bad-request', message: `Unknown method ${String(req.method)}` };
    } else {
      try {
        res = { id: req.id, ok: true, result: (fn as (...args: unknown[]) => unknown).apply(methods, req.args) ?? null };
      } catch (err) {
        res =
          err instanceof BridgeError
            ? { id: req.id, ok: false, code: err.code, message: err.message }
            : { id: req.id, ok: false, code: 'internal', message: String(err) };
      }
    }
    target.dispatchEvent(new CustomEvent(BRIDGE_RESPONSE_EVENT, { detail: encode(res) }));
  };

  target.addEventListener(BRIDGE_REQUEST_EVENT, onRequest);
  return () => target.removeEventListener(BRIDGE_REQUEST_EVENT, onRequest);
}
```

`src/lib/bridge/client.ts`:

```ts
import {
  BRIDGE_REQUEST_EVENT,
  BRIDGE_RESPONSE_EVENT,
  BridgeError,
  decode,
  encode,
  type BridgeMethod,
  type BridgeMethods,
  type BridgeResponse,
} from './protocol';

export interface BridgeClient {
  call<M extends BridgeMethod>(method: M, ...args: Parameters<BridgeMethods[M]>): Promise<ReturnType<BridgeMethods[M]>>;
  dispose(): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export function createBridgeClient(target: EventTarget, timeoutMs = 1000): BridgeClient {
  const prefix = Math.random().toString(36).slice(2);
  let seq = 0;
  const pending = new Map<string, Pending>();

  const onResponse = (event: Event) => {
    const res = decode<BridgeResponse>((event as CustomEvent).detail);
    if (!res) return;
    const entry = pending.get(res.id);
    if (!entry) return;
    pending.delete(res.id);
    clearTimeout(entry.timer);
    if (res.ok) entry.resolve(res.result);
    else entry.reject(new BridgeError(res.code, res.message));
  };
  target.addEventListener(BRIDGE_RESPONSE_EVENT, onResponse);

  return {
    call(method, ...args) {
      const id = `${prefix}-${++seq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BridgeError('timeout', `Bridge call ${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        target.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: encode({ id, method, args }) }));
      });
    },
    dispose() {
      target.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new BridgeError('internal', 'Bridge client disposed'));
      }
      pending.clear();
    },
  };
}
```

- [ ] **Step 7: Run tests and type-check**

Run: `pnpm test tests/unit/video-id.test.ts tests/unit/bridge.test.ts`
Expected: PASS.

Run: `pnpm compile`
Expected: no errors.

- [ ] **Step 8: Add the MAIN-world entrypoint**

`src/entrypoints/netflix-bridge.content.ts`:

```ts
import { defineContentScript } from '#imports';
import { createPlayerMethods, findPlayer } from '@/lib/bridge/player';
import { serveBridge } from '@/lib/bridge/server';
import { parseWatchVideoId } from '@/lib/netflix/video-id';

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    serveBridge(
      document,
      createPlayerMethods(
        () => findPlayer((window as { netflix?: unknown }).netflix),
        () => parseWatchVideoId(location.pathname),
      ),
    );
  },
});
```

- [ ] **Step 9: Build and verify the bridge on Netflix**

Run: `pnpm build`
Expected: succeeds; `.output/chrome-mv3/manifest.json` has a `content_scripts` entry with `"world": "MAIN"`, `"run_at": "document_start"`, matches `https://www.netflix.com/*`.

Load `.output/chrome-mv3` unpacked in Chrome (see README), open a Netflix episode, and in the DevTools console (top frame, page context) run:

```js
document.addEventListener('lingoflix:bridge-response', (e) => console.log(e.detail), { once: true });
document.dispatchEvent(
  new CustomEvent('lingoflix:bridge-request', {
    detail: JSON.stringify({ id: 't1', method: 'seekBy', args: [-5000] }),
  }),
);
```

Expected: the console logs `{"id":"t1","ok":true,"result":null}` and the video jumps back 5 s with no Netflix error screen.

- [ ] **Step 10: Commit**

```bash
git add src/lib/netflix src/lib/bridge src/entrypoints/netflix-bridge.content.ts tests/unit/video-id.test.ts tests/unit/bridge.test.ts
git commit -m "feat: add page bridge for Netflix player control" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Netflix content script — shortcuts and subtitle toggle

**Files:**
- Create: `src/entrypoints/netflix.content/keyboard.ts`
- Create: `src/entrypoints/netflix.content/subtitle-visibility.ts`
- Create: `src/entrypoints/netflix.content/notice.ts`
- Create: `src/entrypoints/netflix.content/index.ts`
- Modify: `docs/netflix-internals.md` (row 5)
- Test: `tests/unit/keyboard.test.ts`, `tests/unit/subtitle-visibility.test.ts`, `tests/unit/notice.test.ts`

**Interfaces:**
- Consumes: `matchAction`, `ActionId` (Task 2); `Settings`, `DEFAULT_SETTINGS`, `loadSettings`, `updateSettings`, `watchSettings` (Task 3); `createBridgeClient`, `BridgeError`, `isWatchPath`, `SUBTITLE_LAYER_SELECTOR` (Task 4).
- Produces:
  - `keyboard.ts`: `type ActionHandlers = Partial<Record<ActionId, () => void>>`, `interface KeyboardDeps { getSettings(): Settings | null; isWatchPage(): boolean; handlers: ActionHandlers; isActionAvailable?(action: ActionId): boolean }`, `isTypingTarget(event: Event): boolean`, `createKeyboardHandlers(deps: KeyboardDeps): { onKeyDown(e: KeyboardEvent): void; onKeyUp(e: KeyboardEvent): void }`
  - `subtitle-visibility.ts`: `SUBTITLES_HIDDEN_ATTR = 'data-lingoflix-subtitles'`, `applySubtitlesHidden(doc: Document, hidden: boolean): void`
  - `notice.ts`: `interface Notifier { show(message: string, durationMs?: number): void; showOnce(key: string, message: string): void }`, `createNotifier(doc: Document): Notifier`

- [ ] **Step 1: Write the failing keyboard tests**

`tests/unit/keyboard.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeyboardHandlers, type KeyboardDeps } from '@/entrypoints/netflix.content/keyboard';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

const teardowns: (() => void)[] = [];
afterEach(() => {
  while (teardowns.length) teardowns.pop()!();
  document.body.innerHTML = '';
});

function setup(overrides: Partial<KeyboardDeps> = {}) {
  const handlers = { rewind: vi.fn(), forward: vi.fn(), toggleSubtitles: vi.fn() };
  const state: { settings: Settings | null; watch: boolean } = { settings: DEFAULT_SETTINGS, watch: true };
  const { onKeyDown, onKeyUp } = createKeyboardHandlers({
    getSettings: () => state.settings,
    isWatchPage: () => state.watch,
    handlers,
    ...overrides,
  });
  // LingoFlix listens on window, capture phase — exactly as index.ts registers it.
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  // Stand-in for Netflix's own key handling.
  const netflix = vi.fn();
  document.addEventListener('keydown', netflix);
  document.addEventListener('keyup', netflix);
  teardowns.push(() => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keyup', onKeyUp, { capture: true });
    document.removeEventListener('keydown', netflix);
    document.removeEventListener('keyup', netflix);
  });

  const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
    target.dispatchEvent(down);
    target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, composed: true, ...init }));
    return down;
  };
  return { handlers, netflix, state, press };
}

describe('keyboard shortcuts', () => {
  it('runs the bound action and hides the key from Netflix', () => {
    const { handlers, netflix, press } = setup();
    const down = press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).toHaveBeenCalledTimes(1);
    expect(down.defaultPrevented).toBe(true);
    expect(netflix).not.toHaveBeenCalled(); // neither keydown nor keyup reached Netflix
  });

  it('passes unbound keys through to Netflix', () => {
    const { handlers, netflix, press } = setup();
    const down = press({ code: 'KeyJ', key: 'j' });
    expect(Object.values(handlers).every((h) => h.mock.calls.length === 0)).toBe(true);
    expect(down.defaultPrevented).toBe(false);
    expect(netflix).toHaveBeenCalledTimes(2);
  });

  it('lets modified combos through (e.g. ⌘← for browser back)', () => {
    const { handlers, netflix, press } = setup();
    press({ code: 'ArrowLeft', key: 'ArrowLeft', metaKey: true });
    press({ code: 'KeyC', key: 'c', ctrlKey: true });
    expect(handlers.rewind).not.toHaveBeenCalled();
    expect(handlers.toggleSubtitles).not.toHaveBeenCalled();
    expect(netflix).toHaveBeenCalledTimes(4);
  });

  it('fires with an IME active (key is "Process", code is physical)', () => {
    const { handlers, press } = setup();
    press({ code: 'KeyC', key: 'Process' });
    expect(handlers.toggleSubtitles).toHaveBeenCalledTimes(1);
  });

  it('ignores keys typed into inputs, including inside an open shadow root', () => {
    const { handlers, netflix, press } = setup();
    const host = document.createElement('div');
    document.body.append(host);
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(input);
    press({ code: 'ArrowLeft', key: 'ArrowLeft' }, input);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    press({ code: 'KeyC', key: 'c' }, textarea);
    expect(handlers.rewind).not.toHaveBeenCalled();
    expect(handlers.toggleSubtitles).not.toHaveBeenCalled();
    expect(netflix).toHaveBeenCalledTimes(4);
  });

  it('re-checks the watch page on every key (browse → watch without reload)', () => {
    const { handlers, netflix, state, press } = setup();
    state.watch = false;
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).not.toHaveBeenCalled();
    expect(netflix).toHaveBeenCalledTimes(2);
    state.watch = true;
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled or before settings load', () => {
    const { handlers, state, press } = setup();
    state.settings = { ...DEFAULT_SETTINGS, enabled: false };
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    state.settings = null;
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).not.toHaveBeenCalled();
  });

  it('auto-repeat: seeking repeats, the subtitle toggle does not', () => {
    const { handlers, press } = setup();
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    press({ code: 'ArrowLeft', key: 'ArrowLeft', repeat: true });
    expect(handlers.rewind).toHaveBeenCalledTimes(2);
    press({ code: 'KeyC', key: 'c' });
    const repeated = press({ code: 'KeyC', key: 'c', repeat: true });
    expect(handlers.toggleSubtitles).toHaveBeenCalledTimes(1);
    expect(repeated.defaultPrevented).toBe(true); // still swallowed, so Netflix doesn't see it either
  });

  it('falls through to Netflix when an action is unavailable', () => {
    const { handlers, netflix, press } = setup({ isActionAvailable: (a) => a !== 'rewind' });
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).not.toHaveBeenCalled();
    expect(netflix).toHaveBeenCalledTimes(2);
  });

  it('falls through when a bound action has no handler', () => {
    const netflixHandlers = { rewind: vi.fn() };
    const { netflix, press } = setup({ handlers: netflixHandlers });
    press({ code: 'KeyC', key: 'c' });
    expect(netflix).toHaveBeenCalledTimes(2);
  });

  it('uses remapped keys', () => {
    const { handlers, netflix, state, press } = setup();
    state.settings = {
      ...DEFAULT_SETTINGS,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, rewind: { code: 'KeyJ', ctrl: false, alt: false, shift: false, meta: false } },
    };
    press({ code: 'KeyJ', key: 'j' });
    press({ code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(handlers.rewind).toHaveBeenCalledTimes(1);
    expect(netflix).toHaveBeenCalledTimes(2); // ArrowLeft is no longer ours
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/unit/keyboard.test.ts`
Expected: FAIL — cannot resolve `@/entrypoints/netflix.content/keyboard`.

- [ ] **Step 3: Implement `keyboard.ts`**

`src/entrypoints/netflix.content/keyboard.ts`:

```ts
import type { Settings } from '@/lib/settings';
import { matchAction, type ActionId } from '@/lib/shortcuts';

export type ActionHandlers = Partial<Record<ActionId, () => void>>;

export interface KeyboardDeps {
  /** Current settings, or null while they are still loading. */
  getSettings(): Settings | null;
  isWatchPage(): boolean;
  handlers: ActionHandlers;
  /** Return false to let an action's key fall through to Netflix (e.g. player unavailable). */
  isActionAvailable?(action: ActionId): boolean;
}

/** Actions that must not auto-repeat while the key is held. */
const NO_REPEAT: ReadonlySet<ActionId> = new Set<ActionId>(['toggleSubtitles']);

export function isTypingTarget(event: Event): boolean {
  const el = event.composedPath()[0] as { tagName?: string; isContentEditable?: boolean } | undefined;
  const tag = el?.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable === true;
}

export function createKeyboardHandlers(deps: KeyboardDeps) {
  const resolve = (event: KeyboardEvent): ActionId | null => {
    const settings = deps.getSettings();
    if (!settings?.enabled || !deps.isWatchPage() || isTypingTarget(event)) return null;
    const action = matchAction(event, settings.shortcuts);
    if (!action || !deps.handlers[action]) return null;
    if (deps.isActionAvailable && !deps.isActionAvailable(action)) return null;
    return action;
  };

  const swallow = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  return {
    onKeyDown(event: KeyboardEvent) {
      const action = resolve(event);
      if (!action) return;
      swallow(event);
      if (event.repeat && NO_REPEAT.has(action)) return;
      deps.handlers[action]?.();
    },
    onKeyUp(event: KeyboardEvent) {
      if (resolve(event)) swallow(event);
    },
  };
}
```

- [ ] **Step 4: Run the keyboard tests**

Run: `pnpm test tests/unit/keyboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing subtitle-visibility and notice tests**

`tests/unit/subtitle-visibility.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { SUBTITLES_HIDDEN_ATTR, applySubtitlesHidden } from '@/entrypoints/netflix.content/subtitle-visibility';
import { SUBTITLE_LAYER_SELECTOR } from '@/lib/netflix/selectors';

afterEach(() => {
  document.documentElement.removeAttribute(SUBTITLES_HIDDEN_ATTR);
  document.getElementById('lingoflix-subtitle-visibility')?.remove();
});

describe('applySubtitlesHidden', () => {
  it('marks <html> and installs one hiding rule for the subtitle layer', () => {
    applySubtitlesHidden(document, true);
    applySubtitlesHidden(document, true);
    expect(document.documentElement.getAttribute(SUBTITLES_HIDDEN_ATTR)).toBe('hidden');
    const styles = document.querySelectorAll('#lingoflix-subtitle-visibility');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(
      `html[${SUBTITLES_HIDDEN_ATTR}="hidden"] ${SUBTITLE_LAYER_SELECTOR} { visibility: hidden !important; }`,
    );
  });

  it('removes the mark when shown again', () => {
    applySubtitlesHidden(document, true);
    applySubtitlesHidden(document, false);
    expect(document.documentElement.hasAttribute(SUBTITLES_HIDDEN_ATTR)).toBe(false);
  });
});
```

`tests/unit/notice.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotifier } from '@/entrypoints/netflix.content/notice';

const box = () =>
  document.getElementById('lingoflix-notice-host')?.shadowRoot?.querySelector('[role="status"]') as HTMLElement | null;

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('notifier', () => {
  it('shows a message and hides it after the duration', () => {
    vi.useFakeTimers();
    const n = createNotifier(document);
    n.show('Subtitles hidden', 1200);
    expect(box()!.textContent).toBe('Subtitles hidden');
    expect(box()!.classList.contains('visible')).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(box()!.classList.contains('visible')).toBe(false);
  });

  it('showOnce shows a given key only once', () => {
    const n = createNotifier(document);
    n.showOnce('player', 'first');
    n.show('other', 10);
    n.showOnce('player', 'second');
    expect(box()!.textContent).toBe('other');
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm test tests/unit/subtitle-visibility.test.ts tests/unit/notice.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 7: Implement subtitle visibility and the notifier**

`src/entrypoints/netflix.content/subtitle-visibility.ts`:

```ts
import { SUBTITLE_LAYER_SELECTOR } from '@/lib/netflix/selectors';

/** An attribute (not a class) so Netflix rewriting <html class> can't drop it. */
export const SUBTITLES_HIDDEN_ATTR = 'data-lingoflix-subtitles';
const STYLE_ID = 'lingoflix-subtitle-visibility';

export function applySubtitlesHidden(doc: Document, hidden: boolean): void {
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `html[${SUBTITLES_HIDDEN_ATTR}="hidden"] ${SUBTITLE_LAYER_SELECTOR} { visibility: hidden !important; }`;
    (doc.head ?? doc.documentElement).append(style);
  }
  if (hidden) doc.documentElement.setAttribute(SUBTITLES_HIDDEN_ATTR, 'hidden');
  else doc.documentElement.removeAttribute(SUBTITLES_HIDDEN_ATTR);
}
```

`src/entrypoints/netflix.content/notice.ts`:

```ts
export interface Notifier {
  show(message: string, durationMs?: number): void;
  showOnce(key: string, message: string): void;
}

const HOST_ID = 'lingoflix-notice-host';

const STYLE = `
  .box {
    position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
    max-width: min(560px, calc(100vw - 32px)); padding: 10px 16px; border-radius: 8px;
    background: rgba(20, 20, 20, 0.92); color: #fff; font: 500 15px/1.4 system-ui, sans-serif;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); pointer-events: none;
    opacity: 0; transition: opacity 0.15s;
  }
  .box.visible { opacity: 1; }
`;

export function createNotifier(doc: Document): Notifier {
  const shownKeys = new Set<string>();
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const getBox = (): HTMLElement => {
    // Mount inside the fullscreen element when there is one, so the notice stays visible.
    const parent = doc.fullscreenElement ?? doc.body ?? doc.documentElement;
    let host = doc.getElementById(HOST_ID);
    if (!host) {
      host = doc.createElement('div');
      host.id = HOST_ID;
      const shadow = host.attachShadow({ mode: 'open' });
      const style = doc.createElement('style');
      style.textContent = STYLE;
      const box = doc.createElement('div');
      box.className = 'box';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      shadow.append(style, box);
    }
    if (host.parentElement !== parent) parent.append(host);
    return host.shadowRoot!.querySelector('.box') as HTMLElement;
  };

  const show = (message: string, durationMs = 5000) => {
    const box = getBox();
    box.textContent = message;
    box.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => box.classList.remove('visible'), durationMs);
  };

  return {
    show,
    showOnce(key, message) {
      if (shownKeys.has(key)) return;
      shownKeys.add(key);
      show(message);
    },
  };
}
```

- [ ] **Step 8: Run the tests**

Run: `pnpm test tests/unit/subtitle-visibility.test.ts tests/unit/notice.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the content script**

`src/entrypoints/netflix.content/index.ts`:

```ts
import { defineContentScript } from '#imports';
import { createBridgeClient } from '@/lib/bridge/client';
import { BridgeError } from '@/lib/bridge/protocol';
import { isWatchPath } from '@/lib/netflix/video-id';
import { loadSettings, updateSettings, watchSettings, type Settings } from '@/lib/settings';
import { createKeyboardHandlers, type ActionHandlers } from './keyboard';
import { createNotifier } from './notice';
import { applySubtitlesHidden } from './subtitle-visibility';

const PLAYER_UNAVAILABLE_MESSAGE =
  "LingoFlix can't control Netflix's player right now, so its seek shortcuts are off and Netflix's own keys apply. Reloading the page may help.";

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  runAt: 'document_start',
  main(ctx) {
    let settings: Settings | null = null;
    let playerUnavailable = false;
    const bridge = createBridgeClient(document);
    const notifier = createNotifier(document);

    const apply = (next: Settings) => {
      settings = next;
      applySubtitlesHidden(document, next.enabled && next.subtitlesHidden);
    };
    void loadSettings().then(apply);
    const unwatch = watchSettings(apply);

    const seekBy = (deltaMs: number) => {
      bridge.call('seekBy', deltaMs).catch((err: unknown) => {
        if (err instanceof BridgeError && (err.code === 'player-unavailable' || err.code === 'timeout')) {
          playerUnavailable = true;
          notifier.showOnce('player-unavailable', PLAYER_UNAVAILABLE_MESSAGE);
        }
      });
    };

    const handlers: ActionHandlers = {
      rewind: () => settings && seekBy(-settings.rewindSeconds * 1000),
      forward: () => settings && seekBy(settings.forwardSeconds * 1000),
      toggleSubtitles: () => {
        void updateSettings((s) => ({ ...s, subtitlesHidden: !s.subtitlesHidden })).then((s) => {
          apply(s);
          notifier.show(s.subtitlesHidden ? 'Subtitles hidden' : 'Subtitles shown', 1200);
        });
      },
    };

    const { onKeyDown, onKeyUp } = createKeyboardHandlers({
      getSettings: () => settings,
      isWatchPage: () => isWatchPath(location.pathname),
      handlers,
      isActionAvailable: (action) => !(playerUnavailable && (action === 'rewind' || action === 'forward')),
    });

    ctx.addEventListener(window, 'keydown', onKeyDown, { capture: true });
    ctx.addEventListener(window, 'keyup', onKeyUp, { capture: true });
    // A new video gets a fresh chance to reach the player.
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      playerUnavailable = false;
    });
    ctx.onInvalidated(() => {
      unwatch();
      bridge.dispose();
    });
  },
});
```

- [ ] **Step 10: Run all tests, type-check, build**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: all tests PASS, no type errors, build succeeds. `.output/chrome-mv3/manifest.json` lists two content scripts for `https://www.netflix.com/*`, both `document_start`, one with `"world": "MAIN"`.

- [ ] **Step 11: Verify on real Netflix and record key preemption**

Reload the unpacked extension, refresh a Netflix episode tab, and check each item:

1. `←` jumps back 5 s and `→` jumps forward 5 s (watch the timestamp). Netflix's own 10 s seek indicator does not appear.
2. `C` hides subtitles and shows "Subtitles hidden"; `C` again shows them. Hidden state survives moving to the next episode.
3. `⌘←` / `Alt+←` still do what the browser normally does.
4. On `/browse`, `←`/`→` behave as Netflix normally does (row navigation).
5. In fullscreen (`F`), `←`, `→`, `C` still work and the toggle notice is visible.

Update row 5 of `docs/netflix-internals.md`: Observed = "Capture-phase window listener at document_start swallows ←/→/C before Netflix (verified 2026-10-__)" with the real date, OK? = ✅. If item 1 fails because Netflix still seeks 10 s, record that in row 5 instead, and stop: report to your human partner before continuing.

- [ ] **Step 12: Commit**

```bash
git add src/entrypoints/netflix.content tests/unit/keyboard.test.ts tests/unit/subtitle-visibility.test.ts tests/unit/notice.test.ts docs/netflix-internals.md
git commit -m "feat: remappable seek and subtitle toggle shortcuts on Netflix" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Shared UI pieces and the popup

**Files:**
- Create: `src/lib/config.ts`, `src/hooks/useSettings.ts`, `src/components/Toggle.tsx`, `src/components/DonationLinks.tsx`
- Modify: `src/entrypoints/popup/App.tsx` (replace the Task 2 version)
- Test: `tests/unit/components.test.tsx`

**Interfaces:**
- Consumes: `Settings`, `loadSettings`, `updateSettings`, `watchSettings` (Task 3).
- Produces:
  - `src/lib/config.ts`: `DONATION_LINKS: readonly { id: string; label: string; url: string }[]`, `DONATION_COPY: string`
  - `src/hooks/useSettings.ts`: `useSettings(): { settings: Settings | null; update(fn: (s: Settings) => Settings): Promise<void> }`
  - `src/components/Toggle.tsx`: `Toggle(props: { label: string; description?: string; checked: boolean; onChange(next: boolean): void })`
  - `src/components/DonationLinks.tsx`: `DonationLinks()`

- [ ] **Step 1: Write the failing component tests**

`tests/unit/components.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DonationLinks } from '@/components/DonationLinks';
import { Toggle } from '@/components/Toggle';

afterEach(cleanup);

describe('Toggle', () => {
  it('is a labelled switch that reports the flipped value', () => {
    const onChange = vi.fn();
    render(<Toggle label="Enabled" description="Turn LingoFlix on or off" checked={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Enabled' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects the checked state', () => {
    render(<Toggle label="Enabled" checked onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Enabled' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('DonationLinks', () => {
  it('links to Buy Me a Coffee and GitHub Sponsors in a new tab', () => {
    render(<DonationLinks />);
    expect(screen.getByText('LingoFlix is free. If it helps you learn, you can support it.')).toBeTruthy();
    const expected = {
      'Buy Me a Coffee': 'https://buymeacoffee.com/jaycho1214',
      'GitHub Sponsors': 'https://github.com/sponsors/jaycho1214',
    };
    for (const [name, href] of Object.entries(expected)) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/unit/components.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement config, Toggle, DonationLinks, useSettings**

`src/lib/config.ts`:

```ts
export const DONATION_LINKS = [
  { id: 'buymeacoffee', label: 'Buy Me a Coffee', url: 'https://buymeacoffee.com/jaycho1214' },
  { id: 'github-sponsors', label: 'GitHub Sponsors', url: 'https://github.com/sponsors/jaycho1214' },
] as const;

export const DONATION_COPY = 'LingoFlix is free. If it helps you learn, you can support it.';
```

`src/components/Toggle.tsx`:

```tsx
import { useId } from 'react';

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange(next: boolean): void;
}

export function Toggle({ label, description, checked, onChange }: ToggleProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-md py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400"
    >
      <span>
        <span id={`${id}-label`} className="block text-sm font-medium text-neutral-100">
          {label}
        </span>
        {description && (
          <span id={`${id}-desc`} className="block text-xs text-neutral-400">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-yellow-400' : 'bg-neutral-600'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full shadow transition-transform ${checked ? 'translate-x-4 bg-neutral-950' : 'bg-white'}`}
        />
      </span>
    </button>
  );
}
```

`src/components/DonationLinks.tsx`:

```tsx
import { DONATION_COPY, DONATION_LINKS } from '@/lib/config';

export function DonationLinks() {
  return (
    <section aria-labelledby="donate-heading" className="space-y-2">
      <h2 id="donate-heading" className="text-sm font-semibold text-neutral-100">
        Support LingoFlix
      </h2>
      <p className="text-xs text-neutral-400">{DONATION_COPY}</p>
      <div className="flex flex-wrap gap-2">
        {DONATION_LINKS.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:border-yellow-400 hover:text-yellow-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400"
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
```

`src/hooks/useSettings.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { loadSettings, updateSettings, watchSettings, type Settings } from '@/lib/settings';

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let active = true;
    void loadSettings().then((s) => {
      if (active) setSettings(s);
    });
    const unwatch = watchSettings((s) => {
      if (active) setSettings(s);
    });
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  const update = useCallback(async (fn: (s: Settings) => Settings) => {
    setSettings(await updateSettings(fn));
  }, []);

  return { settings, update };
}
```

- [ ] **Step 4: Run the component tests**

Run: `pnpm test tests/unit/components.test.tsx`
Expected: PASS.

- [ ] **Step 5: Build the popup**

Replace `src/entrypoints/popup/App.tsx`:

```tsx
import { browser } from '#imports';
import { DonationLinks } from '@/components/DonationLinks';
import { Toggle } from '@/components/Toggle';
import { useSettings } from '@/hooks/useSettings';

export function App() {
  const { settings, update } = useSettings();

  return (
    <main className="w-80 space-y-4 bg-neutral-950 p-4 text-neutral-100">
      <header className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold">LingoFlix</h1>
        <span className="text-xs text-neutral-500">v{browser.runtime.getManifest().version}</span>
      </header>

      {settings ? (
        <Toggle
          label="Enabled"
          description="Turn LingoFlix on or off on Netflix"
          checked={settings.enabled}
          onChange={(enabled) => void update((s) => ({ ...s, enabled }))}
        />
      ) : (
        <p className="text-sm text-neutral-400">Loading…</p>
      )}

      <button
        type="button"
        onClick={() => void browser.runtime.openOptionsPage()}
        className="w-full rounded-md bg-yellow-400 px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-yellow-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400"
      >
        Settings
      </button>

      <hr className="border-neutral-800" />
      <DonationLinks />
    </main>
  );
}
```

- [ ] **Step 6: Type-check and build**

Run: `pnpm compile && pnpm build`
Expected: no type errors; build succeeds.

(The **Settings** button opens the options page, which Task 7 adds; until then Chrome reports no options page.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/config.ts src/hooks src/components src/entrypoints/popup tests/unit/components.test.tsx
git commit -m "feat: popup with enable toggle and donation links" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Options page — Settings tab with shortcut recorder

**Files:**
- Create: `src/entrypoints/options/index.html`, `main.tsx`, `App.tsx`, `SettingsTab.tsx`, `ShortcutRecorder.tsx`, `SecondsInput.tsx`
- Test: `tests/unit/shortcut-recorder.test.tsx`, `tests/unit/seconds-input.test.tsx`

**Interfaces:**
- Consumes: `ACTION_IDS`, `ACTION_LABELS`, `DEFAULT_SHORTCUTS`, `bindingFromEvent`, `findConflict`, `formatBinding`, `overridesNetflix`, `ActionId`, `Binding`, `ShortcutMap` (Task 2); `DEFAULT_SETTINGS`, `SEEK_SECONDS_MIN`, `SEEK_SECONDS_MAX`, `clampSeekSeconds` (Task 3); `useSettings`, `Toggle`, `DonationLinks` (Task 6).
- Produces:
  - `ShortcutRecorder(props: { action: ActionId; shortcuts: ShortcutMap; onChange(binding: Binding | null): void })`
  - `SecondsInput(props: { label: string; value: number; onCommit(seconds: number): void })`
  - Options page routes `#/settings` (default). Plans 2 and 3 add `#/study-log` and `#/microphone` by appending to `TABS` in `App.tsx`.

- [ ] **Step 1: Write the failing recorder and seconds tests**

`tests/unit/shortcut-recorder.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutRecorder } from '@/entrypoints/options/ShortcutRecorder';
import { DEFAULT_SHORTCUTS, key, type ShortcutMap } from '@/lib/shortcuts';

afterEach(cleanup);

function setup(shortcuts: ShortcutMap = DEFAULT_SHORTCUTS) {
  const onChange = vi.fn();
  render(<ShortcutRecorder action="rewind" shortcuts={shortcuts} onChange={onChange} />);
  const startRecording = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Change Rewind shortcut' }));
    return screen.getByLabelText('Press a new key for Rewind');
  };
  return { onChange, startRecording };
}

describe('ShortcutRecorder', () => {
  it('shows the current binding', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Change Rewind shortcut' }).textContent).toBe('←');
  });

  it('records the next key press', () => {
    const { onChange, startRecording } = setup();
    fireEvent.keyDown(startRecording(), { code: 'KeyJ', key: 'j' });
    expect(onChange).toHaveBeenCalledWith(key('KeyJ'));
  });

  it('records modifier combos and ignores modifier-only presses', () => {
    const { onChange, startRecording } = setup();
    const target = startRecording();
    fireEvent.keyDown(target, { code: 'ShiftLeft', key: 'Shift', shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(target, { code: 'KeyJ', key: 'J', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(key('KeyJ', { shift: true }));
  });

  it('refuses a key already used by another action', () => {
    const { onChange, startRecording } = setup();
    fireEvent.keyDown(startRecording(), { code: 'ArrowRight', key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('→ is already used by Forward.');
  });

  it('Escape cancels without changing anything', () => {
    const { onChange, startRecording } = setup();
    fireEvent.keyDown(startRecording(), { code: 'Escape', key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Change Rewind shortcut' })).toBeTruthy();
  });

  it('Clear unbinds the action', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Rewind shortcut' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('warns when the binding overrides a Netflix key', () => {
    setup({ ...DEFAULT_SHORTCUTS, rewind: key('KeyF') });
    expect(screen.getByText("Overrides Netflix's F shortcut.")).toBeTruthy();
  });

  it('shows "Not set" and no Clear button when unbound', () => {
    setup({ ...DEFAULT_SHORTCUTS, rewind: null });
    expect(screen.getByRole('button', { name: 'Change Rewind shortcut' }).textContent).toBe('Not set');
    expect(screen.queryByRole('button', { name: 'Clear Rewind shortcut' })).toBeNull();
  });
});
```

`tests/unit/seconds-input.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecondsInput } from '@/entrypoints/options/SecondsInput';

afterEach(cleanup);

function setup(value = 5) {
  const onCommit = vi.fn();
  render(<SecondsInput label="Rewind seconds" value={value} onCommit={onCommit} />);
  return { onCommit, input: screen.getByLabelText('Rewind seconds') as HTMLInputElement };
}

describe('SecondsInput', () => {
  it('commits a valid value on blur', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(3);
  });

  it('commits on Enter', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(12);
  });

  it('clamps out-of-range values to 1–60', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(1);
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(60);
  });

  it('reverts empty input without committing', () => {
    const { onCommit, input } = setup(5);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('5');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/unit/shortcut-recorder.test.tsx tests/unit/seconds-input.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `ShortcutRecorder.tsx`**

`src/entrypoints/options/ShortcutRecorder.tsx`:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ACTION_LABELS,
  bindingFromEvent,
  findConflict,
  formatBinding,
  overridesNetflix,
  type ActionId,
  type Binding,
  type ShortcutMap,
} from '@/lib/shortcuts';

interface ShortcutRecorderProps {
  action: ActionId;
  shortcuts: ShortcutMap;
  onChange(binding: Binding | null): void;
}

const platform: 'mac' | 'other' = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac') ? 'mac' : 'other';

const chip =
  'min-w-16 rounded-md border px-3 py-1.5 text-center font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400';

export function ShortcutRecorder({ action, shortcuts, onChange }: ShortcutRecorderProps) {
  const label = ACTION_LABELS[action];
  const binding = shortcuts[action];
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasRecording = useRef(false);

  useEffect(() => {
    if (recording) recorderRef.current?.focus();
    else if (wasRecording.current) buttonRef.current?.focus();
    wasRecording.current = recording;
  }, [recording]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      setRecording(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      setRecording(false);
      return;
    }
    const next = bindingFromEvent(e);
    if (!next) return; // modifier only — keep waiting for the real key
    setRecording(false);
    const conflict = findConflict(shortcuts, next, action);
    if (conflict) {
      setError(`${formatBinding(next, platform)} is already used by ${ACTION_LABELS[conflict]}.`);
      return;
    }
    setError(null);
    onChange(next);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {recording ? (
          <div
            ref={recorderRef}
            tabIndex={0}
            role="textbox"
            aria-label={`Press a new key for ${label}`}
            onKeyDown={onKeyDown}
            onBlur={() => setRecording(false)}
            className={`${chip} border-yellow-400 text-yellow-300`}
          >
            Press a key…
          </div>
        ) : (
          <button
            ref={buttonRef}
            type="button"
            aria-label={`Change ${label} shortcut`}
            onClick={() => {
              setError(null);
              setRecording(true);
            }}
            className={`${chip} border-neutral-700 bg-neutral-900 text-neutral-100 hover:border-neutral-500`}
          >
            {formatBinding(binding, platform)}
          </button>
        )}
        {binding && !recording && (
          <button
            type="button"
            aria-label={`Clear ${label} shortcut`}
            onClick={() => {
              setError(null);
              onChange(null);
            }}
            className="rounded-md px-2 py-1.5 text-xs text-neutral-400 hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-yellow-400"
          >
            Clear
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      ) : (
        binding &&
        overridesNetflix(binding) && (
          <p className="text-xs text-yellow-300">Overrides Netflix's {formatBinding(binding, platform)} shortcut.</p>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `SecondsInput.tsx`**

`src/entrypoints/options/SecondsInput.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { SEEK_SECONDS_MAX, SEEK_SECONDS_MIN, clampSeekSeconds } from '@/lib/settings';

interface SecondsInputProps {
  label: string;
  value: number;
  onCommit(seconds: number): void;
}

export function SecondsInput({ label, value, onCommit }: SecondsInputProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = draft.trim() === '' ? value : clampSeekSeconds(Number(draft), value);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <label className="mt-1 flex items-center gap-2 text-sm text-neutral-400">
      <input
        type="number"
        inputMode="numeric"
        min={SEEK_SECONDS_MIN}
        max={SEEK_SECONDS_MAX}
        step={1}
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100 focus-visible:outline-2 focus-visible:outline-yellow-400"
      />
      seconds
    </label>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test tests/unit/shortcut-recorder.test.tsx tests/unit/seconds-input.test.tsx`
Expected: PASS.

- [ ] **Step 6: Build the Settings tab and the options shell**

`src/entrypoints/options/SettingsTab.tsx`:

```tsx
import { Toggle } from '@/components/Toggle';
import { useSettings } from '@/hooks/useSettings';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { ACTION_IDS, ACTION_LABELS, DEFAULT_SHORTCUTS, type ActionId, type Binding } from '@/lib/shortcuts';
import { SecondsInput } from './SecondsInput';
import { ShortcutRecorder } from './ShortcutRecorder';

export function SettingsTab() {
  const { settings, update } = useSettings();
  if (!settings) return <p className="text-sm text-neutral-400">Loading…</p>;

  const setBinding = (action: ActionId, binding: Binding | null) =>
    void update((s) => ({ ...s, shortcuts: { ...s.shortcuts, [action]: binding } }));

  return (
    <div className="space-y-10">
      <section aria-labelledby="general-heading" className="space-y-2">
        <h2 id="general-heading" className="text-lg font-semibold">
          General
        </h2>
        <Toggle
          label="Enabled"
          description="When off, LingoFlix does nothing on Netflix."
          checked={settings.enabled}
          onChange={(enabled) => void update((s) => ({ ...s, enabled }))}
        />
      </section>

      <section aria-labelledby="shortcuts-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="shortcuts-heading" className="text-lg font-semibold">
            Shortcuts
          </h2>
          <button
            type="button"
            onClick={() =>
              void update((s) => ({
                ...s,
                shortcuts: DEFAULT_SHORTCUTS,
                rewindSeconds: DEFAULT_SETTINGS.rewindSeconds,
                forwardSeconds: DEFAULT_SETTINGS.forwardSeconds,
              }))
            }
            className="text-sm text-neutral-400 underline-offset-4 hover:text-neutral-100 hover:underline focus-visible:outline-2 focus-visible:outline-yellow-400"
          >
            Reset to defaults
          </button>
        </div>
        <p className="text-sm text-neutral-400">
          Click a shortcut, then press the new key. Shortcuts work while watching on Netflix. Keys you don't use here
          keep Netflix's normal behavior.
        </p>
        <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
          {ACTION_IDS.map((action) => (
            <li key={action} className="flex items-start justify-between gap-6 py-4">
              <div>
                <span className="text-sm font-medium">{ACTION_LABELS[action]}</span>
                {action === 'rewind' && (
                  <SecondsInput
                    label="Rewind seconds"
                    value={settings.rewindSeconds}
                    onCommit={(rewindSeconds) => void update((s) => ({ ...s, rewindSeconds }))}
                  />
                )}
                {action === 'forward' && (
                  <SecondsInput
                    label="Forward seconds"
                    value={settings.forwardSeconds}
                    onCommit={(forwardSeconds) => void update((s) => ({ ...s, forwardSeconds }))}
                  />
                )}
              </div>
              <ShortcutRecorder
                action={action}
                shortcuts={settings.shortcuts}
                onChange={(binding) => setBinding(action, binding)}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

`src/entrypoints/options/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { DonationLinks } from '@/components/DonationLinks';
import { SettingsTab } from './SettingsTab';

const TABS = [{ id: 'settings', label: 'Settings' }] as const;
type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const id = location.hash.replace(/^#\/?/, '');
  return TABS.find((t) => t.id === id)?.id ?? 'settings';
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold">LingoFlix</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Understand every line on Netflix. Not affiliated with or endorsed by Netflix.
          </p>
          <nav aria-label="Sections" className="mt-6 flex gap-1 border-b border-neutral-800">
            {TABS.map((t) => (
              <a
                key={t.id}
                href={`#/${t.id}`}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-yellow-400 ${
                  tab === t.id
                    ? 'border-yellow-400 text-neutral-100'
                    : 'border-transparent text-neutral-400 hover:text-neutral-100'
                }`}
              >
                {t.label}
              </a>
            ))}
          </nav>
        </header>

        <main>{tab === 'settings' && <SettingsTab />}</main>

        <footer className="mt-16 border-t border-neutral-800 pt-6">
          <DonationLinks />
        </footer>
      </div>
    </div>
  );
}
```

`src/entrypoints/options/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/assets/tailwind.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/entrypoints/options/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="manifest.open_in_tab" content="true" />
    <title>LingoFlix Settings</title>
  </head>
  <body class="bg-neutral-950">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Run everything**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: all tests PASS, no type errors, build succeeds; `manifest.json` has `"options_ui": { "page": "options.html", "open_in_tab": true }`.

- [ ] **Step 8: Verify in Chrome**

Reload the unpacked extension.

1. Popup: shows "LingoFlix", the version, the Enabled switch, **Settings**, and both donation links (each opens in a new tab at the right URL).
2. **Settings** opens the options page in a tab with the Settings tab active and the donation footer.
3. Change Rewind to `J` and Rewind seconds to `3`. In an already-open Netflix episode tab (no refresh), `J` rewinds 3 s and `←` now does Netflix's default.
4. Try to set Forward to `J`: the page shows "J is already used by Rewind." and keeps the old key.
5. Set Toggle subtitles to `F`: the "Overrides Netflix's F shortcut." warning appears; on Netflix, `F` toggles subtitles instead of fullscreen.
6. **Reset to defaults** restores ←/→ 5 s and C.
7. Turn Enabled off in the popup: on Netflix, `←` is back to Netflix's 10 s and `C` does nothing. Turn it back on.

- [ ] **Step 9: Commit**

```bash
git add src/entrypoints/options tests/unit/shortcut-recorder.test.tsx tests/unit/seconds-input.test.tsx
git commit -m "feat: options page with shortcut recorder and seek settings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
