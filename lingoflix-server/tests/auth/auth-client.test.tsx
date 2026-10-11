// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { authClient } from "@/lib/auth-client";

describe("authClient", () => {
  it("offers the sign-in methods and sign-out the pages use", () => {
    expect(typeof authClient.signIn.magicLink).toBe("function");
    expect(typeof authClient.signIn.social).toBe("function");
    expect(typeof authClient.signOut).toBe("function");
  });
});
