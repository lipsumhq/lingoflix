export type ActionId =
  | 'rewind'
  | 'forward'
  | 'previousLine'
  | 'nextLine'
  | 'replayLine'
  | 'toggleSubtitles'
  | 'explainLine';

export interface Binding {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type ShortcutMap = Record<ActionId, Binding | null>;

export const ACTION_IDS: readonly ActionId[] = [
  'rewind',
  'forward',
  'previousLine',
  'nextLine',
  'replayLine',
  'toggleSubtitles',
  'explainLine',
];

export const ACTION_LABELS: Record<ActionId, string> = {
  rewind: 'Rewind',
  forward: 'Forward',
  previousLine: 'Previous line',
  nextLine: 'Next line',
  replayLine: 'Replay line',
  toggleSubtitles: 'Show / hide subtitles',
  explainLine: 'Explain line',
};

export function key(code: string, mods: Partial<Omit<Binding, 'code'>> = {}): Binding {
  return { code, ctrl: false, alt: false, shift: false, meta: false, ...mods };
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  rewind: key('ArrowLeft'),
  forward: key('ArrowRight'),
  previousLine: key('KeyA'),
  nextLine: key('KeyD'),
  replayLine: key('KeyR'),
  toggleSubtitles: key('KeyC'),
  explainLine: key('KeyE'),
};

/** Unmodified keys Netflix's player uses; binding one of them overrides Netflix (warn, don't block). */
export const NETFLIX_DEFAULT_CODES: ReadonlySet<string> = new Set([
  'Space',
  'Enter',
  'KeyF',
  'KeyM',
  'KeyS',
  'ArrowUp',
  'ArrowDown',
  'Escape',
]);

const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'Fn',
  'FnLock',
]);

export type KeyLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

export function bindingFromEvent(e: KeyLike): Binding | null {
  if (!e.code || MODIFIER_CODES.has(e.code)) return null;
  return { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
}

export function sameBinding(a: Binding, b: Binding): boolean {
  return a.code === b.code && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta;
}

export function matchAction(e: KeyLike, shortcuts: ShortcutMap): ActionId | null {
  const pressed = bindingFromEvent(e);
  if (!pressed) return null;
  for (const id of ACTION_IDS) {
    const bound = shortcuts[id];
    if (bound && sameBinding(bound, pressed)) return id;
  }
  return null;
}

export function findConflict(shortcuts: ShortcutMap, binding: Binding, except: ActionId): ActionId | null {
  for (const id of ACTION_IDS) {
    if (id === except) continue;
    const bound = shortcuts[id];
    if (bound && sameBinding(bound, binding)) return id;
  }
  return null;
}

export function overridesNetflix(binding: Binding): boolean {
  return !binding.ctrl && !binding.alt && !binding.meta && NETFLIX_DEFAULT_CODES.has(binding.code);
}

const CODE_LABELS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

function codeLabel(code: string): string {
  const label = CODE_LABELS[code];
  if (label) return label;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function formatBinding(binding: Binding | null, platform: 'mac' | 'other' = 'other'): string {
  if (!binding) return 'Not set';
  const mac = platform === 'mac';
  const parts: string[] = [];
  if (binding.ctrl) parts.push(mac ? '⌃' : 'Ctrl');
  if (binding.alt) parts.push(mac ? '⌥' : 'Alt');
  if (binding.shift) parts.push(mac ? '⇧' : 'Shift');
  if (binding.meta) parts.push(mac ? '⌘' : 'Win');
  parts.push(codeLabel(binding.code));
  return parts.join(mac ? '' : '+');
}
