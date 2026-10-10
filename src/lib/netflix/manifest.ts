/** A subtitle track as listed in Netflix's manifest (docs/netflix-internals.md row 3). */
export interface CapturedTrack {
  /** Every id Netflix uses for the track; the player's `getTimedTextTrack().trackId` is one of them. */
  ids: string[];
  language: string;
  isImageBased: boolean;
  isNone: boolean;
  /** Text subtitle file URLs, best format first. */
  urls: string[];
}

export interface CapturedManifest {
  movieId: string;
  tracks: CapturedTrack[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text profiles we can parse, best first. Image profiles (e.g. `nflx-cmisc`) are not text. */
const TEXT_PROFILES = [/^dfxp/, /^imsc/, /^simplesdh/, /^webvtt/, /ttml/];

function idsOf(track: Record<string, unknown>): string[] {
  return ['new_track_id', 'id', 'trackId']
    .map((key) => track[key])
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .map(String);
}

function urlsOf(download: unknown): string[] {
  if (!isRecord(download)) return [];
  const listed = Array.isArray(download.urls) ? download.urls.map((u) => (isRecord(u) ? u.url : u)) : [];
  const mapped = isRecord(download.downloadUrls) ? Object.values(download.downloadUrls) : [];
  return [...listed, ...mapped].filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));
}

export function extractTextTracks(parsed: unknown): CapturedManifest | null {
  if (!isRecord(parsed)) return null;
  const root = isRecord(parsed.result) ? parsed.result : parsed;
  if (!Array.isArray(root.timedtexttracks)) return null;
  const movieId = root.movieId;
  if (typeof movieId !== 'string' && typeof movieId !== 'number') return null;

  const tracks: CapturedTrack[] = [];
  for (const raw of root.timedtexttracks) {
    if (!isRecord(raw)) continue;
    const ids = idsOf(raw);
    if (!ids.length) continue;
    const downloads = isRecord(raw.ttDownloadables) ? Object.entries(raw.ttDownloadables) : [];
    const text = downloads
      .map(([profile, d]) => ({
        rank: TEXT_PROFILES.findIndex((re) => re.test(profile)),
        image: isRecord(d) && d.isImage === true,
        urls: urlsOf(d),
      }))
      .filter((d) => d.rank >= 0 && !d.image && d.urls.length > 0)
      .sort((a, b) => a.rank - b.rank);
    tracks.push({
      ids,
      language: typeof raw.language === 'string' ? raw.language : '',
      isImageBased: raw.isImageBased === true || (downloads.length > 0 && text.length === 0),
      isNone: raw.isNoneTrack === true,
      urls: text.flatMap((d) => d.urls),
    });
  }
  return { movieId: String(movieId), tracks };
}

export interface ManifestWindow {
  JSON: { parse: typeof JSON.parse };
  Response?: { prototype: { json(): Promise<unknown> } };
}

/**
 * Watches Netflix parse its manifest (MAIN world, installed at document_start) and reports the text tracks.
 * Never throws into Netflix's code.
 */
export function installManifestCapture(win: ManifestWindow, onManifest: (manifest: CapturedManifest) => void): () => void {
  const report = (value: unknown) => {
    try {
      const manifest = extractTextTracks(value);
      if (manifest) onManifest(manifest);
    } catch {
      // A capture problem must never break playback.
    }
  };

  const originalParse = win.JSON.parse;
  win.JSON.parse = function (this: unknown, text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) {
    const value = originalParse.call(this, text, reviver as Parameters<typeof JSON.parse>[1]);
    if (typeof text === 'string' && text.includes('timedtexttracks')) report(value);
    return value;
  } as typeof JSON.parse;

  const proto = win.Response?.prototype;
  const originalJson = proto?.json;
  if (proto && originalJson) {
    proto.json = function (this: unknown) {
      return originalJson.call(this).then((value: unknown) => {
        report(value);
        return value;
      });
    };
  }

  return () => {
    win.JSON.parse = originalParse;
    if (proto && originalJson) proto.json = originalJson;
  };
}

/** The most recent manifests by movie id (Netflix also loads manifests for previews). */
export function createManifestStore(limit = 10) {
  const byMovie = new Map<string, CapturedManifest>();
  return {
    add(manifest: CapturedManifest) {
      byMovie.delete(manifest.movieId);
      byMovie.set(manifest.movieId, manifest);
      while (byMovie.size > limit) byMovie.delete(byMovie.keys().next().value!);
    },
    get(movieId: string): CapturedManifest | undefined {
      return byMovie.get(movieId);
    },
  };
}
