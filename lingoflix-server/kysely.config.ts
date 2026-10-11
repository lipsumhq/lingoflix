import { defineConfig } from "kysely-ctl";
import { Pool } from "pg";
import { migrationConnectionString } from "./src/db/migration-url";

export default defineConfig({
  dialect: "pg",
  // A factory, so commands that need no database (`migrate make`) work without one.
  // Migrations use Neon's direct connection: its pooler can't hold Kysely's migration lock.
  dialectConfig: () => ({ pool: new Pool({ connectionString: migrationConnectionString() }) }),
  migrations: {
    migrationFolder: "src/db/migrations",
  },
});
