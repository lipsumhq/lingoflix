"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The part of `chrome.runtime` a web page can use to message an extension (spec §7.3). */
export interface ExtensionRuntime {
  sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void;
  lastError?: { message?: string };
}

type ConnectState = "connecting" | "connected" | "missing" | "failed";

interface ConnectClientProps {
  extensionId: string | null;
  token: string;
  storeUrl: string | null;
  /** Defaults to the page's `chrome.runtime`; null means the page has none. */
  runtime?: ExtensionRuntime | null;
  timeoutMs?: number;
}

/** A page only has `chrome.runtime` when an installed extension lists the site in `externally_connectable`. */
function pageRuntime(): ExtensionRuntime | null {
  const runtime = (globalThis as { chrome?: { runtime?: Partial<ExtensionRuntime> } }).chrome?.runtime;
  return runtime && typeof runtime.sendMessage === "function" ? (runtime as ExtensionRuntime) : null;
}

const isConnected = (response: unknown) =>
  typeof response === "object" && response !== null && (response as { ok?: unknown }).ok === true;

/** Chrome's lastError when no installed extension has this ID (or it doesn't let this site message it). */
const isNotInstalled = (lastError: ExtensionRuntime["lastError"]) =>
  lastError?.message?.includes("Receiving end does not exist") === true;

const MESSAGES: Record<ConnectState, string> = {
  connecting: "Connecting LingoFlix...",
  connected: "You're all set. LingoFlix is signed in. You can close this tab and go back to Netflix.",
  missing: "Install LingoFlix first",
  failed: "LingoFlix didn't answer. Make sure it's turned on, then ",
};

/**
 * Hands the session token to the extension with `chrome.runtime.sendMessage`. The token is never shown on screen,
 * logged or put in a URL. (Like any client-component prop it travels in the page's server-rendered data; the page is
 * dynamic and never cached.)
 */
export function ConnectClient({ extensionId, token, storeUrl, runtime, timeoutMs = 5000 }: ConnectClientProps) {
  const [state, setState] = useState<ConnectState>("connecting");
  // Each attempt gets a number. An answer or a timeout for an older attempt (or after unmount) is ignored.
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const messageRef = useRef<HTMLParagraphElement>(null);
  // Set once Try again is used: that button disappears while connecting, so focus moves to the message instead.
  const focusMessage = useRef(false);

  const connect = useCallback(() => {
    clearTimeout(timer.current);
    const current = ++attempt.current;
    const target = runtime === undefined ? pageRuntime() : runtime;
    if (!extensionId || !target) {
      setState("missing");
      return;
    }
    const settle = (next: ConnectState) => {
      if (current !== attempt.current) return;
      attempt.current += 1;
      clearTimeout(timer.current);
      setState(next);
    };
    setState("connecting");
    timer.current = setTimeout(() => settle("failed"), timeoutMs);
    try {
      target.sendMessage(extensionId, { type: "lingoflix:session", token }, (response) => {
        // Chrome sets lastError only while this callback runs. Only "Receiving end does not exist" means LingoFlix
        // isn't installed; any other error or answer is a failed attempt that Try again can repeat.
        const { lastError } = target;
        if (lastError) settle(isNotInstalled(lastError) ? "missing" : "failed");
        else settle(isConnected(response) ? "connected" : "failed");
      });
    } catch {
      settle("failed");
    }
  }, [extensionId, runtime, timeoutMs, token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starting the hand-off on mount is this effect's purpose
    connect();
    return () => {
      attempt.current += 1;
      clearTimeout(timer.current);
    };
  }, [connect]);

  useEffect(() => {
    if (focusMessage.current) messageRef.current?.focus();
  }, [state]);

  const tryAgain = () => {
    focusMessage.current = true;
    connect();
  };

  // One status region stays mounted and only its contents change, so screen readers announce every step.
  return (
    <div role="status" className="mt-6 space-y-2">
      <p
        ref={messageRef}
        tabIndex={-1}
        className={`text-lg outline-none ${state === "connected" || state === "missing" ? "font-bold" : ""}`}
      >
        {MESSAGES[state]}
        {state === "failed" && (
          <button type="button" onClick={tryAgain} className="font-bold underline">
            Try again
          </button>
        )}
      </p>
      {state === "missing" &&
        (storeUrl ? (
          <>
            <p>
              <a href={storeUrl} className="font-bold underline">
                Get LingoFlix from the Chrome Web Store
              </a>
            </p>
            <p>Then come back and reload this page.</p>
          </>
        ) : (
          <p>LingoFlix will be in the Chrome Web Store soon.</p>
        ))}
    </div>
  );
}
