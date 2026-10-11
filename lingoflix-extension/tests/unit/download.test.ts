// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadText } from '@/lib/download';

afterEach(() => vi.useRealTimers());

describe('downloadText', () => {
  it('downloads the text through a temporary link and frees the Blob URL afterwards', async () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:lingoflix-1');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked: { href: string | null; download: string; connected: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href'), download: this.download, connected: this.isConnected });
    });

    downloadText('lingoflix-2026-10-10.csv', '\uFEFF"Type"\r\n', 'text/csv;charset=utf-8');

    expect(clicked).toEqual([{ href: 'blob:lingoflix-1', download: 'lingoflix-2026-10-10.csv', connected: true }]);
    expect(document.querySelector('a[download]')).toBeNull(); // the link is gone again
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:lingoflix-1');

    vi.useRealTimers(); // reading the Blob is async
    const blob = create.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf])); // UTF-8 BOM
  });
});
