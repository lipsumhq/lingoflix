import { describe, expect, it } from 'vitest';
import { createFirstStringFieldReader } from '@/lib/ai/json-field-stream';

/** Pushes `json` in pieces of `size` characters and returns what the reader emitted. */
function readInPieces(json: string, size: number) {
  const out: string[] = [];
  const reader = createFirstStringFieldReader('explanation', (text) => out.push(text));
  for (let i = 0; i < json.length; i += size) reader.push(json.slice(i, i + size));
  return { text: out.join(''), reader, pieces: out };
}

const JSON_REPLY = String.raw`{ "explanation" : "## Meaning\n\"Hola\" été 😀 a\\b\/c\tend", "suggest_saves": {"items": []}}`;
const DECODED = '## Meaning\n"Hola" été 😀 a\\b/c\tend';

describe('createFirstStringFieldReader', () => {
  it.each([1, 2, 3, 5, 7, 1000])('decodes the first string property however the JSON is split (%i characters at a time)', (size) => {
    const { text, reader } = readInPieces(JSON_REPLY, size);
    expect(text).toBe(DECODED);
    expect(reader.text).toBe(DECODED);
    expect(reader.started).toBe(true);
  });

  it('emits text as it arrives, before the string ends', () => {
    const out: string[] = [];
    const reader = createFirstStringFieldReader('explanation', (text) => out.push(text));
    reader.push('{"explanation":"Hel');
    expect(out).toEqual(['Hel']);
    reader.push('lo');
    expect(out).toEqual(['Hel', 'lo']);
    reader.push('", "x": "ignored"}');
    expect(out.join('')).toBe('Hello');
  });

  it('keeps what arrived when the JSON is cut off mid-string', () => {
    const { text, reader } = readInPieces('{"explanation":"Cut off mid\\', 4);
    expect(text).toBe('Cut off mid');
    expect(reader.text).toBe('Cut off mid');
  });

  it('emits nothing when the field is not the first property, or the reply is not an object', () => {
    for (const json of ['{"suggest_saves":{"items":[]},"explanation":"Hi"}', 'Plain text', '["explanation"]']) {
      const { text, reader } = readInPieces(json, 3);
      expect(text).toBe('');
      expect(reader.started).toBe(false);
    }
  });
});
