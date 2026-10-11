/** Spec §5.3 step 1: is the pointer on the subtitle text (each rect padded by `pad` px)? */
export function pointInRects(
  x: number,
  y: number,
  rects: readonly Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[],
  pad = 8,
): boolean {
  return rects.some((r) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad);
}
