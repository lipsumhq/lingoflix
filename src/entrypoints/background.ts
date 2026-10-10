import { browser, defineBackground } from '#imports';
import { getApiKey, removeApiKey, setApiKey } from '@/lib/api-key';
import { createMessageHandler } from '@/lib/background/message-handler';
import { createSdkClient } from '@/lib/claude/client';
import { serveExplainPort, type ExplainPort } from '@/lib/claude/explain-service';
import { EXPLAIN_PORT } from '@/lib/claude/protocol';
import { takePendingSeek } from '@/lib/pending-seek';
import { listItems, savedKeysFor } from '@/lib/study-log/items';
import { appendFollowUp, findExplanation, getExplanation, listExplanations, saveExplanation } from '@/lib/study-log/store';

export default defineBackground(() => {
  const handle = createMessageHandler({
    getApiKey,
    setApiKey,
    removeApiKey,
    createClient: createSdkClient,
    findExplanation,
    takePendingSeek: (videoId) => takePendingSeek(videoId),
    openOptions: async (hash) => {
      await browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}${hash}` });
    },
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return undefined; // only LingoFlix's own pages and scripts
    // By URL, not by `sender.tab`: the options page opens in a tab too.
    const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(browser.runtime.getURL('/'));
    handle(message, { fromExtensionPage }).then(sendResponse, (err: unknown) => sendResponse({ error: String(err) }));
    return true; // respond asynchronously
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EXPLAIN_PORT || port.sender?.id !== browser.runtime.id) return;
    serveExplainPort(port as unknown as ExplainPort, {
      getApiKey,
      createClient: createSdkClient,
      saveExplanation: (fields) => saveExplanation(fields),
      getExplanation,
      appendFollowUp: (id, followUp) => appendFollowUp(id, followUp),
      loadHistory: async () => ({ items: await listItems(), explanations: await listExplanations() }),
      savedKeysFor,
    });
  });
});
