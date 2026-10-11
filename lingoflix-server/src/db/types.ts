import type { ColumnType } from "kysely";

/** One answer from the goodbye page (spec §5.5). It holds no user id, IP or anything else. */
export interface UninstallFeedbackTable {
  /** `bigint` identity: node-postgres returns int8 as a string. */
  id: ColumnType<string, never, never>;
  created_at: ColumnType<Date, never, never>;
  reason: string;
  comment: string | null;
}

/**
 * Our tables. Better Auth's tables ("user", "session", "account", "verification") are created by our migrations
 * but read and written only by Better Auth, so they are not listed here.
 */
export interface Database {
  uninstall_feedback: UninstallFeedbackTable;
}
