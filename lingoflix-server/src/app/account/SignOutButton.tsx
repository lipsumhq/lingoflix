"use client";

import { useState } from "react";
import { secondaryButton } from "@/components/styles";
import { authClient } from "@/lib/auth-client";

async function signOutOfBetterAuth(): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "Sign-out failed");
}

export function SignOutButton({
  signOut = signOutOfBetterAuth,
  navigate = (url: string) => window.location.assign(url),
}: {
  signOut?: () => Promise<unknown>;
  navigate?: (url: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick() {
    setPending(true);
    setFailed(false);
    try {
      await signOut();
      navigate("/");
    } catch {
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" className={secondaryButton} onClick={handleClick} disabled={pending}>
        {pending ? "Signing out..." : "Sign out"}
      </button>
      {failed && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {"Couldn't sign out. Please try again."}
        </p>
      )}
    </div>
  );
}
