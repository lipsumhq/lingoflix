/** One subtitle line from a subtitle file. Times are episode time in ms; `text` keeps line breaks as "\n". */
export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

/** Comparable form of a line: line breaks and whitespace runs become one space; zero-width characters go. */
export function normalizeLine(text: string): string {
  return text.replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}
