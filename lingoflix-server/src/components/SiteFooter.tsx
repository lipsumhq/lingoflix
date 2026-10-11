import Link from "next/link";
import { DONATION_LINKS, SUPPORT_EMAIL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t-2 border-line">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2 font-bold">
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:underline">
            {SUPPORT_EMAIL}
          </a>
          {DONATION_LINKS.map((link) => (
            <a key={link.id} href={link.url} className="hover:underline">
              {link.label}
            </a>
          ))}
        </nav>
        <p>Not affiliated with or endorsed by Netflix.</p>
        <p>© 2026 LingoFlix</p>
      </div>
    </footer>
  );
}
