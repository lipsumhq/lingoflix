import { CLAUDE_IDLE_TIMEOUT_MS, CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from '@/lib/config';
import type { FollowUp, NewStudyLogEntry, StudyLogEntry } from '@/lib/study-log/types';
import type { ClaudeClient } from './client';
import { toExplainError } from './errors';
import { buildFollowUpMessages, buildSystemPrompt, buildUserMessage, type ChatMessage, type ExplainRequest } from './prompt';
import { ERROR_COPY, parseClientMessage, type ExplainErrorCode, type ExplainServerMessage } from './protocol';

/** The part of `chrome.runtime.Port` the service uses. */
export interface ExplainPort {
  postMessage(message: ExplainServerMessage): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface ExplainServiceDeps {
  getApiKey(): Promise<string | null>;
  createClient(apiKey: string): ClaudeClient;
  saveExplanation(fields: NewStudyLogEntry): Promise<StudyLogEntry>;
  getEntry(id: string): Promise<StudyLogEntry | null>;
  appendFollowUp(id: string, followUp: FollowUp): Promise<StudyLogEntry | null>;
  idleTimeoutMs?: number;
}

const UNREADABLE = 'LingoFlix sent a request it could not read.';
const ENTRY_GONE = 'This explanation is no longer in your Study Log.';
const EMPTY_ANSWER = 'Claude returned an empty answer.';

function entryFields(request: ExplainRequest, response: string): NewStudyLogEntry {
  const title = request.title;
  return {
    phrase: request.phrase,
    response,
    videoTimeMs: Math.round(request.videoTimeMs),
    videoId: request.videoId,
    kind: title?.kind ?? 'movie',
    seriesId: title?.seriesId ?? null,
    seriesTitle: title?.seriesTitle ?? 'Untitled video',
    seasonNumber: title?.seasonNumber ?? null,
    episodeNumber: title?.episodeNumber ?? null,
    episodeTitle: title?.episodeTitle ?? null,
    context: request.context,
    explanationLanguage: request.language,
    model: CLAUDE_MODEL,
  };
}

/**
 * Serves one explanation or follow-up over a Port (spec §6.3). Streams deltas, saves the result only when
 * the stream completed and the card is still open, and aborts when the Port disconnects or the stream is
 * silent for 30 s.
 */
export function serveExplainPort(port: ExplainPort, deps: ExplainServiceDeps): void {
  const abort = new AbortController();
  let disconnected = false;
  let received = false;
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const post = (message: ExplainServerMessage) => {
    if (!disconnected) port.postMessage(message);
  };
  const fail = (code: ExplainErrorCode, message: string = ERROR_COPY[code]) => post({ type: 'error', code, message });
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, deps.idleTimeoutMs ?? CLAUDE_IDLE_TIMEOUT_MS);
  };

  port.onDisconnect.addListener(() => {
    disconnected = true;
    clearTimeout(idleTimer);
    abort.abort();
  });

  port.onMessage.addListener((raw) => {
    if (received) return; // one request per Port
    received = true;
    // A failure outside the stream (e.g. storage) must still end the card's spinner.
    run(raw).catch(() => {
      clearTimeout(idleTimer);
      fail('network');
    });
  });

  async function run(raw: unknown): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message) return fail('api', UNREADABLE);
    const apiKey = await deps.getApiKey();
    if (!apiKey) return fail('no-key');
    if (disconnected) return;

    let system: string;
    let messages: ChatMessage[];
    let finish: (text: string) => Promise<StudyLogEntry | null>;
    if (message.type === 'start') {
      const { request } = message;
      system = buildSystemPrompt(request.language, request.sections);
      messages = [{ role: 'user', content: buildUserMessage(request) }];
      finish = (text) => deps.saveExplanation(entryFields(request, text));
    } else {
      const entry = await deps.getEntry(message.entryId);
      if (!entry) return fail('api', ENTRY_GONE);
      system = buildSystemPrompt(entry.explanationLanguage, message.sections, true);
      messages = buildFollowUpMessages(entry, message.question);
      finish = (text) => deps.appendFollowUp(entry.id, { question: message.question.trim(), answer: text });
    }

    armIdleTimer();
    try {
      const text = await deps.createClient(apiKey).streamText(
        { model: CLAUDE_MODEL, maxTokens: CLAUDE_MAX_TOKENS, system, messages },
        (delta) => {
          armIdleTimer();
          post({ type: 'delta', text: delta });
        },
        abort.signal,
      );
      clearTimeout(idleTimer);
      if (disconnected) return; // the card closed: nothing is saved
      if (!text.trim()) return fail('api', EMPTY_ANSWER);
      const entry = await finish(text);
      if (!entry) return fail('api', ENTRY_GONE);
      post({ type: 'done', entry });
    } catch (err) {
      clearTimeout(idleTimer);
      if (disconnected) return;
      if (timedOut) return fail('network');
      const { code, message: text } = toExplainError(err);
      fail(code, text);
    }
  }
}
