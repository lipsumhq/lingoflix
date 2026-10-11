// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoodbyeForm } from "@/app/goodbye/GoodbyeForm";
import GoodbyePage from "@/app/goodbye/page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const choose = (label: string) => fireEvent.click(screen.getByRole("radio", { name: label }));
const send = () => fireEvent.click(screen.getByRole("button", { name: "Send" }));

describe("GoodbyeForm", () => {
  it("posts the chosen reason and the trimmed comment as JSON, then thanks the learner", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<GoodbyeForm />);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);

    choose("It didn't work well");
    fireEvent.change(screen.getByLabelText("Anything else? (optional)"), { target: { value: "  Subtitles froze  " } });
    send();

    expect(await screen.findByText("Thanks for telling us.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/goodbye");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "not-working", comment: "Subtitles froze" });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("sends a null comment when none was written", async () => {
    const submit = vi.fn(async () => true);
    render(<GoodbyeForm submit={submit} />);
    choose("Something else");
    send();
    expect(await screen.findByText("Thanks for telling us.")).toBeTruthy();
    expect(submit).toHaveBeenCalledWith({ reason: "other", comment: null });
  });

  it.each([
    ["the server refuses it", () => vi.fn(async () => ({ ok: false }) as Response)],
    [
      "the network fails",
      () =>
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
    ],
  ])("says so when %s", async (_label, makeFetch) => {
    vi.stubGlobal("fetch", makeFetch());
    render(<GoodbyeForm />);
    choose("It costs too much");
    send();
    expect(await screen.findByText("Couldn't send that. You can close this page.")).toBeTruthy();
  });

  it("limits the comment to 500 characters and counts them", () => {
    render(<GoodbyeForm submit={vi.fn(async () => true)} />);
    const comment = screen.getByLabelText("Anything else? (optional)") as HTMLTextAreaElement;
    expect(comment.maxLength).toBe(500);
    fireEvent.change(comment, { target: { value: "Too pricey" } });
    expect(screen.getByText("10/500")).toBeTruthy();
  });
});

describe("the goodbye page", () => {
  it("asks why, and says that uninstalling does not cancel Premium", () => {
    render(<GoodbyePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Sorry to see you go" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByText(/Uninstalling LingoFlix doesn't cancel Premium\./)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Manage or cancel it from your account." }).getAttribute("href"),
    ).toBe("/account");
  });
});
