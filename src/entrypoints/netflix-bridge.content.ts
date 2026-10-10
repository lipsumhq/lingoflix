import { defineContentScript } from '#imports';
import { createPlayerMethods, findPlayer } from '@/lib/bridge/player';
import { serveBridge } from '@/lib/bridge/server';
import { parseWatchVideoId } from '@/lib/netflix/video-id';

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    serveBridge(
      document,
      createPlayerMethods(
        () => findPlayer((window as { netflix?: unknown }).netflix),
        () => parseWatchVideoId(location.pathname),
      ),
    );
  },
});
