import type { BridgeClient } from '@/lib/bridge/client';
import { parseTitleInfo } from '@/lib/bridge/protocol';
import type { ExplainRequest } from '@/lib/ai/prompt';
import { fitStory } from '@/lib/ai/protocol';
import type { Settings } from '@/lib/settings';
import { suggestionKey } from '@/lib/study-log/items';
import type { Explanation, SaveSuggestion } from '@/lib/study-log/types';
import type { SubtitleSession } from '../subtitle-session';
import { IMAGE_SUBTITLES_MESSAGE, unionBox, type CardState, type FollowUpView, type SaveStatus } from './card-state';
import { streamExplanation, type Connect } from './explain-port';
import type { PauseGuard } from './pause';
import type { Store } from './store';

export interface ExplainControllerDeps {
  store: Store<CardState | null>;
  session: Pick<SubtitleSession, 'currentLine' | 'describe' | 'storySoFar'>;
  bridge: Pick<BridgeClient, 'callSync'>;
  pause: Pick<PauseGuard, 'resume'>;
  connect: Connect;
  /** v2 spec §4.2 `explanation:find`: the line's stored explanation, and the keys of its saved rows. */
  findExplanation(videoId: string, language: string, phrase: string): Promise<{ explanation: Explanation | null; savedKeys: string[] }>;
  /** v2 spec §4.2 `item:save`; resolves with the row's key. */
  saveItem(explanationId: string, suggestion: SaveSuggestion): Promise<string>;
  /** v2 spec §4.2 `item:remove`; resolves with the row's key. */
  unsaveItem(explanationId: string, suggestion: SaveSuggestion): Promise<string>;
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
  /** Saves a row of the card's Save section, or removes it when it is saved (v2 spec §4.1). */
  toggleSave(row: SaveSuggestion): void;
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
      // The payload says which rows are saved, so items saved before (e.g. before Regenerate) show as Saved.
      onDone: (explanation, savedKeys) =>
        update(key, (c) => ({ ...c, status: 'done', response: explanation.response, explanation, savedKeys, error: null })),
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
      explanation: null,
      error: null,
      followUps: [],
      followUpBusy: false,
      sections: settings.cardSections,
      explainedBefore: false,
      savedKeys: [],
      saveStatus: {},
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
      // v2 spec §5.2: only lines before the context window; none when Send the story so far is off. Fitted to
      // the background's limits, which reject the whole request otherwise; follow-ups send this same story.
      storySoFar: settings.sendStorySoFar ? fitStory(deps.session.storySoFar(line)) : [],
    };
    request = req;
    deps.store.set(base);
    deps.findExplanation(videoId, req.language, req.phrase).then(
      ({ explanation, savedKeys }) => {
        if (deps.store.get()?.key !== key) return;
        if (!explanation) return stream(key, req);
        update(key, (c) => ({
          ...c,
          status: 'done',
          response: explanation.response,
          explanation,
          savedKeys,
          explainedBefore: true,
          followUps: explanation.followUps.map((f) => ({ ...f, status: 'done', error: null })),
        }));
      },
      () => {
        if (deps.store.get()?.key === key) stream(key, req);
      },
    );
    return true;
  };

  /** Regenerate and Retry: ask Claude again for the same line; the stored explanation is replaced on success. */
  const restart = () => {
    const card = deps.store.get();
    if (!card || !request) return;
    cancelFollowUp?.();
    cancelFollowUp = null;
    // Saved items stay saved; the done payload brings the saved keys of the new rows.
    deps.store.set({
      ...card,
      status: 'loading',
      response: '',
      explanation: null,
      error: null,
      followUps: [],
      followUpBusy: false,
      explainedBefore: false,
      saveStatus: {},
    });
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
      if (!card?.explanation || card.followUpBusy || !text || !settings) return;
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
        // The same story as the explanation it follows (v2 spec §5.1).
        {
          type: 'follow-up',
          explanationId: card.explanation.id,
          question: text,
          sections: settings.cardSections,
          storySoFar: request?.storySoFar ?? [],
        },
        {
          onDelta: (delta) => setFollowUp((f) => ({ ...f, answer: f.answer + delta })),
          onDone: (explanation) =>
            setFollowUp((f) => ({ ...f, status: 'done', answer: explanation.followUps[index]?.answer ?? f.answer }), {
              explanation,
              followUpBusy: false,
            }),
          onError: (_code, message) => setFollowUp((f) => ({ ...f, status: 'error', error: message }), { followUpBusy: false }),
        },
      );
    },
    toggleSave(row) {
      const card = deps.store.get();
      if (!card?.explanation || card.status !== 'done') return;
      const { key, explanation } = card;
      const rowKey = suggestionKey(explanation, row);
      if (card.saveStatus[rowKey] === 'saving') return;
      const wasSaved = card.savedKeys.includes(rowKey);
      const settle = (status: SaveStatus | null, saved: boolean) =>
        update(key, (c) => {
          const saveStatus = { ...c.saveStatus };
          if (status) saveStatus[rowKey] = status;
          else delete saveStatus[rowKey];
          const others = c.savedKeys.filter((k) => k !== rowKey);
          return { ...c, saveStatus, savedKeys: saved ? [...others, rowKey] : others };
        });
      settle('saving', wasSaved);
      (wasSaved ? deps.unsaveItem(explanation.id, row) : deps.saveItem(explanation.id, row)).then(
        () => settle(null, !wasSaved),
        // v2 spec §9: a failed save says so on its row; a failed removal stays Saved. Tapping again retries.
        () => settle(wasSaved ? null : 'error', wasSaved),
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
