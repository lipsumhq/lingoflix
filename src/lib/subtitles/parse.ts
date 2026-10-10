import type { Cue } from './cue';
import { parseTtml } from './ttml';
import { parseWebVtt } from './webvtt';

/** Parses a downloaded subtitle file. WebVTT is recognized by its header; anything else is treated as TTML/IMSC. */
export function parseSubtitleFile(body: string): Cue[] {
  return /^﻿?WEBVTT/.test(body) ? parseWebVtt(body) : parseTtml(body);
}
