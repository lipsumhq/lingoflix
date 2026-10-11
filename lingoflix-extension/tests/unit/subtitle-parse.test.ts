import { describe, expect, it } from 'vitest';
import { normalizeLine } from '@/lib/subtitles/cue';
import { parseSubtitleFile } from '@/lib/subtitles/parse';
import { parseTtml, parseTtmlTime } from '@/lib/subtitles/ttml';
import { parseWebVtt } from '@/lib/subtitles/webvtt';

const NETFLIX_DFXP = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000" xml:lang="en">
<body><div>
<p begin="25000000t" end="43750000t" region="region_00" xml:id="subtitle0"><span style="style_0">Where are you going?</span></p>
<p begin="45000000t" end="61250000t" xml:id="subtitle1"><span>I'm gonna call it</span><br/><span>a night.</span></p>
<p begin="70000000t" end="82500000t"><span>Tom &amp; Jerry&#39;s &lt;place&gt;</span></p>
<p begin="90000000t" end="91000000t"><span>   </span></p>
</div></body></tt>`;

const IMSC = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="00:01:02.500" end="00:01:04.000">[door slams]</p>
<p begin="00:00:59.000" dur="1.5s">- Hi.<br/>- Hello.</p>
<p begin="00:01:10.000">no end</p>
</div></body></tt>`;

const VTT = `WEBVTT

NOTE produced by a test

1
00:00:01.000 --> 00:00:02.500 position:50% line:85%
<c.white>Hello</c> <i>there</i>
second line

01:01.250 --> 01:03.000
Fish &amp; chips
`;

describe('normalizeLine', () => {
  it('collapses line breaks and whitespace and drops zero-width characters', () => {
    expect(normalizeLine("  I'm gonna\ncall it\u200b  a night. ")).toBe("I'm gonna call it a night.");
  });
});

describe('parseTtmlTime', () => {
  const base = { tickRate: 10_000_000, frameRate: 24 };
  it('reads ticks, offsets, and clock times', () => {
    expect(parseTtmlTime('25000000t', base)).toBe(2500);
    expect(parseTtmlTime('12.5s', base)).toBe(12_500);
    expect(parseTtmlTime('500ms', base)).toBe(500);
    expect(parseTtmlTime('1.5m', base)).toBe(90_000);
    expect(parseTtmlTime('00:01:02.250', base)).toBe(62_250);
    expect(parseTtmlTime('00:00:01:12', base)).toBe(1500); // 12 frames at 24 fps
  });
  it('rejects junk', () => {
    expect(parseTtmlTime('soon', base)).toBeNull();
    expect(parseTtmlTime(undefined, base)).toBeNull();
  });
});

describe('parseTtml', () => {
  it("parses Netflix's DFXP: tick times, <br/> line breaks, entities; drops empty cues", () => {
    expect(parseTtml(NETFLIX_DFXP)).toEqual([
      { startMs: 2500, endMs: 4375, text: 'Where are you going?' },
      { startMs: 4500, endMs: 6125, text: "I'm gonna call it\na night." },
      { startMs: 7000, endMs: 8250, text: "Tom & Jerry's <place>" },
    ]);
  });

  it('parses IMSC clock times and dur, sorts by start, skips cues without an end', () => {
    expect(parseTtml(IMSC)).toEqual([
      { startMs: 59_000, endMs: 60_500, text: '- Hi.\n- Hello.' },
      { startMs: 62_500, endMs: 64_000, text: '[door slams]' },
    ]);
  });

  it('handles prefixed tags and source formatting whitespace', () => {
    const xml = `<tt:tt xmlns:tt="http://www.w3.org/ns/ttml"><tt:body><tt:div>
<tt:p begin="1s" end="2s">
    <tt:span>Hello</tt:span>
    <tt:span>there</tt:span>
</tt:p></tt:div></tt:body></tt:tt>`;
    expect(parseTtml(xml)).toEqual([{ startMs: 1000, endMs: 2000, text: 'Hello there' }]);
  });
});

describe('parseWebVtt', () => {
  it('parses cues, strips tags and settings, decodes entities, skips NOTE blocks', () => {
    expect(parseWebVtt(VTT)).toEqual([
      { startMs: 1000, endMs: 2500, text: 'Hello there\nsecond line' },
      { startMs: 61_250, endMs: 63_000, text: 'Fish & chips' },
    ]);
  });
});

describe('parseSubtitleFile', () => {
  it('sniffs the format', () => {
    expect(parseSubtitleFile(VTT)).toHaveLength(2);
    expect(parseSubtitleFile(`\ufeff${VTT}`)).toHaveLength(2);
    expect(parseSubtitleFile(NETFLIX_DFXP)).toHaveLength(3);
    expect(parseSubtitleFile('not subtitles')).toEqual([]);
  });
});
