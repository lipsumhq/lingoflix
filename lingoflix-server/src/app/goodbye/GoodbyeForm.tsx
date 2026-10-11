"use client";

import { useId, useState, type FormEvent } from "react";
import {
  GOODBYE_COMMENT_MAX,
  GOODBYE_REASONS,
  GOODBYE_REASON_LABELS,
  type GoodbyeFeedback,
  type GoodbyeReason,
} from "@/lib/goodbye";

async function postGoodbye(feedback: GoodbyeFeedback): Promise<boolean> {
  try {
    const res = await fetch("/api/goodbye", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(feedback),
    });
    return res.ok;
  } catch {
    return false;
  }
}

type FormState = "idle" | "sending" | "sent" | "failed";

/** Spec §4 journey 5: one optional question. Nothing about the learner is sent, only the answer. */
export function GoodbyeForm({ submit = postGoodbye }: { submit?: (feedback: GoodbyeFeedback) => Promise<boolean> }) {
  const commentId = useId();
  const countId = useId();
  const [reason, setReason] = useState<GoodbyeReason | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<FormState>("idle");

  if (state === "sent") {
    return (
      <p role="status" className="text-lg font-bold">
        Thanks for telling us.
      </p>
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason || state === "sending") return;
    setState("sending");
    const trimmed = comment.trim();
    const ok = await submit({ reason, comment: trimmed === "" ? null : trimmed });
    setState(ok ? "sent" : "failed");
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-lg font-bold">Why are you leaving?</legend>
        {GOODBYE_REASONS.map((value) => (
          <label key={value} className="flex items-center gap-3">
            <input
              type="radio"
              name="reason"
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
            />
            {GOODBYE_REASON_LABELS[value]}
          </label>
        ))}
      </fieldset>

      <div>
        <label htmlFor={commentId} className="block font-bold">
          Anything else? (optional)
        </label>
        <textarea
          id={commentId}
          value={comment}
          maxLength={GOODBYE_COMMENT_MAX}
          rows={4}
          aria-describedby={countId}
          onChange={(event) => setComment(event.target.value)}
          className="mt-2 w-full rounded-xl border-2 p-3"
        />
        <p id={countId} className="text-sm">
          {comment.length}/{GOODBYE_COMMENT_MAX}
        </p>
      </div>

      <button
        type="submit"
        disabled={!reason || state === "sending"}
        className="rounded-xl border-2 px-5 py-2 font-bold disabled:opacity-50"
      >
        Send
      </button>

      {state === "failed" && (
        <p role="alert" className="font-bold">
          {"Couldn't send that. You can close this page."}
        </p>
      )}
    </form>
  );
}
