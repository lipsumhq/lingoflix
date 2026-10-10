# Netflix internals (verified)

LingoFlix depends on Netflix internals that can change without notice. Re-run
`scripts/netflix-probe.js` (instructions at the top of the file) and update this
table whenever something stops working.

Verified on: 2026-10-10 · Chrome 154 (macOS) · A Different World, E1 "Irreconcilable Differences" (`/watch/82028220`), English closed captions

| # | Item | LingoFlix assumes | Observed | OK? | Code that depends on it |
|---|------|-------------------|----------|-----|-------------------------|
| 1 | Subtitle layer | `.player-timedtext` contains the visible subtitle text | `div.player-timedtext` → `div.player-timedtext-text-container` → `span` → `span` (text). `innerText` = the visible line. | ✅ | `src/lib/netflix/selectors.ts` |
| 2 | Player API | `netflix.appContext.state.playerApp.getAPI().videoPlayer` → `getAllPlayerSessionIds()` (pick the id starting with `watch`) → `getVideoPlayerBySessionId(id)` with `seek(ms)`, `play()`, `pause()`, `getCurrentTime()` (ms), `getDuration()` (ms), `isPaused()` | Path and all six methods present. One session `watch-55980845-…`. `getCurrentTime()` = 251854 vs `<video>.currentTime` = 251.95 s → milliseconds. | ✅ | `src/lib/bridge/player.ts` |
| 3 | Text track download URLs | Verified in Plan 2 (needs the extension's `document_start` hook) | Plan 2 | — | Plan 2 |
| 4 | Title metadata | `playerApp.getState().videoPlayer.videoMetadata[videoId]._metadata.video` has series title, type, seasons → episodes | `videoMetadata` is keyed by the episode id, but the entry's keys are `_metadataObject`, `_video`, `_seasons` — no `_metadata`. Structure inside pending probe v2. DOM fallback `[data-uia="video-title"]` innerText = `A Different WorldE1Irreconcilable Differences` (series, `E1`, episode title, no separators). `document.title` is just `Netflix`. | ❌ path differs | Plan 2 |
| 5 | Key preemption | A capture-phase `window` keydown listener registered at `document_start` runs before Netflix's handlers | Plan 1 Task 5 | — | `src/entrypoints/netflix.content/keyboard.ts` |
| 6 | Fullscreen element | Some element that contains `.player-timedtext` | Pending probe v2 (fullscreen run) | — | Plan 2 overlay mount |
| 7 | `?t=` deep link | `/watch/{id}?t={seconds}` starts playback at that time | Pending | — | Plan 2 Study Log |

## Other findings (for Plan 2)

- **Player timeline ≠ `<video>` timeline.** `getDuration()` = 1 802 217 ms (30:02) while `<video>.duration` = 898.7 s (14:58). Netflix plays a segmented "playgraph" (the player also has `getAdManager`, `getSegmentTime`, `getPlaygraphManager`). Use only the player's own times for seeking, clamping, and cue timing; never `<video>` times.
- **Current subtitle track is exposed** by `getTimedTextTrack()`: `{ trackId, bcp47, displayName, trackType, rawTrackType, isNoneTrack, isForcedNarrative, isImageBased }`. `bcp47` gives the subtitle language for prompts; `isImageBased` drives the "subtitles can't be read" message (spec §9). `getTimedTextTrackList()` lists every track (this title: 39).
- **Closed captions** (`rawTrackType: "CLOSEDCAPTIONS"`) include sound descriptions, e.g. `["Yes You Can" by Young Thug playing]`. The explanation prompt should treat bracketed text as non-dialogue.
- The player also has `isTimedTextVisible()` / `setTimedTextVisible()`. LingoFlix keeps hiding subtitles with CSS instead, because the DOM must keep updating while hidden (spec §5.2).
- Watch URLs carry extra query params (`?trackId=…&tctx=…`); only the path identifies the video.
- `getMovieId()` returns the episode id as a number (`82028220`).

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
