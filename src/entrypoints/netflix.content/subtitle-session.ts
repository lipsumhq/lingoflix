import type { BridgeClient } from '@/lib/bridge/client';
import { parseSubtitleSource, type PlayerState } from '@/lib/bridge/protocol';
import { describeLine, storyBefore, trackMatchesLine, type LineDetails, type StoryLine } from '@/lib/subtitles/context';
import type { Cue } from '@/lib/subtitles/cue';
import { createLineHistory, type ObservedLine } from '@/lib/subtitles/history';
import { cuesAsTimedLines, historyAsTimedLines, nextLineStart, previousLineStart } from '@/lib/subtitles/navigation';
import { parseSubtitleFile } from '@/lib/subtitles/parse';
import type { DisplayedSubtitle } from './subtitle-dom';

export interface SubtitleSessionDeps {
  bridge: Pick<BridgeClient, 'callSync'>;
  fetchText(url: string): Promise<string>;
  /** The video in the URL; a different one starts a fresh session (spec §8.5). */
  getVideoId(): string | null;
}

export interface SubtitleSession {
  /** Feed every change of the displayed subtitle (from watchSubtitles). */
  onDisplayed(subtitle: DisplayedSubtitle): void;
  displayed(): DisplayedSubtitle;
  /** Spec §5.1: the line on screen, else the most recent one. */
  currentLine(): ObservedLine | null;
  /** Context and timing: from the subtitle file when it matches the screen, else from history (spec §8.2). */
  describe(line: ObservedLine): LineDetails;
  /** The lines before the context window, for Claude's story so far (v2 spec §5.2). Never the context or later. */
  storySoFar(line: ObservedLine): StoryLine[];
  /** Episode time of the previous/next line start (spec §5.1.1), or null when there is none. */
  lineTarget(direction: 'previous' | 'next'): number | null;
  /** Language of the subtitle file in use, or null when none is in use. */
  trackLanguage(): string | null;
  reset(): void;
}

type TrackState = 'loading' | 'unchecked' | 'valid' | 'invalid';

interface Track {
  key: string;
  language: string;
  cues: Cue[] | null;
  state: TrackState;
}

const NOTHING_SHOWN: DisplayedSubtitle = { text: '', rects: [] };

export function createSubtitleSession(deps: SubtitleSessionDeps): SubtitleSession {
  const history = createLineHistory();
  let shown = NOTHING_SHOWN;
  let videoId: string | null = null;
  let track: Track | null = null;

  const reset = () => {
    history.clear();
    track = null;
    shown = NOTHING_SHOWN;
  };

  const syncVideo = () => {
    const id = deps.getVideoId();
    if (id === videoId) return;
    videoId = id;
    reset();
  };

  const playerState = (): PlayerState | null => {
    const res = deps.bridge.callSync('getState');
    return res.ok ? res.result : null;
  };

  /** Starts loading the subtitle file for the track Netflix shows, unless it's already the loaded one. */
  const loadTrack = (state: PlayerState | null) => {
    const textTrack = state?.textTrack;
    if (!videoId || !textTrack || textTrack.isNone || textTrack.isImageBased) return;
    const key = `${videoId}|${textTrack.trackId}`;
    if (track?.key === key) return;
    const res = deps.bridge.callSync('getSubtitleSource');
    const source = res.ok ? parseSubtitleSource(res.result) : null;
    if (!source || source.trackId !== textTrack.trackId) return; // not captured yet; try again on the next line
    const loading: Track = { key, language: source.language, cues: null, state: 'loading' };
    track = loading;
    // A fetch failure or timeout, or a file that can't be parsed, leaves the track unused.
    deps
      .fetchText(source.url)
      .then(parseSubtitleFile)
      .then(
        (cues) => {
          loading.cues = cues;
          loading.state = cues.length > 0 ? 'unchecked' : 'invalid';
        },
        () => {
          loading.state = 'invalid';
        },
      );
  };

  /** The file's cues, checked once against a line Netflix displayed (spec §8.2). */
  const usableCues = (line: ObservedLine | null): Cue[] | null => {
    if (!track?.cues) return null;
    if (track.state === 'unchecked' && line && line.shownAtMs !== null) {
      track.state = trackMatchesLine(track.cues, line) ? 'valid' : 'invalid';
    }
    return track.state === 'valid' ? track.cues : null;
  };

  return {
    onDisplayed(subtitle) {
      syncVideo();
      shown = subtitle;
      const state = playerState();
      history.observe(subtitle.text, state ? state.currentTimeMs : null);
      loadTrack(state);
      usableCues(history.displayed());
    },
    displayed: () => shown,
    currentLine() {
      syncVideo();
      return history.current();
    },
    describe(line) {
      syncVideo();
      return describeLine(line, usableCues(line), history);
    },
    storySoFar(line) {
      syncVideo();
      return storyBefore(line, usableCues(line), history);
    },
    lineTarget(direction) {
      syncVideo();
      const state = playerState();
      if (!state) return null;
      const cues = usableCues(history.current());
      const lines = cues ? cuesAsTimedLines(cues) : historyAsTimedLines(history.all());
      return direction === 'previous'
        ? previousLineStart(lines, state.currentTimeMs)
        : nextLineStart(lines, state.currentTimeMs);
    },
    trackLanguage: () => (track?.state === 'valid' ? track.language : null),
    reset,
  };
}
