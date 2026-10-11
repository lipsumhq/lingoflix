import { episodeCode, formatTimestamp } from './format';
import type { Explanation, SavedItem } from './types';

export type ExportKind = 'anki' | 'csv' | 'backup';

/** v2 spec §7.3: the backup file's identity and the version this LingoFlix writes and reads. */
export const BACKUP_FORMAT = 'lingoflix-backup';
export const BACKUP_VERSION = 1;

export const EXPORT_MIME: Record<ExportKind, string> = {
  anki: 'text/plain;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  backup: 'application/json',
};

/** v2 spec §7.1: Anki 2.1.54+ text-import headers. */
const ANKI_HEADERS = [
  '#separator:Tab',
  '#html:true',
  '#notetype:Basic',
  '#deck:LingoFlix',
  '#tags column:3',
  '#columns:Front\tBack\tTags',
];

const CSV_HEADER = [
  'Type',
  'Text',
  'Meaning',
  'Line',
  'Show',
  'Season',
  'Episode',
  'Episode title',
  'Time',
  'Saved',
  'Explanation language',
  'Netflix link',
];

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One Anki field: a raw tab would start a new field and a raw line break a new note. */
const ankiField = (html: string) => html.replace(/\t/g, ' ').replace(/\r\n|\r|\n/g, '<br>');

/**
 * Lowercase NFC, with every run of characters that aren't letters, combining marks or digits (in any script) turned
 * into "_". Marks count as part of a word: Thai vowels, Devanagari matras and viramas are marks, and a decomposed
 * accent ("e" + U+0301) composes into one letter first.
 */
const tagSlug = (title: string) =>
  title
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');

/** Anki's importer skips a line that starts with "#" (a header or comment); `&#35;` shows as "#" with HTML on. */
const ankiFront = (html: string) => html.replace(/^#/, '&#35;');

/**
 * The line as HTML with every occurrence of `text` in bold: case-insensitive, any whitespace between words,
 * `text` taken literally. Each piece is escaped before it is wrapped, so the bold tags are the only HTML.
 */
export function highlightHtml(line: string, text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return escapeHtml(line);
  const pattern = new RegExp(words.map(escapeRegExp).join('\\s+'), 'giu');
  let html = '';
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    html += `${escapeHtml(line.slice(last, start))}<b>${escapeHtml(match[0])}</b>`;
    last = start + match[0].length;
  }
  return html + escapeHtml(line.slice(last));
}

/** "Stranger Things · S1 E3 · 30:34", or "Roma · 1:02:03" for a movie. */
export function sourceLabel(item: Pick<SavedItem, 'kind' | 'seriesTitle' | 'seasonNumber' | 'episodeNumber' | 'lineTimeMs'>): string {
  return [item.seriesTitle, episodeCode(item), formatTimestamp(item.lineTimeMs)].filter(Boolean).join(' · ');
}

/** v2 spec §7.1: front = the text; back = meaning, the line with the text in bold, where it's from; tags. */
export function toAnki(items: readonly SavedItem[]): string {
  const notes = items.map((item) => {
    const meaning = item.meaning.trim() ? `${escapeHtml(item.meaning.trim())}<br><br>` : '';
    const line = item.type === 'line' ? escapeHtml(item.line) : highlightHtml(item.line, item.text);
    const back = `${meaning}${line}<br><small>${escapeHtml(sourceLabel(item))}</small>`;
    const tags = ['lingoflix', item.type, tagSlug(item.seriesTitle)].filter(Boolean).join(' ');
    return [ankiFront(escapeHtml(item.text)), back, tags].map(ankiField).join('\t');
  });
  return `${[...ANKI_HEADERS, ...notes].join('\n')}\n`;
}

/**
 * Excel and Sheets read a cell that starts with = + - @ (or a tab or carriage return) as a formula, so a subtitle
 * line like "- What?" would show an error. A leading apostrophe keeps it text (OWASP CSV injection guidance).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

const csvCell = (value: string | number | null) => {
  const text = String(value ?? '');
  return `"${(FORMULA_START.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};

/** v2 spec §7.2: RFC 4180, every field quoted, CRLF, UTF-8 with a byte-order mark for Excel. */
export function toCsv(items: readonly SavedItem[]): string {
  const rows = items.map((item) => [
    item.type,
    item.text,
    item.meaning,
    item.line,
    item.seriesTitle,
    item.seasonNumber,
    item.episodeNumber,
    item.episodeTitle,
    formatTimestamp(item.lineTimeMs),
    item.savedAt,
    item.explanationLanguage,
    `https://www.netflix.com/watch/${item.videoId}`,
  ]);
  return `\uFEFF${[CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** v2 spec §7.3: every saved item and every explanation. Never the API key or settings. */
export function toBackup(items: readonly SavedItem[], explanations: readonly Explanation[], now: Date): string {
  const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), items, explanations };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

const localDate = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export function exportFileName(kind: ExportKind, now: Date): string {
  const date = localDate(now);
  if (kind === 'anki') return `lingoflix-anki-${date}.txt`;
  if (kind === 'csv') return `lingoflix-${date}.csv`;
  return `lingoflix-backup-${date}.json`;
}
