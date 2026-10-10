# Netflix internals (verified)

LingoFlix depends on Netflix internals that can change without notice. Re-run
`scripts/netflix-probe.js` (instructions at the top of the file) and update this
table whenever something stops working. Plan 2 probes, same instructions style:
`scripts/netflix-probe-plan2.js` (isolation, root font size, clocks),
`scripts/netflix-manifest-probe.js` (where the subtitle track list lives),
`scripts/netflix-track-probe.js` (subtitle files, our parser, cue clock) and
`scripts/netflix-bridge-check.js` (what the installed extension's bridge answers).

Verified on: 2026-10-10 · Chrome 154 (macOS) · A Different World, E1 "Irreconcilable Differences" (`/watch/82028220`), English closed captions
Plan 2 probes: 2026-10-10 · Chrome 154 (macOS) · ad-supported plan · A Different World, E2 "O Captain! My Captain!" (`/watch/82028221`), English closed captions
Plan 2 live checklist: 2026-10-10 · all 22 items passed (explain, follow-ups with Korean IME, line jumps to unwatched lines and after the lead-in, fullscreen and small window, language switch, next episode, movie, Study Log)

| # | Item | LingoFlix assumes | Observed | OK? | Code that depends on it |
|---|------|-------------------|----------|-----|-------------------------|
| 1 | Subtitle layer | `.player-timedtext` contains the visible subtitle text | `div.player-timedtext` → `div.player-timedtext-text-container` → `span` → `span` (text). `innerText` = the visible line. | ✅ | `src/lib/netflix/selectors.ts` |
| 2 | Player API | `netflix.appContext.state.playerApp.getAPI().videoPlayer` → `getAllPlayerSessionIds()` (pick the id starting with `watch`) → `getVideoPlayerBySessionId(id)` with `seek(ms)`, `play()`, `pause()`, `getCurrentTime()` (ms), `getDuration()` (ms), `isPaused()` | Path and all six methods present. One session `watch-55980845-…`. `getCurrentTime()` = 251854 vs `<video>.currentTime` = 251.95 s → milliseconds. **But `seek()` takes `getSegmentTime()`'s clock, not `getCurrentTime()`'s** — see "Two clocks" below. | ✅ | `src/lib/bridge/player.ts` |
| 3 | Text track download URLs | The playing title's manifest is in player memory at `getInternalPlayer().playback.segmentWithBoundObservables.manifest.manifestResult` with `movieId` = the watch id. Its track list is `textTracks` (the old name `timedtexttracks` sits beside it). Each track's `id`/`new_track_id` equals `getTimedTextTrack().trackId`; files are in `ttDownloadables[profile].urls[].url`. | The original assumption failed: the manifest arrives by MSL XHR (`/msl/playapi/cadmium/licensedmanifest/1`) and never passed through `JSON.parse` or `Response.json` where our hook sees it (console probe and a fresh-load bridge check both empty). Memory path confirmed: `movieId` 82028221, `isAd: false`, 68 text tracks, profiles `imsc1.1`, `simplesdh`, `dfxp-ls-sdh`, 3 CDN URLs each (`{ cdnId, url, cdn_id }`). An ad manifest (`isAd: true`, another `movieId`, 6006 ms) sits at `manifestResult.auxiliaryManifests[0]`. Fetching each file from the page: 200; `parseTtml` reads 686 cues from each. | ✅ (read from memory; live checklist: D jumps to lines not yet watched) | `src/lib/netflix/manifest.ts` (`createManifestSource`), `src/lib/bridge/player.ts`, `src/entrypoints/netflix-bridge.content.ts` |
| 4 | Title metadata | `playerApp.getState().videoPlayer.videoMetadata[videoId]._metadata.video` has series title, type, seasons → episodes | Path differs: use `videoMetadata[videoId]._metadataObject.video` → `{ title, type: "show"\|"movie", id (series id), currentEpisode, hiddenEpisodeNumbers, seasons: [{ id, seq, title, year, shortName, longName, hiddenEpisodeNumbers, episodes: [{ id, episodeId, seq, title, runtime, displayRuntime, creditsOffset, bookmark, skipMarkers, … }] }] }`. Find the episode whose `id === currentEpisode` → season `seq`, episode `seq`, episode `title`. Entry also has methods `getTitle`, `getVideo`, `getCurrentVideo`, `getAllSeasons`. DOM fallback `[data-uia="video-title"]` = `h4` (series) + `span` (`E1`) + `span` (episode title). `document.title` is just `Netflix`. | ✅ (corrected path) | Plan 2 |
| 5 | Key preemption | A capture-phase `window` keydown listener registered at `document_start` runs before Netflix's handlers | Verified live 2026-10-10: during the seek probe no bound ←/→ reached Netflix's `document` listeners and Netflix showed no seek indicator; unbound keys (Space) still did. | ✅ | `src/entrypoints/netflix.content/keyboard.ts` |
| 6 | Fullscreen element | Some element that contains `.player-timedtext` | `div.watch-video[data-uia="watch-video"]`; it contains `.player-timedtext`. Mount overlays inside it (or deeper, e.g. `[data-uia="player"]`). | ✅ | Plan 2 overlay mount; `notice.ts` already mounts in `document.fullscreenElement` |
| 7 | `?t=` deep link | `/watch/{id}?t={seconds}` starts playback at that time | Does **not** work: `?t=120` did not start at 2:00 (user-verified); `?t=2000` resumed at the saved bookmark (11:31). | ❌ | Plan 2 Study Log — open `/watch/{id}` then seek via the page bridge (spec §5.5) |
| 8 | Cue clock | Cue times are episode time (`getSegmentTime()`) | Paused on "[suspenseful music playing]": its cue runs 929 303 to 931 389 ms and `getSegmentTime()` was 931 103, inside the cue. On this run both clocks were equal (reloaded mid-episode, no lead-in), so it can't exclude the player clock alone; the files declare `ttp:timeBase="media"` and belong to the episode's own manifest, while the lead-in is a separate ad manifest. | ✅ (live checklist: line jumps land on line starts after the lead-in too) | `src/entrypoints/netflix.content/subtitle-session.ts`, `src/lib/subtitles/context.ts`, `src/lib/subtitles/navigation.ts` |
| 9 | Event isolation | Stopping key/click/pointer events at the overlay's shadow host (bubble phase) keeps them from Netflix | Space twice in a textarea inside a stopping host while paused, plus a click: paused before and after, time unchanged (8720 → 8720), the textarea got `"  "`. | ✅ (no capture-phase listener needed; live checklist: Korean IME typing in the card never reaches Netflix) | `src/entrypoints/netflix.content/overlay/isolate.ts` |
| 10 | Root font size | Netflix's root font size isn't ours, so on-Netflix UI sizes are px | `htmlFontSize` = `6px` | ✅ (px sizes required) | `src/entrypoints/netflix.content/overlay/overlay.css` |
| 11 | Overlay mount | A shadow host appended to `div.watch-video[data-uia="watch-video"]` shows a `position: fixed` card in and out of fullscreen | Live checklist: hover and the card work in fullscreen and in a small window; the card stays inside the player and scrolls when long. | ✅ | `src/entrypoints/netflix.content/overlay/mount.tsx` |

## Two clocks (seek probe, 2026-10-10, `scripts/netflix-seek-probe.js`)

Starting `/watch/82028220` from the beginning, Netflix played a 7007 ms lead-in before the episode:

- `getSegmentTime()` stayed `0` while `getCurrentTime()` ran 0 → 7007, then both advanced with `getCurrentTime() − getSegmentTime() = 7007` for the rest of the session.
- `seek(x)` landed at `getSegmentTime() === x` (17 of 17 calls), never at `getCurrentTime() === x`.
- So LingoFlix's original `seek(getCurrentTime() ± 5000)` jumped → **+12 s** and ← **+2 s (forward)**. One bridge request and one `seek()` per key press, and no arrow key reached Netflix, which rules out double handling. Every seek landed exactly on target, which rules out keyframe snapping.
- In the earlier v1/v2 probes (resumed from the bookmark mid-episode) the two clocks were equal (691009 / 691009), which is why this only shows up after a lead-in.

Rule: **every time LingoFlix stores, compares, or seeks to is in `getSegmentTime()`'s clock** (the episode's own time). The bridge reports `currentTimeMs = getSegmentTime()` and `durationMs = getDuration() − (getCurrentTime() − getSegmentTime())`. That duration is exact if `getDuration()` includes the lead-in, and ends the clamp 7 s early if it doesn't — safe either way; unverified which. Subtitle cue times use the episode clock too (row 8).

## Subtitle files (Plan 2 probes, 2026-10-10)

- `getInternalPlayer().playback.segmentWithBoundObservables.manifest.manifestResult` keys include `movieId`, `duration` (1 932 722), `isAd`, `viewableType` (`EPISODE`), `textTracks`, `timedtexttracks`, `audioTracks`, `videoTracks`, `auxiliaryManifests`, `adverts`, `urlExpirationDuration` (about 12 h). The ad beside it: `viewableType: "SUPPLEMENTAL"`, `isAd: true`.
- Other track lists in memory (`playback.tracks.audioTrack.timedTextTrackList`, `parsedManifest.timedTextTrackList`) hold player track objects with `trackId`, `downloadableId`, `profile` (`imsc1.1` for the shown track) but are class instances; LingoFlix reads only the plain manifest object.
- Netflix itself downloads the shown track's `imsc1.1` file by XHR from `*.oca.nflxvideo.net` (114 KB); the page can fetch all three formats (200; `text/xml` for IMSC, `application/octet-stream` for the others).
- Root tags: IMSC 1.1 `<tt ttp:tickRate="10000000" ttp:timeBase="media" xml:lang="en" …>`, DFXP and SimpleSDH the same tick rate; lines are `<p begin="60060000t" end="98848750t" …>` with `<span>` and `<br/>`.
- Internal objects include custom array types and objects that throw on reflection: read only data properties, in plain loops, one object at a time.

## Other findings (for Plan 2)

- **Player timeline ≠ `<video>` timeline.** `getDuration()` = 1 802 217 ms (30:02) while `<video>.duration` = 898.7 s (14:58). Netflix plays a segmented "playgraph" (the player also has `getAdManager`, `getSegmentTime`, `getPlaygraphManager`). Use only the player's own times for seeking, clamping, and cue timing; never `<video>` times.
- **Current subtitle track is exposed** by `getTimedTextTrack()`: `{ trackId, bcp47, displayName, trackType, rawTrackType, isNoneTrack, isForcedNarrative, isImageBased }`. `bcp47` gives the subtitle language for prompts; `isImageBased` drives the "subtitles can't be read" message (spec §9). `getTimedTextTrackList()` lists every track (this title: 39).
- **Closed captions** (`rawTrackType: "CLOSEDCAPTIONS"`) include sound descriptions, e.g. `["Yes You Can" by Young Thug playing]`. The explanation prompt should treat bracketed text as non-dialogue.
- The player also has `isTimedTextVisible()` / `setTimedTextVisible()`. LingoFlix keeps hiding subtitles with CSS instead, because the DOM must keep updating while hidden (spec §5.2).
- Watch URLs carry extra query params (`?trackId=…&tctx=…`); only the path identifies the video.
- `getMovieId()` returns the episode id as a number (`82028220`).

- **Subtitle layer receives pointer events** (`pointer-events: auto`). Two-line subtitles are one `.player-timedtext-text-container` whose `innerText` contains `\n` (3 spans).
- **Subtitle-layer ancestors** (inner → outer): `div#<videoId>` → `div` → `div[data-uia="video-canvas"]` → `div.active[data-uia="player"]` → `div.watch-video--player-view[data-uia="watch-video-player-view-minimized"]` → `div.watch-video[data-uia="watch-video"]` (fullscreen element) → `div[data-uia="loc"]` → … → `#appMountPoint` → `body`. Class names other than `watch-video*` are generated hashes — don't select on them.
- **Original language:** `getAudioTrack()` → `{ bcp47: "en", displayName: "English [Original]", isNative: true, … }`. The native audio track's `bcp47` is the show's spoken language.
- `getTimedTextTrack()` also has `channels`, `subType`, `variant`. `getTimedTextSettings()` → `{ bounds: { bottom: 135 }, size: null, visibility: true }`.
- `getTimeCodes()` → 2 entries, first `{ type: "start", startOffsetMs: 5922, endOffsetMs: 5922 }`. `getChapters()` → empty. `skipMarkers` has `credit` and `recap` ranges.
- **Subtitle files are not visible in resource timing:** the last 40 Netflix XHRs are all media `GET /range/<a>-<b>` on `*.oca.nflxvideo.net`. Text-track URLs must be captured from the manifest (spec §8.2) — still a Plan 2 check.
- `playerApp.getState()` keys: `playerApp, postPlay, videoPlayer, live, accessibility, ads`. `videoPlayer` keys include `videoMetadata`, `playbackStateBySessionId`, `videoSession`.
- This show's only season has `seq: 1`, `year: 2026`, empty `shortName`, which is why the player UI shows `E1` without a season.

## Raw probe output (v2, fullscreen run, `/watch/82028220`)

Trimmed: `methods` is identical to v1; `resources` summarized above.

```json
{
  "probeVersion": 2,
  "subtitles": {
    "playerTimedtext": { "tag": "DIV", "className": "player-timedtext", "dataUia": null },
    "textContainers": [{ "text": "\"Glory, hallelujah, big daddy,\nyou sure do do me right.\"", "spanCount": 3, "rect": { "x": 573.5, "y": 820.8, "width": 580.6, "height": 110 } }],
    "layerPointerEvents": "auto"
  },
  "player": {
    "getCurrentTime": 691009, "getSegmentTime": 691009, "videoElementCurrentTimeSeconds": 691.046534,
    "getDuration": 1802217, "videoElementDurationSeconds": 898.689458, "isPaused": false, "getPlaybackRate": 1, "movieId": 82028220,
    "timedTextTrackKeys": ["trackId", "bcp47", "displayName", "trackType", "rawTrackType", "channels", "isNoneTrack", "isForcedNarrative", "isImageBased", "subType", "variant"],
    "timedTextTrackCount": 39, "isTimedTextVisible": true,
    "getTimedTextSettings": { "bounds": { "bottom": 135 }, "size": null, "visibility": true },
    "getTimeCodes": { "length": 2, "first": { "type": "start", "startOffsetMs": 5922, "endOffsetMs": 5922 } },
    "getChapters": { "length": 0, "first": null },
    "audioTrack": { "trackId": "A:2:1;2;en;1;0;0;", "bcp47": "en", "displayName": "English [Original]", "trackType": "PRIMARY", "rawTrackType": "PRIMARY", "channels": "2.0", "isNative": true, "surroundFormatLabel": "2.0" }
  },
  "metadata": {
    "entryKeys": ["_metadataObject", "_video", "_seasons"],
    "entryMethods": ["getAllSeasons", "getCurrentVideo", "getEpisodeSelectorTrackId", "getNextEpisodeTrackId", "getTitle", "getVideo"],
    "_metadataObject": {
      "version": "2.1",
      "trackIds": { "nextEpisode": 200257858, "episodeSelector": 200257859 },
      "video": { "title": "A Different World", "type": "show", "id": 81747525, "unifiedEntityId": "Video:81747525", "currentEpisode": 82028220, "rating": "TV-14", "hiddenEpisodeNumbers": false,
        "seasons": { "length": 1, "first": "[object keys: year, shortName, longName, hiddenEpisodeNumbers, title, id, seq, episodes]" } }
    },
    "_seasons[0]._season": { "year": 2026, "shortName": "", "longName": "", "hiddenEpisodeNumbers": false, "title": "A Different World", "id": 81747526, "seq": 1,
      "episodes": { "length": 10, "first": "[object keys: synopsis, episodeId, liveEvent, taglineMessages, requiresAdultVerification, requiresPin, requiresPreReleasePin, creditsOffset, runtime, displayRuntime, watchedToEndOffset, autoplayable, title, id, bookmark, skipMarkers, hd, thumbs, stills, seq, hiddenEpisodeNumbers]" } }
  },
  "titleDom": { "children": [ { "tag": "H4", "text": "A Different World" }, { "tag": "SPAN", "text": "E1" }, { "tag": "SPAN", "text": "Irreconcilable Differences" } ], "documentTitle": "Netflix" },
  "fullscreen": { "element": { "tag": "DIV", "className": "watch-video", "dataUia": "watch-video" }, "containsSubtitles": true }
}
```

## Raw probe output (v1)

Track list trimmed to 3 of 39 entries; method list kept in full.

```json
{
  "url": "https://www.netflix.com/watch/82028220?trackId=284616272&tctx=…",
  "at": "2026-10-10T07:01:16.932Z",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  "subtitles": {
    "playerTimedtext": { "tag": "DIV", "id": null, "className": "player-timedtext" },
    "textContainer": { "tag": "DIV", "id": null, "className": "player-timedtext-text-container" },
    "currentText": "[\"Yes You Can\" by Young Thug playing]",
    "outerHTMLSample": "<div class=\"player-timedtext\" style=\"position: absolute; inset: 0px 10px; display: block; direction: ltr;\"><div class=\"player-timedtext-text-container\" style=\"display: block; white-space: nowrap; text-align: center; position: absolute; left: 27.1186%; bottom: 14.5318%;\"><span style=\"display: inline-block; text-align: center;\"><span style=\"font-size: 41px; line-height: normal; color: rgb(255, 255, 255); text-shadow: rgb(0, 0, 0) 0px 0px 7px; font-family: &quot;Netflix Sans&quot;, &quot;Helvetica Nueue&quot;, Helvetica, Arial, sans-serif; font-weight: bolder;\">[\"Yes You Can\" by Young Thug playing]</span></span></div></div>"
  },
  "player": {
    "sessionIds": ["watch-55980845-8cd8-42b9-ae60-e55aa880b8af"],
    "chosenSessionId": "watch-55980845-8cd8-42b9-ae60-e55aa880b8af",
    "methods": ["addEpisode", "addEventListener", "addToPostplayList", "applyCallbackToPromiseChain", "clearNextSegment", "close", "decorateEventHandler", "decoratedEventHandler", "engage", "generateScreenshots", "getAdManager", "getAdditionalLogInfo", "getAudioTrack", "getAudioTrackList", "getBufferedTime", "getBusy", "getChapters", "getCongestionInfo", "getCropAspectRatio", "getCurrentTime", "getDiagnostics", "getDuration", "getElement", "getEnded", "getError", "getInternalPlayer", "getLivePlaybackManager", "getManifestAltCastId", "getMaxRecommendedAudioIndex", "getMaxRecommendedTextIndex", "getMaxRecommendedTimedTextIndex", "getMovieId", "getMuted", "getPaused", "getPlaybackContextId", "getPlaybackRate", "getPlaygraphManager", "getPlaying", "getReady", "getSegmentTime", "getSessionSummary", "getTextTrack", "getTextTrackList", "getTimeCodes", "getTimedTextSettings", "getTimedTextTrack", "getTimedTextTrackList", "getTimedTextVisibility", "getTrickPlayFrame", "getVideoSize", "getVolume", "getXid", "goToNextSegment", "induceError", "isBackground", "isEnded", "isMuted", "isPaused", "isPlaying", "isReady", "isTimedTextVisible", "load", "loadCustomTimedTextTrack", "pause", "play", "playNextEpisode", "playSegment", "prepare", "queueSegment", "registerStreamingPlugin", "removeEventListener", "seek", "setAudioTrack", "setBackground", "setMuted", "setNextSegment", "setPlaybackRate", "setPostplayAtEnd", "setTextTrack", "setTimedTextBounds", "setTimedTextMargins", "setTimedTextSettings", "setTimedTextSize", "setTimedTextTrack", "setTimedTextVisibility", "setTimedTextVisible", "setTransitionTime", "setVolume", "skipAd", "skipAdBreak", "startInactivityMonitor", "transition", "tryRecoverFromStall", "updateNextSegmentWeights", "watchCredits"],
    "getCurrentTime": 251854,
    "videoElementCurrentTimeSeconds": 251.95404,
    "getDuration": 1802217,
    "videoElementDurationSeconds": 898.689458,
    "isPaused": false,
    "movieId": 82028220,
    "timedTextTrack": { "trackId": "T:2:1;1;en;0;0;0;0;", "bcp47": "en", "displayName": "English", "trackType": "ASSISTIVE", "rawTrackType": "CLOSEDCAPTIONS", "isNoneTrack": false, "isForcedNarrative": false, "isImageBased": false },
    "timedTextTrackList": [
      { "trackId": "T:2:0;1;en;1;1;0;0;", "bcp47": "en", "displayName": "Off", "trackType": "PRIMARY", "rawTrackType": "SUBTITLES", "isNoneTrack": false, "isForcedNarrative": true, "isImageBased": false },
      { "trackId": "T:2:0;1;en;0;0;3;0;", "bcp47": "en", "displayName": "English", "trackType": "PRIMARY", "rawTrackType": "SUBTITLES", "isNoneTrack": false, "isForcedNarrative": false, "isImageBased": false },
      { "trackId": "T:2:0;1;ko;0;0;0;0;", "bcp47": "ko", "displayName": "Korean", "trackType": "PRIMARY", "rawTrackType": "SUBTITLES", "isNoneTrack": false, "isForcedNarrative": false, "isImageBased": false }
    ]
  },
  "metadata": { "videoMetadataKeys": ["82028220"], "entryKeys": ["_metadataObject", "_video", "_seasons"], "video": null },
  "titleDom": { "videoTitle": "A Different WorldE1Irreconcilable Differences", "documentTitle": "Netflix" },
  "fullscreen": "not fullscreen — press F and run again"
}
```
