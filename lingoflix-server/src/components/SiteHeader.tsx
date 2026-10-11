import Link from "next/link";
import { LogoMark } from "./LogoMark";

export function SiteHeader() {
  return (
    <header className="border-b-2 border-line">
      <nav aria-label="Main" className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-xl font-black">
          <LogoMark className="size-8" />
          LingoFlix
        </Link>
        <div className="flex items-center gap-5 text-sm font-extrabold">
          <Link href="/#pricing" className="hover:underline">
            Pricing
          </Link>
          <Link href="/account" className="hover:underline">
            Account
          </Link>
        </div>
      </nav>
    </header>
  );
}
