import { promises as fs } from "node:fs";
import path from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import type { Database } from "@/db/types";

/** The real migrations folder (absolute, as FileMigrationProvider requires). */
export const MIGRATION_FOLDER = path.resolve(import.meta.dirname, "../../src/db/migrations");

export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: MIGRATION_FOLDER,
      // Load migrations through Vitest's transformer, not Node's strip-only TypeScript loader.
      import: (file) => import(file),
    }),
  });
}

/**
 * A fresh in-memory Postgres (PGlite) with every migration applied. `db.destroy()` also closes PGlite.
 * int8 values come back as strings, as they do through node-postgres in production.
 */
export async function createTestDb(): Promise<Kysely<Database>> {
  const pglite = await PGlite.create({ parsers: { [types.INT8]: (value: string) => value } });
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) {
    const failed = results?.find((result) => result.status === "Error");
    await db.destroy();
    throw new Error(`Migration failed: ${failed?.migrationName ?? "unknown"}`, { cause: error });
  }
  return db;
}
