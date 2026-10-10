import { defineContentScript } from '#imports';
import { createPlayerMethods, findPlayer, metadataVideoFrom } from '@/lib/bridge/player';
import { serveBridge } from '@/lib/bridge/server';
import { createManifestSource, createManifestStore, installManifestCapture, type ManifestWindow } from '@/lib/netflix/manifest';
import { parseWatchVideoId } from '@/lib/netflix/video-id';

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    // Backup source: Netflix's current player no longer parses its manifest where this hook sees it (row 3).
    const manifests = createManifestStore();
    installManifestCapture(window as unknown as ManifestWindow, manifests.add);

    const netflix = () => (window as { netflix?: unknown }).netflix;
    const videoId = () => parseWatchVideoId(location.pathname);
    serveBridge(
      document,
      createPlayerMethods(() => findPlayer(netflix(), videoId()), videoId, {
        // The player's own memory first (docs/netflix-internals.md row 3), then the hook, then a throttled search.
        getManifest: createManifestSource(manifests),
        getMetadataVideo: (id) => metadataVideoFrom(netflix(), id),
        getDocument: () => document,
      }),
    );
  },
});
