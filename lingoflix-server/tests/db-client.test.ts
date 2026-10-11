import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

describe("getDb", () => {
  it("can be imported with no DATABASE_URL and says so only when used", async () => {
    const { getDb } = await import("@/db/client");
    expect(() => getDb()).toThrow("DATABASE_URL is not set");
  });

  it("creates the database once and reuses it, without connecting", async () => {
    // Nothing listens on port 1: creating the pool must not connect.
    process.env.DATABASE_URL = "postgres://lingoflix:secret@127.0.0.1:1/none";
    const { getDb } = await import("@/db/client");
    const db = getDb();
    expect(getDb()).toBe(db);
    await db.destroy();
  });

  it("works once DATABASE_URL is set after a failed call", async () => {
    const { getDb } = await import("@/db/client");
    expect(() => getDb()).toThrow("DATABASE_URL is not set");
    process.env.DATABASE_URL = "postgres://lingoflix:secret@127.0.0.1:1/none";
    const db = getDb();
    expect(db).toBeDefined();
    await db.destroy();
  });
});
