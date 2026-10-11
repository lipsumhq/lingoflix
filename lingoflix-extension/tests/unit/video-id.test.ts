import { describe, expect, it } from 'vitest';
import { isWatchPath, parseWatchVideoId } from '@/lib/netflix/video-id';

describe('watch path parsing', () => {
  it('extracts the numeric video id from /watch/{id}', () => {
    expect(parseWatchVideoId('/watch/81091396')).toBe('81091396');
    expect(parseWatchVideoId('/watch/81091396/')).toBe('81091396');
    expect(isWatchPath('/watch/81091396')).toBe(true);
  });

  it('rejects non-watch pages', () => {
    for (const path of ['/browse', '/title/80057281', '/watch/', '/watch/abc', '/']) {
      expect(parseWatchVideoId(path)).toBeNull();
      expect(isWatchPath(path)).toBe(false);
    }
  });
});
