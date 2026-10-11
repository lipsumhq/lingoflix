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
 * The watch record is written and deleted one job at a time, so a watch heard as reminders are turned off can't
 * outlive the delete: a write that started first finishes before it, and one queued after it finds reminders off.
 */
let activityWrites: Promise<unknown> = Promise.resolve();

function oneActivityWrite(job: () => Promise<void>): Promise<void> {
  const run = activityWrites.then(job);
  activityWrites = run.catch(() => undefined);
  return run;
}

/**
 * Reminders spec §5: a video is playing on Netflix now. Records today's local date and the show, but only while
 * reminders are on, so nothing about viewing is kept unless the learner asked for reminders. A missing or invalid
 * show keeps the stored one.
 */
export function recordWatched(show: unknown, now: number = Date.now()): Promise<void> {
  return oneActivityWrite(async () => {
    if (!(await loadReminders()).enabled) return;
    const stored = await storage.getItem(ACTIVITY_KEY);
    const next: Activity = { lastWatchedOn: localDate(now), show: parseShow(show) ?? normalizeActivity(stored).show };
    await storage.setItem(ACTIVITY_KEY, keepUnknown(stored, next));
  });
}

/** Deletes the watch record: the background does so whenever reminders are off or the permission is gone (spec §6). */
export function clearActivity(): Promise<void> {
  return oneActivityWrite(() => storage.removeItem(ACTIVITY_KEY));
}
