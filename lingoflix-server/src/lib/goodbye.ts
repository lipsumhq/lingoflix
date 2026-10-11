import type { Kysely } from "kysely";
import type { Database } from "@/db/types";

/** Spec §5.4: the uninstall page's one optional question. */
export const GOODBYE_REASONS = ["too-expensive", "not-using", "missing-feature", "not-working", "other"] as const;
export type GoodbyeReason = (typeof GOODBYE_REASONS)[number];

export const GOODBYE_REASON_LABELS: Record<GoodbyeReason, string> = {
  "too-expensive": "It costs too much",
  "not-using": "I don't use it enough",
  "missing-feature": "It's missing something I need",
  "not-working": "It didn't work well",
  other: "Something else",
};

export const GOODBYE_COMMENT_MAX = 500;
/** Request bodies larger than this are rejected before they are parsed. */
export const GOODBYE_BODY_MAX_BYTES = 4096;

export interface GoodbyeFeedback {
  reason: GoodbyeReason;
  comment: string | null;
}

const isReason = (value: unknown): value is GoodbyeReason =>
  typeof value === "string" && (GOODBYE_REASONS as readonly string[]).includes(value);

/** `{ reason, comment? }` and nothing else: a known reason and an optional comment of at most 500 characters. */
export function parseGoodbye(body: unknown): GoodbyeFeedback | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "reason" && key !== "comment")) return null;
  const { reason, comment } = record;
  if (!isReason(reason)) return null;
  if (comment === undefined || comment === null) return { reason, comment: null };
  if (typeof comment !== "string") return null;
  const trimmed = comment.trim();
  if (trimmed.length > GOODBYE_COMMENT_MAX) return null;
  return { reason, comment: trimmed === "" ? null : trimmed };
}

const badRequest = () => Response.json({ error: "bad-request" }, { status: 400 });

/**
 * POST /api/goodbye (spec §5.4). No sign-in. Stores only the reason, the comment and the time:
 * never a user, an IP address or request headers. `openDb` is called per request, so importing
 * the route needs no environment.
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

    await openDb()
      .insertInto("uninstall_feedback")
      .values({ reason: feedback.reason, comment: feedback.comment })
      .execute();
    return Response.json({ ok: true }, { status: 201 });
  };
}
