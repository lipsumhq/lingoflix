import { describe, expect, it, vi } from 'vitest';
import { createManifestStore, extractTextTracks, installManifestCapture } from '@/lib/netflix/manifest';

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
