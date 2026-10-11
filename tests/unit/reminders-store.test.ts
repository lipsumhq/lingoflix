import { storage } from '#imports';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { REMINDER_ID, REMINDER_TITLE, reminderMessage, reminderNotification, reminderUrl } from '@/lib/reminders/notification';
import {
  DEFAULT_REMINDERS,
  clearActivity,
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

  it('is deleted by clearActivity', async () => {
    await updateReminders((r) => ({ ...r, enabled: true }));
    await recordWatched(SHOW, EVENING);
    await clearActivity();
    expect(await storage.getItem('local:activity')).toBeNull();
  });

  it('a watch recorded at the moment reminders are turned off leaves no record', async () => {
    await updateReminders((r) => ({ ...r, enabled: true }));
    // The watch reads the settings (still on) before the turn-off, and its own read of the record is slow.
    const getItem = storage.getItem.bind(storage);
    vi.spyOn(storage, 'getItem').mockImplementation(async (key: Parameters<typeof storage.getItem>[0]) => {
      if (key === 'local:activity') await new Promise((resolve) => setTimeout(resolve, 30));
      return getItem(key);
    });
    await Promise.all([
      recordWatched(SHOW, EVENING),
      updateReminders((r) => ({ ...r, enabled: false })).then(() => clearActivity()),
    ]);
    expect(await storage.getItem('local:activity')).toBeNull();
  });

  it('a failed write or delete leaves later ones working', async () => {
    await updateReminders((r) => ({ ...r, enabled: true }));
    vi.spyOn(storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(recordWatched(SHOW, EVENING)).rejects.toThrow('disk full');
    await recordWatched(SHOW, EVENING);
    expect(await loadActivity()).toEqual({ lastWatchedOn: '2026-10-14', show: SHOW });
    vi.spyOn(storage, 'removeItem').mockRejectedValueOnce(new Error('busy'));
    await expect(clearActivity()).rejects.toThrow('busy');
    await clearActivity();
    expect(await storage.getItem('local:activity')).toBeNull();
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
