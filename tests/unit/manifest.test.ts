// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createManifestStore, extractTextTracks, installManifestCapture, manifestFromPlayer } from '@/lib/netflix/manifest';

/** Shaped like the manifest in Netflix's player memory (track probe, 2026-10-10). */
const LIVE_URL = 'https://ipv4-c192-lax009-ix.1.oca.nflxvideo.net/?o=1&v=93&e=1791706398';
const NONE_TRACK = 'T:2:1;1;NONE;0;1;0;0;';
const EN_CC = 'T:2:1;1;en;0;0;0;0;';
const liveManifest = (movieId: number, isAd = false) => ({
  movieId,
  isAd,
  viewableType: isAd ? 'SUPPLEMENTAL' : 'EPISODE',
  textTracks: [
    { id: NONE_TRACK, new_track_id: NONE_TRACK, language: null, isNoneTrack: true, ttDownloadables: {} },
    {
      id: EN_CC,
      new_track_id: EN_CC,
      language: 'en',
      rawTrackType: 'closedcaptions',
      isNoneTrack: false,
      ttDownloadables: Object.fromEntries(
        [
          ['imsc1.1', 'imsc'],
          ['simplesdh', 'simplesdh'],
          ['dfxp-ls-sdh', 'dfxp'],
        ].map(([profile, tag]) => [profile, { size: 1, isImage: false, urls: [{ cdnId: 1, url: `${LIVE_URL}&p=${tag}`, cdn_id: 1 }] }]),
      ),
    },
  ],
  // The old list name can sit beside it; only the list that carries files is useful.
  timedtexttracks: [{ new_track_id: EN_CC, language: 'en' }],
});

const MANIFEST = {
  result: {
    movieId: 82028220,
    timedtexttracks: [
      {
        new_track_id: 'T:1:0;1;en;1;1;0;',
        id: 'T:1:0;1;en;1;1;0;',
        language: 'en',
        rawTrackType: 'closedcaptions',
        isNoneTrack: false,
        ttDownloadables: {
          'nflx-cmisc': { isImage: true, urls: [{ url: 'https://ipv4-c1.oca.nflxvideo.net/img?o=1' }] },
          'imsc1.1': { urls: [{ cdn_id: 1, url: 'https://ipv4-c1.oca.nflxvideo.net/imsc?o=1' }] },
          'dfxp-ls-sdh': { downloadUrls: { 1: 'https://ipv4-c1.oca.nflxvideo.net/dfxp?o=1' } },
        },
      },
      {
        new_track_id: 'T:1:1;1;ja;0;0;0;',
        language: 'ja',
        isNoneTrack: false,
        ttDownloadables: { 'nflx-cmisc': { isImage: true, urls: [{ url: 'https://ipv4-c1.oca.nflxvideo.net/ja?o=1' }] } },
      },
      { new_track_id: 'T:1:2;1;none;0;0;0;', language: 'none', isNoneTrack: true, ttDownloadables: {} },
      { language: 'de' }, // no id → skipped
    ],
  },
};

describe('extractTextTracks', () => {
  it('lists text tracks with their ids and text-file URLs, best format first', () => {
    expect(extractTextTracks(MANIFEST)).toEqual({
      movieId: '82028220',
      tracks: [
        {
          ids: ['T:1:0;1;en;1;1;0;', 'T:1:0;1;en;1;1;0;'],
          language: 'en',
          isImageBased: false,
          isNone: false,
          urls: ['https://ipv4-c1.oca.nflxvideo.net/dfxp?o=1', 'https://ipv4-c1.oca.nflxvideo.net/imsc?o=1'],
        },
        { ids: ['T:1:1;1;ja;0;0;0;'], language: 'ja', isImageBased: true, isNone: false, urls: [] },
        { ids: ['T:1:2;1;none;0;0;0;'], language: 'none', isImageBased: false, isNone: true, urls: [] },
      ],
    });
  });

  it('accepts the manifest without the result wrapper and ignores everything else', () => {
    expect(extractTextTracks(MANIFEST.result)?.movieId).toBe('82028220');
    expect(extractTextTracks({ result: { movieId: 1 } })).toBeNull();
    expect(extractTextTracks('nope')).toBeNull();
    expect(extractTextTracks({ timedtexttracks: [] })).toBeNull(); // no movieId
  });

  it('reads the renamed track list (textTracks) and prefers the list that carries files', () => {
    expect(extractTextTracks(liveManifest(82028221))).toEqual({
      movieId: '82028221',
      tracks: [
        { ids: [NONE_TRACK, NONE_TRACK], language: '', isImageBased: false, isNone: true, urls: [] },
        {
          ids: [EN_CC, EN_CC],
          language: 'en',
          isImageBased: false,
          isNone: false,
          urls: [`${LIVE_URL}&p=dfxp`, `${LIVE_URL}&p=imsc`, `${LIVE_URL}&p=simplesdh`],
        },
      ],
    });
  });
});

describe('manifestFromPlayer', () => {
  const playerWith = (internal: unknown) => ({ getInternalPlayer: () => internal });
  const atKnownPath = (manifestResult: unknown, playback: Record<string, unknown> = {}) =>
    playerWith({ playback: { segmentWithBoundObservables: { manifest: { manifestResult } }, ...playback } });

  it('reads the playing episode from player memory, not the ad manifest beside it', () => {
    const episode = { ...liveManifest(82028221), auxiliaryManifests: [liveManifest(83236072, true)] };
    const found = manifestFromPlayer(atKnownPath(episode), '82028221');
    expect(found?.movieId).toBe('82028221');
    expect(found?.tracks.find((t) => t.ids.includes(EN_CC))?.urls[0]).toBe(`${LIVE_URL}&p=dfxp`);
  });

  it("finds the episode when the known path holds another title's manifest (an ad playing)", () => {
    const player = atKnownPath(liveManifest(83236072, true), { segments: [{ manifest: { manifestResult: liveManifest(82028221) } }] });
    expect(manifestFromPlayer(player, '82028221')?.movieId).toBe('82028221');
    expect(manifestFromPlayer(atKnownPath(liveManifest(83236072, true)), '82028221')).toBeUndefined();
  });

  it('still finds it if Netflix renames a step of the path, within a bounded search', () => {
    expect(manifestFromPlayer(playerWith({ playback: { renamed: { manifestResult: liveManifest(82028221) } } }), '82028221')?.movieId).toBe(
      '82028221',
    );
    let deep: Record<string, unknown> = { manifestResult: liveManifest(82028221) };
    for (let i = 0; i < 10; i++) deep = { next: deep };
    expect(manifestFromPlayer(playerWith(deep), '82028221')).toBeUndefined();
  });

  it('never runs Netflix getters, skips objects that refuse to be read, and never throws', () => {
    const getter = vi.fn(() => liveManifest(82028221));
    const sneaky = Object.defineProperty({}, 'manifestResult', { get: getter, enumerable: true });
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('nope'); } });
    const player = playerWith({ playback: { a: hostile, segmentWithBoundObservables: { manifest: sneaky }, b: { manifestResult: liveManifest(82028221) } } });
    expect(manifestFromPlayer(player, '82028221')?.movieId).toBe('82028221');
    expect(getter).not.toHaveBeenCalled();
    expect(manifestFromPlayer({ getInternalPlayer: () => { throw new Error('gone'); } }, '82028221')).toBeUndefined();
    expect(manifestFromPlayer(null, '82028221')).toBeUndefined();
    expect(manifestFromPlayer({}, '82028221')).toBeUndefined();
  });

  it('does not walk into media buffers or page elements', () => {
    const buffer = new Uint8Array(16);
    const element = document.createElement('div');
    const names = vi.spyOn(Object, 'getOwnPropertyNames');
    try {
      manifestFromPlayer(playerWith({ playback: { buffer, element } }), '82028221');
      expect(names.mock.calls.some(([obj]) => obj === buffer || obj === element)).toBe(false);
    } finally {
      names.mockRestore();
    }
  });
});

describe('installManifestCapture', () => {
  it('reports manifests that pass through JSON.parse and leaves other parsing alone', () => {
    const win = { JSON: { parse: JSON.parse } } as unknown as Parameters<typeof installManifestCapture>[0];
    const seen = vi.fn();
    const restore = installManifestCapture(win, seen);
    expect(win.JSON.parse('{"a":1}')).toEqual({ a: 1 });
    expect(seen).not.toHaveBeenCalled();
    win.JSON.parse(JSON.stringify(MANIFEST));
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ movieId: '82028220' }));
    expect(() => win.JSON.parse('{bad')).toThrow(SyntaxError);
    restore();
    expect(win.JSON.parse).toBe(JSON.parse);
  });

  it('reports manifests read with Response.json()', async () => {
    class FakeResponse {
      json() {
        return Promise.resolve(structuredClone(MANIFEST));
      }
    }
    const originalJson = FakeResponse.prototype.json;
    const win = { JSON: { parse: JSON.parse }, Response: FakeResponse } as unknown as Parameters<typeof installManifestCapture>[0];
    const seen = vi.fn();
    const restore = installManifestCapture(win, seen);
    expect(await new FakeResponse().json()).toEqual(MANIFEST);
    expect(seen).toHaveBeenCalledTimes(1);
    restore();
    expect(FakeResponse.prototype.json).toBe(originalJson);
  });

  it('a broken manifest never breaks Netflix', () => {
    const win = { JSON: { parse: JSON.parse } } as unknown as Parameters<typeof installManifestCapture>[0];
    installManifestCapture(win, () => {
      throw new Error('sink failed');
    });
    expect(() => win.JSON.parse(JSON.stringify(MANIFEST))).not.toThrow();
  });
});

describe('createManifestStore', () => {
  it('keeps the latest manifests by movie id', () => {
    const store = createManifestStore(2);
    store.add({ movieId: '1', tracks: [] });
    store.add({ movieId: '2', tracks: [] });
    store.add({ movieId: '3', tracks: [] });
    expect(store.get('1')).toBeUndefined();
    expect(store.get('3')).toEqual({ movieId: '3', tracks: [] });
  });
});
