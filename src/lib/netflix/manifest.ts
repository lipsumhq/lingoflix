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

/** Netflix's name for the track list: `textTracks` now, `timedtexttracks` before (both can be present). */
const TRACK_LISTS = ['textTracks', 'timedtexttracks'] as const;

export function extractTextTracks(parsed: unknown): CapturedManifest | null {
  if (!isRecord(parsed)) return null;
  const root = isRecord(parsed.result) ? parsed.result : parsed;
  const lists = TRACK_LISTS.map((key) => root[key]).filter(Array.isArray);
  if (!lists.length) return null;
  const movieId = root.movieId;
  if (typeof movieId !== 'string' && typeof movieId !== 'number') return null;

  const parsedLists = lists.map(tracksFrom);
  const tracks = parsedLists.find((list) => list.some((t) => t.urls.length > 0)) ?? parsedLists[0]!;
  return { movieId: String(movieId), tracks };
}

function tracksFrom(list: unknown[]): CapturedTrack[] {
  const tracks: CapturedTrack[] = [];
  for (const raw of list) {
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
  return tracks;
}

/** Where the playing title's manifest sits in `player.getInternalPlayer()` (docs/netflix-internals.md row 3). */
const MANIFEST_PATH = ['playback', 'segmentWithBoundObservables', 'manifest', 'manifestResult'];
/** If Netflix renames a step of that path, search this deep (the path is 4) and no further. */
const SEARCH_DEPTH = 6;
const SEARCH_BUDGET = 20_000;

/** Reads a plain data property; getters are never run, so no Netflix code runs. */
function dataProperty(obj: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d && 'value' in d ? d.value : undefined;
}

function manifestOf(candidate: unknown, movieId: string): CapturedManifest | null {
  if (!isRecord(candidate) || String(dataProperty(candidate, 'movieId')) !== movieId) return null;
  return extractTextTracks(candidate);
}

/** Objects worth looking inside: not media buffers (huge) and not page elements (they lead into React). */
function walkable(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  return typeof Node === 'undefined' || !(value instanceof Node);
}

/**
 * The text tracks of `movieId`, read from Netflix's player memory (MAIN world): the known path first,
 * then a bounded breadth-first search. Other manifests there (ads, previews) have another movieId. Never throws.
 */
export function manifestFromPlayer(player: unknown, movieId: string): CapturedManifest | undefined {
  let internal: unknown;
  try {
    internal = (player as { getInternalPlayer?(): unknown } | null)?.getInternalPlayer?.();
    let known: unknown = internal;
    for (const key of MANIFEST_PATH) known = walkable(known) ? dataProperty(known, key) : undefined;
    const direct = manifestOf(known, movieId);
    if (direct) return direct;
  } catch {
    return undefined;
  }

  const seen = new Set<object>();
  let level: object[] = walkable(internal) ? [internal] : [];
  for (let depth = 0; depth <= SEARCH_DEPTH && level.length > 0; depth++) {
    const next: object[] = [];
    for (const obj of level) {
      if (seen.has(obj) || seen.size >= SEARCH_BUDGET) continue;
      seen.add(obj);
      try {
        const found = manifestOf(obj, movieId);
        if (found) return found;
        for (const key of Object.getOwnPropertyNames(obj)) {
          const value = dataProperty(obj, key);
          if (walkable(value) && !seen.has(value)) next.push(value);
        }
      } catch {
        // An object that refuses to be read is skipped.
      }
    }
    level = next;
  }
  return undefined;
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
