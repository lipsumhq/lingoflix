/** Fixed facts about the LingoFlix site (free-own-key spec §5). LingoFlix is free: no prices, no trial. */
export const SITE_NAME = "LingoFlix";
export const SITE_URL = "https://lingoflix.lipsum.fun";
export const SUPPORT_EMAIL = "support@lingoflix.lipsum.fun";

/** Where to donate: the same two pages as the extension's `DONATION_LINKS` (lingoflix-extension/src/lib/config.ts). */
export const DONATION_LINKS = [
  { id: "buymeacoffee", label: "Buy Me a Coffee", url: "https://buymeacoffee.com/jaycho1214" },
  { id: "github-sponsors", label: "GitHub Sponsors", url: "https://github.com/sponsors/jaycho1214" },
] as const;

const STORE_PREFIX = "https://chromewebstore.google.com/";

/**
 * The extension's Chrome Web Store page from `NEXT_PUBLIC_CHROME_STORE_URL`, or null until it is published.
 * Only an https chromewebstore.google.com link is accepted, so a typo can't send people somewhere else.
 * The default reads the variable by its full name, which Next.js also inlines into browser code.
 */
export function chromeStoreUrl(
  env: Record<string, string | undefined> = {
    NEXT_PUBLIC_CHROME_STORE_URL: process.env.NEXT_PUBLIC_CHROME_STORE_URL,
  },
): string | null {
  const value = env.NEXT_PUBLIC_CHROME_STORE_URL?.trim();
  return value && value.startsWith(STORE_PREFIX) ? value : null;
}
