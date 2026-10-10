// LingoFlix: read the subtitle list from Netflix's player memory, download the current track's file,
// parse it with a copy of LingoFlix's TTML parser, and compare its line times with the player clocks.
// Read-only; nothing is sent anywhere except the subtitle download Netflix itself makes.
//
// 1. Reload the Netflix episode tab (Cmd + R) and turn on text subtitles.
// 2. Play until a subtitle line is on screen, then pause with Space while it is still showing.
// 3. DevTools → Console → paste this file → Enter. Copy the JSON it prints.
(async () => {
  const call = (f) => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const redact = (s) => {
    try {
      const u = new URL(s);
      return `${u.host}${u.pathname.slice(0, 40)} (+${u.search.length} query chars)`;
    } catch {
      return String(s).slice(0, 40);
    }
  };
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const own = (obj, key) => {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    return d && 'value' in d ? d.value : undefined;
  };

  // ---- Copy of src/lib/subtitles/ttml.ts (parseTtml) ----
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decodeEntities = (text) =>
    text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      return NAMED[body.toLowerCase()] ?? match;
    });
  const parseTtmlTime = (value, base) => {
    if (!value) return null;
    const v = value.trim();
    let m = /^(\d+(?:\.\d+)?)t$/.exec(v);
    if (m) return base.tickRate > 0 ? Math.round((Number(m[1]) / base.tickRate) * 1000) : null;
    m = /^(\d+(?:\.\d+)?)(h|m|s|ms|f)$/.exec(v);
    if (m) return Math.round(Number(m[1]) * { h: 3600000, m: 60000, s: 1000, ms: 1, f: 1000 / base.frameRate }[m[2]]);
    m = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+)|:(\d+(?:\.\d+)?))?$/.exec(v);
    if (m) {
      const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      const fraction = m[4] ? Number(`0.${m[4]}`) : m[5] ? Number(m[5]) / base.frameRate : 0;
      return Math.round((seconds + fraction) * 1000);
    }
    return null;
  };
  const attrValue = (tag, name) => {
    const m = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
    return m ? (m[1] ?? m[2]) : undefined;
  };
  const parseTtml = (xml) => {
    const ttTag = /<(?:[\w.-]+:)?tt\b[^>]*>/.exec(xml)?.[0] ?? '';
    const base = { tickRate: Number(attrValue(ttTag, 'tickRate')) || 1, frameRate: Number(attrValue(ttTag, 'frameRate')) || 30 };
    const cues = [];
    for (const [, attrs = '', inner = ''] of xml.matchAll(/<(?:[\w.-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?p>/g)) {
      const startMs = parseTtmlTime(attrValue(attrs, 'begin'), base);
      let endMs = parseTtmlTime(attrValue(attrs, 'end'), base);
      const durMs = parseTtmlTime(attrValue(attrs, 'dur'), base);
      if (endMs === null && startMs !== null && durMs !== null) endMs = startMs + durMs;
      if (startMs === null || endMs === null || endMs < startMs) continue;
      const withBreaks = inner.replace(/\s+/g, ' ').replace(/<(?:[\w.-]+:)?br\b[^>]*>/g, '\n');
      const text = decodeEntities(withBreaks.replace(/<[^>]+>/g, ''))
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
      if (text) cues.push({ startMs, endMs, text });
    }
    return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  };

  // ---- Player ----
  const app = call(() => window.netflix.appContext.state.playerApp);
  const vp = call(() => app.getAPI().videoPlayer);
  const sid = call(() => vp.getAllPlayerSessionIds().find((s) => s.startsWith('watch')));
  const player = sid ? call(() => vp.getVideoPlayerBySessionId(sid)) : undefined;
  if (!player) {
    console.log('LingoFlix probe: no Netflix player found. Open an episode first.');
    return;
  }
  const internal = call(() => player.getInternalPlayer());
  const movieId = call(() => String(player.getMovieId())) ?? null;
  const textTrack = call(() => player.getTimedTextTrack());
  const trackId = textTrack ? String(textTrack.trackId) : null;
  const clocks = { segment: call(() => player.getSegmentTime()) ?? null, current: call(() => player.getCurrentTime()) ?? null };
  const displayed = [...document.querySelectorAll('.player-timedtext-text-container')].map((c) => c.innerText).join('\n');

  // ---- Every subtitle list reachable from the internal player ----
  const found = [];
  const seen = new WeakSet();
  const queue = internal && typeof internal === 'object' ? [['internalPlayer', internal, 0]] : [];
  let visited = 0;
  for (let i = 0; i < queue.length && i < 80000; i++) {
    const [path, obj, depth] = queue[i];
    if (seen.has(obj)) continue;
    seen.add(obj);
    visited++;
    try {
      if ((typeof Node !== 'undefined' && obj instanceof Node) || ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) continue;
      const tracks = own(obj, 'textTracks') ?? own(obj, 'timedtexttracks');
      if (Array.isArray(tracks)) {
        let withFiles = 0;
        for (let j = 0; j < tracks.length; j++) if (tracks[j] && typeof tracks[j] === 'object' && own(tracks[j], 'ttDownloadables')) withFiles++;
        if (withFiles) found.push({ path, obj, tracks });
      }
      if (depth >= 9) continue;
      const kids = [];
      if (obj instanceof Map) Map.prototype.forEach.call(obj, (v, k) => kids.push([`get(${String(k).slice(0, 30)})`, v]));
      else for (const k of Object.getOwnPropertyNames(obj).slice(0, 600)) kids.push([k, own(obj, k)]);
      for (const [k, v] of kids) if (v && typeof v === 'object' && !seen.has(v)) queue.push([`${path}.${k}`, v, depth + 1]);
    } catch {
      // Skip objects that refuse to be read.
    }
  }

  const idsOf = (t) => ['new_track_id', 'id', 'trackId'].map((k) => own(t, k)).filter((v) => v !== undefined && v !== null).map(String);
  const trackIn = (tracks) => {
    for (const t of tracks) if (t && typeof t === 'object' && trackId && idsOf(t).includes(trackId)) return t;
    return null;
  };
  const fieldsOf = (o) => {
    const out = {};
    for (const k of Object.getOwnPropertyNames(o).slice(0, 300)) {
      const v = own(o, k);
      if ((typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && /id$|movie|viewable|duration|type|expir|ad/i.test(k)) {
        out[k] = typeof v === 'string' ? v.slice(0, 60) : v;
      }
    }
    return out;
  };
  const lists = found.map(({ path, obj, tracks }) => ({
    path,
    fields: fieldsOf(obj),
    keys: Object.keys(obj).slice(0, 60),
    trackCount: tracks.length,
    hasCurrentTrack: !!trackIn(tracks),
  }));

  const chosen = found.find((f) => String(own(f.obj, 'movieId')) === movieId && trackIn(f.tracks)) ?? found.find((f) => trackIn(f.tracks));
  const current = chosen ? trackIn(chosen.tracks) : null;
  const urlOf = (u) => (typeof u === 'string' ? u : u && typeof u === 'object' ? u.url : undefined);

  const files = {};
  const target = norm(displayed);
  if (current) {
    const downloads = own(current, 'ttDownloadables') || {};
    for (const profile of Object.keys(downloads)) {
      const d = downloads[profile];
      const urls = d && Array.isArray(d.urls) ? d.urls : [];
      const url = urlOf(urls[0]) ?? (d && d.downloadUrls ? Object.values(d.downloadUrls)[0] : undefined);
      const entry = {
        isImage: d?.isImage,
        urlCount: urls.length,
        urlEntryShape: urls[0] && typeof urls[0] === 'object' ? Object.keys(urls[0]) : typeof urls[0],
        url: url ? redact(url) : null,
      };
      files[profile] = entry;
      if (!url || d?.isImage) continue;
      try {
        const res = await fetch(url);
        const body = await res.text();
        const cues = parseTtml(body);
        Object.assign(entry, {
          status: res.status,
          contentType: res.headers.get('content-type'),
          length: body.length,
          ttTag: (/<(?:[\w.-]+:)?tt\b[^>]*>/.exec(body)?.[0] ?? body.slice(0, 120)).slice(0, 500),
          firstP: (/<(?:[\w.-]+:)?p\b[\s\S]*?<\/(?:[\w.-]+:)?p>/.exec(body)?.[0] ?? '').slice(0, 400),
          parsedCueCount: cues.length,
        });
        const matches = target ? cues.filter((c) => norm(c.text) && (norm(c.text) === target || target.includes(norm(c.text)))) : [];
        if (matches.length && clocks.segment !== null) {
          const best = matches.slice().sort((a, b) => Math.abs(a.startMs - clocks.segment) - Math.abs(b.startMs - clocks.segment))[0];
          entry.clock = {
            matchCount: matches.length,
            cue: { startMs: best.startMs, endMs: best.endMs },
            segmentMinusStart: clocks.segment - best.startMs,
            currentMinusStart: clocks.current === null ? null : clocks.current - best.startMs,
          };
        } else {
          entry.clock = { matchCount: 0 };
        }
      } catch (e) {
        entry.error = String(e);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        probe: 'track-v1',
        path: location.pathname,
        movieId,
        trackId,
        clocks,
        displayed,
        visited,
        lists,
        chosen: chosen ? { path: chosen.path, movieId: own(chosen.obj, 'movieId') ?? null } : null,
        currentTrack: current ? { ids: idsOf(current), language: own(current, 'language'), isNoneTrack: own(current, 'isNoneTrack'), profiles: Object.keys(own(current, 'ttDownloadables') || {}) } : null,
        files,
      },
      null,
      2,
    ),
  );
})();
