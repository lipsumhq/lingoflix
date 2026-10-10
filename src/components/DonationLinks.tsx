import { DONATION_COPY, DONATION_LINKS } from '@/lib/config';

export function DonationLinks() {
  return (
    <section aria-labelledby="donate-heading" className="space-y-2">
      <h2 id="donate-heading" className="text-sm font-semibold text-neutral-100">
        Support LingoFlix
      </h2>
      <p className="text-xs text-neutral-400">{DONATION_COPY}</p>
      <div className="flex flex-wrap gap-2">
        {DONATION_LINKS.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:border-yellow-400 hover:text-yellow-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400"
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
