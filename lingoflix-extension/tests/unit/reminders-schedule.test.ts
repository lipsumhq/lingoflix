import { afterAll, describe, expect, it } from 'vitest';
import { LATE_LIMIT_MS, localDate, nextReminderTime, shouldNotify } from '@/lib/reminders/schedule';

// Local-time math: pin a zone whose 2026 daylight-saving dates are known (starts Mar 8, ends Nov 1).
// Pinned as the file loads, not in beforeAll, so values built while tests are collected use it too.
const previousTz = process.env.TZ;
process.env.TZ = 'America/New_York';
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
