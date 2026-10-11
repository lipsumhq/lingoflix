import { describe, expect, it, vi } from "vitest";
import * as site from "@/lib/site";
import { DONATION_LINKS, SITE_NAME, SITE_URL, SUPPORT_EMAIL, chromeStoreUrl } from "@/lib/site";

const STORE_URL = "https://chromewebstore.google.com/detail/lingoflix/abcdefghijklmnopabcdefghijklmnop";

describe("site constants", () => {
  it("names the product, its address and its support email", () => {
    expect(SITE_NAME).toBe("LingoFlix");
    expect(SITE_URL).toBe("https://lingoflix.lipsum.fun");
    expect(SUPPORT_EMAIL).toBe("support@lingoflix.lipsum.fun");
  });

  it("has no prices or trial: LingoFlix is free", () => {
    expect(Object.keys(site).filter((name) => /PRICE|TRIAL/.test(name))).toEqual([]);
  });

  it("links the same two donation pages as the extension", () => {
    expect(DONATION_LINKS).toEqual([
      { id: "buymeacoffee", label: "Buy Me a Coffee", url: "https://buymeacoffee.com/jaycho1214" },
      { id: "github-sponsors", label: "GitHub Sponsors", url: "https://github.com/sponsors/jaycho1214" },
    ]);
  });
});

describe("chromeStoreUrl", () => {
  it("is null until the store URL is set", () => {
    expect(chromeStoreUrl({})).toBeNull();
    expect(chromeStoreUrl({ NEXT_PUBLIC_CHROME_STORE_URL: "" })).toBeNull();
    expect(chromeStoreUrl({ NEXT_PUBLIC_CHROME_STORE_URL: "   " })).toBeNull();
  });

  it("is null for anything but an https Chrome Web Store link", () => {
    for (const value of [
      "http://chromewebstore.google.com/detail/lingoflix/x",
      "https://evil.example/detail/lingoflix/x",
      "https://chromewebstore.google.com.evil.example/detail/x",
      "javascript:alert(1)",
      "chromewebstore.google.com/detail/lingoflix/x",
    ]) {
      expect(chromeStoreUrl({ NEXT_PUBLIC_CHROME_STORE_URL: value })).toBeNull();
    }
  });

  it("returns a Chrome Web Store link as given", () => {
    expect(chromeStoreUrl({ NEXT_PUBLIC_CHROME_STORE_URL: STORE_URL })).toBe(STORE_URL);
  });

  it("reads NEXT_PUBLIC_CHROME_STORE_URL from the environment by default", () => {
    vi.stubEnv("NEXT_PUBLIC_CHROME_STORE_URL", STORE_URL);
    expect(chromeStoreUrl()).toBe(STORE_URL);
  });
});
