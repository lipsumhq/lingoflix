import { describe, expect, it } from 'vitest';
import {
  ACTION_IDS,
  DEFAULT_SHORTCUTS,
  bindingFromEvent,
  findConflict,
  formatBinding,
  key,
  matchAction,
  overridesNetflix,
} from '@/lib/shortcuts';

const ev = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe('defaults', () => {
  it('binds rewind ←, forward →, toggle subtitles C', () => {
    expect(DEFAULT_SHORTCUTS).toEqual({
      rewind: key('ArrowLeft'),
      forward: key('ArrowRight'),
      toggleSubtitles: key('KeyC'),
    });
    expect(ACTION_IDS).toEqual(['rewind', 'forward', 'toggleSubtitles']);
  });
});

describe('bindingFromEvent', () => {
  it('captures code and all modifiers', () => {
    expect(bindingFromEvent(ev('KeyJ', { shift: true, meta: true }))).toEqual({
      code: 'KeyJ',
      ctrl: false,
      alt: false,
      shift: true,
      meta: true,
    });
  });

  it('returns null for modifier-only keys and empty codes', () => {
    for (const code of ['ShiftLeft', 'ControlRight', 'AltLeft', 'MetaRight', 'CapsLock', '']) {
      expect(bindingFromEvent(ev(code))).toBeNull();
    }
  });
});

describe('matchAction', () => {
  it('matches the bound action', () => {
    expect(matchAction(ev('ArrowLeft'), DEFAULT_SHORTCUTS)).toBe('rewind');
    expect(matchAction(ev('KeyC'), DEFAULT_SHORTCUTS)).toBe('toggleSubtitles');
  });

  it('requires exact modifiers', () => {
    expect(matchAction(ev('ArrowLeft', { meta: true }), DEFAULT_SHORTCUTS)).toBeNull();
    expect(matchAction(ev('KeyC', { ctrl: true }), DEFAULT_SHORTCUTS)).toBeNull();
    const shifted = { ...DEFAULT_SHORTCUTS, rewind: key('KeyJ', { shift: true }) };
    expect(matchAction(ev('KeyJ'), shifted)).toBeNull();
    expect(matchAction(ev('KeyJ', { shift: true }), shifted)).toBe('rewind');
  });

  it('skips unbound actions', () => {
    expect(matchAction(ev('KeyC'), { ...DEFAULT_SHORTCUTS, toggleSubtitles: null })).toBeNull();
  });
});

describe('findConflict', () => {
  it('reports the other action using the same binding', () => {
    expect(findConflict(DEFAULT_SHORTCUTS, key('ArrowRight'), 'rewind')).toBe('forward');
  });

  it('ignores the action being edited and unbound actions', () => {
    expect(findConflict(DEFAULT_SHORTCUTS, key('ArrowLeft'), 'rewind')).toBeNull();
    expect(findConflict({ ...DEFAULT_SHORTCUTS, forward: null }, key('ArrowRight'), 'rewind')).toBeNull();
  });
});

describe('overridesNetflix', () => {
  it('flags unmodified Netflix default keys', () => {
    for (const code of ['Space', 'Enter', 'KeyF', 'KeyM', 'KeyS', 'ArrowUp', 'ArrowDown', 'Escape']) {
      expect(overridesNetflix(key(code))).toBe(true);
    }
  });

  it('does not flag other keys, the default seek arrows, or modified combos', () => {
    expect(overridesNetflix(key('KeyJ'))).toBe(false);
    expect(overridesNetflix(key('ArrowLeft'))).toBe(false);
    expect(overridesNetflix(key('KeyF', { ctrl: true }))).toBe(false);
  });
});

describe('formatBinding', () => {
  it('formats keys readably', () => {
    expect(formatBinding(key('ArrowLeft'))).toBe('←');
    expect(formatBinding(key('KeyC'))).toBe('C');
    expect(formatBinding(key('Digit5'))).toBe('5');
    expect(formatBinding(key('Space'))).toBe('Space');
    expect(formatBinding(key('KeyJ', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+J');
    expect(formatBinding(key('KeyJ', { meta: true, shift: true }), 'mac')).toBe('⇧⌘J');
    expect(formatBinding(null)).toBe('Not set');
  });
});
