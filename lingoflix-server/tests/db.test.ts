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

const SIGN_IN_TABLES = ["account", "session", "user", "verification"];

/** Every column, index and constraint of Better Auth's four tables, to compare two schemas. */
async function signInSchema() {
  const tables = sql.join(SIGN_IN_TABLES);
  const columns = await sql`
    select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name in (${tables})
    order by table_name, ordinal_position
  `.execute(db);
  const indexes = await sql`
    select tablename, indexname, indexdef from pg_indexes
    where schemaname = 'public' and tablename in (${tables})
    order by tablename, indexname
  `.execute(db);
  const constraints = await sql`
    select cl.relname as table_name, co.conname, pg_get_constraintdef(co.oid) as definition
    from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname = 'public' and cl.relname in (${tables})
    order by cl.relname, co.conname
  `.execute(db);
  return { columns: columns.rows, indexes: indexes.rows, constraints: constraints.rows };
}

describe("migrations", () => {
  it("leave only uninstall_feedback: the sign-in tables are dropped", async () => {
    expect(await tableNames()).toEqual(["uninstall_feedback"]);
  });

  it("bring the sign-in tables back, exactly as better_auth made them, when drop_sign_in is rolled back", async () => {
    const migrator = createMigrator(db);
    expect((await migrator.migrateTo(NO_MIGRATIONS)).error).toBeUndefined();
    expect((await migrator.migrateTo("1791690386107_better_auth")).error).toBeUndefined();
    const created = await signInSchema();
    expect(created.columns).not.toEqual([]);

    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    expect((await migrator.migrateDown()).error).toBeUndefined();
    expect(await tableNames()).toEqual(["account", "session", "uninstall_feedback", "user", "verification"]);
    expect(await signInSchema()).toEqual(created);
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
