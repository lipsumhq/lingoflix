// LingoFlix: ask the installed extension's page bridge what it captured. Read-only.
//
// 1. With LingoFlix loaded, open a series episode at https://www.netflix.com/watch/<id> and RELOAD the page
//    (so LingoFlix's capture runs from the very start). Turn on text subtitles.
// 2. Let it play until a subtitle line is on screen, then pause with Space while the line is still visible.
// 3. DevTools → Console → paste this whole file → Enter. Copy the JSON it prints.
(async () => {
  const ask = (method) =>
    new Promise((resolve) => {
      const id = `check-${Math.random().toString(36).slice(2)}`;
      const onResponse = (event) => {
        let res;
        try {
          res = JSON.parse(event.detail);
        } catch {
          return;
        }
        if (res.id !== id) return;
        document.removeEventListener('lingoflix:bridge-response', onResponse);
        resolve(res);
      };
      document.addEventListener('lingoflix:bridge-response', onResponse);
      document.dispatchEvent(new CustomEvent('lingoflix:bridge-request', { detail: JSON.stringify({ id, method, args: [] }) }));
      setTimeout(() => {
        document.removeEventListener('lingoflix:bridge-response', onResponse);
        resolve({ timeout: true });
      }, 1000);
    });

  const redact = (url) => {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}${u.pathname.slice(0, 40)}… (${u.search.length} query chars)`;
    } catch {
      return String(url).slice(0, 60);
    }
  };
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

  const state = await ask('getState');
  const title = await ask('getTitle');
  const source = await ask('getSubtitleSource');
  const displayed = [...document.querySelectorAll('.player-timedtext-text-container')].map((c) => c.innerText).join('\n');

  let file = null;
  let clock = null;
  if (source.ok && source.result?.url) {
    try {
      const res = await fetch(source.result.url);
      const body = await res.text();
      file = { status: res.status, type: res.headers.get('content-type'), length: body.length, head: body.slice(0, 160) };
      const tickRate = Number(/tickRate="(\d+)"/.exec(body)?.[1] ?? 0);
      const toMs = (v) => {
        if (!v) return null;
        let m;
        if ((m = /^(\d+(?:\.\d+)?)t$/.exec(v))) return tickRate ? Math.round((Number(m[1]) / tickRate) * 1000) : null;
        if ((m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v))) return Math.round((+m[1] * 3600 + +m[2] * 60 + Number(m[3])) * 1000);
        return null;
      };
      const cues = [...body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].map(([, attrs, inner]) => ({
        begin: toMs(/\bbegin="([^"]+)"/.exec(attrs)?.[1]),
        end: toMs(/\bend="([^"]+)"/.exec(attrs)?.[1]),
        text: norm(inner.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')),
      }));
      const target = norm(displayed);
      const episodeMs = state.ok ? state.result.currentTimeMs : null;
      const matches = cues.filter((c) => c.text && target && (c.text === target || target.includes(c.text)));
      const best = episodeMs === null ? null : (matches.sort((a, b) => Math.abs(a.begin - episodeMs) - Math.abs(b.begin - episodeMs))[0] ?? null);
      clock = { cueCount: cues.length, matchedCue: best, episodeMs, episodeMinusCueBegin: best ? episodeMs - best.begin : null };
    } catch (e) {
      file = { error: String(e) };
    }
  }

  console.log(
    JSON.stringify(
      {
        check: 'bridge-v1',
        path: location.pathname,
        state,
        title,
        source: source.ok && source.result ? { ...source.result, url: redact(source.result.url) } : source,
        displayed,
        file,
        clock,
      },
      null,
      2,
    ),
  );
})();
