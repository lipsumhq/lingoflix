import type { Settings } from '@/lib/settings';
import { matchAction, type ActionId } from '@/lib/shortcuts';

/** Return false when the action couldn't run (e.g. no player); the key then goes to Netflix. */
export type ActionHandlers = Partial<Record<ActionId, () => boolean | void>>;

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

  // Codes whose keydown went to Netflix, so the matching keyup goes there too.
  const passedThrough = new Set<string>();

  return {
    onKeyDown(event: KeyboardEvent) {
      const action = resolve(event);
      if (!action) return;
      if (event.repeat && NO_REPEAT.has(action)) {
        swallow(event);
        return;
      }
      if (deps.handlers[action]?.() === false) {
        passedThrough.add(event.code);
        return;
      }
      passedThrough.delete(event.code);
      swallow(event);
    },
    onKeyUp(event: KeyboardEvent) {
      if (passedThrough.delete(event.code)) return;
      if (resolve(event)) swallow(event);
    },
  };
}
