// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecondsInput } from '@/entrypoints/options/SecondsInput';

afterEach(cleanup);

function setup(value = 5) {
  const onCommit = vi.fn();
  render(<SecondsInput label="Rewind seconds" value={value} onCommit={onCommit} />);
  return { onCommit, input: screen.getByLabelText('Rewind seconds') as HTMLInputElement };
}

describe('SecondsInput', () => {
  it('commits a valid value on blur', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(3);
  });

  it('commits on Enter', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(12);
  });

  it('clamps out-of-range values to 1–60', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(1);
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(60);
  });

  it('reverts empty input without committing', () => {
    const { onCommit, input } = setup(5);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('5');
  });
});
