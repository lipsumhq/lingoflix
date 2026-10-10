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
const isId = (value: unknown): value is string | number => typeof value === 'string' || typeof value === 'number';

/*
 * Manifests may be read from Netflix's own objects (MAIN world), so everything here reads own data
 * properties only, and arrays by index: no getter, iterator, or method of Netflix's runs.
 */
function field(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d && 'value' in d ? d.value : undefined;
}

const MAX_ITEMS = 1000;

function items(list: unknown): unknown[] {
  if (!Array.isArray(list)) return [];
  const length = field(list, 'length');
  if (typeof length !== 'number') return [];
  const out: unknown[] = [];
  for (let i = 0; i < Math.min(length, MAX_ITEMS); i++) out.push(field(list, String(i)));
  return out;
}

function entries(obj: unknown): [string, unknown][] {
  if (!isRecord(obj)) return [];
  return Object.getOwnPropertyNames(obj).map((key) => [key, field(obj, key)]);
}

/** Text profiles we can parse, best first. Image profiles (e.g. `nflx-cmisc`) are not text. */
const TEXT_PROFILES = [/^dfxp/, /^imsc/, /^simplesdh/, /^webvtt/, /ttml/];

function idsOf(track: Record<string, unknown>): string[] {
  return ['new_track_id', 'id', 'trackId']
    .map((key) => field(track, key))
    .filter(isId)
    .map(String);
}

function urlsOf(download: unknown): string[] {
  const listed = items(field(download, 'urls')).map((u) => (isRecord(u) ? field(u, 'url') : u));
  const mapped = entries(field(download, 'downloadUrls')).map(([, u]) => u);
  return [...listed, ...mapped].filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));
}

/** Netflix's name for the track list: `textTracks` now, `timedtexttracks` before (both can be present). */
const TRACK_LISTS = ['textTracks', 'timedtexttracks'] as const;

export function extractTextTracks(parsed: unknown): CapturedManifest | null {
  const wrapped = field(parsed, 'result');
  const root = isRecord(wrapped) ? wrapped : parsed;
  if (!isRecord(root)) return null;
  const lists = TRACK_LISTS.map((key) => field(root, key)).filter(Array.isArray);
  if (!lists.length) return null;
  const movieId = field(root, 'movieId');
  if (!isId(movieId)) return null;
  return { movieId: String(movieId), tracks: mergeTracks(lists.map(tracksFrom)) };
}

/**
 * Both lists can describe the same tracks. A track from a later list joins the earlier list's track
 * that shares an id (keeping every id, and the files if only the later one has them); tracks within
 * one list are never merged.
 */
function mergeTracks([first = [], ...rest]: CapturedTrack[][]): CapturedTrack[] {
  const merged = [...first];
  for (const list of rest) {
    const earlier = merged.length;
    for (const track of list) {
      const i = merged.findIndex((t, at) => at < earlier && t.ids.some((id) => track.ids.includes(id)));
      if (i === -1) {
        merged.push(track);
        continue;
      }
      const kept = merged[i]!;
      const ids = [...kept.ids, ...track.ids.filter((id) => !kept.ids.includes(id))];
      merged[i] = kept.urls.length === 0 && track.urls.length > 0 ? { ...track, ids } : { ...kept, ids };
    }
  }
  return merged;
}

function tracksFrom(list: unknown): CapturedTrack[] {
  const tracks: CapturedTrack[] = [];
  for (const raw of items(list)) {
    if (!isRecord(raw)) continue;
    const ids = idsOf(raw);
    if (!ids.length) continue;
    const downloads = entries(field(raw, 'ttDownloadables'));
    const text = downloads
      .map(([profile, d]) => ({
        rank: TEXT_PROFILES.findIndex((re) => re.test(profile)),
        image: field(d, 'isImage') === true,
        urls: urlsOf(d),
      }))
      .filter((d) => d.rank >= 0 && !d.image && d.urls.length > 0)
      .sort((a, b) => a.rank - b.rank);
    const language = field(raw, 'language');
    tracks.push({
      ids,
      language: typeof language === 'string' ? language : '',
      isImageBased: field(raw, 'isImageBased') === true || (downloads.length > 0 && text.length === 0),
      isNone: field(raw, 'isNoneTrack') === true,
      urls: text.flatMap((d) => d.urls),
    });
  }
  return tracks;
}

/** Where the playing title's manifest sits in `player.getInternalPlayer()` (docs/netflix-internals.md row 3). */
const MANIFEST_PATH = ['playback', 'segmentWithBoundObservables', 'manifest', 'manifestResult'];

/** If Netflix renames a step of that path: how deep to look (the path is 4), and how much to read in all. */
export const SEARCH_LIMITS = { depth: 6, reads: 50_000, keysPerObject: 2_000 } as const;
/** While the search misses, it runs at most this often per title (the content script asks on every line). */
export const SEARCH_COOLDOWN_MS = 5_000;

function internalPlayerOf(player: unknown): unknown {
  // A Netflix player API method, called on purpose like getSegmentTime().
  const get = typeof player === 'object' && player !== null ? (player as { getInternalPlayer?: unknown }).getInternalPlayer : undefined;
  return typeof get === 'function' ? get.call(player) : undefined;
}

/** The manifest of `movieId` itself: other manifests in memory (ads, previews) have another movieId. */
function manifestOf(candidate: unknown, movieId: string): CapturedManifest | null {
  const id = field(candidate, 'movieId');
  if (!isId(id) || String(id) !== movieId) return null;
  const manifest = extractTextTracks(candidate);
  return manifest?.movieId === movieId ? manifest : null;
}

/** The playing title's manifest at its known place in Netflix's player memory (MAIN world). Never throws. */
export function manifestAtKnownPath(player: unknown, movieId: string): CapturedManifest | undefined {
  try {
    let node = internalPlayerOf(player);
    for (const key of MANIFEST_PATH) node = field(node, key);
    return manifestOf(node, movieId) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Objects worth looking inside: not media buffers (huge), page elements (they lead into React), or windows. */
function walkable(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || value === globalThis) return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  if (typeof Window !== 'undefined' && value instanceof Window) return false;
  return typeof Node === 'undefined' || !(value instanceof Node);
}

/**
 * A bounded breadth-first search of Netflix's player memory for the manifest of `movieId` that lists
 * subtitle files, in case Netflix renames a step of the known path. Never throws.
 */
export function searchPlayerForManifest(player: unknown, movieId: string): CapturedManifest | undefined {
  let level: object[];
  try {
    const root = internalPlayerOf(player);
    level = walkable(root) ? [root] : [];
  } catch {
    return undefined;
  }
  const seen = new Set<object>();
  let reads = 0;
  for (let depth = 0; depth <= SEARCH_LIMITS.depth && level.length > 0; depth++) {
    const next: object[] = [];
    for (const obj of level) {
      if (seen.has(obj)) continue;
      if (reads >= SEARCH_LIMITS.reads) return undefined;
      seen.add(obj);
      try {
        reads++;
        // A copy without any file is no use: keep looking.
        const found = manifestOf(obj, movieId);
        if (found?.tracks.some((t) => t.urls.length > 0)) return found;
        const length = Array.isArray(obj) ? field(obj, 'length') : undefined;
        if (typeof length === 'number' && length > SEARCH_LIMITS.keysPerObject) continue;
        const keys = Object.getOwnPropertyNames(obj);
        reads += keys.length;
        if (keys.length > SEARCH_LIMITS.keysPerObject) continue;
        for (const key of keys) {
          const value = field(obj, key);
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

/**
 * Where the bridge gets a title's manifest: the player's memory at the known path, then what the
 * capture hook saw, then a search of player memory (at most once per cooldown while it misses).
 */
export function createManifestSource(captured: { get(movieId: string): CapturedManifest | undefined }, now: () => number = Date.now) {
  const searches = new Map<string, { at: number; found: CapturedManifest | undefined }>();
  return (movieId: string, player: unknown): CapturedManifest | undefined => {
    const known = manifestAtKnownPath(player, movieId) ?? captured.get(movieId);
    if (known) return known;
    const last = searches.get(movieId);
    if (last?.found) return last.found;
    if (last && now() - last.at < SEARCH_COOLDOWN_MS) return undefined;
    const found = searchPlayerForManifest(player, movieId);
    searches.set(movieId, { at: now(), found });
    return found;
  };
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
    if (typeof text === 'string' && (text.includes('timedtexttracks') || text.includes('"textTracks"'))) report(value);
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
      // Response.json sees many objects; one without files never replaces a capture that has them.
      const hasFiles = (m: CapturedManifest | undefined) => !!m?.tracks.some((t) => t.urls.length > 0);
      if (hasFiles(byMovie.get(manifest.movieId)) && !hasFiles(manifest)) return;
      byMovie.delete(manifest.movieId);
      byMovie.set(manifest.movieId, manifest);
      while (byMovie.size > limit) byMovie.delete(byMovie.keys().next().value!);
    },
    get(movieId: string): CapturedManifest | undefined {
      return byMovie.get(movieId);
    },
  };
}
