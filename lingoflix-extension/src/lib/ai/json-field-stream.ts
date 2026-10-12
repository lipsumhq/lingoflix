const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

export interface FirstStringFieldReader {
  /** Raw JSON text, in pieces of any size. */
  push(chunk: string): void;
  /** Whether the JSON opened with the field, so its text has been streaming. */
  readonly started: boolean;
  /** The field's text decoded so far. */
  readonly text: string;
}

/**
 * Streams the value of a JSON object's first property, a string, as the JSON arrives: `onText` gets each run of
 * decoded characters. Claude's structured reply opens with the explanation, so the card shows it while the rest
 * is still being written. When the JSON doesn't open with the field, nothing is emitted (`started` stays false).
 */
export function createFirstStringFieldReader(field: string, onText: (text: string) => void): FirstStringFieldReader {
  const opening = `{"${field}":"`;
  let raw = '';
  let pos = 0;
  let matched = 0; // characters of `opening` matched so far, whitespace between tokens skipped
  let state: 'opening' | 'value' | 'done' | 'other' = 'opening';
  let text = '';

  const readOpening = () => {
    while (pos < raw.length && matched < opening.length) {
      const ch = raw.charAt(pos);
      // Whitespace may sit between the JSON tokens, never inside the field's name.
      const inName = matched > 1 && matched < opening.length - 2;
      if (!inName && /\s/.test(ch)) {
        pos++;
        continue;
      }
      if (ch !== opening[matched]) {
        state = 'other';
        return;
      }
      pos++;
      matched++;
    }
    if (matched === opening.length) state = 'value';
  };

  const readValue = () => {
    let out = '';
    while (pos < raw.length) {
      const ch = raw.charAt(pos);
      if (ch === '"') {
        state = 'done';
        break;
      }
      if (ch !== '\\') {
        out += ch;
        pos++;
        continue;
      }
      const next = raw[pos + 1];
      if (next === undefined) break; // the escape's second half hasn't arrived
      if (next === 'u') {
        const hex = raw.slice(pos + 2, pos + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        pos += 6;
        continue;
      }
      out += ESCAPES[next] ?? next;
      pos += 2;
    }
    if (out) {
      text += out;
      onText(out);
    }
  };

  return {
    push(chunk) {
      if (state === 'done' || state === 'other') return;
      raw += chunk;
      if (state === 'opening') readOpening();
      if (state === 'value') readValue();
    },
    get started() {
      return state === 'value' || state === 'done';
    },
    get text() {
      return text;
    },
  };
}
