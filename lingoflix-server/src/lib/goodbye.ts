import { sql, type Kysely } from "kysely";
import type { Database } from "@/db/types";

/** Spec §5.4: the uninstall page's one optional question. */
export const GOODBYE_REASONS = ["too-expensive", "not-using", "missing-feature", "not-working", "other"] as const;
export type GoodbyeReason = (typeof GOODBYE_REASONS)[number];

export const GOODBYE_REASON_LABELS: Record<GoodbyeReason, string> = {
  "too-expensive": "The AI costs too much on my key",
  "not-using": "I don't use it enough",
  "missing-feature": "It's missing something I need",
  "not-working": "It didn't work well",
  other: "Something else",
};

export const GOODBYE_COMMENT_MAX = 500;
/** At most this many answers are stored per hour, in total (free-own-key spec §5.4). */
export const GOODBYE_ANSWERS_PER_HOUR = 100;
/** Request bodies larger than this are rejected before they are parsed. */
export const GOODBYE_BODY_MAX_BYTES = 4096;

export interface GoodbyeFeedback {
  reason: GoodbyeReason;
  comment: string | null;
}

const isReason = (value: unknown): value is GoodbyeReason =>
  typeof value === "string" && (GOODBYE_REASONS as readonly string[]).includes(value);

/** Any control character except tab, line feed and carriage return (Postgres text can't even hold NUL). */
const CONTROL_CHARACTER = /(?![\t\n\r])\p{Cc}/u;

/**
 * `{ reason, comment? }` and nothing else: a known reason and an optional comment of at most 500 characters,
 * with no control characters other than tabs and line breaks.
 */
export function parseGoodbye(body: unknown): GoodbyeFeedback | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "reason" && key !== "comment")) return null;
  const { reason, comment } = record;
  if (!isReason(reason)) return null;
  if (comment === undefined || comment === null) return { reason, comment: null };
  if (typeof comment !== "string") return null;
  if (CONTROL_CHARACTER.test(comment)) return null;
  const trimmed = comment.trim();
  if (trimmed.length > GOODBYE_COMMENT_MAX) return null;
  return { reason, comment: trimmed === "" ? null : trimmed };
}

const badRequest = () => Response.json({ error: "bad-request" }, { status: 400 });

/**
 * POST /api/goodbye (spec §5.4). No sign-in. Stores only the reason, the comment and the time:
 * never a user, an IP address or request headers. Past GOODBYE_ANSWERS_PER_HOUR answers in the last hour it
 * stores nothing but answers the same, so the page still says thanks. `openDb` is called per request, so
 * importing the route needs no environment.
 */
export function createGoodbyeHandler(openDb: () => Kysely<Database>): (request: Request) => Promise<Response> {
  return async (request) => {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > GOODBYE_BODY_MAX_BYTES) return badRequest();

    let text: string;
    try {
      text = await request.text();
    } catch {
      return badRequest();
    }
    if (new TextEncoder().encode(text).byteLength > GOODBYE_BODY_MAX_BYTES) return badRequest();

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return badRequest();
    }
    const feedback = parseGoodbye(body);
    if (!feedback) return badRequest();

    // One statement counts the last hour's answers and inserts only below the cap.
    const db = openDb();
    await db
      .insertInto("uninstall_feedback")
      .columns(["reason", "comment"])
      .expression(
        db
          .selectNoFrom((eb) => [eb.val(feedback.reason).as("reason"), eb.val(feedback.comment).as("comment")])
          .where(
            (eb) =>
              eb
                .selectFrom("uninstall_feedback")
                .select(eb.fn.countAll().as("recent"))
                .where("created_at", ">", sql<Date>`now() - interval '1 hour'`),
            "<",
            GOODBYE_ANSWERS_PER_HOUR,
          ),
      )
      .execute();
    return Response.json({ ok: true }, { status: 201 });
  };
}
