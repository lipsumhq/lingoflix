import { defineContentScript } from '#imports';
import { createPlayerMethods, findPlayer, metadataVideoFrom } from '@/lib/bridge/player';
import { serveBridge } from '@/lib/bridge/server';
import { createManifestStore, installManifestCapture, type ManifestWindow } from '@/lib/netflix/manifest';
import { parseWatchVideoId } from '@/lib/netflix/video-id';

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    // Installed before Netflix's own scripts run, so the first manifest is seen too.
    const manifests = createManifestStore();
    installManifestCapture(window as unknown as ManifestWindow, manifests.add);

    const netflix = () => (window as { netflix?: unknown }).netflix;
    const videoId = () => parseWatchVideoId(location.pathname);
    serveBridge(
      document,
      createPlayerMethods(() => findPlayer(netflix(), videoId()), videoId, {
        getManifest: manifests.get,
        getMetadataVideo: (id) => metadataVideoFrom(netflix(), id),
        getDocument: () => document,
      }),
    );
  },
});
