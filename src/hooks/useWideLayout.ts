import { useEffect, useState } from 'react';

/** v2 spec §6.1: at this width the detail view gets its own column; below it, it replaces the list. */
export const WIDE_LAYOUT_QUERY = '(min-width: 1100px)';

const mediaQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_LAYOUT_QUERY) : null;

/** True on wide windows, and wherever `matchMedia` is missing. */
export function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => mediaQuery()?.matches ?? true);
  useEffect(() => {
    const list = mediaQuery();
    if (!list) return;
    const onChange = () => setWide(list.matches);
    list.addEventListener('change', onChange);
    onChange();
    return () => list.removeEventListener('change', onChange);
  }, []);
  return wide;
}
