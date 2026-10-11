import { describe, expect, it } from 'vitest';
import { exportFileName, highlightHtml, sourceLabel, toAnki, toBackup, toCsv } from '@/lib/study-log/export';
import type { Explanation, SavedItem } from '@/lib/study-log/types';

const item = (over: Partial<SavedItem> = {}): SavedItem => ({
  id: 'i1',
  type: 'idiom',
  text: 'call it a night',
  meaning: '그만 자러 가다',
  explanationId: 'e1',
  line: "I'm gonna call it a night.",
  lineTimeMs: 1_834_200,
  context: { before: ['Where are you going?'], after: ['Night.'] },
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  explanationLanguage: 'ko',
  savedAt: '2026-10-10T10:05:00.000Z',
  updatedAt: '2026-10-10T10:05:00.000Z',
  ...over,
});

const movieLine = item({
  id: 'i2',
  type: 'line',
  text: 'Where is everyone?',
  meaning: '',
  explanationId: null,
  line: 'Where is everyone?',
  lineTimeMs: 3_723_000,
  videoId: '80240715',
  kind: 'movie',
  seriesId: null,
  seriesTitle: 'Roma',
  seasonNumber: null,
  episodeNumber: null,
  episodeTitle: null,
  explanationLanguage: 'en',
});

const explanation: Explanation = {
  id: 'e1',
  phrase: "I'm gonna call it a night.",
  response: '## Meaning\nTime to sleep.',
  followUps: [{ question: 'Formal?', answer: 'No.' }],
  videoTimeMs: 1_834_200,
  savedAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  videoId: '80077211',
  kind: 'episode',
  seriesId: '80057281',
  seriesTitle: 'Stranger Things',
  seasonNumber: 1,
  episodeNumber: 3,
  episodeTitle: 'Holly, Jolly',
  context: { before: ['Where are you going?'], after: ['Night.'] },
  explanationLanguage: 'ko',
  model: 'claude-sonnet-5-5',
  suggestions: [{ type: 'idiom', text: 'call it a night', meaning: '그만 자러 가다' }],
};

const ANKI_HEADERS = [
  '#separator:Tab',
  '#html:true',
  '#notetype:Basic',
  '#deck:LingoFlix',
  '#tags column:3',
  '#columns:Front\tBack\tTags',
];

describe('highlightHtml', () => {
  it('bolds every occurrence, ignoring case, and escapes the rest', () => {
    expect(highlightHtml('Night, night. NIGHT!', 'night')).toBe('<b>Night</b>, <b>night</b>. <b>NIGHT</b>!');
    expect(highlightHtml('Tom & Jerry <3', 'tom & jerry')).toBe('<b>Tom &amp; Jerry</b> &lt;3');
  });

  it('matches across any whitespace and treats the text literally', () => {
    expect(highlightHtml('call it\na night', 'call it a night')).toBe('<b>call it\na night</b>');
    expect(highlightHtml('(laughs) Fine.', '(laughs)')).toBe('<b>(laughs)</b> Fine.');
    expect(highlightHtml('a.b axb', 'a.b')).toBe('<b>a.b</b> axb');
  });

  it('without text, is just the escaped line', () => {
    expect(highlightHtml('"Hi" <b>', '  ')).toBe('&quot;Hi&quot; &lt;b&gt;');
  });
});

describe('sourceLabel', () => {
  it('is "Series · S1 E3 · time", or "Title · time" for a movie', () => {
    expect(sourceLabel(item())).toBe('Stranger Things · S1 E3 · 30:34');
    expect(sourceLabel(movieLine)).toBe('Roma · 1:02:03');
  });
});

describe('toAnki', () => {
  it('writes the Anki headers, then one note per item: front, back, tags', () => {
    expect(toAnki([item(), movieLine])).toBe(
      [
        ...ANKI_HEADERS,
        "call it a night\t그만 자러 가다<br><br>I'm gonna <b>call it a night</b>.<br><small>Stranger Things · S1 E3 · 30:34</small>\tlingoflix idiom stranger_things",
        'Where is everyone?\tWhere is everyone?<br><small>Roma · 1:02:03</small>\tlingoflix line roma',
      ].join('\n') + '\n',
    );
  });

  it('with no items, is just the headers', () => {
    expect(toAnki([])).toBe(ANKI_HEADERS.join('\n') + '\n');
  });
});

describe('toCsv', () => {
  it('starts with a byte-order mark and the header row; every field is quoted; rows end with CRLF', () => {
    expect(toCsv([item(), movieLine])).toBe(
      '\uFEFF' +
        [
          '"Type","Text","Meaning","Line","Show","Season","Episode","Episode title","Time","Saved","Explanation language","Netflix link"',
          '"idiom","call it a night","그만 자러 가다","I\'m gonna call it a night.","Stranger Things","1","3","Holly, Jolly","30:34","2026-10-10T10:05:00.000Z","ko","https://www.netflix.com/watch/80077211"',
          '"line","Where is everyone?","","Where is everyone?","Roma","","","","1:02:03","2026-10-10T10:05:00.000Z","en","https://www.netflix.com/watch/80240715"',
        ].join('\r\n') +
        '\r\n',
    );
  });
});

describe('export escaping (Review Focus 5)', () => {
  it('escapes tabs, newlines, quotes, HTML and keeps non-Latin text', () => {
    const tricky = item({
      type: 'phrase',
      text: 'A & B',
      meaning: '"좋아" & <ok>',
      line: 'He said "A & B"\tthen <left>\nfor good',
      lineTimeMs: 61_000,
      videoId: '81234567',
      seriesTitle: '오징어 게임',
      seasonNumber: 2,
      episodeNumber: 1,
      episodeTitle: null,
    });

    const anki = toAnki([tricky]);
    const lines = anki.split('\n');
    expect(lines).toHaveLength(ANKI_HEADERS.length + 2); // headers, one note, and the final empty string
    const note = lines[ANKI_HEADERS.length]!;
    expect(note.split('\t')).toEqual([
      'A &amp; B',
      '&quot;좋아&quot; &amp; &lt;ok&gt;<br><br>He said &quot;<b>A &amp; B</b>&quot; then &lt;left&gt;<br>for good<br><small>오징어 게임 · S2 E1 · 1:01</small>',
      'lingoflix phrase 오징어_게임',
    ]);

    expect(toCsv([tricky]).split('\r\n')[1]).toBe(
      '"phrase","A & B","""좋아"" & <ok>","He said ""A & B""\tthen <left>\nfor good","오징어 게임","2","1","","1:01","2026-10-10T10:05:00.000Z","ko","https://www.netflix.com/watch/81234567"',
    );
  });
  it('keeps cells that look like formulas as text with a leading apostrophe (subtitle lines like "- What?")', () => {
    const dash = item({ type: 'line', text: '- What?', line: '- What?', meaning: '=SUM(A1)' });
    expect(toCsv([dash]).split('\r\n')[1]!.split(',').slice(1, 4)).toEqual(['"\'- What?"', '"\'=SUM(A1)"', '"\'- What?"']);
  });
});

describe('toBackup', () => {
  it('holds everything, versioned, pretty-printed', () => {
    const text = toBackup([item(), movieLine], [explanation], new Date('2026-10-10T21:41:00.000Z'));
    const parsed: unknown = JSON.parse(text);
    expect(parsed).toEqual({
      format: 'lingoflix-backup',
      version: 1,
      exportedAt: '2026-10-10T21:41:00.000Z',
      items: [item(), movieLine],
      explanations: [explanation],
    });
    expect(Object.keys(parsed as object)).toEqual(['format', 'version', 'exportedAt', 'items', 'explanations']);
    expect(text.startsWith('{\n  "format": "lingoflix-backup",')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
  });
});

describe('exportFileName', () => {
  it('uses the local date', () => {
    const lateEvening = new Date(2026, 9, 10, 23, 59); // local time
    expect(exportFileName('anki', lateEvening)).toBe('lingoflix-anki-2026-10-10.txt');
    expect(exportFileName('csv', lateEvening)).toBe('lingoflix-2026-10-10.csv');
    expect(exportFileName('backup', new Date(2026, 0, 5, 0, 1))).toBe('lingoflix-backup-2026-01-05.json');
  });
});
