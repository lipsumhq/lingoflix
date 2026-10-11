// LingoFlix — Netflix internals probe (v2).
// Paste into the DevTools console on a playing https://www.netflix.com/watch/<id> page
// (subtitles ON, a line visible). Run once normally and once while fullscreen (press F first).
// Prints a JSON report and returns it. Read-only: it never seeks, plays, or changes settings.
(() => {
  const report = { probeVersion: 2, url: location.href, at: new Date().toISOString(), userAgent: navigator.userAgent };
  const q = (s) => document.querySelector(s);
  const describe = (el) =>
    el && {
      tag: el.tagName,
      id: el.id || null,
      className: String(el.className || '') || null,
      dataUia: el.getAttribute && el.getAttribute('data-uia'),
    };
  const isPrimitive = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  const shallow = (o) => o && Object.fromEntries(Object.entries(o).filter(([, v]) => isPrimitive(v)));
  // Depth-limited structural dump: primitives as-is, arrays as {length, first}, objects by key.
  const peek = (v, depth = 2) => {
    if (isPrimitive(v) || v === undefined) return v;
    if (typeof v === 'function') return '[function]';
    if (Array.isArray(v)) return { length: v.length, first: v.length ? peek(v[0], depth - 1) : null };
    if (depth <= 0) return `[object keys: ${Object.keys(v).slice(0, 25).join(', ')}]`;
    const out = {};
    for (const k of Object.keys(v).slice(0, 40)) {
      try {
        out[k] = peek(v[k], depth - 1);
      } catch (e) {
        out[k] = `[throws ${e}]`;
      }
    }
    return out;
  };
  const safe = (fn) => {
    try {
      return fn();
    } catch (e) {
      return { error: String(e) };
    }
  };
  const methodsOf = (obj) => {
    const names = new Set();
    for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const k of Object.getOwnPropertyNames(o)) {
        if (k === 'constructor') continue;
        try {
          if (typeof obj[k] === 'function') names.add(k);
        } catch {}
      }
    }
    return [...names].sort();
  };

  // 1. Subtitle layer, its text structure, and its ancestors (where an overlay could mount)
  const layer = q('.player-timedtext');
  const ancestors = [];
  for (let el = layer && layer.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    ancestors.push(describe(el));
  }
  report.subtitles = {
    playerTimedtext: describe(layer),
    textContainers: [...document.querySelectorAll('.player-timedtext-text-container')].map((c) => ({
      text: c.innerText,
      spanCount: c.querySelectorAll('span').length,
      rect: (({ x, y, width, height }) => ({ x, y, width, height }))(c.getBoundingClientRect()),
    })),
    layerPointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
    ancestors,
  };

  // 2. Player API
  let p = null;
  try {
    const vp = netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const ids = vp.getAllPlayerSessionIds();
    const id = ids.find((s) => s.startsWith('watch')) ?? ids[0];
    p = vp.getVideoPlayerBySessionId(id);
    const video = q('video');
    report.player = {
      sessionIds: ids,
      methods: methodsOf(p),
      getCurrentTime: p.getCurrentTime(),
      getSegmentTime: safe(() => p.getSegmentTime()),
      videoElementCurrentTimeSeconds: video ? video.currentTime : null,
      getDuration: p.getDuration(),
      videoElementDurationSeconds: video ? video.duration : null,
      isPaused: p.isPaused(),
      getPlaybackRate: safe(() => p.getPlaybackRate()),
      movieId: safe(() => p.getMovieId()),
      getElement: safe(() => describe(p.getElement())),
      timedTextTrack: safe(() => shallow(p.getTimedTextTrack())),
      timedTextTrackKeys: safe(() => Object.keys(p.getTimedTextTrack())),
      timedTextTrackCount: safe(() => p.getTimedTextTrackList().length),
      isTimedTextVisible: safe(() => p.isTimedTextVisible()),
      getTimedTextSettings: safe(() => peek(p.getTimedTextSettings(), 2)),
      getTimeCodes: safe(() => peek(p.getTimeCodes(), 2)),
      getChapters: safe(() => peek(p.getChapters(), 2)),
      audioTrack: safe(() => shallow(p.getAudioTrack())),
    };
  } catch (e) {
    report.player = { error: String(e) };
  }

  // 4. Title metadata (series / season / episode)
  report.metadata = safe(() => {
    const state = netflix.appContext.state.playerApp.getState();
    const vm = state.videoPlayer && state.videoPlayer.videoMetadata;
    const movieId = (location.pathname.match(/\/watch\/(\d+)/) || [])[1];
    const entry = vm && movieId && vm[movieId];
    return {
      playerAppStateKeys: Object.keys(state),
      videoPlayerStateKeys: state.videoPlayer ? Object.keys(state.videoPlayer) : null,
      entryKeys: entry ? Object.keys(entry) : null,
      entryMethods: entry ? methodsOf(entry) : null,
      _video: entry ? peek(entry._video, 2) : null,
      _seasons: entry ? peek(entry._seasons, 3) : null,
      _metadataObject: entry ? peek(entry._metadataObject, 3) : null,
    };
  });
  const titleEl = q('[data-uia="video-title"]');
  report.titleDom = {
    videoTitle: titleEl ? titleEl.innerText : null,
    children: titleEl ? [...titleEl.querySelectorAll('*')].map((c) => ({ ...describe(c), text: c.textContent })) : null,
    documentTitle: document.title,
  };

  // 3. Subtitle file downloads seen so far (for Plan 2's context capture)
  report.resources = performance
    .getEntriesByType('resource')
    .filter((r) => /nflxvideo\.net|nflxso\.net|netflix\.com\/.*(timedtext|manifest|licensedManifest)/i.test(r.name))
    .filter((r) => ['xmlhttprequest', 'fetch'].includes(r.initiatorType))
    .slice(-40)
    .map((r) => ({
      host: (() => {
        try {
          return new URL(r.name).host;
        } catch {
          return null;
        }
      })(),
      path: (() => {
        try {
          return new URL(r.name).pathname.slice(0, 80);
        } catch {
          return null;
        }
      })(),
      initiatorType: r.initiatorType,
      transferSize: r.transferSize,
      decodedBodySize: r.decodedBodySize,
    }));

  // 6. Fullscreen
  const fs = document.fullscreenElement;
  report.fullscreen = fs
    ? { element: describe(fs), containsSubtitles: !!(layer && fs.contains(layer)) }
    : 'not fullscreen — press F and run again';

  console.log(JSON.stringify(report, null, 2));
  return report;
})();
