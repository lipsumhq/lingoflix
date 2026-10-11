// LingoFlix — seek diagnostics.
// Paste into the DevTools console on a Netflix /watch page with LingoFlix loaded. Then:
//   1. Click the video once and make sure it is PAUSED (Space), so playback doesn't add time.
//   2. Press ← once. About 2.5 s later the console prints what happened at every layer.
//   3. In the console run:  lfSeekProbe.direct(-5000)
//      (Netflix's own player.seek, no LingoFlix involved) and wait for its report.
//   4. Run lfSeekProbe.restore() when done.
// It only observes, except direct(), which seeks once.
(() => {
  const api = netflix.appContext.state.playerApp.getAPI().videoPlayer;
  const player = () =>
    api.getVideoPlayerBySessionId(
      api
        .getAllPlayerSessionIds()
        .filter((s) => s.startsWith('watch'))
        .at(-1),
    );
  const video = () => document.querySelector('video');
  const snap = () => {
    const p = player();
    return {
      at: Math.round(performance.now()),
      playerMs: p.getCurrentTime(),
      segmentMs: p.getSegmentTime ? p.getSegmentTime() : null,
      videoMs: Math.round(video().currentTime * 1000),
      paused: p.isPaused(),
    };
  };

  const events = [];
  let pendingReport = null;
  const scheduleReport = (label, before) => {
    if (pendingReport) return;
    pendingReport = setTimeout(() => {
      const after = snap();
      console.log(
        JSON.stringify(
          {
            label,
            before,
            after,
            movedPlayerMs: after.playerMs - before.playerMs,
            movedVideoMs: after.videoMs - before.videoMs,
            events: events.splice(0),
          },
          null,
          2,
        ),
      );
      pendingReport = null;
    }, 2500);
  };

  // Layer 1: keys as the page sees them (bubble phase on document — LingoFlix swallows bound keys before this).
  const onKey = (e) => events.push({ layer: 'netflix-sees-key', type: e.type, code: e.code, repeat: e.repeat, ...snap() });
  // Layer 2/3: LingoFlix bridge traffic.
  const onReq = (e) => {
    const before = snap();
    events.push({ layer: 'bridge-request', detail: e.detail, ...before });
    scheduleReport('LingoFlix key press', before);
  };
  const onRes = (e) => events.push({ layer: 'bridge-response', detail: e.detail, ...snap() });
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);
  document.addEventListener('lingoflix:bridge-request', onReq);
  document.addEventListener('lingoflix:bridge-response', onRes);

  // Layer 4: Netflix player.seek calls (patched where the method lives).
  let owner = player();
  while (owner && !Object.prototype.hasOwnProperty.call(owner, 'seek')) owner = Object.getPrototypeOf(owner);
  const realSeek = owner.seek;
  owner.seek = function (ms, ...rest) {
    events.push({ layer: 'player.seek', arg: ms, extraArgs: rest.length, ...snap() });
    return realSeek.call(this, ms, ...rest);
  };
  const seekOwnedBy = owner === player() ? 'instance (may not catch LingoFlix calls)' : 'prototype';

  window.lfSeekProbe = {
    direct(deltaMs = -5000) {
      const before = snap();
      events.length = 0;
      player().seek(before.playerMs + deltaMs);
      scheduleReport(`direct player.seek(current ${deltaMs >= 0 ? '+' : ''}${deltaMs})`, before);
    },
    restore() {
      owner.seek = realSeek;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKey);
      document.removeEventListener('lingoflix:bridge-request', onReq);
      document.removeEventListener('lingoflix:bridge-response', onRes);
      delete window.lfSeekProbe;
      console.log('lfSeekProbe restored');
    },
  };
  console.log(`lfSeekProbe ready (seek patched on ${seekOwnedBy}). Pause the video, press ← once, then run lfSeekProbe.direct(-5000).`);
})();
