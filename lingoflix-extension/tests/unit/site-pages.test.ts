import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { SITE_URL } from '@/lib/config';
import { installSitePages } from '@/lib/site-pages';

beforeEach(() => fakeBrowser.reset());

const openedUrls = async () => (await fakeBrowser.tabs.query({})).map((tab) => tab.url).filter(Boolean);
/** For asserting that something did not happen. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('install and uninstall pages (free-own-key spec §4.7)', () => {
  it('the site is lingoflix.lipsum.fun', () => {
    expect(SITE_URL).toBe('https://lingoflix.lipsum.fun');
  });

  it('sets the goodbye page as the uninstall page each time the background starts', () => {
    const setUninstallURL = vi.spyOn(fakeBrowser.runtime, 'setUninstallURL').mockResolvedValue();
    installSitePages(fakeBrowser);
    expect(setUninstallURL).toHaveBeenCalledExactlyOnceWith('https://lingoflix.lipsum.fun/goodbye');
  });

  it('opens the welcome page in a new tab on first install only, not on updates', async () => {
    vi.spyOn(fakeBrowser.runtime, 'setUninstallURL').mockResolvedValue();
    installSitePages(fakeBrowser);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.1.0' });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'chrome_update' });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'shared_module_update', id: 'abcdefghijklmnopabcdefghijklmnop' });
    await settle();
    expect(await openedUrls()).toEqual([]);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await vi.waitFor(async () => expect(await openedUrls()).toEqual(['https://lingoflix.lipsum.fun/welcome']));
  });
});
