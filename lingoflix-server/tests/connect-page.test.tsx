// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentSession: vi.fn() }));

import ConnectPage, { dynamic } from "@/app/connect/page";
import { getCurrentSession } from "@/lib/session";

const SESSION = { user: { id: "u1", email: "learner@example.com", name: "" }, token: "session-token-abc" };

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(getCurrentSession).mockReset();
});

describe("/connect", () => {
  it("is rendered for every request and never cached, since its page data carries the session token", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("sends signed-out visitors to sign in first, then back here", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    const error = await ConnectPage().catch((err: unknown) => err);
    expect(String((error as { digest?: string }).digest)).toContain("/sign-in?next=%2Fconnect");
  });

  it("hands the signed-in session to the extension named by EXTENSION_ID, read when the page renders", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SESSION);
    vi.stubEnv("EXTENSION_ID", "abcdefghijklmnopabcdefghijklmnop");
    const sendMessage = vi.fn();
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    render(await ConnectPage());
    expect(screen.getByRole("heading", { level: 1, name: "Connect LingoFlix" })).toBeTruthy();
    expect(sendMessage).toHaveBeenCalledWith(
      "abcdefghijklmnopabcdefghijklmnop",
      { type: "lingoflix:session", token: "session-token-abc" },
      expect.any(Function),
    );
    expect(document.body.innerHTML).not.toContain("session-token-abc");
  });

  it("asks to install LingoFlix when EXTENSION_ID is not set", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SESSION);
    vi.stubEnv("EXTENSION_ID", "");
    render(await ConnectPage());
    expect(screen.getByText("Install LingoFlix first")).toBeTruthy();
  });
});
