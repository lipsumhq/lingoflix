// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecondsStepper } from '@/entrypoints/options/SecondsStepper';

afterEach(cleanup);

function setup(value = 5) {
  const onCommit = vi.fn();
  render(<SecondsStepper label="Rewind seconds" value={value} onCommit={onCommit} />);
  return {
    onCommit,
    input: screen.getByLabelText('Rewind seconds') as HTMLInputElement,
    minus: screen.getByRole('button', { name: 'Decrease Rewind seconds' }) as HTMLButtonElement,
    plus: screen.getByRole('button', { name: 'Increase Rewind seconds' }) as HTMLButtonElement,
  };
}

describe('SecondsStepper', () => {
  it('+ and – change the value by one second', () => {
    const { onCommit, minus, plus } = setup(5);
    fireEvent.click(plus);
    expect(onCommit).toHaveBeenLastCalledWith(6);
    fireEvent.click(minus);
    expect(onCommit).toHaveBeenLastCalledWith(4);
  });

  it('disables – at 1 s and + at 60 s', () => {
    expect(setup(1).minus.disabled).toBe(true);
    cleanup();
    const atMax = setup(60);
    expect(atMax.plus.disabled).toBe(true);
    expect(atMax.minus.disabled).toBe(false);
  });

  it('commits a typed value on blur', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(3);
  });

  it('commits a typed value on Enter', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(12);
  });

  it('clamps typed values to 1–60', () => {
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
