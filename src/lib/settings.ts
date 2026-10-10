import { browser, storage } from '#imports';
import { isExplanationLanguage, languageForUi } from './languages';
import { ACTION_IDS, DEFAULT_SHORTCUTS, sameBinding, type ActionId, type Binding, type ShortcutMap } from './shortcuts';

/** Popup and options page colors. `system` follows the OS light/dark setting. */
export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** Rewind/Forward jump by seconds or by one subtitle line (spec §5.1.1). */
export type SeekMode = 'seconds' | 'line';
export const SEEK_MODES: readonly SeekMode[] = ['seconds', 'line'];

/** Explanation card sections (spec §5.3). All on by default. */
export interface CardSections {
  meaning: boolean;
  keyExpressions: boolean;
  howToUse: boolean;
  followUp: boolean;
}
export const CARD_SECTION_IDS: readonly (keyof CardSections)[] = ['meaning', 'keyExpressions', 'howToUse', 'followUp'];

export interface Settings {
  enabled: boolean;
  theme: ThemePreference;
  shortcuts: ShortcutMap;
  rewindSeconds: number;
  forwardSeconds: number;
  rewindMode: SeekMode;
  forwardMode: SeekMode;
  subtitlesHidden: boolean;
  pauseOnHover: boolean;
  /** A code from src/lib/languages.ts. */
  explanationLanguage: string;
  cardSections: CardSections;
}

export const SEEK_SECONDS_MIN = 1;
export const SEEK_SECONDS_MAX = 60;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  theme: 'system',
  shortcuts: DEFAULT_SHORTCUTS,
  rewindSeconds: 5,
  forwardSeconds: 5,
  rewindMode: 'seconds',
  forwardMode: 'seconds',
  subtitlesHidden: false,
  pauseOnHover: true,
  explanationLanguage: 'en',
  cardSections: { meaning: true, keyExpressions: true, howToUse: true, followUp: true },
};

const SETTINGS_KEY = 'sync:settings';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function clampSeekSeconds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(SEEK_SECONDS_MAX, Math.max(SEEK_SECONDS_MIN, Math.round(value)));
}

function isBinding(value: unknown): value is Binding {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === 'string' &&
    value.code.length > 0 &&
    typeof value.ctrl === 'boolean' &&
    typeof value.alt === 'boolean' &&
    typeof value.shift === 'boolean' &&
    typeof value.meta === 'boolean'
  );
}

function normalizeShortcuts(raw: unknown): ShortcutMap {
  const source = isRecord(raw) ? raw : {};
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

function normalizeCardSections(raw: unknown): CardSections {
  const source = isRecord(raw) ? raw : {};
  const result = { ...DEFAULT_SETTINGS.cardSections };
  for (const id of CARD_SECTION_IDS) {
    const value = source[id];
    if (typeof value === 'boolean') result[id] = value;
  }
  return result;
}

const seekMode = (value: unknown): SeekMode => (SEEK_MODES.includes(value as SeekMode) ? (value as SeekMode) : 'seconds');

/** The browser's UI language; `chrome.i18n` is missing in some test environments. */
function browserUiLanguage(): string {
  try {
    return browser.i18n.getUILanguage();
  } catch {
    return 'en';
  }
}

export function normalizeSettings(raw: unknown, uiLanguage: string = browserUiLanguage()): Settings {
  const r = isRecord(raw) ? raw : {};
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SETTINGS.enabled,
    theme: THEME_PREFERENCES.includes(r.theme as ThemePreference) ? (r.theme as ThemePreference) : DEFAULT_SETTINGS.theme,
    shortcuts: normalizeShortcuts(r.shortcuts),
    rewindSeconds: clampSeekSeconds(r.rewindSeconds, DEFAULT_SETTINGS.rewindSeconds),
    forwardSeconds: clampSeekSeconds(r.forwardSeconds, DEFAULT_SETTINGS.forwardSeconds),
    rewindMode: seekMode(r.rewindMode),
    forwardMode: seekMode(r.forwardMode),
    subtitlesHidden: typeof r.subtitlesHidden === 'boolean' ? r.subtitlesHidden : DEFAULT_SETTINGS.subtitlesHidden,
    pauseOnHover: typeof r.pauseOnHover === 'boolean' ? r.pauseOnHover : DEFAULT_SETTINGS.pauseOnHover,
    explanationLanguage: isExplanationLanguage(r.explanationLanguage) ? r.explanationLanguage : languageForUi(uiLanguage),
    cardSections: normalizeCardSections(r.cardSections),
  };
}

/**
 * Settings sync across the user's computers, which may run different LingoFlix versions. Keep the
 * fields (and one level of nested fields, e.g. shortcuts of newer actions) this version doesn't know.
 */
function mergeForWrite(stored: unknown, next: Settings): Record<string, unknown> {
  const base = isRecord(stored) ? stored : {};
  const out: Record<string, unknown> = { ...base };
  for (const [field, value] of Object.entries(next)) {
    const previous = base[field];
    out[field] = isRecord(value) && isRecord(previous) ? { ...previous, ...value } : value;
  }
  return out;
}

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await storage.getItem(SETTINGS_KEY));
}

export async function saveSettings(settings: Settings): Promise<void> {
  const stored = await storage.getItem(SETTINGS_KEY);
  await storage.setItem(SETTINGS_KEY, mergeForWrite(stored, normalizeSettings(settings)));
}

/** Updates run one at a time, so two changes made at once can't both read the old value and drop one. */
let updateQueue: Promise<unknown> = Promise.resolve();

export function updateSettings(update: (current: Settings) => Settings): Promise<Settings> {
  const run = updateQueue.then(async () => {
    const stored = await storage.getItem(SETTINGS_KEY);
    const next = normalizeSettings(update(normalizeSettings(stored)));
    await storage.setItem(SETTINGS_KEY, mergeForWrite(stored, next));
    return next;
  });
  updateQueue = run.catch(() => undefined);
  return run;
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return storage.watch(SETTINGS_KEY, (value) => callback(normalizeSettings(value)));
}
