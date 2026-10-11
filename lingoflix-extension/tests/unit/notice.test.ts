// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotifier } from '@/entrypoints/netflix.content/notice';

const box = () =>
  document.getElementById('lingoflix-notice-host')?.shadowRoot?.querySelector('[role="status"]') as HTMLElement | null;

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('notifier', () => {
  it('shows a message and hides it after the duration', () => {
    vi.useFakeTimers();
    const n = createNotifier(document);
    n.show('Subtitles hidden', 1200);
    expect(box()!.textContent).toBe('Subtitles hidden');
    expect(box()!.classList.contains('visible')).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(box()!.classList.contains('visible')).toBe(false);
  });

  it('showOnce shows a given key only once', () => {
    const n = createNotifier(document);
    n.showOnce('player', 'first');
    n.show('other', 10);
    n.showOnce('player', 'second');
    expect(box()!.textContent).toBe('other');
  });
});

describe('notifier dispose', () => {
  it('removes the notice from the page', () => {
    const n = createNotifier(document);
    n.show('hello');
    expect(document.getElementById('lingoflix-notice-host')).not.toBeNull();
    n.dispose();
    expect(document.getElementById('lingoflix-notice-host')).toBeNull();
  });
});
