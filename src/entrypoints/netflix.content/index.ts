import { defineContentScript } from '#imports';
import { createBridgeClient } from '@/lib/bridge/client';
import { isWatchPath, parseWatchVideoId } from '@/lib/netflix/video-id';
import { loadSettings, updateSettings, watchSettings } from '@/lib/settings';
import { createController } from './controller';
import { createNotifier } from './notice';

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  runAt: 'document_start',
  main(ctx) {
    const bridge = createBridgeClient(document);
    const notifier = createNotifier(document);
    const controller = createController({
      doc: document,
      bridge,
      notifier,
      updateSettings,
      isWatchPage: () => isWatchPath(location.pathname),
      getVideoId: () => parseWatchVideoId(location.pathname),
      isValid: () => ctx.isValid,
    });

    void loadSettings().then(controller.applySettings);
    const unwatch = watchSettings(controller.applySettings);

    ctx.addEventListener(window, 'keydown', controller.onKeyDown, { capture: true });
    ctx.addEventListener(window, 'keyup', controller.onKeyUp, { capture: true });
    ctx.onInvalidated(() => {
      unwatch();
      bridge.dispose();
      controller.teardown();
    });
  },
});
