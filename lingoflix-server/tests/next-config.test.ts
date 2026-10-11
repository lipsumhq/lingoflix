import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next.config headers", () => {
  it("forbids framing on every page, so no other site can overlay the sign-in or account pages", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const everyPath = rules.find((rule) => rule.source === "/:path*");
    expect(everyPath?.headers).toEqual(
      expect.arrayContaining([
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
      ]),
    );
  });

  it("keeps the Tailwind loader for CSS", () => {
    expect(nextConfig.turbopack?.rules?.["*.css"]).toEqual({ loaders: ["@tailwindcss/turbopack"], as: "*.css" });
  });
});
