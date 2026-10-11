import { describe, expect, it } from "vitest";
import { upgradeDestination } from "@/lib/upgrade";

const SESSION = { user: { id: "user-1", email: "learner@example.com", name: "" }, token: "token-1" };

describe("upgradeDestination", () => {
  it("sends signed-out visitors to sign in, then back to /upgrade", () => {
    expect(upgradeDestination(null)).toBe("/sign-in?next=%2Fupgrade");
  });

  it("sends signed-in learners to their account until billing exists", () => {
    expect(upgradeDestination(SESSION)).toBe("/account");
  });
});
