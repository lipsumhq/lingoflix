import { attachDatabasePool } from "@vercel/functions";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types";

let db: Kysely<Database> | null = null;

/**
 * The app's database: Neon through node-postgres, on the pooled `DATABASE_URL`.
 * Created on first use, so importing this module needs no environment (builds and tests run without one).
 */
export function getDb(): Kysely<Database> {
  if (db) return db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 5000 });
  // On Vercel (Fluid compute) idle clients are released before the function suspends; elsewhere a no-op.
  attachDatabasePool(pool);
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return db;
}
