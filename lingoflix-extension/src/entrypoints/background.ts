import { browser, defineBackground } from '#imports';
import { getApiKey, removeApiKey, setApiKey } from '@/lib/api-key';
import { createMessageHandler } from '@/lib/background/message-handler';
import { createClient } from '@/lib/ai/client';
import { createExplainService, type ExplainPort } from '@/lib/ai/explain-service';
import { EXPLAIN_PORT } from '@/lib/ai/protocol';
import { takePendingSeek } from '@/lib/pending-seek';
import { notificationPermission } from '@/lib/reminders/permission';
import { installReminders } from '@/lib/reminders/service';
import { installSitePages } from '@/lib/site-pages';
import { migrateIfNeeded, saveItem, savedKeysFor, unsaveItem } from '@/lib/study-log/items';
import { appendFollowUp, findExplanation, getExplanation, readStudyLog, saveExplanation } from '@/lib/study-log/store';

export default defineBackground(() => {
  // Reminders spec §6: added first and synchronously, so a worker woken by the reminder's alarm hears it.
  const reminders = installReminders({
    browser,
    notifications: () => browser.notifications,
    permission: notificationPermission,
    now: Date.now,
  });

  // Free-own-key spec §4.7: the welcome page on first install, and the goodbye page as the uninstall page.
  installSitePages(browser);

  // v2 spec §3.3: lines explained before v2 become saved whole-line items, once: on install and update, and
  // whenever the worker starts before it has run (a run that failed or was cut short). Both go through
  // migrateIfNeeded, which runs one conversion at a time and never rejects.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install' || reason === 'update') void migrateIfNeeded();
  });
  void migrateIfNeeded();

  const handle = createMessageHandler({
    getApiKey,
    setApiKey,
    removeApiKey,
    createClient,
    findExplanation,
    getExplanation,
    saveItem: (explanation, suggestion) => saveItem(explanation, suggestion),
    unsaveItem: (explanation, suggestion) => unsaveItem(explanation, suggestion),
    savedKeysFor,
    takePendingSeek: (videoId) => takePendingSeek(videoId),
    openOptions: async (hash) => {
      await browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}${hash}` });
    },
    recordWatched: (show) => reminders.recordWatched(show),
    testReminder: () => reminders.test(),
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return undefined; // only LingoFlix's own pages and scripts
    // By URL, not by `sender.tab`: the options page opens in a tab too.
    const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(browser.runtime.getURL('/'));
    handle(message, { fromExtensionPage }).then(sendResponse, (err: unknown) => sendResponse({ error: String(err) }));
    return true; // respond asynchronously
  });

  // One service for every card, so a card that reopens a line joins its answer (finish-answers spec §3.3).
  const explain = createExplainService({
    getApiKey,
    createClient,
    saveExplanation: (fields) => saveExplanation(fields),
    getExplanation,
    appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
    loadHistory: readStudyLog,
    savedKeysFor,
    keepAlive: () => void browser.runtime.getPlatformInfo(),
  });
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EXPLAIN_PORT || port.sender?.id !== browser.runtime.id) return;
    explain.serve(port as unknown as ExplainPort);
  });
});
