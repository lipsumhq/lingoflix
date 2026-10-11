/** Fixed facts about the LingoFlix site (spec §1, §5.3, §10). */
export const SITE_NAME = "LingoFlix";
export const SITE_URL = "https://lingoflix.lipsum.fun";
export const SUPPORT_EMAIL = "support@lingoflix.lipsum.fun";
export const PRICE_MONTHLY = "$7.99";
export const PRICE_YEARLY = "$59.99";
export const TRIAL_DAYS = 7;

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
