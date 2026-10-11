import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "@/lib/auth";
import { TEST_BASE_URL, createTestAuth, signInWithMagicLink, type TestAuth } from "../support/test-auth";

const state = vi.hoisted(() => ({ auth: null as Auth | null, headers: new Headers() }));

vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAuth: () => state.auth!,
}));

const { getCurrentSession } = await import("@/lib/session");
const route = await import("@/app/api/auth/[...all]/route");

let t: TestAuth;
async function setUp() {
  t = await createTestAuth();
  state.auth = t.auth;
  state.headers = new Headers();
}
afterEach(async () => {
  await t.close();
});

describe("getCurrentSession", () => {
  it("is null when nobody is signed in", async () => {
    await setUp();
    expect(await getCurrentSession()).toBeNull();
  });

  it("returns the user and the raw session token for a signed-in request", async () => {
    await setUp();
    const { bearer } = await signInWithMagicLink(t, "learner@example.com");
    state.headers = new Headers({ authorization: `Bearer ${bearer}` });
    const session = await getCurrentSession();
    expect(session?.user.email).toBe("learner@example.com");
    expect(session?.user.id).toEqual(expect.any(String));
    expect(session?.user.name).toBe("");
    expect(bearer!.startsWith(`${session!.token}.`)).toBe(true);
  });
});

describe("the /api/auth route", () => {
  it("hands requests to Better Auth", async () => {
    await setUp();
    const { bearer } = await signInWithMagicLink(t, "learner@example.com");
    const res = await route.GET(
      new Request(`${TEST_BASE_URL}/api/auth/get-session`, { headers: { authorization: `Bearer ${bearer}` } }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { email: string } }).user.email).toBe("learner@example.com");
  });
});
