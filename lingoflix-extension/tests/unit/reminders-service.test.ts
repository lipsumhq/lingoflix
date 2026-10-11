import { storage } from '#imports';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { REMINDER_ID } from '@/lib/reminders/notification';
import type { NotificationPermission } from '@/lib/reminders/permission';
import { REMINDER_ALARM, installReminders } from '@/lib/reminders/service';
import { loadActivity, recordWatched, updateReminders, type Reminders } from '@/lib/reminders/store';

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

  it('a slow earlier check never overwrites the alarm a later change set', async () => {
    let checks = 0;
    installReminders({
      browser: fakeBrowser,
      notifications: () => fakeBrowser.notifications,
      permission: {
        ...fakePermission(true).permission,
        has: async () => {
          if (checks++ === 0) await new Promise((resolve) => setTimeout(resolve, 30));
          return true;
        },
      },
      now: () => at(14, 9),
    });
    await turnOn({ time: '21:00' });
    await updateReminders((r) => ({ ...r, time: '22:15' }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await scheduled()).toBe(at(14, 22, 15));
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

describe('the watch record', () => {
  it('is deleted when reminders are turned off', async () => {
    await turnOn();
    await recordWatched(SHOW, at(14, 18));
    setup();
    await updateReminders((r) => ({ ...r, enabled: false }));
    await vi.waitFor(async () => expect(await storage.getItem('local:activity')).toBeNull());
  });

  it('is deleted when the permission is removed', async () => {
    await turnOn();
    await recordWatched(SHOW, at(14, 18));
    const { change } = setup();
    await settle();
    expect(await storage.getItem('local:activity')).not.toBeNull();
    change(false);
    await vi.waitFor(async () => expect(await storage.getItem('local:activity')).toBeNull());
  });

  it('is not written while the switch shows off: reminders on but the permission missing', async () => {
    await turnOn();
    const { service } = setup({ granted: false });
    await service.recordWatched(SHOW);
    await settle();
    expect(await storage.getItem('local:activity')).toBeNull();
  });

  it('is written while reminders are on and the permission is granted', async () => {
    await turnOn();
    const { service } = setup();
    await service.recordWatched(SHOW);
    expect(await loadActivity()).toEqual({ lastWatchedOn: '2026-10-14', show: SHOW });
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

  it('an alarm heard a little before its time is not set for that same time again', async () => {
    await turnOn();
    const { clock } = setup();
    clock.now = at(14, 20) - 5_000; // the clock reads a few seconds early
    await fire(at(14, 20));
    await vi.waitFor(async () => expect(await scheduled()).toBe(at(15, 20)));
  });

  it('ignores alarms that are not the reminder', async () => {
    await turnOn();
    const create = vi.spyOn(fakeBrowser.notifications, 'create');
    const { clock } = setup();
    clock.now = at(14, 20);
    await fakeBrowser.alarms.onAlarm.trigger({ name: 'something-else', scheduledTime: at(14, 20), persistAcrossSessions: false });
    await settle();
    expect(create).not.toHaveBeenCalled();
    expect(await scheduled()).toBeUndefined();
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
