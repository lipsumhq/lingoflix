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
