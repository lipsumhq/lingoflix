import type { Box } from './card-state';

export interface CardPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export const CARD_MAX_WIDTH = 520;
const MARGIN = 12;
const MIN_HEIGHT = 140;
/** Without a line to sit on, stay above Netflix's controls. */
const CONTROLS_CLEARANCE = 72;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Spec §5.3: above the line, constrained to the player, scrolling internally when taller than the room. When the card
 * doesn't fit above the line and there's more room below it, it goes below: Netflix moves lines to the top of the
 * picture while there's text at the bottom (credits, signs), which left the card a sliver above them.
 */
export function placeCard(anchor: Box | null, player: Box, cardHeight: number): CardPlacement {
  const width = Math.min(CARD_MAX_WIDTH, Math.max(0, player.width - 2 * MARGIN));
  const centerX = anchor ? anchor.left + anchor.width / 2 : player.left + player.width / 2;
  const left = clamp(centerX - width / 2, player.left + MARGIN, player.left + player.width - MARGIN - width);
  const bottom = anchor ? anchor.top - MARGIN : player.top + player.height - CONTROLS_CLEARANCE;
  const roomAbove = bottom - (player.top + MARGIN);
  if (anchor) {
    const belowTop = anchor.top + anchor.height + MARGIN;
    const roomBelow = player.top + player.height - CONTROLS_CLEARANCE - belowTop;
    if (cardHeight > roomAbove && roomBelow > roomAbove) return { left, top: belowTop, width, maxHeight: Math.max(MIN_HEIGHT, roomBelow) };
  }
  const maxHeight = Math.max(MIN_HEIGHT, roomAbove);
  const top = Math.max(player.top + MARGIN, bottom - Math.min(cardHeight, maxHeight));
  return { left, top, width, maxHeight };
}
