import type { Cue } from './cue';
import { decodeEntities } from './ttml';

const TIMING = /^((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/;

function vttTime(value: string): number {
  const parts = value.replace(',', '.').split(':').map(Number);
  const seconds = parts.pop() ?? 0;
  const minutes = parts.pop() ?? 0;
  const hours = parts.pop() ?? 0;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

export function parseWebVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex < 0) continue; // header, NOTE, STYLE, REGION
    const [, start = '', end = ''] = TIMING.exec(lines[timingIndex]!)!;
    const body = lines
      .slice(timingIndex + 1)
      .map((line) => decodeEntities(line.replace(/<[^>]+>/g, '')).trim())
      .filter(Boolean)
      .join('\n');
    if (body) cues.push({ startMs: vttTime(start), endMs: vttTime(end), text: body });
  }
  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
