/**
 * The connection string kysely-ctl migrates through: Neon's direct `DATABASE_URL_UNPOOLED`, else `DATABASE_URL`
 * (for a local Postgres). Kysely's migration lock is a session-level advisory lock, which Neon's pooler (PgBouncer)
 * can't hold, so a pooled Neon host is refused instead of risking a leaked lock and hanging migrations.
 */
export function migrationConnectionString(env: Record<string, string | undefined> = process.env): string {
  // `||`, not `??`: an empty variable counts as unset.
  const connectionString = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");
  if (hostname(connectionString)?.includes("-pooler")) {
    throw new Error("Migrations need Neon's direct connection: set DATABASE_URL_UNPOOLED (the pooled host ends in -pooler)");
  }
  return connectionString;
}

/** The URL's lower-cased hostname, or null when it doesn't parse (pg then reports the bad value itself). */
function hostname(connectionString: string): string | null {
  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    return null;
  }
}
