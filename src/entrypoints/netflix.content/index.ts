import { defineContentScript } from '#imports';
import { createBridgeClient } from '@/lib/bridge/client';
import { BridgeError } from '@/lib/bridge/protocol';
import { isWatchPath } from '@/lib/netflix/video-id';
import { loadSettings, updateSettings, watchSettings, type Settings } from '@/lib/settings';
import { createKeyboardHandlers, type ActionHandlers } from './keyboard';
import { createNotifier } from './notice';
import { applySubtitlesHidden } from './subtitle-visibility';

const PLAYER_UNAVAILABLE_MESSAGE =
  "LingoFlix can't control Netflix's player right now, so its seek shortcuts are off and Netflix's own keys apply. Reloading the page may help.";

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  runAt: 'document_start',
  main(ctx) {
    let settings: Settings | null = null;
    let playerUnavailable = false;
    const bridge = createBridgeClient(document);
    const notifier = createNotifier(document);

    const apply = (next: Settings) => {
      settings = next;
      applySubtitlesHidden(document, next.enabled && next.subtitlesHidden);
    };
    void loadSettings().then(apply);
    const unwatch = watchSettings(apply);

    const seekBy = (deltaMs: number) => {
      bridge.call('seekBy', deltaMs).catch((err: unknown) => {
        if (err instanceof BridgeError && (err.code === 'player-unavailable' || err.code === 'timeout')) {
          playerUnavailable = true;
          notifier.showOnce('player-unavailable', PLAYER_UNAVAILABLE_MESSAGE);
        }
      });
    };

    const handlers: ActionHandlers = {
      rewind: () => settings && seekBy(-settings.rewindSeconds * 1000),
      forward: () => settings && seekBy(settings.forwardSeconds * 1000),
      toggleSubtitles: () => {
        void updateSettings((s) => ({ ...s, subtitlesHidden: !s.subtitlesHidden })).then((s) => {
          apply(s);
          notifier.show(s.subtitlesHidden ? 'Subtitles hidden' : 'Subtitles shown', 1200);
        });
      },
    };

    const { onKeyDown, onKeyUp } = createKeyboardHandlers({
      getSettings: () => settings,
      isWatchPage: () => isWatchPath(location.pathname),
      handlers,
      isActionAvailable: (action) => !(playerUnavailable && (action === 'rewind' || action === 'forward')),
    });

    ctx.addEventListener(window, 'keydown', onKeyDown, { capture: true });
    ctx.addEventListener(window, 'keyup', onKeyUp, { capture: true });
    // A new video gets a fresh chance to reach the player.
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      playerUnavailable = false;
    });
    ctx.onInvalidated(() => {
      unwatch();
      bridge.dispose();
    });
  },
});
