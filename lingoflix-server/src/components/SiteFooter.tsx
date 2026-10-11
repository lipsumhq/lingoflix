import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t-2 border-line">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <nav aria-label="Footer" className="flex gap-4 font-bold">
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
          <Link href="/account" className="hover:underline">
            Account
          </Link>
        </nav>
        <p>Not affiliated with or endorsed by Netflix.</p>
        <p>© 2026 LingoFlix</p>
      </div>
    </footer>
  );
}
