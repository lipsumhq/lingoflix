import type { BridgeClient } from '@/lib/bridge/client';
import { parseTitleInfo } from '@/lib/bridge/protocol';
import type { ExplainRequest } from '@/lib/claude/prompt';
import type { Settings } from '@/lib/settings';
import type { StudyLogEntry } from '@/lib/study-log/types';
import type { SubtitleSession } from '../subtitle-session';
import { IMAGE_SUBTITLES_MESSAGE, unionBox, type CardState, type FollowUpView } from './card-state';
import { streamExplanation, type Connect } from './explain-port';
import type { PauseGuard } from './pause';
import type { Store } from './store';

export interface ExplainControllerDeps {
  store: Store<CardState | null>;
  session: Pick<SubtitleSession, 'currentLine' | 'describe'>;
  bridge: Pick<BridgeClient, 'callSync'>;
  pause: Pick<PauseGuard, 'resume'>;
  connect: Connect;
  findEntry(videoId: string, language: string, phrase: string): Promise<StudyLogEntry | null>;
  getSettings(): Settings | null;
  getVideoId(): string | null;
  subtitleRects(): readonly Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[];
}

export interface ExplainController {
  /** Opens a card for the current line (spec §5.3 step 3). False when there is no line to explain. */
  open(openedBy: 'hover' | 'shortcut'): boolean;
  regenerate(): void;
  retry(): void;
  askFollowUp(question: string): void;
  /** Closes the card, aborts its requests, and resumes playback if LingoFlix paused it. */
  close(): void;
  isOpen(): boolean;
  openedBy(): 'hover' | 'shortcut' | null;
}

export function createExplainController(deps: ExplainControllerDeps): ExplainController {
  let nextKey = 1;
  let request: ExplainRequest | null = null;
  let cancelMain: (() => void) | null = null;
  let cancelFollowUp: (() => void) | null = null;

  const update = (key: number, fn: (card: CardState) => CardState) =>
    deps.store.update((card) => (card && card.key === key ? fn(card) : card));

  const stopRequests = () => {
    cancelMain?.();
    cancelFollowUp?.();
    cancelMain = null;
    cancelFollowUp = null;
  };

  const stream = (key: number, req: ExplainRequest) => {
    cancelMain?.();
    cancelMain = streamExplanation(deps.connect, { type: 'start', request: req }, {
      onDelta: (text) => update(key, (c) => ({ ...c, status: 'streaming', response: c.response + text })),
      onDone: (entry) => update(key, (c) => ({ ...c, status: 'done', response: entry.response, entry, error: null })),
      onError: (code, message) => update(key, (c) => ({ ...c, status: 'error', error: { code, message } })),
    });
  };

  const open = (openedBy: 'hover' | 'shortcut'): boolean => {
    const settings = deps.getSettings();
    const videoId = deps.getVideoId();
    if (!settings || !videoId) return false;
    const state = deps.bridge.callSync('getState');
    const imageBased = state.ok && state.result.textTrack?.isImageBased === true;
    const line = deps.session.currentLine();
    if (!line && !imageBased) return false;

    stopRequests();
    const key = nextKey++;
    const base: CardState = {
      key,
      line: line?.text ?? '',
      anchor: unionBox(deps.subtitleRects()),
      openedBy,
      status: 'loading',
      response: '',
      entry: null,
      error: null,
      followUps: [],
      followUpBusy: false,
      sections: settings.cardSections,
      fromStudyLog: false,
    };
    if (imageBased || !line) {
      request = null;
      deps.store.set({ ...base, status: 'error', error: { code: 'image-subs', message: IMAGE_SUBTITLES_MESSAGE } });
      return true;
    }

    const details = deps.session.describe(line);
    const title = deps.bridge.callSync('getTitle');
    const req: ExplainRequest = {
      phrase: line.text,
      context: details.context,
      title: title.ok ? parseTitleInfo(title.result) : null,
      videoId,
      videoTimeMs: details.timing?.startMs ?? (state.ok ? state.result.currentTimeMs : 0),
      language: settings.explanationLanguage,
      sections: settings.cardSections,
    };
    request = req;
    deps.store.set(base);
    deps.findEntry(videoId, req.language, req.phrase).then(
      (entry) => {
        if (deps.store.get()?.key !== key) return;
        if (!entry) return stream(key, req);
        update(key, (c) => ({
          ...c,
          status: 'done',
          response: entry.response,
          entry,
          fromStudyLog: true,
          followUps: entry.followUps.map((f) => ({ ...f, status: 'done', error: null })),
        }));
      },
      () => {
        if (deps.store.get()?.key === key) stream(key, req);
      },
    );
    return true;
  };

  /** Regenerate and Retry: ask Claude again for the same line; the saved entry is replaced on success. */
  const restart = () => {
    const card = deps.store.get();
    if (!card || !request) return;
    cancelFollowUp?.();
    cancelFollowUp = null;
    deps.store.set({ ...card, status: 'loading', response: '', error: null, followUps: [], followUpBusy: false, fromStudyLog: false });
    stream(card.key, request);
  };

  return {
    open,
    regenerate: restart,
    retry: restart,
    askFollowUp(question) {
      const card = deps.store.get();
      const settings = deps.getSettings();
      const text = question.trim();
      if (!card?.entry || card.followUpBusy || !text || !settings) return;
      const { key } = card;
      const index = card.followUps.length;
      deps.store.set({
        ...card,
        followUpBusy: true,
        followUps: [...card.followUps, { question: text, answer: '', status: 'streaming', error: null }],
      });
      const setFollowUp = (fn: (f: FollowUpView) => FollowUpView, extra: Partial<CardState> = {}) =>
        update(key, (c) => ({ ...c, ...extra, followUps: c.followUps.map((f, i) => (i === index ? fn(f) : f)) }));
      cancelFollowUp = streamExplanation(
        deps.connect,
        { type: 'follow-up', entryId: card.entry.id, question: text, sections: settings.cardSections },
        {
          onDelta: (delta) => setFollowUp((f) => ({ ...f, answer: f.answer + delta })),
          onDone: (entry) =>
            setFollowUp((f) => ({ ...f, status: 'done', answer: entry.followUps[index]?.answer ?? f.answer }), {
              entry,
              followUpBusy: false,
            }),
          onError: (_code, message) => setFollowUp((f) => ({ ...f, status: 'error', error: message }), { followUpBusy: false }),
        },
      );
    },
    close() {
      stopRequests();
      request = null;
      deps.store.set(null);
      deps.pause.resume();
    },
    isOpen: () => deps.store.get() !== null,
    openedBy: () => deps.store.get()?.openedBy ?? null,
  };
}
