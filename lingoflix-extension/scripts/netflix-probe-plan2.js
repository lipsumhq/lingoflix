// LingoFlix — Netflix internals probe for Plan 2 (v3). Read-only, except a test box it adds and removes.
//
// 1. Open a SERIES episode at https://www.netflix.com/watch/<id>. Turn subtitles on (a text language, not "Off").
// 2. DevTools → Console → paste this whole file → Enter.
// 3. In the player, open the episode list and click a DIFFERENT episode (Netflix switches without reloading).
//    Let it play until a subtitle line is on screen, then pause with Space while the line is still visible.
// 4. Run:  await lfProbe.report()   → copy the JSON it prints.
// 5. Run:  lfProbe.isolationTest()  → click inside the yellow box at the top of the player, press Space twice,
//    then run:  lfProbe.isolationResult()  → copy what it prints.
// 6. Run:  lfProbe.restore()
(() => {
  const captured = [];
  const inspect = (value, via) => {
    try {
      const root = value && (value.result ?? value);
      if (root && Array.isArray(root.timedtexttracks)) {
        captured.push({ via, movieId: root.movieId ?? null, tracks: root.timedtexttracks });
      }
    } catch {}
  };

  const origParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const value = origParse.call(this, text, reviver);
    if (typeof text === 'string' && text.includes('timedtexttracks')) inspect(value, 'JSON.parse');
    return value;
  };
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    return origJson.call(this).then((value) => {
      inspect(value, 'Response.json');
      return value;
    });
  };

  const api = () => netflix.appContext.state.playerApp.getAPI().videoPlayer;
  const player = () => {
    const ids = api().getAllPlayerSessionIds().filter((s) => s.startsWith('watch'));
    return api().getVideoPlayerBySessionId(ids.at(-1));
  };
  const redact = (url) => {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}${u.pathname.slice(0, 40)}… (${u.search.length} query chars)`;
    } catch {
      return String(url).slice(0, 60);
    }
  };
  const urlsOf = (d) => [...(d?.urls ?? []).map((u) => u?.url ?? u), ...Object.values(d?.downloadUrls ?? {})].filter((u) => typeof u === 'string');
  const summarizeTrack = (t) => ({
    keys: Object.keys(t),
    new_track_id: t.new_track_id,
    id: t.id,
    trackId: t.trackId,
    language: t.language,
    languageDescription: t.languageDescription,
    rawTrackType: t.rawTrackType,
    trackType: t.trackType,
    isNoneTrack: t.isNoneTrack,
    isForcedNarrative: t.isForcedNarrative,
    isImageBased: t.isImageBased,
    downloadables: Object.fromEntries(
      Object.entries(t.ttDownloadables ?? {}).map(([profile, d]) => [
        profile,
        { keys: Object.keys(d ?? {}), firstUrl: urlsOf(d).slice(0, 1).map(redact), isImage: d?.isImage },
      ]),
    ),
  });

  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const compareClock = (body, displayed, p) => {
    const tickRate = Number(/tickRate="(\d+)"/.exec(body)?.[1] ?? 0);
    const toMs = (v) => {
      if (!v) return null;
      let m;
      if ((m = /^(\d+(?:\.\d+)?)t$/.exec(v))) return tickRate ? Math.round((Number(m[1]) / tickRate) * 1000) : null;
      if ((m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v))) return Math.round((+m[1] * 3600 + +m[2] * 60 + Number(m[3])) * 1000);
      if ((m = /^(\d+(?:\.\d+)?)(h|m|s|ms)$/.exec(v))) return Math.round(Number(m[1]) * { h: 3600000, m: 60000, s: 1000, ms: 1 }[m[2]]);
      return null;
    };
    const cues = [...body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].map(([, attrs, inner]) => ({
      begin: toMs(/\bbegin="([^"]+)"/.exec(attrs)?.[1]),
      end: toMs(/\bend="([^"]+)"/.exec(attrs)?.[1]),
      text: norm(inner.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')),
    }));
    const target = norm(displayed);
    const seg = p.getSegmentTime();
    const cur = p.getCurrentTime();
    const matches = cues.filter((c) => c.text && target && (c.text === target || target.includes(c.text)));
    const best = matches.sort((a, b) => Math.abs(a.begin - seg) - Math.abs(b.begin - seg))[0] ?? null;
    return {
      tickRate,
      cueCount: cues.length,
      firstCue: cues[0] ?? null,
      matchedCue: best,
      segmentTime: seg,
      currentTime: cur,
      segMinusCueBegin: best ? seg - best.begin : null,
      curMinusCueBegin: best ? cur - best.begin : null,
    };
  };

  let isolation = null;
  window.lfProbe = {
    async report() {
      const p = player();
      const current = p.getTimedTextTrack?.() ?? null;
      const displayed = [...document.querySelectorAll('.player-timedtext-text-container')].map((c) => c.innerText).join('\n');
      const last = captured.at(-1) ?? null;
      const match = last?.tracks.find((t) => current && [t.new_track_id, t.id, t.trackId].includes(current.trackId)) ?? null;
      const fetches = {};
      let clock = null;
      if (match) {
        for (const [profile, d] of Object.entries(match.ttDownloadables ?? {})) {
          const url = urlsOf(d)[0];
          if (!url) continue;
          try {
            const res = await fetch(url);
            const body = await res.text();
            fetches[profile] = { status: res.status, type: res.headers.get('content-type'), length: body.length, head: body.slice(0, 300) };
            if (!clock && /<tt[\s>]/.test(body)) clock = compareClock(body, displayed, p);
          } catch (e) {
            fetches[profile] = { error: String(e) };
          }
        }
      }
      const out = {
        probeVersion: 3,
        path: location.pathname,
        movieId: p.getMovieId?.(),
        captures: captured.map((c) => ({ via: c.via, movieId: c.movieId, trackCount: c.tracks.length })),
        currentTrack: current && {
          trackId: current.trackId,
          bcp47: current.bcp47,
          rawTrackType: current.rawTrackType,
          isImageBased: current.isImageBased,
          isNoneTrack: current.isNoneTrack,
        },
        displayed,
        matchedTrack: match ? summarizeTrack(match) : null,
        allTracks: last
          ? last.tracks.slice(0, 40).map((t) => ({
              new_track_id: t.new_track_id,
              language: t.language,
              rawTrackType: t.rawTrackType,
              isNoneTrack: t.isNoneTrack,
              isImageBased: t.isImageBased,
              profiles: Object.keys(t.ttDownloadables ?? {}),
            }))
          : null,
        fetches,
        clock,
        htmlFontSize: getComputedStyle(document.documentElement).fontSize,
        times: { segment: p.getSegmentTime(), current: p.getCurrentTime(), duration: p.getDuration() },
      };
      console.log(JSON.stringify(out, null, 2));
      return 'printed above';
    },

    isolationTest() {
      const anchor = document.querySelector('div.watch-video[data-uia="watch-video"]');
      if (!anchor) return 'no player container';
      const host = document.createElement('div');
      host.id = 'lf-probe-host';
      host.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML =
        '<input style="width:280px;padding:10px;border-radius:12px;border:3px solid #ffc800;background:#fff7d6;font:16px system-ui" placeholder="Click here, press Space twice">';
      // Same as WXT createShadowRootUi({ isolateEvents: [...] }): stop these events at the host as they bubble out.
      const stopped = ['keydown', 'keyup', 'keypress', 'click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel', 'contextmenu'];
      for (const type of stopped) host.addEventListener(type, (e) => e.stopPropagation());
      anchor.append(host);
      isolation = { pausedBefore: player().isPaused(), timeBefore: player().getSegmentTime() };
      return 'Click inside the yellow box, press Space twice, then run lfProbe.isolationResult()';
    },

    isolationResult() {
      const input = document.getElementById('lf-probe-host')?.shadowRoot?.querySelector('input');
      const out = {
        ...isolation,
        pausedAfter: player().isPaused(),
        timeAfter: player().getSegmentTime(),
        inputValue: JSON.stringify(input?.value ?? null),
      };
      console.log(JSON.stringify(out, null, 2));
      return 'printed above';
    },

    restore() {
      JSON.parse = origParse;
      Response.prototype.json = origJson;
      document.getElementById('lf-probe-host')?.remove();
      delete window.lfProbe;
      return 'restored';
    },
  };
  console.log('lfProbe ready. Switch to a different episode from the player, pause on a subtitle line, then: await lfProbe.report()');
})();
