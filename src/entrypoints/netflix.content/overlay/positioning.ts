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

/** Spec §5.3: above the line, constrained to the player, scrolling internally when taller than the room. */
export function placeCard(anchor: Box | null, player: Box, cardHeight: number): CardPlacement {
  const width = Math.min(CARD_MAX_WIDTH, Math.max(0, player.width - 2 * MARGIN));
  const centerX = anchor ? anchor.left + anchor.width / 2 : player.left + player.width / 2;
  const left = clamp(centerX - width / 2, player.left + MARGIN, player.left + player.width - MARGIN - width);
  const bottom = anchor ? anchor.top - MARGIN : player.top + player.height - CONTROLS_CLEARANCE;
  const maxHeight = Math.max(MIN_HEIGHT, bottom - (player.top + MARGIN));
  const top = Math.max(player.top + MARGIN, bottom - Math.min(cardHeight, maxHeight));
  return { left, top, width, maxHeight };
}
