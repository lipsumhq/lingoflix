import { SITE_URL } from "./site";

const SITE_ORIGIN = new URL(SITE_URL).origin;

/** Tabs, newlines and other control characters: browsers drop some of them, which can turn "/\t/x" into "//x". */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Where to go after signing in. Only a path on this site is kept. Anything else becomes `fallback`:
 * another site, a protocol-relative URL, a backslash or control-character trick, or junk (Review Focus 1).
 */
export function safeNextPath(value: string | null | undefined, fallback = "/account"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.includes("\\") || hasControlCharacter(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, SITE_ORIGIN);
  } catch {
    return fallback;
  }
  return url.origin === SITE_ORIGIN ? value : fallback;
}
