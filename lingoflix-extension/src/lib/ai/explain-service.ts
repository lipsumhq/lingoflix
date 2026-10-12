import { AI_IDLE_TIMEOUT_MS, KEEP_ALIVE_MS } from '@/lib/config';
import type { Explanation, FollowUp, NewExplanation, SaveSuggestion } from '@/lib/study-log/types';
import type { StoryLine } from '@/lib/subtitles/context';
import { normalizeLine } from '@/lib/subtitles/cue';
import type { AiClient, StreamParams, StreamResult, SystemBlock, ToolCall } from './client';
import { learningHistoryBlock, splitStory, storyBlock, type HistorySources } from './context-blocks';
import { toExplainError } from './errors';
import { buildFollowUpMessages, buildSystemPrompt, buildUserMessage, type ExplainRequest } from './prompt';
import { PROVIDERS, providerOf, type Provider } from './provider';
import {
  errorCopy,
  parseClientMessage,
  type ExplainClientMessage,
  type ExplainErrorCode,
  type ExplainServerMessage,
} from './protocol';
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
  /**
   * A trivial extension API call, made every 25 s while an answer is in progress: Chrome stops a background
   * that makes no call for 30 s, and with no card watching nothing else would (finish-answers spec §3.4).
   * A call that throws or rejects (e.g. while the extension shuts down) is ignored.
   */
  keepAlive(): Promise<unknown> | void;
  idleTimeoutMs?: number;
}

const UNREADABLE = 'LingoFlix sent a request it could not read.';
const EXPLANATION_GONE = 'This explanation is no longer available.';

function explanationFields(request: ExplainRequest, response: string, suggestions: SaveSuggestion[], model: string): NewExplanation {
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
    model,
    suggestions,
  };
}

/** v2 spec §5.4: the first suggest_saves call, checked; none when the model didn't call it. */
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

/** A line as saved answers identify it (the study log's explanation index): video, language, normalized text. */
const lineKey = (request: ExplainRequest) => `${request.videoId}|${request.language}|${normalizeLine(request.phrase)}`;

type Watcher = (message: ExplainServerMessage) => void;

/** One answer or follow-up in progress (finish-answers spec §3.1). */
interface Job {
  /** The text streamed so far, sent at once to a card that joins. */
  text: string;
  /** One per card watching; each posts to its own Port while it is connected. */
  watchers: Set<Watcher>;
  /** Takes the job off the list a card can join, just before its last message goes out. */
  release(): void;
}

/** The request to send, and how to store its answer. */
interface Prepared {
  params: StreamParams;
  finish(result: StreamResult): Promise<Explanation | null>;
}

export interface ExplainService {
  /** Serves one card's Port (spec §6.3): one start or one follow-up. */
  serve(port: ExplainPort): void;
}

/**
 * Serves every card's Port. An answer, once asked for, always finishes and is saved, whether or not a card
 * still watches it; a start for a line already being answered joins that answer (finish-answers spec §3).
 * Deltas stream to the cards watching, and the answer stops only when the stream is silent (no event at all)
 * for 30 s. Errors name the key's provider (free-own-key spec §4.6).
 */
export function createExplainService(deps: ExplainServiceDeps): ExplainService {
  /** Explanations in progress, by line. */
  const answers = new Map<string, Job>();
  let inProgress = 0;
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  /** A failed call only misses one beat; the next one, 25 s later, tries again. */
  const keepAlive = async () => {
    try {
      await deps.keepAlive();
    } catch {
      // ignored: see ExplainServiceDeps.keepAlive
    }
  };

  /** Finish-answers spec §3.4: Chrome would stop the background mid-answer once no card is watching. */
  const begin = () => {
    inProgress += 1;
    if (inProgress === 1) keepAliveTimer = setInterval(() => void keepAlive(), KEEP_ALIVE_MS);
  };
  const end = () => {
    inProgress -= 1;
    if (inProgress === 0) clearInterval(keepAliveTimer);
  };

  /** v2 spec §5.2: the learning history block. When it can't be read, the request goes out without it. */
  async function historyFor(line: string): Promise<string | null> {
    try {
      return learningHistoryBlock(await deps.loadHistory(), line);
    } catch {
      return null;
    }
  }

  /** Null when a follow-up's explanation is gone. */
  async function prepare(message: ExplainClientMessage, provider: Provider): Promise<Prepared | null> {
    if (message.type === 'start') {
      const { request } = message;
      const history = await historyFor(request.phrase);
      const instructions = buildSystemPrompt(request.language, request.sections);
      const { system, recent } = contextFor(instructions, request.storySoFar, request.videoTimeMs, history);
      return {
        params: {
          kind: 'explain',
          system,
          messages: [{ role: 'user', content: buildUserMessage(request, recent) }],
          tools: [SUGGEST_SAVES_TOOL],
        },
        finish: (result) =>
          deps.saveExplanation(
            explanationFields(request, result.text, suggestionsFrom(result.toolCalls, request.phrase), PROVIDERS[provider].model),
          ),
      };
    }
    const explanation = await deps.getExplanation(message.explanationId);
    if (!explanation) return null;
    const history = await historyFor(explanation.phrase);
    const instructions = buildSystemPrompt(explanation.explanationLanguage, message.sections, true);
    const { system, recent } = contextFor(instructions, message.storySoFar, explanation.videoTimeMs, history);
    return {
      params: {
        kind: 'follow-up',
        system,
        messages: buildFollowUpMessages(explanation, message.question, recent),
      },
      finish: async (result) => {
        // Regenerate replaces the response (same id) and clears the follow-ups, which referred to the old one:
        // a follow-up still in progress then was about the old response too, so it is not kept.
        const current = await deps.getExplanation(explanation.id);
        if (current?.response !== explanation.response) return null;
        return deps.appendFollowUp(explanation.id, { question: message.question.trim(), answer: result.text });
      },
    };
  }

  /** Runs one answer or follow-up to its end, and tells the cards still watching how it ended. */
  async function run(job: Job, message: ExplainClientMessage): Promise<void> {
    begin();
    const abort = new AbortController();
    /** The saved key's provider, once read. */
    let provider: Provider | null = null;
    let timedOut = false;
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const broadcast = (m: ExplainServerMessage) => {
      for (const watch of job.watchers) watch(m);
    };
    const settle = (m: ExplainServerMessage) => {
      if (settled) return;
      settled = true;
      job.release();
      broadcast(m);
    };
    const fail = (code: ExplainErrorCode, text: string = errorCopy(code, provider)) =>
      settle({ type: 'error', code, message: text, provider });
    const armIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, deps.idleTimeoutMs ?? AI_IDLE_TIMEOUT_MS);
    };

    try {
      const apiKey = await deps.getApiKey();
      // A key saved before Save checked the provider, that is neither Claude's nor OpenAI's, counts as none.
      const keyProvider = apiKey ? providerOf(apiKey) : null;
      if (!apiKey || !keyProvider) return fail('no-key');
      provider = keyProvider;
      const prepared = await prepare(message, keyProvider);
      if (!prepared) return fail('api', EXPLANATION_GONE);

      armIdleTimer();
      try {
        const result = await deps.createClient(apiKey).stream(
          prepared.params,
          (delta) => {
            armIdleTimer();
            job.text += delta;
            broadcast({ type: 'delta', text: delta });
          },
          abort.signal,
          armIdleTimer,
        );
        clearTimeout(idleTimer);
        if (!result.text.trim()) return fail('api', `${PROVIDERS[keyProvider].name} returned an empty answer.`);
        const explanation = await prepared.finish(result);
        if (!explanation) return fail('api', EXPLANATION_GONE);
        // The explanation is stored; not knowing which rows are saved only shows them as unsaved.
        const savedKeys = await deps.savedKeysFor(explanation).catch((): string[] => []);
        settle({ type: 'done', explanation, savedKeys });
      } catch (err) {
        clearTimeout(idleTimer);
        if (timedOut) return fail('network');
        const { code, message: text } = toExplainError(err, keyProvider);
        fail(code, text);
      }
    } catch {
      // A failure outside the stream (e.g. storage) must still end the cards' spinners.
      fail('network');
    } finally {
      clearTimeout(idleTimer);
      end();
    }
  }

  function serve(port: ExplainPort): void {
    let connected = true;
    let received = false;
    let job: Job | null = null;
    const watch: Watcher = (m) => {
      if (!connected) return;
      try {
        port.postMessage(m);
      } catch {
        // The Port closed before its disconnect event arrived: stop watching, as if it had.
        connected = false;
        job?.watchers.delete(watch);
      }
    };

    // Closing the card only stops it watching: the answer still finishes and is saved (finish-answers spec §3.2).
    port.onDisconnect.addListener(() => {
      connected = false;
      job?.watchers.delete(watch);
    });

    port.onMessage.addListener((raw) => {
      if (received) return; // one request per Port
      received = true;
      const message = parseClientMessage(raw);
      if (!message) return watch({ type: 'error', code: 'api', message: UNREADABLE, provider: null });

      if (message.type === 'follow-up') {
        job = { text: '', watchers: new Set([watch]), release: () => {} };
        void run(job, message);
        return;
      }
      const key = lineKey(message.request);
      const current = answers.get(key);
      if (current) {
        // Finish-answers spec §3.3: join the answer in progress; the AI is asked once.
        job = current;
        current.watchers.add(watch);
        if (current.text) watch({ type: 'delta', text: current.text });
        return;
      }
      const created: Job = {
        text: '',
        watchers: new Set([watch]),
        release: () => {
          if (answers.get(key) === created) answers.delete(key);
        },
      };
      job = created;
      answers.set(key, created);
      void run(created, message);
    });
  }

  return { serve };
}
