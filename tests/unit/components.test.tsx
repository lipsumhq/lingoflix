// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DonationLinks } from '@/components/DonationLinks';
import { Toggle } from '@/components/Toggle';

afterEach(cleanup);

describe('Toggle', () => {
  it('is a labelled switch that reports the flipped value', () => {
    const onChange = vi.fn();
    render(<Toggle label="Enabled" description="Turn LingoFlix on or off" checked={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Enabled' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects the checked state', () => {
    render(<Toggle label="Enabled" checked onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Enabled' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('DonationLinks', () => {
  it('links to Buy Me a Coffee and GitHub Sponsors in a new tab', () => {
    render(<DonationLinks />);
    expect(screen.getByText('LingoFlix is free. If it helps you learn, you can support it.')).toBeTruthy();
    const expected = {
      'Buy Me a Coffee': 'https://buymeacoffee.com/jaycho1214',
      'GitHub Sponsors': 'https://github.com/sponsors/jaycho1214',
    };
    for (const [name, href] of Object.entries(expected)) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});
