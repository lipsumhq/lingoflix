import { Lightbulb } from 'lucide-react';
import { useId, useState } from 'react';

/** Tips name actions, not keys, so they stay true after the user rebinds shortcuts. */
export const TIPS = [
  { id: 'listen-first', text: 'Hide subtitles, listen to a line once, then show them again to check yourself.' },
  { id: 'short-rewind', text: 'Set Rewind to 3 seconds to replay a line you just missed without losing your place.' },
  { id: 'reachable-keys', text: "Pick keys you can reach without looking. You'll press them a lot while watching." },
] as const;

export function pickTip(random: () => number = Math.random): (typeof TIPS)[number] {
  return TIPS[Math.min(TIPS.length - 1, Math.floor(random() * TIPS.length))]!;
}

/** "Try this" card; shows a different tip each time the page opens. */
export function TipCard({ random = Math.random }: { random?: () => number }) {
  const [tip] = useState(() => pickTip(random));
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-[18px] border-2 border-tint-line bg-tint px-4 py-3.5">
      <h2 id={headingId} className="flex items-center gap-2 text-[15px] font-black text-tint-ink">
        <Lightbulb size={16} strokeWidth={2.5} aria-hidden />
        Try this
      </h2>
      <p className="mt-1.5 text-[13px] leading-snug font-semibold text-ink">{tip.text}</p>
    </section>
  );
}
