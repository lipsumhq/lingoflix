import { defineContentScript } from '#imports';
import { createElement } from 'react';
import { createBridgeClient } from '@/lib/bridge/client';
import { sendToBackground } from '@/lib/messages';
import { isWatchPath, parseWatchVideoId } from '@/lib/netflix/video-id';
import { loadSettings, updateSettings, watchSettings, type Settings } from '@/lib/settings';
import { createController } from './controller';
import { createNotifier } from './notice';
import type { CardState } from './overlay/card-state';
import { createExplainController } from './overlay/explain-controller';
import { connectExplainPort } from './overlay/explain-port';
import { mountOverlay, type OverlayHandle } from './overlay/mount';
import { OverlayApp } from './overlay/OverlayApp';
import { createPauseGuard } from './overlay/pause';
import { createOverlayRuntime } from './overlay/runtime';
import { createStore } from './overlay/store';
import { runPendingSeek } from './pending-seek-runner';
import { readDisplayedSubtitle, watchSubtitles } from './subtitle-dom';
import { createSubtitleSession } from './subtitle-session';

const SUBTITLE_FETCH_TIMEOUT_MS = 15_000;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(SUBTITLE_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Subtitle file: HTTP ${res.status}`);
  return res.text();
}

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  main(ctx) {
    const bridge = createBridgeClient(document);
    const notifier = createNotifier(document);
    const getVideoId = () => parseWatchVideoId(location.pathname);
    const isWatchPage = () => isWatchPath(location.pathname);
    const session = createSubtitleSession({ bridge, fetchText, getVideoId });
    const subtitleRects = () => readDisplayedSubtitle(document).rects;

    let settings: Settings | null = null;
    let overlay: OverlayHandle | null = null;
    let cardElement: HTMLElement | null = null;

    const store = createStore<CardState | null>(null);
    const pause = createPauseGuard(bridge);
    const explain = createExplainController({
      store,
      session,
      bridge,
      pause,
      connect: connectExplainPort,
      findExplanation: (videoId, language, phrase) => sendToBackground({ type: 'explanation:find', videoId, language, phrase }),
      saveItem: async (explanationId, suggestion) => (await sendToBackground({ type: 'item:save', explanationId, suggestion })).key,
      unsaveItem: async (explanationId, suggestion) => (await sendToBackground({ type: 'item:remove', explanationId, suggestion })).key,
      getSettings: () => settings,
      getVideoId,
      subtitleRects,
    });
    const runtime = createOverlayRuntime({
      explain,
      pause,
      getSettings: () => settings,
      isWatchPage,
      overlayReady: () => overlay?.playerRect() != null,
      subtitleRects,
      cardElement: () => cardElement,
      isInOverlay: (target) => overlay?.contains(target) ?? false,
    });
    const controller = createController({
      doc: document,
      bridge,
      notifier,
      session,
      overlay: runtime,
      updateSettings,
      isWatchPage,
      getVideoId,
      isValid: () => ctx.isValid,
    });

    const applySettings = (next: Settings) => {
      settings = next;
      controller.applySettings(next);
      runtime.onSettingsChanged();
      if (!next.enabled) runtime.teardown();
    };
    void loadSettings().then(applySettings);
    const unwatch = watchSettings(applySettings);
    const stopSubtitles = watchSubtitles(document, session.onDisplayed);

    ctx.addEventListener(window, 'keydown', controller.onKeyDown, { capture: true });
    ctx.addEventListener(window, 'keyup', controller.onKeyUp, { capture: true });
    ctx.addEventListener(document, 'mousemove', runtime.onMouseMove, { passive: true });
    // Window capture, before Netflix sees it: a click that dismisses a shortcut card is consumed.
    ctx.addEventListener(window, 'pointerdown', runtime.onPointerDown, { capture: true });
    let lastVideoId = getVideoId();
    let cancelPendingSeek: (() => void) | null = null;
    const startPendingSeek = (videoId: string | null) => {
      cancelPendingSeek?.();
      cancelPendingSeek = videoId
        ? runPendingSeek(videoId, {
            take: async (id) => (await sendToBackground({ type: 'pending-seek:take', videoId: id })).timeMs,
            bridge,
          })
        : null;
    };
    startPendingSeek(lastVideoId);
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      const videoId = getVideoId();
      if (videoId === lastVideoId) return;
      lastVideoId = videoId;
      runtime.onVideoChange();
      startPendingSeek(videoId);
    });

    void mountOverlay(
      ctx,
      createElement(OverlayApp, {
        store,
        // Close on the card closes like Escape: hover waits until the pointer leaves the line.
        explain: {
          regenerate: explain.regenerate,
          retry: explain.retry,
          askFollowUp: explain.askFollowUp,
          toggleSave: explain.toggleSave,
          close: runtime.closeCard,
        },
        playerRect: () => overlay?.playerRect() ?? null,
        openSettings: () => void sendToBackground({ type: 'open-options', hash: '#/settings' }),
        onCardElement: (element) => {
          cardElement = element;
        },
      }),
    ).then((handle) => {
      if (!ctx.isValid) return handle.remove(); // invalidated while mounting
      overlay = handle;
    });

    ctx.onInvalidated(() => {
      cancelPendingSeek?.();
      unwatch();
      stopSubtitles();
      runtime.teardown();
      overlay?.remove(); // also stops autoMount watching the page for this orphaned script
      bridge.dispose();
      controller.teardown();
    });
  },
});
