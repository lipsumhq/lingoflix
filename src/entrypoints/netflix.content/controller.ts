import type { BridgeClient } from '@/lib/bridge/client';
import type { Settings } from '@/lib/settings';
import { createKeyboardHandlers, type ActionHandlers } from './keyboard';
import type { Notifier } from './notice';
import { applySubtitlesHidden } from './subtitle-visibility';

const PLAYER_UNAVAILABLE_MESSAGE =
  "LingoFlix can't reach Netflix's player right now, so Netflix's own seek keys apply. Reloading the page may help.";

export interface ControllerDeps {
  doc: Document;
  bridge: Pick<BridgeClient, 'callSync'>;
  notifier: Notifier;
  updateSettings(update: (current: Settings) => Settings): Promise<Settings>;
  isWatchPage(): boolean;
  getVideoId(): string | null;
  /** False once the extension was reloaded, updated, or disabled and this script is orphaned. */
  isValid(): boolean;
}

export interface Controller {
  applySettings(settings: Settings): void;
  onKeyDown(event: KeyboardEvent): void;
  onKeyUp(event: KeyboardEvent): void;
  /** Undo everything LingoFlix shows on the page. Safe to call more than once. */
  teardown(): void;
}

export function createController(deps: ControllerDeps): Controller {
  let settings: Settings | null = null;
  let tornDown = false;

  const applySettings = (next: Settings) => {
    if (tornDown) return;
    settings = next;
    applySubtitlesHidden(deps.doc, next.enabled && next.subtitlesHidden);
  };

  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    settings = null;
    applySubtitlesHidden(deps.doc, false);
    deps.notifier.dispose();
  };

  /** Seeks through the page bridge; false hands the key back to Netflix. */
  const seekBy = (deltaMs: number): boolean => {
    const res = deps.bridge.callSync('seekBy', deltaMs);
    if (res.ok) return true;
    deps.notifier.showOnce(`player-unavailable:${deps.getVideoId() ?? ''}`, PLAYER_UNAVAILABLE_MESSAGE);
    return false;
  };

  const handlers: ActionHandlers = {
    rewind: () => !!settings && seekBy(-settings.rewindSeconds * 1000),
    forward: () => !!settings && seekBy(settings.forwardSeconds * 1000),
    toggleSubtitles: () => {
      void deps.updateSettings((s) => ({ ...s, subtitlesHidden: !s.subtitlesHidden })).then((s) => {
        applySettings(s);
        deps.notifier.show(s.subtitlesHidden ? 'Subtitles hidden' : 'Subtitles shown', 1200);
      });
    },
  };

  const keys = createKeyboardHandlers({
    getSettings: () => {
      if (!deps.isValid()) {
        teardown();
        return null;
      }
      return settings;
    },
    isWatchPage: deps.isWatchPage,
    handlers,
  });

  return { applySettings, onKeyDown: keys.onKeyDown, onKeyUp: keys.onKeyUp, teardown };
}
