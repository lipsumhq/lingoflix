import { defineContentScript } from '#imports';
import { createBridgeClient } from '@/lib/bridge/client';
import { isWatchPath, parseWatchVideoId } from '@/lib/netflix/video-id';
import { loadSettings, updateSettings, watchSettings } from '@/lib/settings';
import { createController } from './controller';
import { createNotifier } from './notice';
import { watchSubtitles } from './subtitle-dom';
import { createSubtitleSession } from './subtitle-session';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Subtitle file: HTTP ${res.status}`);
  return res.text();
}

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  main(ctx) {
    const bridge = createBridgeClient(document);
    const notifier = createNotifier(document);
    const getVideoId = () => parseWatchVideoId(location.pathname);
    const session = createSubtitleSession({ bridge, fetchText, getVideoId });
    const controller = createController({
      doc: document,
      bridge,
      notifier,
      session,
      updateSettings,
      isWatchPage: () => isWatchPath(location.pathname),
      getVideoId,
      isValid: () => ctx.isValid,
    });

    void loadSettings().then(controller.applySettings);
    const unwatch = watchSettings(controller.applySettings);
    const stopSubtitles = watchSubtitles(document, session.onDisplayed);

    ctx.addEventListener(window, 'keydown', controller.onKeyDown, { capture: true });
    ctx.addEventListener(window, 'keyup', controller.onKeyUp, { capture: true });
    ctx.onInvalidated(() => {
      unwatch();
      stopSubtitles();
      bridge.dispose();
      controller.teardown();
    });
  },
});
