import type { ExplainErrorCode } from '@/lib/ai/protocol';
import type { Provider } from '@/lib/ai/provider';
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

/** A Save row with a save or removal in flight, or whose last save failed (v2 spec §4.1, §9). */
export type SaveStatus = 'saving' | 'error';

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
  /** The stored explanation, once Claude finished or when found in the history. */
  explanation: Explanation | null;
  /** `provider` is the key's when the background named it (for the no-credit billing link). */
  error: { code: CardErrorCode; message: string; provider: Provider | null } | null;
  followUps: FollowUpView[];
  followUpBusy: boolean;
  sections: CardSections;
  /** Shown from the explanation history without asking Claude ("Explained before"). */
  explainedBefore: boolean;
  /** Index keys (`suggestionKey`) of this line's Save rows that are saved. */
  savedKeys: string[];
  /** By row key: rows with a request in flight, or whose last save failed. */
  saveStatus: Record<string, SaveStatus>;
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
