import type { ExplainErrorCode } from '@/lib/claude/protocol';
import type { CardSections } from '@/lib/settings';
import type { Explanation } from '@/lib/study-log/types';

/** A viewport rectangle. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CardErrorCode = ExplainErrorCode | 'image-subs';

export interface FollowUpView {
  question: string;
  answer: string;
  status: 'streaming' | 'done' | 'error';
  error: string | null;
}

export interface CardState {
  /** New for every opened card, so late answers for an old card are dropped. */
  key: number;
  /** The subtitle line, line breaks kept. The card stays on it (spec §5.3 step 6). */
  line: string;
  /** Where the line was on screen when the card opened. */
  anchor: Box | null;
  openedBy: 'hover' | 'shortcut';
  status: 'loading' | 'streaming' | 'done' | 'error';
  response: string;
  /** The Study Log entry once saved or found. */
  entry: Explanation | null;
  error: { code: CardErrorCode; message: string } | null;
  followUps: FollowUpView[];
  followUpBusy: boolean;
  sections: CardSections;
  fromStudyLog: boolean;
}

export const IMAGE_SUBTITLES_MESSAGE = "This title's subtitles can't be read as text";

export function unionBox(rects: readonly Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[]): Box | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, width: right - left, height: bottom - top };
}
