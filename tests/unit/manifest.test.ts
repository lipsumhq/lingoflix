// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  SEARCH_COOLDOWN_MS,
  SEARCH_LIMITS,
  createManifestSource,
  createManifestStore,
  extractTextTracks,
  installManifestCapture,
  manifestAtKnownPath,
  searchPlayerForManifest,
} from '@/lib/netflix/manifest';

/** Shaped like the manifest in Netflix's player memory (track probe, 2026-10-10). */
const LIVE_URL = 'https://ipv4-c192-lax009-ix.1.oca.nflxvideo.net/?o=1&v=93&e=1791706398';
const NONE_TRACK = 'T:2:1;1;NONE;0;1;0;0;';
const EN_CC = 'T:2:1;1;en;0;0;0;0;';
const fileUrl = (movieId: number, tag: string) => `${LIVE_URL}&m=${movieId}&p=${tag}`;
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
        ].map(([profile, tag]) => [profile, { size: 1, isImage: false, urls: [{ cdnId: 1, url: fileUrl(movieId, tag!), cdn_id: 1 }] }]),
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
          urls: [fileUrl(82028221, 'dfxp'), fileUrl(82028221, 'imsc'), fileUrl(82028221, 'simplesdh')],
        },
      ],
    });
  });

  it('merges both track lists track by track, keeping the entry that has files', () => {
    const withFiles = { new_track_id: 'T:ja', language: 'ja', ttDownloadables: { 'dfxp-ls-sdh': { urls: [{ url: 'https://cdn.example/ja' }] } } };
    expect(
      extractTextTracks({
        movieId: 1,
        textTracks: [{ id: 'T:ja', new_track_id: 'T:ja', language: 'ja', ttDownloadables: {} }],
        timedtexttracks: [withFiles, { new_track_id: 'T:ko', language: 'ko' }],
      })?.tracks,
    ).toEqual([
      { ids: ['T:ja', 'T:ja'], language: 'ja', isImageBased: false, isNone: false, urls: ['https://cdn.example/ja'] },
      { ids: ['T:ko'], language: 'ko', isImageBased: false, isNone: false, urls: [] },
    ]);
  });

  it('merges only across the two lists, and a merged track keeps every id', () => {
    const files = (tag: string) => ({ 'dfxp-ls-sdh': { urls: [{ url: `https://cdn.example/${tag}` }] } });
    const sameList = extractTextTracks({
      movieId: 1,
      textTracks: [
        { id: 'S', new_track_id: 'A', ttDownloadables: files('a') },
        { id: 'S', new_track_id: 'B', ttDownloadables: files('b') },
      ],
    });
    expect(sameList?.tracks.map((t) => t.ids)).toEqual([
      ['A', 'S'],
      ['B', 'S'],
    ]);
    const acrossLists = extractTextTracks({
      movieId: 1,
      textTracks: [{ id: 'X', new_track_id: 'Y' }],
      timedtexttracks: [{ new_track_id: 'Y', ttDownloadables: files('y') }],
    });
    expect(acrossLists?.tracks).toHaveLength(1);
    expect(acrossLists?.tracks[0]?.ids).toEqual(expect.arrayContaining(['X', 'Y']));
    expect(acrossLists?.tracks[0]?.urls).toEqual(['https://cdn.example/y']);
  });
});

const playerWith = (internal: unknown) => ({ getInternalPlayer: () => internal });
const atKnownPath = (manifestResult: unknown, playback: Record<string, unknown> = {}) =>
  playerWith({ playback: { segmentWithBoundObservables: { manifest: { manifestResult } }, ...playback } });

describe('manifestAtKnownPath', () => {
  it('reads the playing episode from player memory', () => {
    const episode = { ...liveManifest(82028221), auxiliaryManifests: [liveManifest(83236072, true)] };
    const found = manifestAtKnownPath(atKnownPath(episode), '82028221');
    expect(found?.movieId).toBe('82028221');
    expect(found?.tracks.find((t) => t.ids.includes(EN_CC))?.urls[0]).toBe(fileUrl(82028221, 'dfxp'));
  });

  it("ignores another title's manifest there (an ad playing), even one wrapped around a matching id", () => {
    expect(manifestAtKnownPath(atKnownPath(liveManifest(83236072, true)), '82028221')).toBeUndefined();
    const wrapped = { movieId: 82028221, result: liveManifest(83236072, true) };
    expect(manifestAtKnownPath(atKnownPath(wrapped), '82028221')).toBeUndefined();
  });

  it('never runs Netflix code: getters, prototype getters, custom iterators, or an object id', () => {
    const pathGetter = vi.fn(() => liveManifest(82028221));
    expect(manifestAtKnownPath(playerWith({ playback: Object.defineProperty({}, 'segmentWithBoundObservables', { get: pathGetter }) }), '82028221')).toBeUndefined();

    const protoGetter = vi.fn(() => liveManifest(82028221).textTracks);
    class Hydrated {
      movieId = 82028221;
      get textTracks() {
        return protoGetter();
      }
    }
    expect(manifestAtKnownPath(atKnownPath(new Hydrated()), '82028221')).toBeUndefined();

    const iterate = vi.fn();
    const map = vi.fn();
    class TrackList extends Array {
      override [Symbol.iterator]() {
        iterate();
        return super[Symbol.iterator]();
      }
      override map<U>(fn: (v: unknown, i: number, a: unknown[]) => U): U[] {
        map();
        return super.map(fn);
      }
    }
    const live = liveManifest(82028221);
    const custom = { ...live, textTracks: TrackList.from(live.textTracks), timedtexttracks: undefined };
    expect(manifestAtKnownPath(atKnownPath(custom), '82028221')?.tracks[1]?.urls).toHaveLength(3);

    const downloadGetter = vi.fn(() => ({ urls: [{ url: 'https://x' }] }));
    const track = { new_track_id: EN_CC, ttDownloadables: Object.defineProperty({}, 'dfxp', { get: downloadGetter, enumerable: true }) };
    manifestAtKnownPath(atKnownPath({ movieId: 82028221, textTracks: [track] }), '82028221');

    const toStringSpy = vi.fn(() => '82028221');
    expect(manifestAtKnownPath(atKnownPath({ ...live, movieId: { toString: toStringSpy } }), '82028221')).toBeUndefined();

    for (const spy of [pathGetter, protoGetter, iterate, map, downloadGetter, toStringSpy]) expect(spy).not.toHaveBeenCalled();
  });

  it('never throws', () => {
    expect(manifestAtKnownPath({ getInternalPlayer: () => { throw new Error('gone'); } }, '82028221')).toBeUndefined();
    expect(manifestAtKnownPath(null, '82028221')).toBeUndefined();
    expect(manifestAtKnownPath({}, '82028221')).toBeUndefined();
    const hostile = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('nope'); } });
    expect(manifestAtKnownPath(playerWith({ playback: hostile }), '82028221')).toBeUndefined();
  });
});

describe('searchPlayerForManifest', () => {
  it("finds the episode elsewhere in memory, e.g. while an ad's manifest is on the known path", () => {
    const player = atKnownPath(liveManifest(83236072, true), { segments: [{ manifest: { manifestResult: liveManifest(82028221) } }] });
    const found = searchPlayerForManifest(player, '82028221');
    expect(found?.movieId).toBe('82028221');
    expect(found?.tracks[1]?.urls[0]).toBe(fileUrl(82028221, 'dfxp'));
  });

  it(`still finds it if Netflix renames a step, down to depth ${SEARCH_LIMITS.depth} and no further`, () => {
    const chain = (links: number) => {
      let node: Record<string, unknown> = { manifestResult: liveManifest(82028221) };
      for (let i = 0; i < links; i++) node = { next: node };
      return playerWith(node);
    };
    // The internal player is depth 0; with n links the manifest sits at depth n + 1.
    expect(searchPlayerForManifest(chain(SEARCH_LIMITS.depth - 1), '82028221')?.movieId).toBe('82028221');
    expect(searchPlayerForManifest(chain(SEARCH_LIMITS.depth), '82028221')).toBeUndefined();
  });

  it('skips objects that refuse to be read and keeps going', () => {
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('nope'); } });
    const player = playerWith({ playback: { a: hostile, b: { manifestResult: liveManifest(82028221) } } });
    expect(searchPlayerForManifest(player, '82028221')?.movieId).toBe('82028221');
    expect(searchPlayerForManifest({ getInternalPlayer: () => { throw new Error('gone'); } }, '82028221')).toBeUndefined();
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(searchPlayerForManifest(playerWith(revoked.proxy), '82028221')).toBeUndefined();
    expect(createManifestSource(createManifestStore(), () => 0)('82028221', playerWith(revoked.proxy))).toBeUndefined();
  });

  it('passes over a copy of the manifest that has no files and keeps looking', () => {
    const stub = { movieId: 82028221, textTracks: [{ new_track_id: EN_CC, language: 'en' }] };
    const player = playerWith({ playback: { a: { manifestResult: stub }, b: { deeper: { manifestResult: liveManifest(82028221) } } } });
    expect(searchPlayerForManifest(player, '82028221')?.tracks.find((t) => t.ids.includes(EN_CC))?.urls).toHaveLength(3);
    expect(searchPlayerForManifest(playerWith({ playback: { a: { manifestResult: stub } } }), '82028221')).toBeUndefined();
  });

  it('does not walk into media buffers, page elements, the window, or huge lists', () => {
    const buffer = new Uint8Array(16);
    const element = document.createElement('div');
    const big = Array.from({ length: SEARCH_LIMITS.keysPerObject + 1 }, (_, i) => ({ i }));
    const playback = { buffer, element, win: globalThis, big, hidden: { manifestResult: liveManifest(82028221) } };
    const names = vi.spyOn(Object, 'getOwnPropertyNames');
    try {
      expect(searchPlayerForManifest(playerWith({ playback }), '82028221')?.movieId).toBe('82028221');
      expect(names.mock.calls.some(([obj]) => obj === playback)).toBe(true);
      expect(names.mock.calls.some(([obj]) => obj === buffer || obj === element || obj === globalThis || obj === big)).toBe(false);
    } finally {
      names.mockRestore();
    }
  });

  it('stops after a fixed number of property reads', () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) wide[`n${i}`] = Object.fromEntries(Array.from({ length: 1000 }, (_, k) => [`k${k}`, k]));
    wide.zz = { deeper: { manifestResult: liveManifest(82028221) } };
    const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptor');
    try {
      expect(searchPlayerForManifest(playerWith({ playback: wide }), '82028221')).toBeUndefined();
      expect(descriptors.mock.calls.length).toBeLessThan(SEARCH_LIMITS.reads + SEARCH_LIMITS.keysPerObject + 200);
    } finally {
      descriptors.mockRestore();
    }
  });
});

describe('createManifestSource', () => {
  it('uses the known path first, then what the hook captured, then a search', () => {
    const store = createManifestStore();
    const getManifest = createManifestSource(store, () => 0);
    expect(getManifest('82028221', atKnownPath(liveManifest(82028221)))?.tracks).toHaveLength(2);

    const captured = { movieId: '82028221', tracks: [{ ids: ['T:x'], language: 'x', isImageBased: false, isNone: false, urls: ['https://cdn.example/x'] }] };
    store.add(captured);
    const getInternalPlayer = vi.fn(() => ({ playback: { elsewhere: { manifestResult: liveManifest(82028221) } } }));
    expect(getManifest('82028221', { getInternalPlayer })).toBe(captured);
    expect(getInternalPlayer).toHaveBeenCalledTimes(1); // the known path only: no search
  });

  it('searches at most once per cooldown while it misses, and keeps what it found', () => {
    let now = 0;
    const internal: { playback: Record<string, unknown> } = { playback: {} };
    const getInternalPlayer = vi.fn(() => internal);
    const getManifest = createManifestSource(createManifestStore(), () => now);
    const player = { getInternalPlayer };

    expect(getManifest('82028221', player)).toBeUndefined();
    expect(getInternalPlayer).toHaveBeenCalledTimes(2); // known path + search
    now = SEARCH_COOLDOWN_MS - 1;
    expect(getManifest('82028221', player)).toBeUndefined();
    expect(getInternalPlayer).toHaveBeenCalledTimes(3); // known path only

    internal.playback.renamed = { manifestResult: liveManifest(82028221) };
    now = SEARCH_COOLDOWN_MS;
    expect(getManifest('82028221', player)?.movieId).toBe('82028221');
    expect(getInternalPlayer).toHaveBeenCalledTimes(5);
    now += 1;
    expect(getManifest('82028221', player)?.movieId).toBe('82028221');
    expect(getInternalPlayer).toHaveBeenCalledTimes(6); // kept: no new search
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

  it('reports manifests that only use the new list name (textTracks)', () => {
    const win = { JSON: { parse: JSON.parse } } as unknown as Parameters<typeof installManifestCapture>[0];
    const seen = vi.fn();
    installManifestCapture(win, seen);
    const { timedtexttracks: _old, ...renamedOnly } = liveManifest(82028221);
    win.JSON.parse(JSON.stringify(renamedOnly));
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ movieId: '82028221' }));
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

  it('never replaces a capture that has files with one that has none', () => {
    const store = createManifestStore();
    const track = { ids: ['T:en'], language: 'en', isImageBased: false, isNone: false };
    const good = { movieId: '1', tracks: [{ ...track, urls: ['https://cdn.example/en'] }] };
    store.add(good);
    store.add({ movieId: '1', tracks: [{ ...track, urls: [] }] });
    expect(store.get('1')).toBe(good);
    const newer = { movieId: '1', tracks: [{ ...track, urls: ['https://cdn.example/en2'] }] };
    store.add(newer);
    expect(store.get('1')).toBe(newer);
  });
});
