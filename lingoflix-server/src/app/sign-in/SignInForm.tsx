"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { primaryButton, secondaryButton } from "@/components/styles";
import { authClient } from "@/lib/auth-client";

type ClientResult = Promise<{ error: { message?: string } | null }>;

export interface SignInClient {
  magicLink(input: { email: string; callbackURL: string; errorCallbackURL: string }): ClientResult;
  google(input: { callbackURL: string; errorCallbackURL: string }): ClientResult;
}

const defaultClient: SignInClient = {
  magicLink: (input) => authClient.signIn.magicLink(input),
  google: (input) => authClient.signIn.social({ provider: "google", ...input }),
};

const MESSAGES = {
  expired: "That link has expired or was already used. We can send you a new one.",
  sendFailed: "Couldn't send the email. Try again or use Google.",
  generic: "Sign-in didn't work. Please try again.",
};

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

/** Better Auth sends `?error=INVALID_TOKEN` for unknown, expired and already-used links alike. */
function initialStatus(code: string | null): Status {
  if (!code) return { kind: "idle" };
  return { kind: "error", message: code === "INVALID_TOKEN" ? MESSAGES.expired : MESSAGES.generic };
}

export function SignInForm({
  next,
  initialError,
  client = defaultClient,
}: {
  next: string;
  initialError: string | null;
  client?: SignInClient;
}) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(() => initialStatus(initialError));
  const errorCallbackURL = `/sign-in?next=${encodeURIComponent(next)}`;
  const sending = status.kind === "sending";
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const showedConfirmation = useRef(false);

  // The form (and its focused button) is swapped for the confirmation and back, so move focus with it:
  // to the heading, which screen readers then read out, and back to the email field.
  useEffect(() => {
    if (status.kind === "sent") {
      showedConfirmation.current = true;
      headingRef.current?.focus();
    } else if (showedConfirmation.current) {
      showedConfirmation.current = false;
      emailRef.current?.focus();
    }
  }, [status.kind]);

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    setStatus({ kind: "sending" });
    try {
      const { error } = await client.magicLink({ email: address, callbackURL: next, errorCallbackURL });
      setStatus(error ? { kind: "error", message: MESSAGES.sendFailed } : { kind: "sent", email: address });
    } catch {
      setStatus({ kind: "error", message: MESSAGES.sendFailed });
    }
  }

  async function continueWithGoogle() {
    setStatus({ kind: "sending" });
    try {
      // On success the browser leaves for Google, so only a failure comes back here.
      const { error } = await client.google({ callbackURL: next, errorCallbackURL });
      if (error) setStatus({ kind: "error", message: MESSAGES.generic });
    } catch {
      setStatus({ kind: "error", message: MESSAGES.generic });
    }
  }

  if (status.kind === "sent") {
    return (
      <div role="status" className="flex flex-col gap-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-black outline-none">
          Check your email
        </h2>
        <p>{`We sent a link to ${status.email}. It works once and expires in 15 minutes.`}</p>
        <button type="button" className={secondaryButton} onClick={() => setStatus({ kind: "idle" })}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {status.kind === "error" && (
        <p role="alert" className="rounded-xl border-2 border-danger px-4 py-3 font-semibold text-danger">
          {status.message}
        </p>
      )}
      <button type="button" className={secondaryButton} onClick={continueWithGoogle} disabled={sending}>
        Continue with Google
      </button>
      <p className="text-center text-sm font-bold text-mute">or</p>
      <form aria-label="Email sign-in" onSubmit={sendLink} className="flex flex-col gap-3">
        <label htmlFor={emailId} className="font-extrabold">
          Email
        </label>
        <input
          ref={emailRef}
          id={emailId}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-xl border-2 border-line px-3 py-2 font-semibold outline-none focus:border-brand"
        />
        <button type="submit" className={primaryButton} disabled={sending}>
          {sending ? "Sending..." : "Email me a sign-in link"}
        </button>
      </form>
    </div>
  );
}
