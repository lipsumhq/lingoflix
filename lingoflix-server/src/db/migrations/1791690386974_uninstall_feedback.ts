/* eslint-disable @typescript-eslint/no-explicit-any -- migrations are frozen in time, so they don't use the app's Database type */
import { sql, type Kysely } from "kysely";

// Spec §5.5: the goodbye page's optional answer. Only a reason, an optional comment and when it was sent.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`create table uninstall_feedback (id bigint generated always as identity primary key, created_at timestamptz not null default now(), reason text not null, comment text)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop table if exists uninstall_feedback`.execute(db);
}
