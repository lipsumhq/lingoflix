import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next";
import { SITE_URL } from "@/lib/site";

describe("safeNextPath", () => {
  it.each(["/connect", "/account", "/upgrade", "/account?tab=billing", "/sign-in?next=%2Fupgrade", "/"])(
    "keeps the same-site path %s",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    ["a protocol-relative URL", "//evil.com"],
    ["an absolute URL", "https://evil.com"],
    ["a backslash right after the slash", "/\\evil.com"],
    ["a backslash later in the path", "/account\\..\\evil"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a tab that browsers strip into //", "/\t/evil.com"],
    ["a newline", "/account\nSet-Cookie: x=1"],
    ["an empty string", ""],
    ["a path without a leading slash", "account"],
  ])("falls back to /account for %s", (_label, value) => {
    expect(safeNextPath(value)).toBe("/account");
  });

  it("falls back for null and undefined", () => {
    expect(safeNextPath(null)).toBe("/account");
    expect(safeNextPath(undefined)).toBe("/account");
  });

  it("uses the fallback it is given", () => {
    expect(safeNextPath("//evil.com", "/connect")).toBe("/connect");
  });

  it("keeps an encoded double slash on this site", () => {
    const result = safeNextPath("/%2F%2Fevil.com");
    expect(new URL(result, SITE_URL).origin).toBe(new URL(SITE_URL).origin);
  });
});
