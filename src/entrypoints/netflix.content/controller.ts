import type { BridgeClient } from '@/lib/bridge/client';
import type { Settings } from '@/lib/settings';
import { createKeyboardHandlers, type ActionHandlers } from './keyboard';
import type { Notifier } from './notice';
import type { SubtitleSession } from './subtitle-session';
import { applySubtitlesHidden } from './subtitle-visibility';

const PLAYER_UNAVAILABLE_MESSAGE =
  "LingoFlix can't reach Netflix's player right now, so Netflix's own seek keys apply. Reloading the page may help.";
const NO_LINE_MESSAGE = 'No subtitle line yet.';

export interface ControllerDeps {
  doc: Document;
  bridge: Pick<BridgeClient, 'callSync'>;
  notifier: Notifier;
  session: Pick<SubtitleSession, 'currentLine' | 'describe' | 'lineTarget'>;
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

  /** Explains once per video why Netflix's own keys apply; false hands the key back to Netflix. */
  const playerUnavailable = (): false => {
    deps.notifier.showOnce(`player-unavailable:${deps.getVideoId() ?? ''}`, PLAYER_UNAVAILABLE_MESSAGE);
    return false;
  };
  const seekBy = (deltaMs: number): boolean => deps.bridge.callSync('seekBy', deltaMs).ok || playerUnavailable();
  const seekTo = (timeMs: number): boolean => deps.bridge.callSync('seek', timeMs).ok || playerUnavailable();

  /** Spec §5.1.1: to the previous/next line, or by the Rewind/Forward seconds when there is no such line. */
  const jumpLine = (direction: 'previous' | 'next'): boolean => {
    if (!settings) return false;
    const target = deps.session.lineTarget(direction);
    if (target !== null) return seekTo(target);
    return seekBy(direction === 'previous' ? -settings.rewindSeconds * 1000 : settings.forwardSeconds * 1000);
  };

  const replayLine = (): boolean => {
    const line = deps.session.currentLine();
    const timing = line ? deps.session.describe(line).timing : null;
    if (!timing) {
      deps.notifier.show(NO_LINE_MESSAGE, 2000);
      return true;
    }
    if (!seekTo(timing.startMs)) return false;
    deps.bridge.callSync('play');
    return true;
  };

  const handlers: ActionHandlers = {
    rewind: () =>
      !!settings && (settings.rewindMode === 'line' ? jumpLine('previous') : seekBy(-settings.rewindSeconds * 1000)),
    forward: () =>
      !!settings && (settings.forwardMode === 'line' ? jumpLine('next') : seekBy(settings.forwardSeconds * 1000)),
    previousLine: () => jumpLine('previous'),
    nextLine: () => jumpLine('next'),
    replayLine,
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
