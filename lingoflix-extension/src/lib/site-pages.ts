import { SITE_URL } from '@/lib/config';

interface Listener<T extends unknown[]> {
  addListener(callback: (...args: T) => void): void;
}

/** The parts of `browser` the site pages use (the real one and `fakeBrowser` both fit). */
export interface SitePagesBrowser {
  runtime: {
    onInstalled: Listener<[details: { reason: string }]>;
    setUninstallURL(url: string): Promise<void>;
  };
  tabs: { create(properties: { url: string }): Promise<unknown> };
}

/**
 * Free-own-key spec §4.7: the site's welcome page opens on first install (not on updates), and its goodbye page
 * is the uninstall page, set each time the background starts. Called synchronously at start, so the worker that
 * installation wakes hears onInstalled. Both are best effort.
 */
export function installSitePages(browser: SitePagesBrowser): void {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') browser.tabs.create({ url: `${SITE_URL}/welcome` }).catch(() => undefined);
  });
  browser.runtime.setUninstallURL(`${SITE_URL}/goodbye`).catch(() => undefined);
}
