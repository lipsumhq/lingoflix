// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutRecorder } from '@/entrypoints/options/ShortcutRecorder';
import { DEFAULT_SHORTCUTS, key, type ShortcutMap } from '@/lib/shortcuts';

afterEach(cleanup);

function setup(shortcuts: ShortcutMap = DEFAULT_SHORTCUTS) {
  const onChange = vi.fn();
  render(<ShortcutRecorder action="rewind" shortcuts={shortcuts} onChange={onChange} />);
  const startRecording = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Change Rewind shortcut' }));
    return screen.getByLabelText('Press a new key for Rewind');
  };
  return { onChange, startRecording };
}

describe('ShortcutRecorder', () => {
  it('shows the current binding', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Change Rewind shortcut' }).textContent).toBe('←');
  });

  it('asks for a key while recording', () => {
    const { startRecording } = setup();
    expect(startRecording().textContent).toBe('Press any key…');
  });

  it('records the next key press', () => {
    const { onChange, startRecording } = setup();
    fireEvent.keyDown(startRecording(), { code: 'KeyJ', key: 'j' });
    expect(onChange).toHaveBeenCalledWith(key('KeyJ'));
  });

  it('records modifier combos and ignores modifier-only presses', () => {
    const { onChange, startRecording } = setup();
    const target = startRecording();
    fireEvent.keyDown(target, { code: 'ShiftLeft', key: 'Shift', shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(target, { code: 'KeyJ', key: 'J', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(key('KeyJ', { shift: true }));
  });

  it('refuses a key already used by another action', () => {
    const { onChange, startRecording } = setup();
    fireEvent.keyDown(startRecording(), { code: 'ArrowRight', key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('→ is already used by Forward.');
  });

  it('Escape cancels without changing anything', () => {
    const { onChange, startRecording } = setup();
    fireEvent.keyDown(startRecording(), { code: 'Escape', key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Change Rewind shortcut' })).toBeTruthy();
  });

  it('Clear unbinds the action', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Rewind shortcut' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('warns when the binding overrides a Netflix key', () => {
    setup({ ...DEFAULT_SHORTCUTS, rewind: key('KeyF') });
    expect(screen.getByText("Overrides Netflix's F shortcut.")).toBeTruthy();
  });

  it('invites "Pick a key" and has no Clear button when unbound', () => {
    setup({ ...DEFAULT_SHORTCUTS, rewind: null });
    expect(screen.getByRole('button', { name: 'Change Rewind shortcut' }).textContent).toBe('Pick a key');
    expect(screen.queryByRole('button', { name: 'Clear Rewind shortcut' })).toBeNull();
  });
});
