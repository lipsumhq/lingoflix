import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/types";
import {
  GOODBYE_COMMENT_MAX,
  GOODBYE_REASONS,
  GOODBYE_REASON_LABELS,
  createGoodbyeHandler,
  parseGoodbye,
} from "@/lib/goodbye";
import { createTestDb } from "./support/test-db";

describe("parseGoodbye", () => {
  it("accepts a known reason with an optional comment, trimmed; an empty comment is null", () => {
    expect(parseGoodbye({ reason: "too-expensive" })).toEqual({ reason: "too-expensive", comment: null });
    expect(parseGoodbye({ reason: "other", comment: "  Needs more shows  " })).toEqual({
      reason: "other",
      comment: "Needs more shows",
    });
    expect(parseGoodbye({ reason: "not-using", comment: null })).toEqual({ reason: "not-using", comment: null });
    expect(parseGoodbye({ reason: "not-using", comment: "   " })).toEqual({ reason: "not-using", comment: null });
  });

  it("allows a comment of 500 characters after trimming, not 501", () => {
    expect(parseGoodbye({ reason: "other", comment: ` ${"x".repeat(500)} ` })?.comment).toHaveLength(500);
    expect(parseGoodbye({ reason: "other", comment: "x".repeat(501) })).toBeNull();
  });

  it.each([
    ["an unknown reason", { reason: "hates-netflix" }],
    ["no reason", { comment: "hi" }],
    ["a reason that is not a string", { reason: 1 }],
    ["a comment that is not a string", { reason: "other", comment: 42 }],
    ["an extra field", { reason: "other", email: "a@example.com" }],
    ["an array", ["other"]],
    ["null", null],
    ["a string", "other"],
  ])("rejects %s", (_label, body) => {
    expect(parseGoodbye(body)).toBeNull();
  });

  it("has a label for every reason", () => {
    expect(GOODBYE_REASONS.map((reason) => GOODBYE_REASON_LABELS[reason])).toEqual([
      "It costs too much",
      "I don't use it enough",
      "It's missing something I need",
      "It didn't work well",
      "Something else",
    ]);
    expect(GOODBYE_COMMENT_MAX).toBe(500);
  });
});

describe("POST /api/goodbye", () => {
  let db: Kysely<Database>;

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.destroy();
  });
  beforeEach(async () => {
    await db.deleteFrom("uninstall_feedback").execute();
  });

  const post = (body: string) =>
    createGoodbyeHandler(() => db)(
      new Request("http://localhost:3000/api/goodbye", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    );
  const stored = () => db.selectFrom("uninstall_feedback").selectAll().execute();

  it("stores the reason, the comment and the time, and nothing else", async () => {
    const before = Date.now();
    const res = await post(JSON.stringify({ reason: "not-working", comment: "  Subtitles froze  " }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["comment", "created_at", "id", "reason"]);
    expect(rows[0]).toMatchObject({ reason: "not-working", comment: "Subtitles froze" });
    expect(rows[0]!.created_at).toBeInstanceOf(Date);
    expect(rows[0]!.created_at.getTime()).toBeGreaterThanOrEqual(before - 60_000);
  });

  it("stores a missing comment as null", async () => {
    expect((await post(JSON.stringify({ reason: "other" }))).status).toBe(201);
    expect((await stored())[0]?.comment).toBeNull();
  });

  it.each([
    ["an unknown reason", JSON.stringify({ reason: "hates-netflix" })],
    ["a 501-character comment", JSON.stringify({ reason: "other", comment: "x".repeat(501) })],
    ["a body that is not JSON", "reason=other"],
    ["an empty body", ""],
    // Valid JSON (trailing spaces are allowed), so only the size limit can reject it.
    ["a body over 4096 bytes", `{"reason":"other"}${" ".repeat(5000)}`],
  ])("rejects %s with 400 and stores nothing", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad-request" });
    expect(await stored()).toEqual([]);
  });
});

describe("the goodbye route module", () => {
  it("loads with no environment and needs the database only when a request comes in", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { POST } = await import("@/app/api/goodbye/route");
      const request = new Request("http://localhost:3000/api/goodbye", {
        method: "POST",
        body: JSON.stringify({ reason: "other" }),
      });
      await expect(POST(request)).rejects.toThrow("DATABASE_URL is not set");
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});
