import { storage } from '#imports';
import { ACTION_IDS, DEFAULT_SHORTCUTS, sameBinding, type ActionId, type Binding, type ShortcutMap } from './shortcuts';

export interface Settings {
  enabled: boolean;
  shortcuts: ShortcutMap;
  rewindSeconds: number;
  forwardSeconds: number;
  subtitlesHidden: boolean;
}

export const SEEK_SECONDS_MIN = 1;
export const SEEK_SECONDS_MAX = 60;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  shortcuts: DEFAULT_SHORTCUTS,
  rewindSeconds: 5,
  forwardSeconds: 5,
  subtitlesHidden: false,
};

const SETTINGS_KEY = 'sync:settings';

export function clampSeekSeconds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(SEEK_SECONDS_MAX, Math.max(SEEK_SECONDS_MIN, Math.round(value)));
}

function isBinding(value: unknown): value is Binding {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.code === 'string' &&
    b.code.length > 0 &&
    typeof b.ctrl === 'boolean' &&
    typeof b.alt === 'boolean' &&
    typeof b.shift === 'boolean' &&
    typeof b.meta === 'boolean'
  );
}

function normalizeShortcuts(raw: unknown): ShortcutMap {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const result = {} as ShortcutMap;
  const missing: ActionId[] = [];

  for (const id of ACTION_IDS) {
    const value = source[id];
    if (value === null) result[id] = null;
    else if (isBinding(value))
      result[id] = { code: value.code, ctrl: value.ctrl, alt: value.alt, shift: value.shift, meta: value.meta };
    else missing.push(id);
  }

  // A default can collide with a key the user already assigned elsewhere; leave it unbound then.
  for (const id of missing) {
    const fallback = DEFAULT_SHORTCUTS[id];
    const taken =
      fallback !== null &&
      ACTION_IDS.some((other) => {
        const bound = result[other];
        return other !== id && bound != null && sameBinding(bound, fallback);
      });
    result[id] = taken ? null : fallback;
  }
  return result;
}

export function normalizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SETTINGS.enabled,
    shortcuts: normalizeShortcuts(r.shortcuts),
    rewindSeconds: clampSeekSeconds(r.rewindSeconds, DEFAULT_SETTINGS.rewindSeconds),
    forwardSeconds: clampSeekSeconds(r.forwardSeconds, DEFAULT_SETTINGS.forwardSeconds),
    subtitlesHidden: typeof r.subtitlesHidden === 'boolean' ? r.subtitlesHidden : DEFAULT_SETTINGS.subtitlesHidden,
  };
}

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await storage.getItem(SETTINGS_KEY));
}

export async function saveSettings(settings: Settings): Promise<void> {
  await storage.setItem(SETTINGS_KEY, normalizeSettings(settings));
}

export async function updateSettings(update: (current: Settings) => Settings): Promise<Settings> {
  const next = normalizeSettings(update(await loadSettings()));
  await storage.setItem(SETTINGS_KEY, next);
  return next;
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return storage.watch(SETTINGS_KEY, (value) => callback(normalizeSettings(value)));
}
