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

  it('watchSettings reports normalized changes', async () => {
    const seen: Settings[] = [];
    const unwatch = watchSettings((s) => seen.push(s));
    await updateSettings((s) => ({ ...s, enabled: false }));
    await vi.waitFor(() => expect(seen.at(-1)?.enabled).toBe(false));
    unwatch();
  });
});
