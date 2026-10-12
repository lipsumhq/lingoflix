import { CodeXml } from 'lucide-react';
import { useId } from 'react';
import { SOURCE_CODE_URL, SOURCE_COPY, SOURCE_TITLE } from '@/lib/config';
import { buttonSecondary, card } from './styles';

/** "Open source" with a link to the public repository (options page sidebar). */
export function SourceCard() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`${card} p-3.5`}>
      <h2 id={headingId} className="text-[15px] font-black text-ink">
        {SOURCE_TITLE}
      </h2>
      <p className="mt-0.5 text-[13px] font-semibold text-mute">{SOURCE_COPY}</p>
      <div className="mt-3 flex flex-col gap-2">
        <a href={SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer" className={buttonSecondary}>
          <CodeXml size={16} strokeWidth={2.5} aria-hidden />
          View on GitHub
        </a>
      </div>
    </section>
  );
}
