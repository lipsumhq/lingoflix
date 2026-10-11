# LingoFlix study reminders

Date: 2026-10-10 · Status: approved in conversation, pending written review
Builds on: `docs/superpowers/specs/2026-10-09-lingoflix-design.md` (the main spec) and
`docs/superpowers/specs/2026-10-10-lingoflix-study-log-v2-design.md` (Study Log v2, merged to `main`).
Where this document and those disagree, this document wins; §12 lists the sections it amends.

## 1. Summary

LingoFlix can remind the learner to study with Netflix. On the days and at the time they pick, a notification says
**Time to study** and offers to pick up the show they last watched. It is skipped on days they already watched with
LingoFlix on, so it never nags after they have practiced. Reminders are off by default; turning them on asks Chrome
for permission to show notifications, and turning them off gives that permission back.

LingoFlix will not get flashcards or other study modes. Learners study their saved items in the app they prefer
(Anki, Quizlet and others) through the Study Log exports.

## 2. Decisions (from the brainstorm, 2026-10-10)

| Topic | Decision |
|---|---|
| Flashcards | Dropped. Study happens in Anki, Quizlet or any other app, through the exports (v2 spec §7). This replaces "Flashcards get their own design next" in the v2 spec. |
| Kind of reminder | A watch nudge framed as studying: "Time to study". Not a "cards due" or "new items to export" reminder. |
| Schedule | A time and days of the week the learner picks (default: every day, 8:00 PM). |
| Skip rule | Skipped on days the learner already watched Netflix with LingoFlix on. |
| Click | Opens the Netflix page of the last show watched, or Netflix home. |
| Permission | `alarms` in the manifest (no install warning); `notifications` optional, requested when reminders are turned on and removed when turned off. |
| Where settings live | Per computer (`chrome.storage.local`), not synced: Chrome grants the notification permission per computer. |

## 3. Settings: the Reminders card

A new **Reminders** card (Lucide `Bell` icon) in Options → Settings, after the Explanations card.

- **Study reminders** toggle, off by default. Its visible state is "on" only when the stored setting is on **and**
  Chrome has granted the `notifications` permission (checked when the page opens and on
  `permissions.onAdded` / `onRemoved`).
  - **Turning it on** calls `permissions.request({ permissions: ['notifications'] })` directly in the click
    handler, before any `await` (Chrome requires a user gesture). Granted: store `enabled: true`. Declined: the
    toggle stays off and the card says "Chrome didn't allow notifications."
  - **Turning it off** stores `enabled: false`, then calls `permissions.remove({ permissions: ['notifications'] })`.
- **Time:** an `<input type="time">` (minute steps), default `20:00`, shown in the browser's 12/24-hour format.
- **Days:** seven toggle buttons, Sunday first, labelled `S M T W T F S` with accessible names "Sunday" to
  "Saturday" and `aria-pressed`. All on by default. The last one still on can't be turned off: its button gets
  `aria-disabled="true"` and the title "Pick at least one day", and clicks on it are ignored (not `disabled`, so
  focus stays on it).
- Time and Days stay editable while reminders are off, so the learner can set them up first.
- **Hint:** "Skipped on days you've already watched with LingoFlix on. Chrome needs to be running."
- **Send a test** (secondary button, enabled only while reminders are on): shows the reminder now through the
  background (§8), ignoring the skip rules. Afterwards the card says "Sent. Nothing showed up? Allow notifications
  for Google Chrome in your computer's settings."

## 4. The notification

| Field | Value |
|---|---|
| id | `study-reminder` (a new one replaces one still on screen) |
| type | `basic` |
| iconUrl | the extension's 128 px icon (`/icons/128.png`) |
| title | `Time to study` |
| message, with a last show | `Pick up {title} and learn a few new lines.` |
| message, without one | `Open Netflix and learn a few new lines.` |

**Clicking it** opens a new tab at `https://www.netflix.com/title/{id}` for the last show, or
`https://www.netflix.com/browse` when there is none, then clears the notification. The id is read from the activity
record (§5) at click time and used only if it is 1 to 20 digits; anything else opens Netflix home.

## 5. Knowing whether the learner watched today

**In the Netflix content script.** Once a minute (`ctx.setInterval`, 60 000 ms), when the page is a `/watch/` page and
LingoFlix is enabled, it asks the bridge for the player state. When the video is playing (`paused: false`), it builds
the show from `bridge.getTitle()`:

- an episode: `{ id: seriesId, title: seriesTitle }` (no show when `seriesId` is null);
- a movie: `{ id: videoId, title: seriesTitle }` (the movie title);
- no title info yet: no show.

It sends `activity:watched` (§8) when the pair (today's local date, show id or none) differs from the last pair it
sent successfully. That is at most one message per show per day, plus one when the title becomes known. A failed
send is retried on the next check.

**In the background.** On `activity:watched`, when reminders are on (`enabled: true`) and the `notifications`
permission is granted (the switch shows on, §3), it writes the activity record (§7): `lastWatchedOn` = today's
local date, and `show` = the message's show if it is valid (§8), otherwise the stored show is kept. Otherwise it
writes nothing, so nothing about viewing is recorded unless the learner turned reminders on. The record is deleted
when reminders are turned off or the permission is gone (setting the alarm, §6); writes and that delete run one at
a time, so a watch heard as reminders are turned off can't leave a record behind.

## 6. Scheduling and firing

**One alarm**, named `study-reminder`, created with `alarms.create(name, { when })` for the next reminder time.

**Next reminder time** (`nextReminderTime(from, time, days)`): the earliest local date and time strictly after
`from` whose weekday is in `days` and whose clock time is `time`. Built with the local `Date` constructor, so
daylight-saving changes are handled; a time that doesn't exist on a spring-forward day becomes the time Chrome's
`Date` normalizes it to.

**Setting the alarm** (`armReminder(from)`): when reminders are on and the permission is granted, create the alarm
at `nextReminderTime(from, …)`; otherwise clear it and delete the activity record (`local:activity`). It runs:

| When | `from` |
|---|---|
| `runtime.onInstalled` (install, update) | now |
| `runtime.onStartup` (Chrome starts) | now |
| The `reminders` key changes (`storage.onChanged`, area `local`) | now |
| `permissions.onAdded` / `onRemoved` | now |
| After the alarm fires | the later of now and the alarm's `scheduledTime` + 60 s (after days asleep, the next one is set from now, not a run of past-due alarms) |

It does not run on every service-worker start, so it never replaces an alarm that is waking the worker.

**When the alarm fires** (`alarms.onAlarm` with name `study-reminder`), the background reads the settings, the
permission and the activity record, decides with `shouldNotify` (below), shows the notification if so, then
re-arms. `shouldNotify` is false when:

1. reminders are off, or the `notifications` permission isn't granted;
2. the alarm fired more than 2 hours after its `scheduledTime` (the computer was asleep or busy);
3. `lastWatchedOn` equals the local date of the alarm's `scheduledTime` (already watched that day).

Otherwise it is true.

**The click listener** (`notifications.onClicked`) is registered at the top level of the background when
`browser.notifications` exists, and again from `permissions.onAdded` if it wasn't registered yet.

## 7. Permissions and storage

**Manifest:** `permissions` gains `alarms` (`storage`, `unlimitedStorage`, `alarms`); new
`optional_permissions: ["notifications"]`. Host permissions are unchanged. Opening a tab needs no permission.

| Key (`chrome.storage.local`) | Shape | Default |
|---|---|---|
| `reminders` | `{ enabled: boolean; time: string; days: number[] }` | `{ enabled: false, time: '20:00', days: [0, 1, 2, 3, 4, 5, 6] }` |
| `activity` | `{ lastWatchedOn: string \| null; show: { id: string; title: string } \| null }` | `{ lastWatchedOn: null, show: null }` |

- Both are read through one typed module (`src/lib/reminders/`) that fills defaults: `time` must match
  `^([01]\d|2[0-3]):[0-5]\d$` (else `'20:00'`); `days` keeps unique integers 0 to 6, sorted (empty or invalid:
  every day); `lastWatchedOn` must be `YYYY-MM-DD` (else null); `show` must pass the §8 checks (else null).
  Unknown fields are kept on write, as with settings.
- Neither key is part of the Study Log: **Reset all**, export and backup leave them alone.
- The options page writes `reminders`; the background is the only writer of `activity`.
- `activity` is kept only while reminders are on: it is deleted when they are turned off or the permission is gone
  (setting the alarm, §6).

## 8. Messages

New `BackgroundRequests` entries:

| Type | Request | Response | Who may send |
|---|---|---|---|
| `activity:watched` | `{ show: { id: string; title: string } \| null }` | `{ ok: true }` | Netflix content script |
| `reminder:test` | `{}` | `{ ok: boolean }` (false without the permission) | extension pages only (`fromExtensionPage`) |

`show` is valid only when `id` matches `^\d{1,20}$` and `title`, trimmed, is 1 to 200 characters. An invalid show is
treated as none; it never fails the request. `reminder:test` shows the same notification as §4, built from the
current activity record.

## 9. Errors

| Situation | Behavior |
|---|---|
| Learner declines Chrome's prompt | Toggle stays off; "Chrome didn't allow notifications." |
| Permission removed later (chrome://extensions) | Card shows reminders off; the alarm is cleared (`permissions.onRemoved`), and `shouldNotify` checks again when it fires |
| The OS blocks Chrome's notifications | Undetectable; **Send a test** and its hint cover it |
| Chrome closed at reminder time | That reminder is missed; on start the next one is set from now |
| Alarm more than 2 hours late | Skipped |
| No show recorded yet | Generic message; click opens Netflix home |
| Stored show id not 1 to 20 digits | Ignored; click opens Netflix home |
| `activity:watched` fails | Retried next minute; worst case one extra nudge that day |
| `notifications.create` fails | Logged with `console.warn`; the alarm is still re-armed |

## 10. Testing

Unit tests (Vitest), each written to fail first:

- **`nextReminderTime`:** later today; a future day; only some weekdays chosen; `from` exactly at the time (next
  occurrence, not now); across a daylight-saving change (run under a fixed `TZ`, e.g. `America/New_York`).
- **`shouldNotify`:** off; no permission; more than 2 hours late (and exactly 2 hours: still shown); watched on
  the scheduled date; watched the day before; a late alarm just after midnight uses the scheduled date.
- **Notification content:** message with and without a show; click URL for a valid id; invalid id falls back to
  Netflix home.
- **Storage module:** defaults; invalid time, days, date and show normalized; unknown fields kept.
- **`activity:watched`:** writes today's local date and a valid show; keeps the stored show when the message has
  none or an invalid one; writes nothing when reminders are off.
- **Content-script tracker:** sends only while on a watch page, enabled and playing; once per (date, show); again
  when the title becomes known; retries after a failed send; nothing while paused.
- **Reminders card:** turning on requests the permission and stores `enabled: true`; declining keeps it off with
  the message; turning off stores `false` and removes the permission; the last day can't be turned off; Send a
  test sends `reminder:test` and shows the hint; shows off when the setting is on but the permission is missing.
- **Background wiring:** `armReminder` on install, startup, settings change and permission change; re-arm after
  firing from the later of now and `scheduledTime` + 60 s; cleared when off; click opens the right URL and clears the notification;
  `reminder:test` rejected from a content script.

Live checklist:

1. Turn reminders on and accept Chrome's prompt.
2. Set the time 2 minutes ahead; the notification appears.
3. Click it; your last show's Netflix page opens.
4. Play an episode for over a minute, set the time 2 minutes ahead again; nothing appears.
5. Send a test; the notification appears.
6. Turn reminders off; chrome://extensions no longer lists notifications for LingoFlix.

## 11. Out of scope

Flashcards and other in-extension study modes (dropped, §2), spaced repetition, synced reminder settings, more than
one reminder time per day, snooze or buttons on the notification, reminders about anything other than studying with
Netflix, the Stripe subscription. Export follow-ups ("Export new items only", "Copy for Quizlet") are proposed for
the release plan (Plan 3b), not this one.

## 12. Sections this amends

- Main spec §5.8 (options page): the Settings tab gains the Reminders card (§3).
- Main spec §6.2 (components): the background also owns the reminder alarm and notification (§6).
- Main spec §6.3 (messaging): `activity:watched` and `reminder:test` (§8).
- Main spec §6.4 (storage): `local:reminders` and `local:activity` (§7).
- Main spec §10 (privacy and permissions): `alarms`, optional `notifications`; while reminders are on, the date the
  learner last watched and that show's id and title are stored on this computer only, and deleted when reminders
  are turned off. The hosted privacy policy (Plan 3b) must say so.
- v2 spec §2 and §11: flashcards are dropped, not next (§2 here).
