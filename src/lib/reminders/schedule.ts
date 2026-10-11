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
