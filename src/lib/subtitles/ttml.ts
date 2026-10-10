import type { Cue } from './cue';

interface TimeBase {
  tickRate: number;
  frameRate: number;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** TTML time expressions: ticks ("25000000t"), offsets ("12.5s", "500ms", "1.5m", "2h", "30f"), clock ("00:01:02.250", "00:00:01:12"). */
export function parseTtmlTime(value: string | undefined, base: TimeBase): number | null {
  if (!value) return null;
  const v = value.trim();
  let m = /^(\d+(?:\.\d+)?)t$/.exec(v);
  if (m) return base.tickRate > 0 ? Math.round((Number(m[1]) / base.tickRate) * 1000) : null;
  m = /^(\d+(?:\.\d+)?)(h|m|s|ms|f)$/.exec(v);
  if (m) {
    const n = Number(m[1]);
    const unitMs = { h: 3_600_000, m: 60_000, s: 1000, ms: 1, f: 1000 / base.frameRate }[m[2] as 'h' | 'm' | 's' | 'ms' | 'f'];
    return Math.round(n * unitMs);
  }
  m = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+)|:(\d+(?:\.\d+)?))?$/.exec(v);
  if (m) {
    const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const fraction = m[4] ? Number(`0.${m[4]}`) : m[5] ? Number(m[5]) / base.frameRate : 0;
    return Math.round((seconds + fraction) * 1000);
  }
  return null;
}

/** Attribute value by local name, ignoring any namespace prefix (`ttp:tickRate`, `begin`). */
function attrValue(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[1] ?? m[2]) : undefined;
}

export function parseTtml(xml: string): Cue[] {
  const ttTag = /<(?:[\w.-]+:)?tt\b[^>]*>/.exec(xml)?.[0] ?? '';
  const base: TimeBase = {
    tickRate: Number(attrValue(ttTag, 'tickRate')) || 1,
    frameRate: Number(attrValue(ttTag, 'frameRate')) || 30,
  };
  const cues: Cue[] = [];
  const paragraph = /<(?:[\w.-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?p>/g;
  for (const [, attrs = '', inner = ''] of xml.matchAll(paragraph)) {
    const startMs = parseTtmlTime(attrValue(attrs, 'begin'), base);
    let endMs = parseTtmlTime(attrValue(attrs, 'end'), base);
    const durMs = parseTtmlTime(attrValue(attrs, 'dur'), base);
    if (endMs === null && startMs !== null && durMs !== null) endMs = startMs + durMs;
    if (startMs === null || endMs === null || endMs < startMs) continue;
    // Source whitespace is insignificant; <br/> is the only line break.
    const withBreaks = inner.replace(/\s+/g, ' ').replace(/<(?:[\w.-]+:)?br\b[^>]*>/g, '\n');
    const text = decodeEntities(withBreaks.replace(/<[^>]+>/g, ''))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    if (text) cues.push({ startMs, endMs, text });
  }
  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
