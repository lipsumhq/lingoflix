# LingoFlix Study Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the days and at the time the learner picks, a Chrome notification says "Time to study" and offers the show they last watched, skipped on days they already watched with LingoFlix on.

**Architecture:** Pure scheduling math (`schedule.ts`) and a storage module (`store.ts`) under `src/lib/reminders/`. The background worker installs one reminder service that keeps a single `study-reminder` alarm set to the next reminder, shows the notification when it fires, and opens Netflix on click. The Netflix content script tells the background once per show per day that a video is playing. The options page gets a Reminders card that asks Chrome for the optional `notifications` permission when turned on.

**Tech Stack:** WXT 0.21.4 (MV3), React 19.3, TypeScript 6.0.3 strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Tailwind 4.3.3, Vitest 5 with `wxt/testing/fake-browser` and happy-dom + Testing Library, lucide-react 1.48.0, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-10-lingoflix-study-reminders-design.md` (builds on `docs/superpowers/specs/2026-10-09-lingoflix-design.md` and `docs/superpowers/specs/2026-10-10-lingoflix-study-log-v2-design.md`).

## Global Constraints

- New permissions are exactly: `alarms` in `permissions`, and `optional_permissions: ["notifications"]`. Host permissions stay `https://www.netflix.com/*` and `https://api.anthropic.com/*`. No other permission is added.
- Storage keys (WXT names): `local:reminders` (`{ enabled: boolean; time: string; days: number[] }`, default `{ enabled: false, time: '20:00', days: [0, 1, 2, 3, 4, 5, 6] }`) and `local:activity` (`{ lastWatchedOn: string | null; show: { id: string; title: string } | null }`). Neither is touched by Study Log Reset all, export or backup.
- Alarm name and notification id: `study-reminder`.
- A show is valid only when `id` matches `^\d{1,20}$` and `title`, trimmed, is 1 to 200 characters. Anything else is "no show".
- Notification: `type: 'basic'`, icon `/icons/128.png`, title `Time to study`, message `Pick up {title} and learn a few new lines.` or `Open Netflix and learn a few new lines.`
- Click URLs: `https://www.netflix.com/title/{id}` or `https://www.netflix.com/browse`.
- Skip rules: off or no permission; more than 2 hours late (`> 2 h`, exactly 2 h still shows); `lastWatchedOn` equals the local date of the alarm's `scheduledTime`.
- After the alarm fires, the next one is set from the later of now and `scheduledTime` + 60 s.
- Settings card copy, verbatim: heading `Reminders` with the line `A nudge to keep studying with Netflix.`; toggle `Study reminders` with description `Skipped on days you've already watched with LingoFlix on. Chrome needs to be running.`; `Time`; `Days` with buttons `S M T W T F S` named `Sunday` to `Saturday`; `Pick at least one day`; button `Send a test`; notices `Chrome didn't allow notifications.`, `Sent. Nothing showed up? Allow notifications for Google Chrome in your computer's settings.`, `Couldn't send a test reminder.`
- No em dashes in user-facing copy, comments or commit messages (use a colon instead).
- The API key rules are unchanged: nothing in this plan reads, logs or sends the key.
- Tests live in `tests/unit/*.test.ts(x)`; DOM tests start with `// @vitest-environment happy-dom`. `fakeBrowser.reset()` in `beforeEach`. Write each test first and watch it fail.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `pnpm test` (all unit tests), `pnpm vitest run <file>` (one file), `pnpm compile` (tsc), `pnpm build`.

## Review Focus

1. A computer asleep for days: the late alarm is skipped and the next one is set in the future from now, not a run of past-due alarms that fire one after another. (Task 3: "slept for days" test.)
2. Quick setting changes (a time typed field by field, days tapped quickly): the alarm ends at what the last settings call for. (Task 3: "quick changes" test.)
3. The time field mid-edit (an incomplete time reads as `''`): nothing invalid is stored and the field doesn't snap back under the learner's fingers. (Task 6: "incomplete time" test.)
4. Clicking a test reminder behaves exactly like a real one, and clicks on any other notification are ignored. (Task 3: "click" test.)
5. Watching across midnight records the new day, so the next evening's skip rule is right. (Task 5: "midnight" test.)

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/reminders/schedule.ts` (new) | Pure: `nextReminderTime`, `shouldNotify`, `localDate`, constants |
| `src/lib/reminders/store.ts` (new) | `local:reminders` and `local:activity`: types, normalizing, load/update/watch, `recordWatched` |
| `src/lib/reminders/notification.ts` (new) | Notification id, title, message, click URL |
| `src/lib/reminders/permission.ts` (new) | The optional `notifications` permission, never throwing |
| `src/lib/reminders/service.ts` (new) | Background: the alarm, firing, the notification and its click |
| `src/entrypoints/background.ts` | Installs the service; message handler deps |
| `wxt.config.ts` | `alarms`, `optional_permissions` |
| `src/lib/messages.ts`, `src/lib/background/message-handler.ts` | `activity:watched`, `reminder:test` |
| `src/entrypoints/netflix.content/watch-tracker.ts` (new), `index.ts` | Once-a-minute "is it playing" check |
| `src/entrypoints/options/RemindersCard.tsx` (new), `SettingsTab.tsx` | The Reminders card |
| `README.md`, main spec, v2 spec | Docs |

---

### Task 1: Reminder schedule math

**Files:**
- Create: `src/lib/reminders/schedule.ts`
- Test: `tests/unit/reminders-schedule.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LATE_LIMIT_MS: number` (2 hours), `ALL_DAYS: readonly number[]`, `DEFAULT_TIME = '20:00'`, `TIME_PATTERN: RegExp`
  - `localDate(ms: number): string` (`YYYY-MM-DD`, local)
  - `nextReminderTime(from: number, time: string, days: readonly number[]): number`
  - `interface ReminderCheck { now: number; scheduledTime: number; enabled: boolean; granted: boolean; lastWatchedOn: string | null }`
  - `shouldNotify(check: ReminderCheck): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reminders-schedule.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LATE_LIMIT_MS, localDate, nextReminderTime, shouldNotify } from '@/lib/reminders/schedule';

// Local-time math: pin a zone whose 2026 daylight-saving dates are known (starts Mar 8, ends Nov 1).
let previousTz: string | undefined;
beforeAll(() => {
  previousTz = process.env.TZ;
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const HOUR = 60 * 60 * 1000;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
/** Local time; months are 1-based here. 2026-10-14 is a Wednesday. */
const at = (month: number, day: number, hours = 0, minutes = 0) => new Date(2026, month - 1, day, hours, minutes).getTime();

describe('nextReminderTime', () => {
  it('is later today when the time has not come yet', () => {
    expect(nextReminderTime(at(10, 14, 9), '20:00', EVERY_DAY)).toBe(at(10, 14, 20));
  });

  it("is tomorrow once today's time has passed", () => {
    expect(nextReminderTime(at(10, 14, 21), '20:00', EVERY_DAY)).toBe(at(10, 15, 20));
  });

  it('never returns the starting moment itself', () => {
    expect(nextReminderTime(at(10, 14, 20), '20:00', EVERY_DAY)).toBe(at(10, 15, 20));
  });

  it('skips the days that are not chosen', () => {
    // Monday (1) and Saturday (6) only: from Wednesday morning, Saturday comes first.
    expect(nextReminderTime(at(10, 14, 9), '07:30', [1, 6])).toBe(at(10, 17, 7, 30));
  });

  it("waits a week when only today is chosen and today's time has passed", () => {
    expect(nextReminderTime(at(10, 14, 21), '20:00', [3])).toBe(at(10, 21, 20));
  });

  it('keeps the clock time across a daylight-saving change', () => {
    const from = at(3, 7, 21); // Saturday 9 PM, the night clocks go forward
    const next = nextReminderTime(from, '20:00', EVERY_DAY);
    expect(next).toBe(at(3, 8, 20));
    expect(new Date(next).getHours()).toBe(20);
    expect(next - from).toBe(22 * HOUR); // a fixed 24-hour repeat would land at 9 PM
  });

  it('a time that spring-forward skips lands just after the change', () => {
    expect(new Date(nextReminderTime(at(3, 8, 0), '02:30', EVERY_DAY)).getHours()).toBe(3);
  });

  it('falls back to 8:00 PM on every day for a bad time or no valid day', () => {
    expect(nextReminderTime(at(10, 14, 9), '25:00', EVERY_DAY)).toBe(at(10, 14, 20));
    expect(nextReminderTime(at(10, 14, 9), '20:00', [9])).toBe(at(10, 14, 20));
    expect(nextReminderTime(at(10, 14, 9), '20:00', [])).toBe(at(10, 14, 20));
  });
});

describe('shouldNotify', () => {
  const scheduledTime = at(10, 14, 20);
  const onTime = { now: scheduledTime + 500, scheduledTime, enabled: true, granted: true, lastWatchedOn: null };

  it('shows the reminder when nothing stops it', () => {
    expect(shouldNotify(onTime)).toBe(true);
  });

  it('not when reminders are off or the permission is gone', () => {
    expect(shouldNotify({ ...onTime, enabled: false })).toBe(false);
    expect(shouldNotify({ ...onTime, granted: false })).toBe(false);
  });

  it('not more than 2 hours late; exactly 2 hours late still shows', () => {
    expect(LATE_LIMIT_MS).toBe(2 * HOUR);
    expect(shouldNotify({ ...onTime, now: scheduledTime + LATE_LIMIT_MS })).toBe(true);
    expect(shouldNotify({ ...onTime, now: scheduledTime + LATE_LIMIT_MS + 1 })).toBe(false);
  });

  it('not on a day already watched; watching the day before does not count', () => {
    expect(shouldNotify({ ...onTime, lastWatchedOn: '2026-10-14' })).toBe(false);
    expect(shouldNotify({ ...onTime, lastWatchedOn: '2026-10-13' })).toBe(true);
  });

  it('a late alarm just after midnight checks the day it was set for', () => {
    const lateNight = at(10, 14, 23, 30);
    const fired = { ...onTime, scheduledTime: lateNight, now: lateNight + 40 * 60_000 }; // 12:10 AM on the 15th
    expect(shouldNotify({ ...fired, lastWatchedOn: '2026-10-14' })).toBe(false);
    expect(shouldNotify({ ...fired, lastWatchedOn: '2026-10-15' })).toBe(true);
  });
});

describe('localDate', () => {
  it('is the local calendar date, zero-padded', () => {
    expect(localDate(at(3, 8, 23, 59))).toBe('2026-03-08');
    expect(localDate(at(10, 14, 0, 0))).toBe('2026-10-14');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/reminders-schedule.test.ts`
Expected: FAIL: cannot resolve `@/lib/reminders/schedule`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/reminders/schedule.ts`:

```ts
/** Study reminders (reminders spec §6): when the next one is due and whether to show it. Pure: no Chrome APIs. */

/** An alarm that fires later than this after its time is skipped (the computer was asleep or busy). */
export const LATE_LIMIT_MS = 2 * 60 * 60 * 1000;
export const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const DEFAULT_TIME = '20:00';
/** `HH:MM`, 24-hour. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar date of `ms`, as `YYYY-MM-DD`. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The earliest local date and time strictly after `from` that falls on one of `days` (0 = Sunday) at `time`.
 * Built with the local Date constructor, so a daylight-saving change keeps the clock time; a time the change
 * skips becomes the time Date normalizes it to. A bad time means 8:00 PM; no valid day means every day.
 */
export function nextReminderTime(from: number, time: string, days: readonly number[]): number {
  const [hours, minutes] = (TIME_PATTERN.test(time) ? time : DEFAULT_TIME).split(':').map(Number) as [number, number];
  const allowed = days.some((day) => ALL_DAYS.includes(day)) ? days : ALL_DAYS;
  const start = new Date(from);
  // Every weekday comes up within 8 consecutive dates (today through a week from today).
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, hours, minutes);
    if (candidate.getTime() > from && allowed.includes(candidate.getDay())) return candidate.getTime();
  }
  throw new Error('No reminder day within a week');
}

export interface ReminderCheck {
  now: number;
  /** When the alarm was set to fire. */
  scheduledTime: number;
  enabled: boolean;
  /** Chrome has granted the `notifications` permission. */
  granted: boolean;
  /** `YYYY-MM-DD`, local. */
  lastWatchedOn: string | null;
}

/** Reminders spec §6: show it unless reminders are off, it is more than 2 hours late, or that day was watched. */
export function shouldNotify(check: ReminderCheck): boolean {
  if (!check.enabled || !check.granted) return false;
  if (check.now - check.scheduledTime > LATE_LIMIT_MS) return false;
  return check.lastWatchedOn !== localDate(check.scheduledTime);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/reminders-schedule.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders/schedule.ts tests/unit/reminders-schedule.test.ts
git commit -m "feat(reminders): next reminder time and skip rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Reminder settings, watch activity and notification content

**Files:**
- Create: `src/lib/reminders/store.ts`, `src/lib/reminders/notification.ts`
- Test: `tests/unit/reminders-store.test.ts`

**Interfaces:**
- Consumes (Task 1): `ALL_DAYS`, `DEFAULT_TIME`, `TIME_PATTERN`, `localDate(ms)`.
- Produces (`store.ts`):
  - `interface Show { id: string; title: string }`
  - `interface Reminders { enabled: boolean; time: string; days: number[] }`
  - `interface Activity { lastWatchedOn: string | null; show: Show | null }`
  - `DEFAULT_REMINDERS: Reminders`
  - `parseShow(value: unknown): Show | null`
  - `normalizeReminders(raw: unknown): Reminders`, `normalizeActivity(raw: unknown): Activity`
  - `loadReminders(): Promise<Reminders>`
  - `updateReminders(update: (current: Reminders) => Reminders): Promise<Reminders>` (queued)
  - `watchReminders(callback: (reminders: Reminders) => void): () => void`
  - `loadActivity(): Promise<Activity>`
  - `recordWatched(show: unknown, now?: number): Promise<void>`
- Produces (`notification.ts`):
  - `REMINDER_ID = 'study-reminder'`, `REMINDER_TITLE = 'Time to study'`
  - `reminderMessage(show: Show | null): string`
  - `reminderUrl(show: Show | null): string`
  - `reminderNotification(show: Show | null, iconUrl: string): { type: 'basic'; iconUrl: string; title: string; message: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reminders-store.test.ts`:

```ts
import { storage } from '#imports';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { REMINDER_ID, REMINDER_TITLE, reminderMessage, reminderNotification, reminderUrl } from '@/lib/reminders/notification';
import {
  DEFAULT_REMINDERS,
  loadActivity,
  loadReminders,
  normalizeActivity,
  normalizeReminders,
  parseShow,
  recordWatched,
  updateReminders,
  watchReminders,
} from '@/lib/reminders/store';

beforeEach(() => fakeBrowser.reset());

const SHOW = { id: '80057281', title: 'Stranger Things' };
const EVENING = new Date(2026, 9, 14, 21, 0).getTime(); // local: Wednesday 2026-10-14, 9 PM

describe('reminder settings', () => {
  it('are off, at 8:00 PM every day, until changed', async () => {
    expect(DEFAULT_REMINDERS).toEqual({ enabled: false, time: '20:00', days: [0, 1, 2, 3, 4, 5, 6] });
    expect(await loadReminders()).toEqual(DEFAULT_REMINDERS);
  });

  it('read bad values as defaults: the time, unknown or repeated days, no days', () => {
    expect(normalizeReminders({ enabled: 'yes', time: '8pm', days: [3, 3, 9, -1, '1', 1.5, 0] })).toEqual({
      enabled: false,
      time: '20:00',
      days: [0, 3],
    });
    expect(normalizeReminders({ enabled: true, time: '07:05', days: [] })).toEqual({
      enabled: true,
      time: '07:05',
      days: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(normalizeReminders({ time: '24:00' }).time).toBe('20:00');
    expect(normalizeReminders(null)).toEqual(DEFAULT_REMINDERS);
  });

  it('a change keeps fields a newer version stored', async () => {
    await storage.setItem('local:reminders', { enabled: false, time: '20:00', days: [1], snoozeMinutes: 10 });
    await updateReminders((r) => ({ ...r, enabled: true }));
    expect(await storage.getItem('local:reminders')).toEqual({ enabled: true, time: '20:00', days: [1], snoozeMinutes: 10 });
  });

  it('two changes made at once both apply', async () => {
    await Promise.all([updateReminders((r) => ({ ...r, time: '07:00' })), updateReminders((r) => ({ ...r, days: [1, 2] }))]);
    expect(await loadReminders()).toEqual({ enabled: false, time: '07:00', days: [1, 2] });
  });

  it('watchers get the new settings, already checked', async () => {
    const seen = vi.fn();
    const unwatch = watchReminders(seen);
    await storage.setItem('local:reminders', { enabled: true, time: 'soon', days: [5] });
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith({ enabled: true, time: '20:00', days: [5] }));
    unwatch();
  });
});

describe('the show', () => {
  it('needs a digits-only id and a title of 1 to 200 characters (trimmed)', () => {
    expect(parseShow({ id: '80057281', title: '  Stranger Things ' })).toEqual(SHOW);
    expect(parseShow({ id: '8005728a', title: 'x' })).toBeNull();
    expect(parseShow({ id: '1'.repeat(21), title: 'x' })).toBeNull();
    expect(parseShow({ id: '', title: 'x' })).toBeNull();
    expect(parseShow({ id: '1', title: '   ' })).toBeNull();
    expect(parseShow({ id: '1', title: 'x'.repeat(200) })?.title).toHaveLength(200);
    expect(parseShow({ id: '1', title: 'x'.repeat(201) })).toBeNull();
    expect(parseShow({ id: 80057281, title: 'x' })).toBeNull();
    expect(parseShow('80057281')).toBeNull();
  });
});

describe('watch activity', () => {
  it('is empty at first, and bad stored values read as empty', async () => {
    expect(await loadActivity()).toEqual({ lastWatchedOn: null, show: null });
    expect(normalizeActivity({ lastWatchedOn: '2026-1-5', show: { id: 'x', title: 'y' } })).toEqual({
      lastWatchedOn: null,
      show: null,
    });
  });

  it('records nothing while reminders are off', async () => {
    await recordWatched(SHOW, EVENING);
    expect(await storage.getItem('local:activity')).toBeNull();
  });

  it("records today's local date and the show while reminders are on", async () => {
    await updateReminders((r) => ({ ...r, enabled: true }));
    await recordWatched(SHOW, EVENING);
    expect(await loadActivity()).toEqual({ lastWatchedOn: '2026-10-14', show: SHOW });
  });

  it('keeps the stored show when the page sends none or a bad one, and keeps unknown fields', async () => {
    await updateReminders((r) => ({ ...r, enabled: true }));
    await storage.setItem('local:activity', { lastWatchedOn: '2026-10-13', show: SHOW, streak: 3 });
    await recordWatched(null, EVENING);
    await recordWatched({ id: '1; javascript:alert(1)', title: 'Bad' }, EVENING);
    expect(await storage.getItem('local:activity')).toEqual({ lastWatchedOn: '2026-10-14', show: SHOW, streak: 3 });
  });
});

describe('the notification', () => {
  it('offers the last show, or Netflix itself', () => {
    expect(REMINDER_ID).toBe('study-reminder');
    expect(REMINDER_TITLE).toBe('Time to study');
    expect(reminderMessage(SHOW)).toBe('Pick up Stranger Things and learn a few new lines.');
    expect(reminderMessage(null)).toBe('Open Netflix and learn a few new lines.');
    expect(reminderNotification(SHOW, 'chrome-extension://id/icons/128.png')).toEqual({
      type: 'basic',
      iconUrl: 'chrome-extension://id/icons/128.png',
      title: 'Time to study',
      message: 'Pick up Stranger Things and learn a few new lines.',
    });
  });

  it("opens the show's Netflix page only for a digits-only id", () => {
    expect(reminderUrl(SHOW)).toBe('https://www.netflix.com/title/80057281');
    expect(reminderUrl(null)).toBe('https://www.netflix.com/browse');
    expect(reminderUrl({ id: '80057281/../../evil', title: 'x' })).toBe('https://www.netflix.com/browse');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/reminders-store.test.ts`
Expected: FAIL: cannot resolve `@/lib/reminders/notification`.

- [ ] **Step 3: Write `store.ts`**

Create `src/lib/reminders/store.ts`:

```ts
import { storage } from '#imports';
import { ALL_DAYS, DEFAULT_TIME, TIME_PATTERN, localDate } from './schedule';

/** The show to pick up (reminders spec §5, §8). `id` is Netflix's: digits only, since it goes into a URL. */
export interface Show {
  id: string;
  title: string;
}

/** Reminder settings, kept per computer (reminders spec §7). `days`: 0 = Sunday … 6 = Saturday. */
export interface Reminders {
  enabled: boolean;
  /** `HH:MM`, 24-hour, local. */
  time: string;
  days: number[];
}

/** What the background knows about the learner's watching (reminders spec §5, §7). */
export interface Activity {
  /** `YYYY-MM-DD`, local. */
  lastWatchedOn: string | null;
  show: Show | null;
}

export const DEFAULT_REMINDERS: Reminders = { enabled: false, time: DEFAULT_TIME, days: [...ALL_DAYS] };

const REMINDERS_KEY = 'local:reminders';
const ACTIVITY_KEY = 'local:activity';
const SHOW_ID = /^\d{1,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_MAX = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Writes keep the fields a newer LingoFlix version stored, as settings do. */
const keepUnknown = (stored: unknown, next: object): Record<string, unknown> => ({ ...(isRecord(stored) ? stored : {}), ...next });

/** A show from a message or from storage; anything else is no show. */
export function parseShow(value: unknown): Show | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') return null;
  const title = value.title.trim();
  if (!SHOW_ID.test(value.id) || title.length === 0 || title.length > TITLE_MAX) return null;
  return { id: value.id, title };
}

export function normalizeReminders(raw: unknown): Reminders {
  const r = isRecord(raw) ? raw : {};
  const stored: unknown[] = Array.isArray(r.days) ? r.days : [];
  const days = ALL_DAYS.filter((day) => stored.includes(day));
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_REMINDERS.enabled,
    time: typeof r.time === 'string' && TIME_PATTERN.test(r.time) ? r.time : DEFAULT_REMINDERS.time,
    days: days.length > 0 ? days : [...ALL_DAYS],
  };
}

export function normalizeActivity(raw: unknown): Activity {
  const r = isRecord(raw) ? raw : {};
  return {
    lastWatchedOn: typeof r.lastWatchedOn === 'string' && DATE.test(r.lastWatchedOn) ? r.lastWatchedOn : null,
    show: parseShow(r.show),
  };
}

export async function loadReminders(): Promise<Reminders> {
  return normalizeReminders(await storage.getItem(REMINDERS_KEY));
}

/** Changes run one at a time, so two quick edits can't both read the old value and drop one. */
let reminderWrites: Promise<unknown> = Promise.resolve();

export function updateReminders(update: (current: Reminders) => Reminders): Promise<Reminders> {
  const run = reminderWrites.then(async () => {
    const stored = await storage.getItem(REMINDERS_KEY);
    const next = normalizeReminders(update(normalizeReminders(stored)));
    await storage.setItem(REMINDERS_KEY, keepUnknown(stored, next));
    return next;
  });
  reminderWrites = run.catch(() => undefined);
  return run;
}

export function watchReminders(callback: (reminders: Reminders) => void): () => void {
  return storage.watch(REMINDERS_KEY, (value) => callback(normalizeReminders(value)));
}

export async function loadActivity(): Promise<Activity> {
  return normalizeActivity(await storage.getItem(ACTIVITY_KEY));
}

/**
 * Reminders spec §5: a video is playing on Netflix now. Records today's local date and the show, but only while
 * reminders are on, so nothing about viewing is kept unless the learner asked for reminders. A missing or invalid
 * show keeps the stored one.
 */
export async function recordWatched(show: unknown, now: number = Date.now()): Promise<void> {
  if (!(await loadReminders()).enabled) return;
  const stored = await storage.getItem(ACTIVITY_KEY);
  const next: Activity = { lastWatchedOn: localDate(now), show: parseShow(show) ?? normalizeActivity(stored).show };
  await storage.setItem(ACTIVITY_KEY, keepUnknown(stored, next));
}
```

- [ ] **Step 4: Write `notification.ts`**

Create `src/lib/reminders/notification.ts`:

```ts
import { parseShow, type Show } from './store';

/** Reminders spec §4. A new reminder with this id replaces one still on screen. */
export const REMINDER_ID = 'study-reminder';
export const REMINDER_TITLE = 'Time to study';
const NETFLIX_HOME = 'https://www.netflix.com/browse';

export function reminderMessage(show: Show | null): string {
  return show ? `Pick up ${show.title} and learn a few new lines.` : 'Open Netflix and learn a few new lines.';
}

/** The show's Netflix page. The id came from the Netflix page, so it is checked again here (digits only). */
export function reminderUrl(show: Show | null): string {
  const valid = parseShow(show);
  return valid ? `https://www.netflix.com/title/${valid.id}` : NETFLIX_HOME;
}

export function reminderNotification(
  show: Show | null,
  iconUrl: string,
): { type: 'basic'; iconUrl: string; title: string; message: string } {
  return { type: 'basic', iconUrl, title: REMINDER_TITLE, message: reminderMessage(show) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/reminders-store.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/reminders/store.ts src/lib/reminders/notification.ts tests/unit/reminders-store.test.ts
git commit -m "feat(reminders): reminder settings, watch activity and notification text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Background reminder service, permission and manifest

**Files:**
- Create: `src/lib/reminders/permission.ts`, `src/lib/reminders/service.ts`
- Modify: `src/entrypoints/background.ts`, `wxt.config.ts`
- Test: `tests/unit/reminders-service.test.ts`

**Interfaces:**
- Consumes (Task 1): `nextReminderTime`, `shouldNotify`. (Task 2): `loadReminders`, `loadActivity`, `watchReminders`, `REMINDER_ID`, `reminderNotification`, `reminderUrl`.
- Produces (`permission.ts`):
  - `interface NotificationPermission { has(): Promise<boolean>; request(): Promise<boolean>; remove(): Promise<void>; onChange(callback: (granted: boolean) => void): () => void }`
  - `notificationPermission: NotificationPermission` (real Chrome, never throws)
- Produces (`service.ts`):
  - `REMINDER_ALARM = 'study-reminder'`
  - `interface ReminderBrowser`, `interface ReminderNotifications` (structural subsets of `browser`)
  - `interface ReminderDeps { browser: ReminderBrowser; notifications(): ReminderNotifications | undefined; permission: NotificationPermission; now(): number }`
  - `installReminders(deps: ReminderDeps): { test(): Promise<boolean> }`

`fakeBrowser` implements `alarms`, `notifications`, `tabs` and the `runtime.onInstalled` / `onStartup` events, but not `permissions` (calling it throws "not implemented"). That is why the permission is injected, and why `notificationPermission` catches every throw.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reminders-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { REMINDER_ID } from '@/lib/reminders/notification';
import type { NotificationPermission } from '@/lib/reminders/permission';
import { REMINDER_ALARM, installReminders } from '@/lib/reminders/service';
import { recordWatched, updateReminders, type Reminders } from '@/lib/reminders/store';

beforeEach(() => fakeBrowser.reset());

/** Local time in October 2026; the 14th is a Wednesday. */
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();
const SHOW = { id: '80057281', title: 'Stranger Things' };

function fakePermission(initiallyGranted: boolean) {
  let granted = initiallyGranted;
  const listeners: ((granted: boolean) => void)[] = [];
  const permission: NotificationPermission = {
    has: async () => granted,
    request: async () => granted,
    remove: async () => {
      granted = false;
    },
    onChange: (callback) => {
      listeners.push(callback);
      return () => {};
    },
  };
  const change = (next: boolean) => {
    granted = next;
    for (const listener of listeners) listener(next);
  };
  return { permission, change };
}

function setup({ granted = true, notifications = true, now = at(14, 9) } = {}) {
  const { permission, change } = fakePermission(granted);
  const clock = { now };
  let available = notifications;
  const service = installReminders({
    browser: fakeBrowser,
    notifications: () => (available ? fakeBrowser.notifications : undefined),
    permission,
    now: () => clock.now,
  });
  const grantNotifications = () => {
    available = true;
    change(true);
  };
  return { service, clock, change, grantNotifications };
}

const turnOn = (over: Partial<Reminders> = {}) => updateReminders((r) => ({ ...r, enabled: true, ...over }));
const scheduled = async () => (await fakeBrowser.alarms.get(REMINDER_ALARM))?.scheduledTime;
const fire = (scheduledTime: number) =>
  fakeBrowser.alarms.onAlarm.trigger({ name: REMINDER_ALARM, scheduledTime, persistAcrossSessions: false });
const shown = async () => Object.keys(await fakeBrowser.notifications.getAll());
const openedUrls = async () => (await fakeBrowser.tabs.query({})).map((tab) => tab.url).filter(Boolean);
/** For asserting that something did not happen. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('setting the alarm', () => {
  it('sets it for the next reminder on install and when Chrome starts', async () => {
    await turnOn();
    const { clock } = setup();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await vi.waitFor(async () => expect(await scheduled()).toBe(at(14, 20)));
    await fakeBrowser.alarms.clearAll();
    clock.now = at(14, 21);
    await fakeBrowser.runtime.onStartup.trigger();
    await vi.waitFor(async () => expect(await scheduled()).toBe(at(15, 20)));
  });

  it('installing alone changes nothing, so a worker woken by the alarm keeps it', async () => {
    await turnOn();
    await fakeBrowser.alarms.create(REMINDER_ALARM, { when: at(14, 20) });
    setup({ now: at(14, 20) + 100 });
    await settle();
    expect(await scheduled()).toBe(at(14, 20));
  });

  it('sets it again when the settings change, and clears it when turned off', async () => {
    setup();
    await turnOn({ time: '07:30' });
    await vi.waitFor(async () => expect(await scheduled()).toBe(at(15, 7, 30)));
    await updateReminders((r) => ({ ...r, enabled: false }));
    await vi.waitFor(async () => expect(await scheduled()).toBeUndefined());
  });

  it('quick changes end with the alarm the last settings call for', async () => {
    setup();
    await Promise.all([
      turnOn({ time: '21:00' }),
      updateReminders((r) => ({ ...r, time: '22:15' })),
      updateReminders((r) => ({ ...r, days: [5] })),
    ]);
    // Friday only: from Wednesday morning, that is the 16th.
    await vi.waitFor(async () => expect(await scheduled()).toBe(at(16, 22, 15)));
    await settle();
    expect(await scheduled()).toBe(at(16, 22, 15));
  });

  it('sets nothing without the permission', async () => {
    await turnOn();
    setup({ granted: false });
    await fakeBrowser.runtime.onStartup.trigger();
    await settle();
    expect(await scheduled()).toBeUndefined();
  });

  it('follows the permission when it is granted or removed', async () => {
    await turnOn();
    const { change } = setup({ granted: false });
    change(true);
    await vi.waitFor(async () => expect(await scheduled()).toBe(at(14, 20)));
    change(false);
    await vi.waitFor(async () => expect(await scheduled()).toBeUndefined());
  });
});

describe('when the alarm fires', () => {
  it('shows the reminder for the last show and sets the next one', async () => {
    await turnOn();
    await recordWatched(SHOW, at(13, 21)); // yesterday
    const create = vi.spyOn(fakeBrowser.notifications, 'create');
    const { clock } = setup();
    clock.now = at(14, 20) + 500;
    await fire(at(14, 20));
    await vi.waitFor(async () => expect(await scheduled()).toBe(at(15, 20)));
    expect(create).toHaveBeenCalledWith(REMINDER_ID, {
      type: 'basic',
      iconUrl: fakeBrowser.runtime.getURL('/icons/128.png'),
      title: 'Time to study',
      message: 'Pick up Stranger Things and learn a few new lines.',
    });
  });

  it('skips a day already watched', async () => {
    await turnOn();
    await recordWatched(SHOW, at(14, 18));
    const create = vi.spyOn(fakeBrowser.notifications, 'create');
    const { clock } = setup();
    clock.now = at(14, 20);
    await fire(at(14, 20));
    await vi.waitFor(async () => expect(await scheduled()).toBe(at(15, 20)));
    expect(create).not.toHaveBeenCalled();
  });

  it('a computer that slept for days gets no reminder, and the next one is set from now', async () => {
    await turnOn();
    const create = vi.spyOn(fakeBrowser.notifications, 'create');
    const { clock } = setup();
    clock.now = at(17, 3); // woke on Saturday at 3 AM; the alarm was for Wednesday 8 PM
    await fire(at(14, 20));
    await vi.waitFor(async () => expect(await scheduled()).toBe(at(17, 20)));
    expect(create).not.toHaveBeenCalled();
  });

  it('a failing notification is logged and the next alarm is still set', async () => {
    await turnOn();
    vi.spyOn(fakeBrowser.notifications, 'create').mockRejectedValue(new Error('OS refused'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { clock } = setup();
    clock.now = at(14, 20);
    await fire(at(14, 20));
    await vi.waitFor(async () => expect(await scheduled()).toBe(at(15, 20)));
    expect(warn).toHaveBeenCalledWith('LingoFlix: showing the study reminder failed', expect.any(Error));
  });
});

describe('Send a test and clicks', () => {
  it('a test shows the reminder whatever the skip rules say, and is refused without the permission', async () => {
    await turnOn();
    await recordWatched(SHOW, at(14, 18)); // already watched today
    const { service, change } = setup();
    expect(await service.test()).toBe(true);
    expect(await shown()).toEqual([REMINDER_ID]);
    change(false);
    expect(await service.test()).toBe(false);
    expect(await setup({ notifications: false }).service.test()).toBe(false);
  });

  it('clicking the reminder (a test one too) opens the last show and closes it; other notifications are ignored', async () => {
    await turnOn();
    await recordWatched(SHOW, at(14, 18));
    const { service } = setup();
    await service.test();
    await fakeBrowser.notifications.onClicked.trigger('another-extension-thing');
    await settle();
    expect(await openedUrls()).toEqual([]);
    await fakeBrowser.notifications.onClicked.trigger(REMINDER_ID);
    await vi.waitFor(async () => expect(await openedUrls()).toEqual(['https://www.netflix.com/title/80057281']));
    await vi.waitFor(async () => expect(await shown()).toEqual([]));
  });

  it('opens Netflix home when no show is recorded', async () => {
    await turnOn();
    const { service } = setup();
    await service.test();
    await fakeBrowser.notifications.onClicked.trigger(REMINDER_ID);
    await vi.waitFor(async () => expect(await openedUrls()).toEqual(['https://www.netflix.com/browse']));
  });

  it('starts listening for clicks once the permission is granted after the worker started, only once', async () => {
    await turnOn();
    await recordWatched(SHOW, at(14, 18));
    const { grantNotifications } = setup({ granted: false, notifications: false });
    grantNotifications();
    grantNotifications();
    await fakeBrowser.notifications.onClicked.trigger(REMINDER_ID);
    await vi.waitFor(async () => expect(await openedUrls()).toEqual(['https://www.netflix.com/title/80057281']));
    await settle();
    expect(await openedUrls()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/reminders-service.test.ts`
Expected: FAIL: cannot resolve `@/lib/reminders/permission`.

- [ ] **Step 3: Write `permission.ts`**

Create `src/lib/reminders/permission.ts`:

```ts
import { browser } from '#imports';

/** Reminders spec §3, §7: `notifications` is optional, granted when reminders are turned on. */
export interface NotificationPermission {
  has(): Promise<boolean>;
  /** Call it straight from a click handler, before any await: Chrome shows its prompt only for a user gesture. */
  request(): Promise<boolean>;
  remove(): Promise<void>;
  /** Calls back when the permission is granted or removed, from any LingoFlix page or chrome://extensions. */
  onChange(callback: (granted: boolean) => void): () => void;
}

const isNotifications = (change: { permissions?: string[] }) => change.permissions?.includes('notifications') === true;

/**
 * The real permission. Never throws: where the permissions API is missing (unit tests, an unusual browser), the
 * permission simply isn't granted.
 */
export const notificationPermission: NotificationPermission = {
  async has() {
    try {
      return await browser.permissions.contains({ permissions: ['notifications'] });
    } catch {
      return false;
    }
  },
  request() {
    try {
      return browser.permissions.request({ permissions: ['notifications'] }).catch(() => false);
    } catch {
      return Promise.resolve(false);
    }
  },
  async remove() {
    try {
      await browser.permissions.remove({ permissions: ['notifications'] });
    } catch {
      // Already gone.
    }
  },
  onChange(callback) {
    const added = (change: { permissions?: string[] }) => {
      if (isNotifications(change)) callback(true);
    };
    const removed = (change: { permissions?: string[] }) => {
      if (isNotifications(change)) callback(false);
    };
    try {
      browser.permissions.onAdded.addListener(added);
      browser.permissions.onRemoved.addListener(removed);
    } catch {
      return () => {};
    }
    return () => {
      browser.permissions.onAdded.removeListener(added);
      browser.permissions.onRemoved.removeListener(removed);
    };
  },
};
```

- [ ] **Step 4: Write `service.ts`**

Create `src/lib/reminders/service.ts`:

```ts
import { REMINDER_ID, reminderNotification, reminderUrl } from './notification';
import type { NotificationPermission } from './permission';
import { nextReminderTime, shouldNotify } from './schedule';
import { loadActivity, loadReminders, watchReminders } from './store';

/** Reminders spec §6: the one alarm, always set for the next reminder (or cleared). */
export const REMINDER_ALARM = 'study-reminder';
/** After an alarm fires, the next one is set from at least a minute past it, so it can't fire twice for one time. */
const REARM_GAP_MS = 60_000;
const ICON_PATH = '/icons/128.png';

interface Listener<T extends unknown[]> {
  addListener(callback: (...args: T) => void): void;
}

/** The parts of `browser` the reminders use (the real one and `fakeBrowser` both fit). */
export interface ReminderBrowser {
  alarms: {
    create(name: string, info: { when: number }): Promise<void>;
    clear(name: string): Promise<boolean>;
    onAlarm: Listener<[alarm: { name: string; scheduledTime: number }]>;
  };
  tabs: { create(properties: { url: string }): Promise<unknown> };
  runtime: {
    onInstalled: Listener<[details: { reason: string }]>;
    onStartup: Listener<[]>;
    getURL(path: string): string;
  };
}

export interface ReminderNotifications {
  create(id: string, options: { type: 'basic'; iconUrl: string; title: string; message: string }): Promise<string>;
  clear(id: string): Promise<boolean>;
  onClicked: Listener<[id: string]>;
}

export interface ReminderDeps {
  browser: ReminderBrowser;
  /** `browser.notifications`, which exists only while the optional permission is granted. */
  notifications(): ReminderNotifications | undefined;
  permission: NotificationPermission;
  now(): number;
}

export interface ReminderService {
  /** Send a test (reminders spec §3): shows the reminder now, ignoring the skip rules. False if it couldn't. */
  test(): Promise<boolean>;
}

/**
 * Reminders spec §6. Every listener is added synchronously, so a worker woken by the alarm hears it. Nothing is
 * set at install time itself: that would replace the very alarm that woke the worker.
 */
export function installReminders(deps: ReminderDeps): ReminderService {
  const { browser, permission, now } = deps;

  // One at a time, each reading the settings when it runs: quick changes end with the alarm the last ones call for.
  let queue: Promise<void> = Promise.resolve();
  function arm(from: () => number): Promise<void> {
    queue = queue
      .then(async () => {
        const [reminders, granted] = await Promise.all([loadReminders(), permission.has()]);
        if (!reminders.enabled || !granted) {
          await browser.alarms.clear(REMINDER_ALARM);
          return;
        }
        await browser.alarms.create(REMINDER_ALARM, { when: nextReminderTime(from(), reminders.time, reminders.days) });
      })
      .catch((err: unknown) => console.warn('LingoFlix: setting the study reminder failed', err));
    return queue;
  }

  async function show(): Promise<boolean> {
    const notifications = deps.notifications();
    if (!notifications || !(await permission.has())) return false;
    try {
      const { show: last } = await loadActivity();
      await notifications.create(REMINDER_ID, reminderNotification(last, browser.runtime.getURL(ICON_PATH)));
      return true;
    } catch (err) {
      console.warn('LingoFlix: showing the study reminder failed', err);
      return false;
    }
  }

  let listeningForClicks = false;
  function listenForClicks(): void {
    const notifications = deps.notifications();
    if (!notifications || listeningForClicks) return;
    listeningForClicks = true;
    notifications.onClicked.addListener((id) => {
      if (id !== REMINDER_ID) return;
      void (async () => {
        try {
          const { show: last } = await loadActivity();
          await browser.tabs.create({ url: reminderUrl(last) });
          await notifications.clear(id);
        } catch (err) {
          console.warn('LingoFlix: opening Netflix from the study reminder failed', err);
        }
      })();
    });
  }

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== REMINDER_ALARM) return;
    void (async () => {
      try {
        const [reminders, granted, activity] = await Promise.all([loadReminders(), permission.has(), loadActivity()]);
        const check = {
          now: now(),
          scheduledTime: alarm.scheduledTime,
          enabled: reminders.enabled,
          granted,
          lastWatchedOn: activity.lastWatchedOn,
        };
        if (shouldNotify(check)) await show();
      } catch (err) {
        console.warn('LingoFlix: the study reminder failed', err);
      }
      // After days asleep, the next one is set from now, not a run of past-due alarms.
      await arm(() => Math.max(now(), alarm.scheduledTime + REARM_GAP_MS));
    })();
  });
  browser.runtime.onInstalled.addListener(() => void arm(now));
  browser.runtime.onStartup.addListener(() => void arm(now));
  watchReminders(() => void arm(now));
  permission.onChange(() => {
    listenForClicks();
    void arm(now);
  });
  listenForClicks();

  return { test: show };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/reminders-service.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 6: Install the service in the background**

In `src/entrypoints/background.ts`, add these imports after the `pending-seek` import (keep the import block sorted by path):

```ts
import { notificationPermission } from '@/lib/reminders/permission';
import { installReminders } from '@/lib/reminders/service';
```

Then make these the first lines inside `defineBackground(() => {`, before the v2 migration comment:

```ts
  // Reminders spec §6: added first and synchronously, so a worker woken by the reminder's alarm hears it.
  installReminders({
    browser,
    notifications: () => browser.notifications,
    permission: notificationPermission,
    now: Date.now,
  });

```

- [ ] **Step 7: Add the permissions**

In `wxt.config.ts`, replace

```ts
    permissions: ['storage', 'unlimitedStorage'],
```

with

```ts
    permissions: ['storage', 'unlimitedStorage', 'alarms'],
    // Reminders spec §7: asked for only when the learner turns reminders on.
    optional_permissions: ['notifications'],
```

- [ ] **Step 8: Verify types, the whole suite, and the built manifest**

Run: `pnpm compile && pnpm test`
Expected: tsc clean; every test file passes.

Run: `pnpm build && python3 -c "import json; m = json.load(open('.output/chrome-mv3/manifest.json')); print(m['permissions'], m.get('optional_permissions'), m['host_permissions'])"`
Expected: `['storage', 'unlimitedStorage', 'alarms'] ['notifications'] ['https://www.netflix.com/*', 'https://api.anthropic.com/*']`

- [ ] **Step 9: Commit**

```bash
git add src/lib/reminders/permission.ts src/lib/reminders/service.ts src/entrypoints/background.ts wxt.config.ts tests/unit/reminders-service.test.ts
git commit -m "feat(reminders): alarm, notification and click in the background worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `activity:watched` and `reminder:test` messages

**Files:**
- Modify: `src/lib/messages.ts`, `src/lib/background/message-handler.ts`, `src/entrypoints/background.ts`
- Test: `tests/unit/background-messages.test.ts`

**Interfaces:**
- Consumes (Task 2): `recordWatched(show: unknown, now?: number)`, `Show`, `loadActivity`, `updateReminders`. (Task 1): `localDate`. (Task 3): `installReminders(...)` returns `{ test(): Promise<boolean> }`.
- Produces:
  - `BackgroundRequests['activity:watched']`: request `{ show: Show | null }`, response `{ ok: true }`
  - `BackgroundRequests['reminder:test']`: request `object`, response `{ ok: boolean }`; LingoFlix pages only
  - `MessageHandlerDeps.recordWatched(show: unknown): Promise<void>` and `MessageHandlerDeps.testReminder(): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

In `tests/unit/background-messages.test.ts`:

Add these imports, keeping the import block sorted by path:

```ts
import { localDate } from '@/lib/reminders/schedule';
import { loadActivity, recordWatched, updateReminders } from '@/lib/reminders/store';
```

In `handlerWith`, add two deps right before `...over,`:

```ts
    recordWatched: (show) => recordWatched(show),
    testReminder: async () => false,
```

Append at the end of the file:

```ts
describe('reminder requests', () => {
  const SHOW = { id: '80057281', title: 'Stranger Things' };

  it('activity:watched records the day and a valid show, only while reminders are on', async () => {
    const { handle } = handlerWith();
    expect(await handle({ type: 'activity:watched', show: SHOW }, FROM_NETFLIX)).toEqual({ ok: true });
    expect(await loadActivity()).toEqual({ lastWatchedOn: null, show: null });

    await updateReminders((r) => ({ ...r, enabled: true }));
    const before = localDate(Date.now());
    await handle({ type: 'activity:watched', show: SHOW }, FROM_NETFLIX);
    const after = localDate(Date.now());
    const activity = await loadActivity();
    expect([before, after]).toContain(activity.lastWatchedOn);
    expect(activity.show).toEqual(SHOW);

    expect(await handle({ type: 'activity:watched', show: { id: '1; DROP', title: 'x' } }, FROM_NETFLIX)).toEqual({ ok: true });
    expect(await handle({ type: 'activity:watched' }, FROM_NETFLIX)).toEqual({ ok: true });
    expect((await loadActivity()).show).toEqual(SHOW);
  });

  it('reminder:test answers whether the reminder was shown, for LingoFlix pages only', async () => {
    const testReminder = vi.fn(async () => true);
    const { handle } = handlerWith(undefined, { testReminder });
    expect(await handle({ type: 'reminder:test' })).toEqual({ ok: true });
    await expect(handle({ type: 'reminder:test' }, FROM_NETFLIX)).rejects.toThrow('Not allowed');
    expect(testReminder).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/background-messages.test.ts`
Expected: FAIL: the two new tests fail with `Unknown request activity:watched` and `Unknown request reminder:test` (and `pnpm compile` would report the unknown deps).

- [ ] **Step 3: Add the request types**

In `src/lib/messages.ts`, add after the existing `import type { Explanation, SaveSuggestion } …` line:

```ts
import type { Show } from '@/lib/reminders/store';
```

and inside `interface BackgroundRequests`, after the `'open-options'` entry:

```ts
  /** Reminders spec §5: a video is playing on Netflix; `show` is what to pick up later. */
  'activity:watched': { request: { show: Show | null }; response: { ok: true } };
  /** Reminders spec §3: Send a test. False when the reminder couldn't be shown. */
  'reminder:test': { request: object; response: { ok: boolean } };
```

- [ ] **Step 4: Handle them**

In `src/lib/background/message-handler.ts`:

Add to `interface MessageHandlerDeps`, after `openOptions(hash: string): Promise<void>;`:

```ts
  /** Reminders spec §5: the Netflix page says a video is playing (checked and stored by the reminders store). */
  recordWatched(show: unknown): Promise<void>;
  /** Reminders spec §3: Send a test. */
  testReminder(): Promise<boolean>;
```

Replace

```ts
const PAGE_ONLY = new Set(['api-key:set', 'api-key:remove', 'api-key:test']);
```

with

```ts
const PAGE_ONLY = new Set(['api-key:set', 'api-key:remove', 'api-key:test', 'reminder:test']);
```

and update its doc comment above it to:

```ts
/** Requests only LingoFlix's own pages (options, popup) may send: the API key ones, and Send a test. */
```

Add these cases before `default:`:

```ts
      case 'activity:watched':
        await deps.recordWatched(m.show);
        return { ok: true } satisfies BackgroundResponse<'activity:watched'>;
      case 'reminder:test':
        return { ok: await deps.testReminder() } satisfies BackgroundResponse<'reminder:test'>;
```

- [ ] **Step 5: Wire the deps in the background**

In `src/entrypoints/background.ts`, add the import (sorted by path, after the `service` import):

```ts
import { recordWatched } from '@/lib/reminders/store';
```

Change `installReminders({` to `const reminders = installReminders({`, and in the `createMessageHandler({ … })` call add after `openOptions: …,`:

```ts
    recordWatched: (show) => recordWatched(show),
    testReminder: () => reminders.test(),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/background-messages.test.ts && pnpm compile`
Expected: PASS; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/messages.ts src/lib/background/message-handler.ts src/entrypoints/background.ts tests/unit/background-messages.test.ts
git commit -m "feat(reminders): activity:watched and reminder:test messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Netflix watch tracker

**Files:**
- Create: `src/entrypoints/netflix.content/watch-tracker.ts`
- Modify: `src/entrypoints/netflix.content/index.ts`
- Test: `tests/unit/watch-tracker.test.ts`

**Interfaces:**
- Consumes: `BridgeClient['callSync']` (`getState` → `PlayerState` with `paused: boolean`; `getTitle` → page data to check with `parseTitleInfo` from `@/lib/bridge/protocol`), `TitleInfo` from `@/lib/netflix/title`, `localDate` (Task 1), `Show` (Task 2), `sendToBackground({ type: 'activity:watched', show })` (Task 4).
- Produces:
  - `WATCH_CHECK_MS = 60_000`
  - `showOf(title: TitleInfo | null): Show | null`
  - `createWatchTracker(deps: WatchTrackerDeps): { check(): Promise<void> }` with `WatchTrackerDeps { bridge: Pick<BridgeClient, 'callSync'>; isWatchPage(): boolean; isEnabled(): boolean; send(show: Show | null): Promise<void>; now(): number }`

Send rule: the first playing check of each local day sends (with or without a show); after that, only a show whose id differs from the last show sent that day. So an ad without a title adds nothing, and switching shows is recorded.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/watch-tracker.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { WATCH_CHECK_MS, createWatchTracker, showOf } from '@/entrypoints/netflix.content/watch-tracker';
import type { TitleInfo } from '@/lib/netflix/title';

const EPISODE: TitleInfo = {
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
};
const MOVIE: TitleInfo = {
  videoId: '81234567',
  kind: 'movie',
  seriesId: null,
  seriesTitle: 'Glass Onion',
  seasonNumber: null,
  episodeNumber: null,
  episodeTitle: null,
};
const STRANGER_THINGS = { id: '80057281', title: 'Stranger Things' };
const GLASS_ONION = { id: '81234567', title: 'Glass Onion' };
/** Local time in October 2026. */
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();

function setup() {
  const page = {
    watching: true,
    enabled: true,
    playing: true,
    playerReady: true,
    title: EPISODE as unknown,
    now: at(14, 21),
    failSend: false,
  };
  const sent: unknown[] = [];
  const bridge = {
    callSync: vi.fn((method: string) => {
      if (method === 'getState') {
        return page.playerReady
          ? { ok: true, result: { currentTimeMs: 60_000, durationMs: 3_000_000, paused: !page.playing, videoId: '80077211', textTrack: null } }
          : { ok: false, error: { code: 'player-unavailable' } };
      }
      if (method === 'getTitle') return { ok: true, result: page.title };
      return { ok: true, result: null };
    }),
  };
  const tracker = createWatchTracker({
    bridge: bridge as never,
    isWatchPage: () => page.watching,
    isEnabled: () => page.enabled,
    send: async (show) => {
      if (page.failSend) throw new Error('Extension context invalidated.');
      sent.push(show);
    },
    now: () => page.now,
  });
  return { page, sent, tracker };
}

describe('showOf', () => {
  it('is the series for an episode and the movie itself for a movie', () => {
    expect(showOf(EPISODE)).toEqual(STRANGER_THINGS);
    expect(showOf(MOVIE)).toEqual(GLASS_ONION);
    expect(showOf({ ...EPISODE, seriesId: null })).toBeNull();
    expect(showOf(null)).toBeNull();
  });
});

describe('createWatchTracker', () => {
  it('is checked once a minute', () => {
    expect(WATCH_CHECK_MS).toBe(60_000);
  });

  it('tells the background once per show per day while a video plays', async () => {
    const { sent, tracker } = setup();
    await tracker.check();
    await tracker.check();
    expect(sent).toEqual([STRANGER_THINGS]);
  });

  it('says nothing while paused, off a watch page, with LingoFlix off, or before the player is ready', async () => {
    const { page, sent, tracker } = setup();
    page.playing = false;
    await tracker.check();
    page.playing = true;
    page.watching = false;
    await tracker.check();
    page.watching = true;
    page.enabled = false;
    await tracker.check();
    page.enabled = true;
    page.playerReady = false;
    await tracker.check();
    expect(sent).toEqual([]);
  });

  it('sends again when the title becomes known or the show changes, but not for an ad without a title', async () => {
    const { page, sent, tracker } = setup();
    page.title = null;
    await tracker.check();
    page.title = EPISODE;
    await tracker.check();
    page.title = null; // an ad
    await tracker.check();
    page.title = EPISODE;
    await tracker.check();
    page.title = MOVIE;
    await tracker.check();
    expect(sent).toEqual([null, STRANGER_THINGS, GLASS_ONION]);
  });

  it('a send that fails is tried again on the next check', async () => {
    const { page, sent, tracker } = setup();
    page.failSend = true;
    await tracker.check();
    page.failSend = false;
    await tracker.check();
    expect(sent).toEqual([STRANGER_THINGS]);
  });

  it('watching across midnight records the new day', async () => {
    const { page, sent, tracker } = setup();
    page.now = at(14, 23, 59);
    await tracker.check();
    page.now = at(15, 0, 1);
    await tracker.check();
    expect(sent).toEqual([STRANGER_THINGS, STRANGER_THINGS]);
  });

  it('ignores a title the page made up', async () => {
    const { page, sent, tracker } = setup();
    page.title = { kind: 'episode', seriesTitle: 'No ids here' };
    await tracker.check();
    expect(sent).toEqual([null]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/watch-tracker.test.ts`
Expected: FAIL: cannot resolve `@/entrypoints/netflix.content/watch-tracker`.

- [ ] **Step 3: Write the tracker**

Create `src/entrypoints/netflix.content/watch-tracker.ts`:

```ts
import type { BridgeClient } from '@/lib/bridge/client';
import { parseTitleInfo } from '@/lib/bridge/protocol';
import type { TitleInfo } from '@/lib/netflix/title';
import { localDate } from '@/lib/reminders/schedule';
import type { Show } from '@/lib/reminders/store';

/** Reminders spec §5: how often the Netflix page checks whether the video is playing. */
export const WATCH_CHECK_MS = 60_000;

export interface WatchTrackerDeps {
  bridge: Pick<BridgeClient, 'callSync'>;
  isWatchPage(): boolean;
  /** LingoFlix's master switch. */
  isEnabled(): boolean;
  /** Tells the background (`activity:watched`); rejects when it can't be reached. */
  send(show: Show | null): Promise<void>;
  now(): number;
}

/** The show to pick up later: the series for an episode, the movie itself for a movie. */
export function showOf(title: TitleInfo | null): Show | null {
  if (!title) return null;
  if (title.kind === 'movie') return { id: title.videoId, title: title.seriesTitle };
  return title.seriesId ? { id: title.seriesId, title: title.seriesTitle } : null;
}

/** Reminders spec §5: tells the background the learner is watching, at most once per show per day. */
export function createWatchTracker(deps: WatchTrackerDeps): { check(): Promise<void> } {
  let sentOn: string | null = null;
  let sentShowId: string | null = null;
  let sending = false;

  return {
    async check() {
      if (sending || !deps.isWatchPage() || !deps.isEnabled()) return;
      const state = deps.bridge.callSync('getState');
      if (!state.ok || state.result.paused !== false) return;
      const title = deps.bridge.callSync('getTitle');
      const show = showOf(title.ok ? parseTitleInfo(title.result) : null);
      const today = localDate(deps.now());
      // Once a day, plus whenever a different show becomes known; an ad without a title adds nothing.
      if (today === sentOn && (show === null || show.id === sentShowId)) return;
      sending = true;
      try {
        await deps.send(show);
        if (today !== sentOn) sentShowId = null;
        sentOn = today;
        if (show) sentShowId = show.id;
      } catch {
        // The extension was reloaded or its worker is waking up: the next check tries again.
      } finally {
        sending = false;
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/watch-tracker.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Start it on Netflix**

In `src/entrypoints/netflix.content/index.ts`, add the import (sorted by path, after `./subtitle-session`):

```ts
import { WATCH_CHECK_MS, createWatchTracker } from './watch-tracker';
```

Then, right after the `const controller = createController({ … });` statement, add:

```ts
    // Reminders spec §5: while a video plays with LingoFlix on, tell the background (once per show per day).
    const watchTracker = createWatchTracker({
      bridge,
      isWatchPage,
      isEnabled: () => settings?.enabled === true,
      send: async (show) => {
        await sendToBackground({ type: 'activity:watched', show });
      },
      now: Date.now,
    });
    ctx.setInterval(() => void watchTracker.check(), WATCH_CHECK_MS);
```

(`ctx.setInterval` is cleared automatically when the content script is invalidated.)

- [ ] **Step 6: Verify and commit**

Run: `pnpm compile && pnpm test`
Expected: tsc clean; every test file passes.

```bash
git add src/entrypoints/netflix.content/watch-tracker.ts src/entrypoints/netflix.content/index.ts tests/unit/watch-tracker.test.ts
git commit -m "feat(reminders): tell the background when a Netflix video plays

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Reminders card in Settings

**Files:**
- Create: `src/entrypoints/options/RemindersCard.tsx`
- Modify: `src/entrypoints/options/SettingsTab.tsx`
- Test: `tests/unit/reminders-card.test.tsx`, `tests/unit/options.test.tsx`

**Interfaces:**
- Consumes (Task 1): `TIME_PATTERN`. (Task 2): `loadReminders`, `updateReminders`, `watchReminders`, `Reminders`. (Task 3): `NotificationPermission`, `notificationPermission`. (Task 4): `sendToBackground({ type: 'reminder:test' })` → `{ ok: boolean }`. Existing: `Toggle` (`@/components/Toggle`: `{ label, name?, description?, checked, onChange }`, `role="switch"`), `card`, `buttonSecondary`, `focusRing` (`@/components/styles`), `Send` type (`./ApiKeyCard`).
- Produces: `RemindersCard({ send?, permission? })`; `SettingsTab({ send?, permission? })`.

The switch shows "on" only when the stored setting is on and the permission is granted. `permission.request()` is called synchronously inside the click (Chrome's user-gesture rule); the test pins that. Time and Days stay editable while reminders are off.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reminders-card.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { RemindersCard } from '@/entrypoints/options/RemindersCard';
import type { sendToBackground } from '@/lib/messages';
import type { NotificationPermission } from '@/lib/reminders/permission';
import { loadReminders, updateReminders } from '@/lib/reminders/store';

beforeEach(() => fakeBrowser.reset());
afterEach(cleanup);

function fakePermission({ granted = false, allow = true } = {}) {
  const state = { granted };
  const listeners = new Set<(granted: boolean) => void>();
  const permission = {
    has: vi.fn(async () => state.granted),
    request: vi.fn(async () => {
      if (allow) state.granted = true;
      return allow;
    }),
    remove: vi.fn(async () => {
      state.granted = false;
    }),
    onChange: (callback: (granted: boolean) => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  } satisfies NotificationPermission;
  const revoke = () => {
    state.granted = false;
    for (const listener of listeners) listener(false);
  };
  return { permission, revoke };
}

const fakeSend = (reply: () => Promise<{ ok: boolean }>) => vi.fn(reply) as unknown as typeof sendToBackground;
const reminderSwitch = () => screen.findByRole('switch', { name: 'Study reminders' });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('Reminders card', () => {
  it('starts off; turning it on asks Chrome right in the click, then saves it', async () => {
    const { permission } = fakePermission();
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    expect(await screen.findByRole('heading', { name: 'Reminders' })).toBeTruthy();
    const toggle = await reminderSwitch();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText("Skipped on days you've already watched with LingoFlix on. Chrome needs to be running.")).toBeTruthy();
    fireEvent.click(toggle);
    expect(permission.request).toHaveBeenCalledTimes(1); // no await before it: Chrome needs the click
    await waitFor(async () => expect((await loadReminders()).enabled).toBe(true));
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  });

  it('stays off and says so when Chrome is not allowed to show notifications', async () => {
    const { permission } = fakePermission({ allow: false });
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    fireEvent.click(await reminderSwitch());
    expect(await screen.findByText("Chrome didn't allow notifications.")).toBeTruthy();
    expect((await reminderSwitch()).getAttribute('aria-checked')).toBe('false');
    expect((await loadReminders()).enabled).toBe(false);
  });

  it('turning it off saves that and gives the permission back', async () => {
    await updateReminders((r) => ({ ...r, enabled: true }));
    const { permission } = fakePermission({ granted: true });
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    const toggle = await reminderSwitch();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle);
    await waitFor(() => expect(permission.remove).toHaveBeenCalledTimes(1));
    expect((await loadReminders()).enabled).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('shows off when the permission is missing or removed elsewhere', async () => {
    await updateReminders((r) => ({ ...r, enabled: true }));
    const missing = fakePermission({ granted: false });
    const { unmount } = render(<RemindersCard permission={missing.permission} send={fakeSend(async () => ({ ok: true }))} />);
    await settle();
    expect((await reminderSwitch()).getAttribute('aria-checked')).toBe('false');
    unmount();

    const granted = fakePermission({ granted: true });
    render(<RemindersCard permission={granted.permission} send={fakeSend(async () => ({ ok: true }))} />);
    const toggle = await reminderSwitch();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    granted.revoke();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('saves a full time, and an incomplete one is neither saved nor snapped back', async () => {
    const { permission } = fakePermission();
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    const input = (await screen.findByLabelText('Time')) as HTMLInputElement;
    expect(input.value).toBe('20:00');
    fireEvent.change(input, { target: { value: '07:30' } });
    await waitFor(async () => expect((await loadReminders()).time).toBe('07:30'));
    fireEvent.change(input, { target: { value: '' } });
    await settle();
    expect(input.value).toBe('');
    expect((await loadReminders()).time).toBe('07:30');
  });

  it('days toggle, and the last one left cannot be turned off', async () => {
    await updateReminders((r) => ({ ...r, days: [1] }));
    const { permission } = fakePermission();
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    const monday = await screen.findByRole('button', { name: 'Monday' });
    expect(monday.textContent).toBe('M');
    expect(monday.getAttribute('aria-pressed')).toBe('true');
    expect(monday.getAttribute('aria-disabled')).toBe('true');
    expect(monday.getAttribute('title')).toBe('Pick at least one day');
    fireEvent.click(monday);
    await settle();
    expect((await loadReminders()).days).toEqual([1]);

    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    await waitFor(async () => expect((await loadReminders()).days).toEqual([1, 3]));
    await waitFor(() => expect(monday.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(monday);
    await waitFor(async () => expect((await loadReminders()).days).toEqual([3]));
  });

  it('Send a test works only while on, and shows the hint or the failure', async () => {
    const { permission } = fakePermission();
    const replies = [{ ok: true }, { ok: false }];
    const send = fakeSend(async () => replies.shift() ?? { ok: false });
    render(<RemindersCard permission={permission} send={send} />);
    const button = (await screen.findByRole('button', { name: 'Send a test' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(await reminderSwitch());
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(
      await screen.findByText("Sent. Nothing showed up? Allow notifications for Google Chrome in your computer's settings."),
    ).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: 'reminder:test' });
    fireEvent.click(button);
    expect(await screen.findByText("Couldn't send a test reminder.")).toBeTruthy();
  });
});
```

In `tests/unit/options.test.tsx`, in the test `'has the settings, a study tip and the donation card'`, add after the `Shortcuts` heading assertion:

```tsx
    expect(await screen.findByRole('heading', { name: 'Reminders' })).toBeTruthy();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/reminders-card.test.tsx tests/unit/options.test.tsx`
Expected: FAIL: cannot resolve `@/entrypoints/options/RemindersCard`; the options test can't find the Reminders heading.

- [ ] **Step 3: Write the card**

Create `src/entrypoints/options/RemindersCard.tsx`:

```tsx
import { Bell, Send as SendIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Toggle } from '@/components/Toggle';
import { buttonSecondary, card, focusRing } from '@/components/styles';
import { sendToBackground } from '@/lib/messages';
import { notificationPermission, type NotificationPermission } from '@/lib/reminders/permission';
import { TIME_PATTERN } from '@/lib/reminders/schedule';
import { loadReminders, updateReminders, watchReminders, type Reminders } from '@/lib/reminders/store';
import type { Send } from './ApiKeyCard';

const DAYS = [
  { day: 0, short: 'S', name: 'Sunday' },
  { day: 1, short: 'M', name: 'Monday' },
  { day: 2, short: 'T', name: 'Tuesday' },
  { day: 3, short: 'W', name: 'Wednesday' },
  { day: 4, short: 'T', name: 'Thursday' },
  { day: 5, short: 'F', name: 'Friday' },
  { day: 6, short: 'S', name: 'Saturday' },
] as const;

const NOTICES = {
  declined: "Chrome didn't allow notifications.",
  sent: "Sent. Nothing showed up? Allow notifications for Google Chrome in your computer's settings.",
  failed: "Couldn't send a test reminder.",
} as const;

interface RemindersCardProps {
  send?: Send;
  permission?: NotificationPermission;
}

/** Reminders spec §3. Settings are per computer (`local:reminders`), and the permission is Chrome's. */
export function RemindersCard({ send = sendToBackground, permission = notificationPermission }: RemindersCardProps) {
  const timeId = useId();
  const [reminders, setReminders] = useState<Reminders | null>(null);
  const [granted, setGranted] = useState(false);
  const [draftTime, setDraftTime] = useState('');
  const [notice, setNotice] = useState<keyof typeof NOTICES | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([loadReminders(), permission.has()]).then(([loaded, has]) => {
      if (!active) return;
      setReminders(loaded);
      setDraftTime(loaded.time);
      setGranted(has);
    });
    const unwatch = watchReminders((next) => {
      if (active) setReminders(next);
    });
    const unlisten = permission.onChange((has) => {
      if (active) setGranted(has);
    });
    return () => {
      active = false;
      unwatch();
      unlisten();
    };
  }, [permission]);

  // The field follows the stored time, but not while the learner is mid-edit (an incomplete time reads as '').
  const storedTime = reminders?.time;
  useEffect(() => {
    if (storedTime) setDraftTime(storedTime);
  }, [storedTime]);

  if (!reminders) return null;
  const on = reminders.enabled && granted;

  const save = (fn: (r: Reminders) => Reminders) => void updateReminders(fn).then(setReminders, () => undefined);

  const toggle = (next: boolean) => {
    setNotice(null);
    if (next) {
      // Straight from the click, before any await: Chrome shows its prompt only for a user gesture.
      void permission.request().then(async (allowed) => {
        if (!allowed) {
          setNotice('declined');
          return;
        }
        setGranted(true);
        setReminders(await updateReminders((r) => ({ ...r, enabled: true })));
      });
      return;
    }
    void (async () => {
      setReminders(await updateReminders((r) => ({ ...r, enabled: false })));
      await permission.remove();
      setGranted(false);
    })();
  };

  const toggleDay = (day: number) => {
    const pressed = reminders.days.includes(day);
    if (pressed && reminders.days.length === 1) return; // at least one day
    save((r) => ({ ...r, days: pressed ? r.days.filter((d) => d !== day) : [...r.days, day] }));
  };

  const sendTest = async () => {
    setNotice(null);
    try {
      const { ok } = await send({ type: 'reminder:test' });
      setNotice(ok ? 'sent' : 'failed');
    } catch {
      setNotice('failed');
    }
  };

  return (
    <section aria-labelledby="reminders-heading" className={`${card} px-5 py-4`}>
      <h2 id="reminders-heading" className="flex items-center gap-2 text-[19px] font-black">
        <Bell size={18} strokeWidth={2.5} aria-hidden />
        Reminders
      </h2>
      <p className="mt-0.5 text-sm font-semibold text-mute">A nudge to keep studying with Netflix.</p>

      <div className="mt-2 py-3">
        <Toggle
          label="Study reminders"
          description="Skipped on days you've already watched with LingoFlix on. Chrome needs to be running."
          checked={on}
          onChange={toggle}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-soft py-3">
        <label htmlFor={timeId} className="text-base font-extrabold">
          Time
        </label>
        <input
          id={timeId}
          type="time"
          step={60}
          value={draftTime}
          onChange={(e) => {
            const value = e.target.value;
            setDraftTime(value);
            if (TIME_PATTERN.test(value)) save((r) => ({ ...r, time: value }));
          }}
          className="rounded-xl border-2 border-line bg-card px-3 py-2 text-sm font-bold text-ink outline-none focus:border-brand"
        />
      </div>

      <fieldset className="border-t-2 border-soft py-3">
        <legend className="sr-only">Days</legend>
        <p className="text-base font-extrabold">Days</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {DAYS.map(({ day, short, name }) => {
            const pressed = reminders.days.includes(day);
            const last = pressed && reminders.days.length === 1;
            return (
              <button
                key={day}
                type="button"
                aria-label={name}
                aria-pressed={pressed}
                aria-disabled={last || undefined}
                title={last ? 'Pick at least one day' : undefined}
                onClick={() => toggleDay(day)}
                className={`grid size-10 place-items-center rounded-xl border-2 text-sm font-black ${focusRing} ${
                  pressed ? 'border-tint-line bg-tint text-tint-ink' : 'border-line bg-card text-mute hover:bg-soft'
                } ${last ? 'cursor-not-allowed' : ''}`}
              >
                {short}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="border-t-2 border-soft pt-3">
        <button
          type="button"
          disabled={!on}
          onClick={() => void sendTest()}
          className={`${buttonSecondary} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <SendIcon size={14} strokeWidth={3} aria-hidden />
          Send a test
        </button>
        <p role="status" className="mt-2 text-[13px] font-semibold text-mute empty:hidden">
          {notice ? NOTICES[notice] : ''}
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add it to Settings**

In `src/entrypoints/options/SettingsTab.tsx`:

Add the imports (sorted by path):

```tsx
import type { NotificationPermission } from '@/lib/reminders/permission';
```

next to the other `@/lib/...` imports, and

```tsx
import { RemindersCard } from './RemindersCard';
```

after the `./ExplanationsCard` import.

Replace the signature

```tsx
export function SettingsTab({ send }: { send?: Send } = {}) {
```

with

```tsx
export function SettingsTab({ send, permission }: { send?: Send; permission?: NotificationPermission } = {}) {
```

and right after `<ExplanationsCard settings={settings} update={update} />` add:

```tsx
      <RemindersCard send={send} permission={permission} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/reminders-card.test.tsx tests/unit/options.test.tsx tests/unit/settings-ui.test.tsx`
Expected: PASS. (Inside `options.test.tsx` the real `notificationPermission` meets `fakeBrowser`, whose `permissions` API throws; the card must still render, switched off.)

- [ ] **Step 6: Verify and commit**

Run: `pnpm compile && pnpm test`
Expected: tsc clean; every test file passes.

```bash
git add src/entrypoints/options/RemindersCard.tsx src/entrypoints/options/SettingsTab.tsx tests/unit/reminders-card.test.tsx tests/unit/options.test.tsx
git commit -m "feat(reminders): Reminders card in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, build and live checklist

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-09-lingoflix-design.md`, `docs/superpowers/specs/2026-10-10-lingoflix-study-log-v2-design.md`

**Interfaces:** none (docs).

- [ ] **Step 1: README**

In `README.md`, after the `- **Your keys.** …` bullet (it ends with `every shortcut.`), add:

```markdown
- **Study reminders.** Pick the days and a time, and LingoFlix reminds you to study with Netflix.
  It skips the days you've already watched. Off until you turn it on.
```

and at the end of the privacy paragraph (after `so Claude can build on it.`), add a new sentence on the next line:

```markdown
If you turn on study reminders, LingoFlix keeps the date you last watched and that show's name on your
computer, to skip days you've watched and to offer the show; it never leaves your computer.
```

- [ ] **Step 2: Main spec pointers and privacy**

In `docs/superpowers/specs/2026-10-09-lingoflix-design.md`, the pointer line is:

```markdown
> Changed by `docs/superpowers/specs/2026-10-10-lingoflix-study-reminders-design.md` (study reminders), which wins where they disagree.
```

- Under `### 5.8 Options page`, `### 6.3 Messaging` and `### 6.4 Storage`, add it on the line after the existing Study Log v2 pointer (blank line between the two quotes).
- Under `### 6.2 Components` and `## 10. Privacy and permissions`, add it as the first line after the heading (followed by a blank line).
- In §10, replace the permissions bullet's start ``- **Permissions:** `storage`, `unlimitedStorage`, `offscreen`;`` with ``- **Permissions:** `storage`, `unlimitedStorage`, `offscreen`, `alarms`; optional `notifications` (requested when study reminders are turned on);``
- In §10, after the bullet `- No analytics, no LingoFlix server. Study Log is stored locally only.`, add:

```markdown
- Study reminders, when turned on, keep the date the learner last watched and that show's id and title on this computer only.
```

- [ ] **Step 3: Study Log v2 spec: flashcards dropped**

In `docs/superpowers/specs/2026-10-10-lingoflix-study-log-v2-design.md`:

- In the §2 table row `| Scope of this version | … Flashcards get their own design next. |`, replace `Flashcards get their own design next.` with `Flashcards were later dropped (study reminders spec §2).`
- In §11, replace `Flashcards and other study modes (next design),` with `Flashcards and other study modes (dropped: study reminders spec §2),`

- [ ] **Step 4: Verify everything**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: every test passes; tsc clean; build succeeds.

Run: `grep -rn "—" src/lib/reminders src/entrypoints/options/RemindersCard.tsx src/entrypoints/netflix.content/watch-tracker.ts README.md docs/superpowers/specs/2026-10-10-lingoflix-study-reminders-design.md || echo "no em dashes"`
Expected: `no em dashes`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-09-lingoflix-design.md docs/superpowers/specs/2026-10-10-lingoflix-study-log-v2-design.md
git commit -m "docs: study reminders in the README and spec pointers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Live checklist (with the learner, after the final whole-branch review and its fixes)**

Load `.output/chrome-mv3` unpacked in Chrome (chrome://extensions → reload LingoFlix), then:

1. Options → Settings → Reminders: turn **Study reminders** on and accept Chrome's prompt.
2. Right after turning reminders on (step 1), **Send a test** and click it: your last show's page (or Netflix home) opens. (Click listener added after the worker started.)
3. Set **Time** 2 minutes ahead; the "Time to study" notification appears.
4. Click it; a new tab opens at your last show's Netflix page (or Netflix home if none is recorded yet).
5. Play an episode for over a minute with LingoFlix on, set the time 2 minutes ahead again; nothing appears.
6. **Send a test**; the notification appears.
7. Wait at least 1 minute without touching LingoFlix (the worker goes idle), **Send a test**, click it: the page opens.
8. Turn reminders off, turn them on again (accept the prompt if shown), **Send a test**, click it: Netflix home opens (turning reminders off deleted the last show).
9. Turn reminders off; chrome://extensions → LingoFlix → Details no longer lists notifications.
