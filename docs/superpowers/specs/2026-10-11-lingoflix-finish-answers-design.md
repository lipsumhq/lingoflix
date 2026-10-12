# LingoFlix: Answers Always Finish (design)

Date: 2026-10-11 · Status: approved in conversation, awaiting review of this document

## 1. Goal

An explanation or follow-up that has started is never stopped halfway: it finishes and is saved even after its card closes. Reopening a line whose answer is still being written joins that answer instead of paying for a second request. Saved answers are reused, as today.

**What the owner decided:**

- Answers keep going when the card closes ("let's not halt in the middle of the generation").
- Saved answers are kept forever, never deleted ("keep them forever, don't delete"). Storage doesn't change.
- Approach A: the background owns each answer, and a card that reopens the line joins it.
- Every card that opens costs a full answer: brushing across several lines no longer cancels the earlier ones.

This replaces the last sentence of the main spec's §6.3 ("Disconnecting the port aborts the request"): disconnecting now only stops that card from watching.

## 2. Today

- The card first asks the background for a saved answer to the line (`explanation:find`, keyed by video, explanation language and normalized line). If there is one, it shows it under "Explained before", with no API call.
- Otherwise it opens an `explain` Port and sends `start`. The background (`src/lib/ai/explain-service.ts`, `serveExplainPort`) streams the answer to that Port and saves it only if the stream completed **and** the Port is still connected. Closing the card disconnects the Port, which aborts the stream; nothing is saved, and the next open pays again.
- Regenerate appears only once an answer is done; Retry only after an error.

## 3. The background

### 3.1 Answers in progress

- The background keeps, in memory, one entry per line with an answer in progress. A line is identified exactly as saved answers are: video ID, explanation language and normalized line (the `explanationIndexKey` of `src/lib/study-log/store.ts`).
- An entry holds the text streamed so far, the cards (Ports) watching it, and its provider (for error copy). It is removed when the answer is saved or fails.
- Follow-ups are tracked for the keep-alive (§3.4) but are not joinable (§3.3).

### 3.2 Closing a card

- A Port that disconnects is removed from its entry's watchers. The stream is **not** aborted.
- When the stream completes with text, the answer is saved (explanations: `saveExplanation`; follow-ups: `appendFollowUp`), whether or not any card still watches. Watching cards then get `done` with the saved explanation and its saved keys, as today.

### 3.3 Joining

- A `start` for a line that has an entry joins it, whoever sent it (the same card reopened, another card, another tab). The joining Port gets one `delta` with the text so far (when not empty), every later `delta`, then the same `done` or `error` as the other watchers. The AI is called once.
- The joining request's other fields (story so far, card sections, context) are ignored: the answer in progress is for the same line.
- A `start` for a line with no entry starts a new answer, as today. That covers Regenerate and Retry: neither can appear while that card's answer is in progress, so they only join an answer some other card or tab started.
- Follow-ups are not joined. A follow-up still in progress when its card reopens is not shown; it appears, saved, the next time the card opens.

### 3.4 Keep-alive

- Chrome stops an extension's background after 30 s with no events or extension API calls. Today the deltas posted to the open card count as activity; with no card watching, a long answer could be cut off.
- While at least one answer or follow-up is in progress, the background calls `browser.runtime.getPlatformInfo()` every 25 s: Chrome's documented way to keep the background alive during a long operation. The timer starts when the first one begins and stops when the last one ends, so an idle background still sleeps.

## 4. Failures

- **Silence:** the existing 30 s idle limit (`AI_IDLE_TIMEOUT_MS`) now applies to the answer, not to one card: 30 s with no stream event aborts the stream. Nothing is saved; watching cards get `network` ("Couldn't reach Claude" or "Couldn't reach OpenAI", with Retry); the entry is removed.
- **Errors with no card watching** (out of credit, busy, rejected key, empty answer): nothing is saved and nothing is shown. The next open of that line requests again and shows the error then.
- **The background is restarted anyway** (a Chrome update or crash): the answer in progress is lost and the line is requested again next time. Watching cards get today's "Couldn't reach LingoFlix's background" with Retry.
- **No key, or a key that is neither Claude's nor OpenAI's:** `no-key` as today; no entry is created.

## 5. The card

- No visible change except that answers no longer stop. Closing the card still resumes the video.
- Reopening a line in progress: the card shows the text so far at once, then keeps streaming.
- Reopening a finished line: the saved answer appears instantly under "Explained before". Answers that finished after their card closed appear this way.
- Two Netflix tabs on the same episode share answers in progress (one background).
- No copy changes. Only the `protocol.ts` comment "disconnecting aborts it" changes, to say disconnecting stops watching.

## 6. Out of scope

- A limit on answers running at once. Each line opened gets its own answer; a rate limit from the provider shows as today on any card watching, or silently fails with none.
- Expiring saved answers (kept forever).
- Joining follow-ups in progress.
- Closing the tiny gap where an answer finishes between the card's `explanation:find` and its `start`: the card then starts a second request. Closing it would need a new message field; the gap is a few milliseconds.

## 7. Testing

Fake AI clients, fake Ports and fake timers only; no real API calls or keys.

- Closing the card mid-answer: the stream keeps going and the answer is saved; the disconnected Port gets nothing more.
- Reopening during an answer: the second Port gets the text so far, the later deltas and `done`; the AI client is called once.
- Two watchers: both get `done`, or both get the same `error`.
- An error with no watcher: nothing is saved, and a later `start` for the line starts a new answer.
- 30 s of silence: the stream is aborted, nothing is saved, watchers get `network`, and a later `start` starts afresh.
- Keep-alive: `getPlatformInfo` runs every 25 s while an answer or follow-up is in progress, and stops after the last one ends.
- A follow-up whose card closes still finishes and is appended.
- Existing tests that expect "the card closed: nothing is saved" or "disconnecting aborts" are updated to this behavior.

## 8. Rulings beyond what the owner said

1. Joining ignores the joining request's other fields (story, sections, context): it is the same line.
2. Follow-ups aren't joined (§3.3): rarer, and joining them would change what the card shows on open.
3. Errors with no card watching are silent (§4): there is nowhere to show them, and the next open shows them.
4. The finish-versus-start gap is accepted (§6).
5. The keep-alive call is `browser.runtime.getPlatformInfo()` every 25 s, per Chrome's service worker lifecycle guide.
6. No cap on answers running at once (§6).
