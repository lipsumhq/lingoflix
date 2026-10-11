import { REMINDER_ID, reminderNotification, reminderUrl } from './notification';
import type { NotificationPermission } from './permission';
import { nextReminderTime, shouldNotify } from './schedule';
import { clearActivity, loadActivity, loadReminders, recordWatched, watchReminders } from './store';

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
  /**
   * `activity:watched` (reminders spec §5): records the watch only while the switch shows on, that is, reminders
   * are on and the permission is granted.
   */
  recordWatched(show: unknown): Promise<void>;
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
          // The watch record is kept only while reminders are on (reminders spec §5, §6).
          await Promise.all([browser.alarms.clear(REMINDER_ALARM), clearActivity()]);
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

  return {
    test: show,
    async recordWatched(watched) {
      if (await permission.has()) await recordWatched(watched, now());
    },
  };
}
