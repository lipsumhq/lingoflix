// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectClient, type ExtensionRuntime } from "@/app/connect/ConnectClient";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const TOKEN = "session-token-1234567890";
const STORE_URL = "https://chromewebstore.google.com/detail/lingoflix/abcdefghijklmnopabcdefghijklmnop";
const CONNECTED = "You're all set. LingoFlix is signed in. You can close this tab and go back to Netflix.";
const FAILED = /LingoFlix didn't answer\. Make sure it's turned on, then/;
const RECEIVING_END_MISSING = "Could not establish connection. Receiving end does not exist.";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeRuntime() {
  const calls: { extensionId: string; message: unknown; callback: (response: unknown) => void }[] = [];
  const runtime: ExtensionRuntime = {
    sendMessage(extensionId, message, callback) {
      calls.push({ extensionId, message, callback });
    },
  };
  /** Answers the latest message the way Chrome does: lastError is set only while the callback runs. */
  const answer = (response: unknown, lastError?: string) => {
    const call = calls.at(-1);
    if (!call) throw new Error("nothing was sent");
    act(() => {
      runtime.lastError = lastError === undefined ? undefined : { message: lastError };
      call.callback(response);
      runtime.lastError = undefined;
    });
  };
  return { runtime, calls, answer };
}

describe("ConnectClient", () => {
  it("sends the session to the extension and says when it is connected", () => {
    const { runtime, calls, answer } = fakeRuntime();
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} />);
    expect(screen.getByText("Connecting LingoFlix...")).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.extensionId).toBe(EXTENSION_ID);
    expect(calls[0]!.message).toEqual({ type: "lingoflix:session", token: TOKEN });

    answer({ ok: true });
    expect(screen.getByText(CONNECTED)).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("asks to install LingoFlix when Chrome cannot reach it", () => {
    const { runtime, answer } = fakeRuntime();
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} />);
    answer(undefined, RECEIVING_END_MISSING);
    expect(screen.getByText("Install LingoFlix first")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Get LingoFlix from the Chrome Web Store" }).getAttribute("href"),
    ).toBe(STORE_URL);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("treats any answer other than { ok: true } as a failed attempt, with Try again", () => {
    const { runtime, answer } = fakeRuntime();
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} />);
    answer({ ok: false });
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("Install LingoFlix first")).toBeNull();
  });

  it("treats a Chrome error other than a missing extension as a failed attempt, with Try again", () => {
    const { runtime, answer } = fakeRuntime();
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} />);
    answer(undefined, "The message port closed before a response was received.");
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("Install LingoFlix first")).toBeNull();
  });

  it("treats a sendMessage that throws as a failed attempt, with Try again", () => {
    const runtime: ExtensionRuntime = {
      sendMessage() {
        throw new Error("Invalid extension id");
      },
    };
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} />);
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("Install LingoFlix first")).toBeNull();
  });

  it("sends nothing without an extension ID, and says the store listing is coming", () => {
    const { runtime, calls } = fakeRuntime();
    render(<ConnectClient extensionId={null} token={TOKEN} storeUrl={null} runtime={runtime} />);
    expect(calls).toHaveLength(0);
    expect(screen.getByText("Install LingoFlix first")).toBeTruthy();
    expect(screen.getByText("LingoFlix will be in the Chrome Web Store soon.")).toBeTruthy();
  });

  it("asks to install LingoFlix when the page has no extension messaging at all", () => {
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={null} />);
    expect(screen.getByText("Install LingoFlix first")).toBeTruthy();
  });

  it("uses the page's chrome.runtime when no runtime is given", () => {
    const sendMessage = vi.fn();
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} />);
    expect(sendMessage).toHaveBeenCalledWith(
      EXTENSION_ID,
      { type: "lingoflix:session", token: TOKEN },
      expect.any(Function),
    );
  });

  it("says LingoFlix did not answer after the timeout, and Try again sends once more", () => {
    vi.useFakeTimers();
    const { runtime, calls, answer } = fakeRuntime();
    render(
      <ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} timeoutMs={5000} />,
    );
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText("Connecting LingoFlix...")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(FAILED)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(calls).toHaveLength(2);
    expect(screen.getByText("Connecting LingoFlix...")).toBeTruthy();
    answer({ ok: true });
    expect(screen.getByText(CONNECTED)).toBeTruthy();
  });

  it("ignores a late answer to an attempt that already timed out", () => {
    vi.useFakeTimers();
    const { runtime, calls } = fakeRuntime();
    render(
      <ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} timeoutMs={5000} />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    act(() => {
      calls[0]!.callback({ ok: true });
    });
    expect(screen.getByText(/LingoFlix didn't answer/)).toBeTruthy();
  });

  it("keeps one status region and changes what it says", () => {
    vi.useFakeTimers();
    const { runtime, answer } = fakeRuntime();
    render(
      <ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} timeoutMs={5000} />,
    );
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("Connecting LingoFlix...");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toMatch(FAILED);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    answer(undefined, RECEIVING_END_MISSING);
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toContain("Install LingoFlix first");

    cleanup();
    const second = fakeRuntime();
    render(<ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={second.runtime} />);
    const region2 = screen.getByRole("status");
    second.answer({ ok: true });
    expect(screen.getByRole("status")).toBe(region2);
    expect(region2.textContent).toContain(CONNECTED);
  });

  it.each([
    ["LingoFlix answers", { ok: true }, undefined, () => screen.getByText(CONNECTED)],
    ["Chrome can't reach LingoFlix", undefined, RECEIVING_END_MISSING, () => screen.getByText("Install LingoFlix first")],
    ["LingoFlix refuses", { ok: false }, undefined, () => screen.getByText(FAILED)],
  ])("after Try again, moves focus to the result when %s", (_label, response, lastError, result) => {
    vi.useFakeTimers();
    const { runtime, answer } = fakeRuntime();
    render(
      <ConnectClient extensionId={EXTENSION_ID} token={TOKEN} storeUrl={STORE_URL} runtime={runtime} timeoutMs={5000} />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(document.activeElement).not.toBe(document.body);
    answer(response, lastError);
    expect(document.activeElement).toBe(result());
  });
});
