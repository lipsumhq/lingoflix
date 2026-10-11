import { defineConfig } from "kysely-ctl";
import { Pool } from "pg";

export default defineConfig({
  dialect: "pg",
  // A factory, so commands that need no database (`migrate make`) work without one.
  // Migrations use Neon's direct connection: its pooler can't hold Kysely's migration lock.
  dialectConfig: () => {
    const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");
    return { pool: new Pool({ connectionString }) };
  },
  migrations: {
    migrationFolder: "src/db/migrations",
  },
});
