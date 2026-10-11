import { sql, type Kysely } from "kysely";
import { NO_MIGRATIONS } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/types";
import { createMigrator, createTestDb } from "./support/test-db";

let db: Kysely<Database>;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.destroy();
});

async function tableNames(): Promise<string[]> {
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name not like 'kysely_%'
    order by table_name
  `.execute(db);
  return rows.map((row) => row.table_name);
}

async function columnNames(table: string): Promise<string[]> {
  const { rows } = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table}
    order by ordinal_position
  `.execute(db);
  return rows.map((row) => row.column_name);
}

describe("migrations", () => {
  it("create Better Auth's tables and uninstall_feedback", async () => {
    expect(await tableNames()).toEqual(["account", "session", "uninstall_feedback", "user", "verification"]);
  });

  it("give Better Auth the exact camelCase columns it checks for", async () => {
    expect(await columnNames("user")).toEqual(["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"]);
    expect(await columnNames("session")).toEqual([
      "id",
      "expiresAt",
      "token",
      "createdAt",
      "updatedAt",
      "ipAddress",
      "userAgent",
      "userId",
    ]);
    expect(await columnNames("verification")).toEqual(["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"]);
  });

  it("roll back to an empty database", async () => {
    const { error } = await createMigrator(db).migrateTo(NO_MIGRATIONS);
    expect(error).toBeUndefined();
    expect(await tableNames()).toEqual([]);
  });
});

describe("uninstall_feedback", () => {
  it("stores a reason with a generated id and time, and an optional comment", async () => {
    const bare = await db
      .insertInto("uninstall_feedback")
      .values({ reason: "not-using", comment: null })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(typeof bare.id).toBe("string");
    expect(bare.created_at).toBeInstanceOf(Date);
    expect(bare.comment).toBeNull();

    const commented = await db
      .insertInto("uninstall_feedback")
      .values({ reason: "other", comment: "Too many keys to learn." })
      .returning(["id", "comment"])
      .executeTakeFirstOrThrow();
    expect(commented.comment).toBe("Too many keys to learn.");
    expect(BigInt(commented.id)).toBeGreaterThan(BigInt(bare.id));
  });

  it("requires a reason", async () => {
    await expect(sql`insert into uninstall_feedback (comment) values ('no reason')`.execute(db)).rejects.toThrow(
      /null value in column "reason"/,
    );
  });
});
