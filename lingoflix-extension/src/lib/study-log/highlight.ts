export interface HighlightPart {
  text: string;
  mark: boolean;
}

/** Characters with a meaning in a regular expression (the `u` flag rejects escaping anything else). */
const escapeRegExp = (s: string) => s.replace(/[\^$\\.*+?()[\]{}|/]/g, '\\$&');

/**
 * The line split around every case-insensitive occurrence of `text` (v2 spec §6.2). Any run of whitespace in
 * `text` matches any run in the line, so "call it a night" finds "call it\na night".
 */
export function highlightParts(line: string, text: string): HighlightPart[] {
  const words = text.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return [{ text: line, mark: false }];
  const pattern = new RegExp(words.join('\\s+'), 'giu');
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: line.slice(last, start), mark: false });
    parts.push({ text: match[0], mark: true });
    last = start + match[0].length;
  }
  if (last < line.length || parts.length === 0) parts.push({ text: line.slice(last), mark: false });
  return parts;
}
