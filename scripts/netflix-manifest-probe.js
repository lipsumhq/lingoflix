// LingoFlix: find where Netflix keeps subtitle-file URLs. Read-only; nothing is sent anywhere.
//
// 1. On a Netflix episode that is playing with text subtitles on, open DevTools → Console, paste this file, press Enter.
//    It prints "part 1" at once: where subtitle track lists live in the player's memory.
// 2. Without reloading, leave the player (back arrow, top left) and start an episode of a DIFFERENT show.
//    When a subtitle line is on screen, type lfReport() in the console and press Enter. It prints "part 2".
// Copy both printed JSON blocks. lfRestore() removes the probe's hooks.
(() => {
  const TEXT_KEY = /timedtext|ttdownload|texttrack/i;
  const STRONG_KEY = /^(timedtexttracks|ttDownloadables)$/i;

  const redact = (s) => {
    try {
      const u = new URL(s, location.href);
      return `${u.host}${u.pathname.slice(0, 40)}${u.search ? ` (+${u.search.length} query chars)` : ''}`;
    } catch {
      return String(s).slice(0, 40);
    }
  };
  const isUrl = (s) => typeof s === 'string' && /^https?:\/\//.test(s);
  const short = (v) => (typeof v === 'string' ? (isUrl(v) ? redact(v) : v.slice(0, 80)) : v);
  const interestingUrl = (s) => {
    try {
      const u = new URL(s, location.href);
      if (/nflxvideo\.net$/.test(u.host)) return !u.pathname.startsWith('/range/');
      return /manifest|playapi|cadmium|licen[cs]e|timedtext|pbo_|msl/i.test(u.pathname);
    } catch {
      return false;
    }
  };
  const call = (f) => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };

  const findPlayer = () => {
    const app = call(() => window.netflix.appContext.state.playerApp);
    const vp = call(() => app.getAPI().videoPlayer);
    const sid = call(() => vp.getAllPlayerSessionIds().find((s) => s.startsWith('watch')));
    const player = sid ? call(() => vp.getVideoPlayerBySessionId(sid)) : undefined;
    return { app, player };
  };
  const currentTrackId = () => call(() => String(findPlayer().player.getTimedTextTrack().trackId)) ?? null;

  // ---- Part 1: search memory (data properties only, so no getters run) ----
  const skip = (v) => {
    if (!v || typeof v !== 'object') return true;
    try {
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return true;
      if (typeof Node !== 'undefined' && v instanceof Node) return true;
      const tag = Object.prototype.toString.call(v);
      return tag === '[object Window]' || tag === '[object Location]' || tag === '[object CSSStyleDeclaration]';
    } catch {
      return true;
    }
  };
  const childrenOf = (obj) => {
    if (obj instanceof Map) return [...obj].slice(0, 500).map(([k, v]) => [`get(${short(String(k))})`, v]);
    if (obj instanceof Set) return [...obj].slice(0, 500).map((v, i) => [`[set ${i}]`, v]);
    if (Array.isArray(obj)) return obj.slice(0, 500).map((v, i) => [`[${i}]`, v]);
    const out = [];
    for (const key of Object.getOwnPropertyNames(obj)) {
      const d = Object.getOwnPropertyDescriptor(obj, key);
      if (d && 'value' in d) out.push([key, d.value]);
    }
    return out;
  };
  const primitives = (o) => {
    const out = {};
    for (const [k, v] of Object.entries(o).slice(0, 40)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = short(v);
    }
    return out;
  };
  const urlHosts = (d) => {
    const found = new Set();
    const walk = (v, n) => {
      if (n > 4 || found.size > 3) return;
      if (isUrl(v)) found.add(redact(v));
      else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, n + 1);
    };
    walk(d, 0);
    return [...found];
  };
  const downloadables = (dl) =>
    Object.fromEntries(
      Object.entries(dl)
        .slice(0, 12)
        .map(([profile, d]) => [profile, d && typeof d === 'object' ? { keys: Object.keys(d), urls: urlHosts(d) } : typeof d]),
    );
  const summarize = (path, value, trackId) => {
    const s = { path: path.slice(0, 240) };
    try {
      if (Array.isArray(value)) {
        s.type = `array(${value.length})`;
        const objs = value.filter((v) => v && typeof v === 'object');
        if (objs[0]) s.firstKeys = Object.keys(objs[0]).slice(0, 50);
        s.samples = objs.slice(0, 2).map(primitives);
        if (trackId) {
          s.keysEqualToCurrentTrackId = [...new Set(objs.flatMap((o) => Object.keys(o).filter((k) => String(o[k]) === trackId)))];
        }
        const dl = objs.map((o) => o.ttDownloadables).find((d) => d && typeof d === 'object' && Object.keys(d).length > 0);
        if (dl) s.ttDownloadables = downloadables(dl);
      } else if (value && typeof value === 'object') {
        s.type = value.constructor?.name ?? 'object';
        s.keys = Object.keys(value).slice(0, 50);
        if (/ttdownload/i.test(path)) s.ttDownloadables = downloadables(value);
      } else {
        s.type = typeof value;
        s.value = short(String(value));
      }
    } catch (e) {
      s.error = String(e);
    }
    return s;
  };
  const search = (roots, trackId) => {
    const strong = [];
    const other = [];
    const seen = new WeakSet();
    const recorded = new WeakSet();
    const queue = [];
    for (const [path, v] of roots) if (!skip(v)) queue.push([path, v, 0]);
    let i = 0;
    for (; i < queue.length && i < 400000; i++) {
      const [path, obj, depth] = queue[i];
      if (seen.has(obj)) continue;
      seen.add(obj);
      let kids;
      try {
        kids = childrenOf(obj);
      } catch {
        continue;
      }
      for (const [key, value] of kids) {
        const childPath = `${path}.${key}`;
        if (TEXT_KEY.test(key) && typeof value !== 'function' && !(value && typeof value === 'object' && recorded.has(value))) {
          if (value && typeof value === 'object') recorded.add(value);
          const s = summarize(childPath, value, trackId);
          const isStrong = STRONG_KEY.test(key) || s.ttDownloadables || s.keysEqualToCurrentTrackId?.length;
          const list = isStrong ? strong : other;
          if (list.length < 15) list.push(s);
        }
        if (depth < 16 && queue.length < 1000000 && !skip(value) && !seen.has(value)) queue.push([childPath, value, depth + 1]);
      }
    }
    return { visited: i, queued: queue.length, strong, other };
  };
  const roots = () => {
    const { app, player } = findPlayer();
    return [
      ['player', player],
      ['internalPlayer', call(() => player.getInternalPlayer())],
      ['playgraph', call(() => player.getPlaygraphManager())],
      ['playerAppState', call(() => app.getState())],
      ['netflix', window.netflix],
    ];
  };
  const snapshot = () => {
    const trackId = currentTrackId();
    return { path: location.pathname, trackId, search: search(roots(), trackId) };
  };

  // ---- Part 2: watch how the next title's data arrives ----
  const events = [];
  const log = (e) => {
    if (events.length < 150) events.push({ t: Math.round(performance.now() / 100) / 10, ...e });
  };
  const shallowKeys = (v) => {
    if (!v || typeof v !== 'object') return { valueType: typeof v };
    const r = v.result && typeof v.result === 'object' ? v.result : null;
    return { keys: Object.keys(v).slice(0, 30), resultKeys: r ? Object.keys(r).slice(0, 40) : undefined };
  };
  const mentionsText = (s) => typeof s === 'string' && /timedtext|ttdownload/i.test(s);
  const keysMentionText = (v) => mentionsText(JSON.stringify(shallowKeys(v)));

  const restore = [];
  const patch = (obj, name, make) => {
    const orig = obj?.[name];
    if (typeof orig !== 'function') return;
    obj[name] = make(orig);
    restore.push(() => {
      obj[name] = orig;
    });
  };

  patch(JSON, 'parse', (orig) =>
    function (text, reviver) {
      const value = orig.call(this, text, reviver);
      try {
        if (typeof text === 'string' && text.length > 1000 && mentionsText(text)) log({ via: 'JSON.parse', length: text.length, ...shallowKeys(value) });
      } catch {}
      return value;
    },
  );
  const RP = typeof Response !== 'undefined' ? Response.prototype : undefined;
  patch(RP, 'json', (orig) =>
    function () {
      const url = this.url;
      return orig.call(this).then((v) => {
        try {
          if (interestingUrl(url) || keysMentionText(v)) log({ via: 'Response.json', url: redact(url), ...shallowKeys(v) });
        } catch {}
        return v;
      });
    },
  );
  patch(RP, 'text', (orig) =>
    function () {
      const url = this.url;
      return orig.call(this).then((t) => {
        try {
          if (interestingUrl(url) || mentionsText(t)) log({ via: 'Response.text', url: redact(url), length: t.length, mentionsText: mentionsText(t) });
        } catch {}
        return t;
      });
    },
  );
  patch(RP, 'arrayBuffer', (orig) =>
    function () {
      const url = this.url;
      return orig.call(this).then((b) => {
        try {
          if (interestingUrl(url)) log({ via: 'Response.arrayBuffer', url: redact(url), size: b.byteLength });
        } catch {}
        return b;
      });
    },
  );
  patch(window, 'fetch', (orig) =>
    function (input, init) {
      const url = typeof input === 'string' ? input : (input?.url ?? String(input));
      const p = orig.apply(this, arguments);
      if (interestingUrl(url)) {
        p.then(
          (r) => log({ via: 'fetch', method: init?.method ?? input?.method ?? 'GET', url: redact(url), status: r.status, type: r.headers.get('content-type') }),
          () => {},
        );
      }
      return p;
    },
  );
  const XP = window.XMLHttpRequest?.prototype;
  patch(XP, 'open', (orig) =>
    function (method, url) {
      this.__lfMethod = method;
      this.__lfUrl = String(url);
      return orig.apply(this, arguments);
    },
  );
  patch(XP, 'send', (orig) =>
    function () {
      const xhr = this;
      if (interestingUrl(xhr.__lfUrl)) {
        xhr.addEventListener('loadend', () => {
          const info = {};
          try {
            info.responseType = xhr.responseType;
            if (xhr.responseType === 'json') Object.assign(info, shallowKeys(xhr.response));
            else if (xhr.responseType === '' || xhr.responseType === 'text') info.mentionsText = mentionsText(xhr.responseText);
            else info.size = xhr.response?.byteLength ?? xhr.response?.size;
          } catch {}
          log({ via: 'XHR', method: xhr.__lfMethod, url: redact(xhr.__lfUrl), status: xhr.status, ...info });
        });
      }
      return orig.apply(this, arguments);
    },
  );
  for (const name of ['Worker', 'SharedWorker']) {
    const Orig = window[name];
    if (typeof Orig !== 'function') continue;
    const Wrapped = function (url, opts) {
      log({ via: name, url: String(url).slice(0, 60) });
      return new Orig(url, opts);
    };
    Wrapped.prototype = Orig.prototype;
    window[name] = Wrapped;
    restore.push(() => {
      window[name] = Orig;
    });
  }

  const resources = [];
  const addEntry = (e) => {
    if (interestingUrl(e.name) && resources.length < 100) {
      resources.push({ t: Math.round(e.startTime / 100) / 10, initiator: e.initiatorType, url: redact(e.name), size: e.transferSize || e.decodedBodySize || 0 });
    }
  };
  call(() => performance.getEntriesByType('resource').forEach(addEntry));
  call(() => new PerformanceObserver((list) => list.getEntries().forEach(addEntry)).observe({ type: 'resource' }));

  const print = (label, data) => console.log(JSON.stringify({ probe: `manifest-v1 ${label}`, ...data }, null, 2));
  print('part 1', { ...snapshot(), resources: resources.slice() });
  window.lfReport = () => print('part 2', { ...snapshot(), events, resources });
  window.lfRestore = () => restore.forEach((f) => f());
})();
