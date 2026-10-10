import type { Settings } from '@/lib/settings';
import { matchAction, type ActionId } from '@/lib/shortcuts';

export type ActionHandlers = Partial<Record<ActionId, () => void>>;

export interface KeyboardDeps {
  /** Current settings, or null while they are still loading. */
  getSettings(): Settings | null;
  isWatchPage(): boolean;
  handlers: ActionHandlers;
  /** Return false to let an action's key fall through to Netflix (e.g. player unavailable). */
  isActionAvailable?(action: ActionId): boolean;
}

/** Actions that must not auto-repeat while the key is held. */
const NO_REPEAT: ReadonlySet<ActionId> = new Set<ActionId>(['toggleSubtitles']);

export function isTypingTarget(event: Event): boolean {
  const el = event.composedPath()[0] as { tagName?: string; isContentEditable?: boolean } | undefined;
  const tag = el?.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable === true;
}

export function createKeyboardHandlers(deps: KeyboardDeps) {
  const resolve = (event: KeyboardEvent): ActionId | null => {
    const settings = deps.getSettings();
    if (!settings?.enabled || !deps.isWatchPage() || isTypingTarget(event)) return null;
    const action = matchAction(event, settings.shortcuts);
    if (!action || !deps.handlers[action]) return null;
    if (deps.isActionAvailable && !deps.isActionAvailable(action)) return null;
    return action;
  };

  const swallow = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  return {
    onKeyDown(event: KeyboardEvent) {
      const action = resolve(event);
      if (!action) return;
      swallow(event);
      if (event.repeat && NO_REPEAT.has(action)) return;
      deps.handlers[action]?.();
    },
    onKeyUp(event: KeyboardEvent) {
      if (resolve(event)) swallow(event);
    },
  };
}
