import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { key } from '@/lib/shortcuts';
import {
  DEFAULT_SETTINGS,
  clampSeekSeconds,
  loadSettings,
  normalizeSettings,
  saveSettings,
  updateSettings,
  watchSettings,
  type Settings,
} from '@/lib/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('clampSeekSeconds', () => {
  it('rounds and clamps to 1–60, falling back on non-numbers', () => {
    expect(clampSeekSeconds(5, 10)).toBe(5);
    expect(clampSeekSeconds(0, 10)).toBe(1);
    expect(clampSeekSeconds(-3, 10)).toBe(1);
    expect(clampSeekSeconds(100, 10)).toBe(60);
    expect(clampSeekSeconds(2.6, 10)).toBe(3);
    expect(clampSeekSeconds('7', 10)).toBe(10);
    expect(clampSeekSeconds(Number.NaN, 10)).toBe(10);
    expect(clampSeekSeconds(undefined, 10)).toBe(10);
  });
});

describe('normalizeSettings', () => {
  it('returns defaults for missing or garbage input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and fixes invalid ones field by field', () => {
    const s = normalizeSettings({
      enabled: false,
      rewindSeconds: 0,
      forwardSeconds: 15,
      subtitlesHidden: 'yes',
      shortcuts: { rewind: key('KeyJ'), forward: { code: 42 }, toggleSubtitles: null },
    });
    expect(s.enabled).toBe(false);
    expect(s.rewindSeconds).toBe(1);
    expect(s.forwardSeconds).toBe(15);
    expect(s.subtitlesHidden).toBe(false);
    expect(s.shortcuts.rewind).toEqual(key('KeyJ'));
    expect(s.shortcuts.forward).toEqual(key('ArrowRight')); // invalid → default
    expect(s.shortcuts.toggleSubtitles).toBeNull(); // explicitly unbound stays unbound
  });

  it('keeps a valid appearance and falls back to following the system', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    for (const theme of ['light', 'dark', 'system'] as const) {
      expect(normalizeSettings({ theme }).theme).toBe(theme);
    }
    for (const theme of ['Dark', 'sepia', 1, null]) {
      expect(normalizeSettings({ theme }).theme).toBe('system');
    }
  });

  it('leaves a missing action unbound when its default is already taken', () => {
    const s = normalizeSettings({ shortcuts: { rewind: key('KeyC'), forward: key('ArrowRight') } });
    expect(s.shortcuts.rewind).toEqual(key('KeyC'));
    expect(s.shortcuts.toggleSubtitles).toBeNull();
  });

  it('drops unknown fields', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, extra: 1 });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
});

describe('storage', () => {
  it('loads defaults when nothing is stored', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips saved settings through chrome.storage.sync', async () => {
    const custom: Settings = { ...DEFAULT_SETTINGS, rewindSeconds: 3, subtitlesHidden: true };
    await saveSettings(custom);
    expect(await loadSettings()).toEqual(custom);
    expect(await fakeBrowser.storage.sync.get('settings')).toEqual({ settings: custom });
  });

  it('updateSettings applies a change and returns the normalized result', async () => {
    const next = await updateSettings((s) => ({ ...s, subtitlesHidden: !s.subtitlesHidden, forwardSeconds: 99 }));
    expect(next.subtitlesHidden).toBe(true);
    expect(next.forwardSeconds).toBe(60);
    expect(await loadSettings()).toEqual(next);
  });

  it('updateSettings calls started together all land (no lost update)', async () => {
    await Promise.all([
      updateSettings((s) => ({ ...s, pauseOnHover: false })),
      updateSettings((s) => ({ ...s, cardSections: { ...s.cardSections, keyExpressions: false } })),
    ]);
    const s = await loadSettings();
    expect(s.pauseOnHover).toBe(false);
    expect(s.cardSections.keyExpressions).toBe(false);
  });

  it('watchSettings reports normalized changes', async () => {
    const seen: Settings[] = [];
    const unwatch = watchSettings((s) => seen.push(s));
    await updateSettings((s) => ({ ...s, enabled: false }));
    await vi.waitFor(() => expect(seen.at(-1)?.enabled).toBe(false));
    unwatch();
  });
});

describe('explanation and line settings', () => {
  it('defaults: pause on hover on, every card section on, seconds mode, language from the browser UI', () => {
    const s = normalizeSettings(undefined, 'ko-KR');
    expect(s.pauseOnHover).toBe(true);
    expect(s.cardSections).toEqual({ meaning: true, keyExpressions: true, howToUse: true, followUp: true });
    expect(s.rewindMode).toBe('seconds');
    expect(s.forwardMode).toBe('seconds');
    expect(s.explanationLanguage).toBe('ko');
  });

  it('keeps valid values and repairs invalid ones field by field', () => {
    const s = normalizeSettings(
      {
        pauseOnHover: false,
        explanationLanguage: 'ja',
        rewindMode: 'line',
        forwardMode: 'sentence',
        cardSections: { meaning: false, howToUse: 'no', junk: 1 },
      },
      'en',
    );
    expect(s.pauseOnHover).toBe(false);
    expect(s.explanationLanguage).toBe('ja');
    expect(s.rewindMode).toBe('line');
    expect(s.forwardMode).toBe('seconds');
    expect(s.cardSections).toEqual({ meaning: false, keyExpressions: true, howToUse: true, followUp: true });
    expect(normalizeSettings({ explanationLanguage: 'klingon' }, 'fr-CA').explanationLanguage).toBe('fr');
  });

  it('gives existing users the new shortcuts unless the key is already theirs', () => {
    const fresh = normalizeSettings({ shortcuts: { rewind: key('ArrowLeft') } }, 'en');
    expect(fresh.shortcuts.explainLine).toEqual(key('KeyE'));
    expect(fresh.shortcuts.previousLine).toEqual(key('KeyA'));
    const taken = normalizeSettings({ shortcuts: { rewind: key('KeyE') } }, 'en');
    expect(taken.shortcuts.explainLine).toBeNull();
  });
});

describe('writing keeps fields from a newer LingoFlix (synced from another computer)', () => {
  const newer = {
    enabled: true,
    future: 42,
    shortcuts: { shadowLine: key('KeyV') },
    cardSections: { glossary: false },
  };

  it('updateSettings', async () => {
    await fakeBrowser.storage.sync.set({ settings: newer });
    await updateSettings((s) => ({ ...s, enabled: false }));
    const { settings: raw } = (await fakeBrowser.storage.sync.get('settings')) as { settings: Record<string, any> };
    expect(raw.enabled).toBe(false);
    expect(raw.future).toBe(42);
    expect(raw.shortcuts.shadowLine).toEqual(key('KeyV'));
    expect(raw.shortcuts.rewind).toEqual(key('ArrowLeft'));
    expect(raw.cardSections).toEqual({ glossary: false, meaning: true, keyExpressions: true, howToUse: true, followUp: true });
  });

  it('saveSettings', async () => {
    await fakeBrowser.storage.sync.set({ settings: newer });
    await saveSettings({ ...DEFAULT_SETTINGS, rewindSeconds: 3 });
    const { settings: raw } = (await fakeBrowser.storage.sync.get('settings')) as { settings: Record<string, any> };
    expect(raw.future).toBe(42);
    expect(raw.rewindSeconds).toBe(3);
    expect(raw.shortcuts.shadowLine).toEqual(key('KeyV'));
  });
});
