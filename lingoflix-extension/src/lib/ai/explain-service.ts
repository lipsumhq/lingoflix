import { CLAUDE_IDLE_TIMEOUT_MS, CLAUDE_MODEL } from '@/lib/config';
import type { Explanation, FollowUp, NewExplanation, SaveSuggestion } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';
import type { AiClient, StreamParams, StreamResult, SystemBlock, ToolCall } from './client';
import { learningHistoryBlock, splitStory, storyBlock, type HistorySources } from './context-blocks';
import { toExplainError } from './errors';
import { buildFollowUpMessages, buildSystemPrompt, buildUserMessage, type ExplainRequest } from './prompt';
import { ERROR_COPY, parseClientMessage, type ExplainErrorCode, type ExplainServerMessage } from './protocol';
import { SUGGEST_SAVES_TOOL, SUGGEST_SAVES_TOOL_NAME, validateSuggestions } from './suggestions';

/** The part of `chrome.runtime.Port` the service uses. */
export interface ExplainPort {
  postMessage(message: ExplainServerMessage): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface ExplainServiceDeps {
  getApiKey(): Promise<string | null>;
  createClient(apiKey: string): AiClient;
  saveExplanation(fields: NewExplanation): Promise<Explanation>;
  getExplanation(id: string): Promise<Explanation | null>;
  appendFollowUp(id: string, followUp: FollowUp): Promise<Explanation | null>;
  /** Saved items and explanations, for the learning history block (v2 spec §5.2). */
  loadHistory(): Promise<HistorySources>;
  /** Index keys of the explanation's card rows that are saved (v2 spec §4.2). */
  savedKeysFor(explanation: Explanation): Promise<string[]>;
  idleTimeoutMs?: number;
}

const UNREADABLE = 'LingoFlix sent a request it could not read.';
const EXPLANATION_GONE = 'This explanation is no longer available.';
const EMPTY_ANSWER = 'Claude returned an empty answer.';

function explanationFields(request: ExplainRequest, response: string, suggestions: SaveSuggestion[]): NewExplanation {
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
    suggestions,
  };
}

/** v2 spec §5.4: the first suggest_saves call, checked; none when Claude didn't call it. */
function suggestionsFrom(calls: readonly ToolCall[], line: string): SaveSuggestion[] {
  const call = calls.find((c) => c.name === SUGGEST_SAVES_TOOL_NAME);
  return call ? validateSuggestions(call.input, line) : [];
}

/**
 * v2 spec §5.1–5.2: the instructions, then the story before the last 5-minute boundary and the learning
 * history, both cached; empty blocks are left out. Lines at or after the explained line never go out,
 * whatever the page sent (no spoilers); the rest of the story goes into the first user message.
 */
function contextFor(
  instructions: string,
  story: readonly StoryLine[],
  lineStartMs: number,
  history: string | null,
): { system: SystemBlock[]; recent: StoryLine[] } {
  const { cached, recent } = splitStory(
    story.filter((line) => line.startMs < lineStartMs),
    lineStartMs,
  );
  const system: SystemBlock[] = [{ text: instructions, cache: false }];
  const storyText = storyBlock(cached);
  if (storyText) system.push({ text: storyText, cache: true });
  if (history) system.push({ text: history, cache: true });
  return { system, recent };
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

  /** v2 spec §5.2: the learning history block. When it can't be read, the request goes out without it. */
  async function historyFor(line: string): Promise<string | null> {
    try {
      return learningHistoryBlock(await deps.loadHistory(), line);
    } catch {
      return null;
    }
  }

  async function run(raw: unknown): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message) return fail('api', UNREADABLE);
    const apiKey = await deps.getApiKey();
    if (!apiKey) return fail('no-key');
    if (disconnected) return;

    let params: StreamParams;
    let finish: (result: StreamResult) => Promise<Explanation | null>;
    if (message.type === 'start') {
      const { request } = message;
      const history = await historyFor(request.phrase);
      const instructions = buildSystemPrompt(request.language, request.sections);
      const { system, recent } = contextFor(instructions, request.storySoFar, request.videoTimeMs, history);
      params = {
        kind: 'explain',
        system,
        messages: [{ role: 'user', content: buildUserMessage(request, recent) }],
        tools: [SUGGEST_SAVES_TOOL],
      };
      finish = (result) =>
        deps.saveExplanation(explanationFields(request, result.text, suggestionsFrom(result.toolCalls, request.phrase)));
    } else {
      const explanation = await deps.getExplanation(message.explanationId);
      if (!explanation) return fail('api', EXPLANATION_GONE);
      const history = await historyFor(explanation.phrase);
      const instructions = buildSystemPrompt(explanation.explanationLanguage, message.sections, true);
      const { system, recent } = contextFor(instructions, message.storySoFar, explanation.videoTimeMs, history);
      params = {
        kind: 'follow-up',
        system,
        messages: buildFollowUpMessages(explanation, message.question, recent),
      };
      finish = (result) => deps.appendFollowUp(explanation.id, { question: message.question.trim(), answer: result.text });
    }

    armIdleTimer();
    try {
      const result = await deps.createClient(apiKey).stream(
        params,
        (delta) => {
          armIdleTimer();
          post({ type: 'delta', text: delta });
        },
        abort.signal,
      );
      clearTimeout(idleTimer);
      if (disconnected) return; // the card closed: nothing is saved
      if (!result.text.trim()) return fail('api', EMPTY_ANSWER);
      const explanation = await finish(result);
      if (!explanation) return fail('api', EXPLANATION_GONE);
      // The explanation is stored; not knowing which rows are saved only shows them as unsaved.
      const savedKeys = await deps.savedKeysFor(explanation).catch((): string[] => []);
      post({ type: 'done', explanation, savedKeys });
    } catch (err) {
      clearTimeout(idleTimer);
      if (disconnected) return;
      if (timedOut) return fail('network');
      const { code, message: text } = toExplainError(err);
      fail(code, text);
    }
  }
}
