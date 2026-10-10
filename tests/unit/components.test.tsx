// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Monitor, Moon, Sun } from 'lucide-react';
import { DonationCard } from '@/components/DonationCard';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TIPS, TipCard, pickTip } from '@/components/TipCard';
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

  it('can keep a fixed name while its visible title changes', () => {
    render(<Toggle label="Taking a break" name="Enabled" description="Netflix works like normal." checked={false} onChange={() => {}} />);
    const sw = screen.getByRole('switch', { name: 'Enabled' });
    expect(sw.textContent).toContain('Taking a break');
    expect(sw.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('reflects the checked state', () => {
    render(<Toggle label="Enabled" checked onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Enabled' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('DonationCard', () => {
  const expected = {
    'Buy Me a Coffee': 'https://buymeacoffee.com/jaycho1214',
    'GitHub Sponsors': 'https://github.com/sponsors/jaycho1214',
  };

  it('links to Buy Me a Coffee and GitHub Sponsors in a new tab', () => {
    render(<DonationCard />);
    expect(screen.getByRole('heading', { name: 'Enjoying LingoFlix?' })).toBeTruthy();
    expect(screen.getByText("It's free forever. A coffee keeps it going.")).toBeTruthy();
    for (const [name, href] of Object.entries(expected)) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('compact (popup) shows short labels but keeps the full link names', () => {
    render(<DonationCard compact />);
    expect(screen.getByRole('link', { name: 'Buy Me a Coffee' }).textContent).toBe('Coffee');
    expect(screen.getByRole('link', { name: 'GitHub Sponsors' }).textContent).toBe('Sponsor');
  });
});

describe('TipCard', () => {
  it('picks a tip from the list, covering both ends', () => {
    expect(pickTip(() => 0)).toBe(TIPS[0]);
    expect(pickTip(() => 0.9999)).toBe(TIPS[TIPS.length - 1]);
  });

  it('shows one tip under "Try this"', () => {
    render(<TipCard random={() => 0} />);
    expect(screen.getByRole('heading', { name: 'Try this' })).toBeTruthy();
    expect(screen.getByText(TIPS[0]!.text, { exact: false })).toBeTruthy();
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  function setup(value: 'light' | 'dark' | 'system' = 'system') {
    const onChange = vi.fn();
    render(<SegmentedControl label="Appearance" value={value} options={options} onChange={onChange} />);
    const radio = (name: string) => screen.getByRole('radio', { name });
    return { onChange, radio };
  }

  it('is a labelled radio group showing the current choice', () => {
    const { radio } = setup('system');
    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeTruthy();
    expect(radio('System').getAttribute('aria-checked')).toBe('true');
    expect(radio('Light').getAttribute('aria-checked')).toBe('false');
  });

  it('reports the clicked choice', () => {
    const { onChange, radio } = setup();
    fireEvent.click(radio('Dark'));
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('only the current choice is in the tab order; arrow keys move and wrap', () => {
    const { onChange, radio } = setup('system');
    expect(radio('System').tabIndex).toBe(0);
    expect(radio('Light').tabIndex).toBe(-1);
    fireEvent.keyDown(radio('System'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('light');
    fireEvent.keyDown(radio('System'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('dark');
  });
});
