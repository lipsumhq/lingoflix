import { Coffee, Heart } from 'lucide-react';
import { useId } from 'react';
import { DONATION_COPY, DONATION_LINKS, DONATION_TITLE } from '@/lib/config';
import { buttonSecondary, card } from './styles';

const ICONS = { buymeacoffee: Coffee, 'github-sponsors': Heart } as const;

/** "Enjoying LingoFlix?" with both donation links. `compact` (popup) puts short labels side by side. */
export function DonationCard({ compact = false }: { compact?: boolean }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`${card} p-3.5`}>
      <h2 id={headingId} className="text-[15px] font-black text-ink">
        {DONATION_TITLE}
      </h2>
      <p className="mt-0.5 text-[13px] font-semibold text-mute">{DONATION_COPY}</p>
      <div className={`mt-3 flex gap-2 ${compact ? '' : 'flex-col'}`}>
        {DONATION_LINKS.map((link) => {
          const Icon = ICONS[link.id];
          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={compact ? link.label : undefined}
              className={`${buttonSecondary} ${compact ? 'flex-1' : ''}`}
            >
              <Icon size={16} strokeWidth={2.5} aria-hidden />
              {compact ? link.shortLabel : link.label}
            </a>
          );
        })}
      </div>
    </section>
  );
}
