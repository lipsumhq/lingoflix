import type { ColumnType } from "kysely";

/** One answer from the goodbye page (spec §5.5). It holds no user id, IP or anything else. */
export interface UninstallFeedbackTable {
  /** `bigint` identity: node-postgres returns int8 as a string. */
  id: ColumnType<string, never, never>;
  created_at: ColumnType<Date, never, never>;
  reason: string;
  comment: string | null;
}

/** Our tables: only the goodbye answers. The sign-in tables are gone (migration `drop_sign_in`). */
export interface Database {
  uninstall_feedback: UninstallFeedbackTable;
}
