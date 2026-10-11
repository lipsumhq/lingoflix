import { afterEach, describe, expect, it, vi } from "vitest";

const VARIABLES = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "EXTENSION_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_EMAIL_TOKEN",
] as const;

function withoutEnvironment() {
  for (const name of VARIABLES) vi.stubEnv(name, "");
}

afterEach(() => {
  vi.resetModules();
});

describe("no environment", () => {
  it("importing the auth module and the auth route touches neither secrets nor the database", async () => {
    withoutEnvironment();
    // getDb() and getAuth() both throw without their variables, so any call at import would fail here.
    await expect(import("@/lib/auth")).resolves.toHaveProperty("getAuth");
    await expect(import("@/app/api/auth/[...all]/route")).resolves.toHaveProperty("POST");
    await expect(import("@/lib/session")).resolves.toHaveProperty("getCurrentSession");
  });

  it("getAuth() names every missing variable", async () => {
    withoutEnvironment();
    const { getAuth } = await import("@/lib/auth");
    expect(() => getAuth()).toThrow(
      "Missing environment variables: BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET",
    );
  });
});
