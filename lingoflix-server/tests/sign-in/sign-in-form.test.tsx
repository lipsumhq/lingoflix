// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInForm, type SignInClient } from "@/app/sign-in/SignInForm";

afterEach(cleanup);

const EXPIRED = "That link has expired or was already used. We can send you a new one.";
const SEND_FAILED = "Couldn't send the email. Try again or use Google.";
const GENERIC = "Sign-in didn't work. Please try again.";

function fakeClient(over: Partial<SignInClient> = {}) {
  return {
    magicLink: vi.fn<SignInClient["magicLink"]>(async () => ({ error: null })),
    google: vi.fn<SignInClient["google"]>(async () => ({ error: null })),
    ...over,
  };
}

const emailBox = () => screen.getByLabelText("Email") as HTMLInputElement;
const emailForm = () => screen.getByRole("form", { name: "Email sign-in" });

describe("SignInForm", () => {
  it("emails a link that returns to the next page, with errors coming back to sign-in", async () => {
    const client = fakeClient();
    render(<SignInForm next="/connect" initialError={null} client={client} />);
    fireEvent.change(emailBox(), { target: { value: "  learner@example.com " } });
    fireEvent.submit(emailForm());
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(
      screen.getByText("We sent a link to learner@example.com. It works once and expires in 15 minutes."),
    ).toBeTruthy();
    expect(client.magicLink).toHaveBeenCalledWith({
      email: "learner@example.com",
      callbackURL: "/connect",
      errorCallbackURL: "/sign-in?next=%2Fconnect",
    });
  });

  it("shows Sending... and disables both buttons while the link is on its way", async () => {
    let finish!: (value: { error: null }) => void;
    const client = fakeClient({
      magicLink: vi.fn<SignInClient["magicLink"]>(() => new Promise((resolve) => (finish = resolve))),
    });
    render(<SignInForm next="/account" initialError={null} client={client} />);
    fireEvent.change(emailBox(), { target: { value: "learner@example.com" } });
    fireEvent.submit(emailForm());
    const sending = (await screen.findByRole("button", { name: "Sending..." })) as HTMLButtonElement;
    expect(sending.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Continue with Google" }) as HTMLButtonElement).disabled).toBe(true);
    finish({ error: null });
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
  });

  it("lets the learner go back and use a different email", async () => {
    render(<SignInForm next="/account" initialError={null} client={fakeClient()} />);
    fireEvent.change(emailBox(), { target: { value: "learner@example.com" } });
    fireEvent.submit(emailForm());
    fireEvent.click(await screen.findByRole("button", { name: "Use a different email" }));
    expect(emailBox()).toBeTruthy();
  });

  it("explains an expired or used link and keeps the email field ready (Review Focus 2)", () => {
    render(<SignInForm next="/account" initialError="INVALID_TOKEN" client={fakeClient()} />);
    expect(screen.getByRole("alert").textContent).toBe(EXPIRED);
    expect(emailBox()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeTruthy();
  });

  it("shows a general message for any other sign-in error", () => {
    render(<SignInForm next="/account" initialError="failed_to_create_user" client={fakeClient()} />);
    expect(screen.getByRole("alert").textContent).toBe(GENERIC);
  });

  it.each([
    ["answers with an error", vi.fn<SignInClient["magicLink"]>(async () => ({ error: { message: "Email failed" } }))],
    ["throws", vi.fn<SignInClient["magicLink"]>(async () => Promise.reject(new Error("offline")))],
  ])("says the email could not be sent when the server %s", async (_label, magicLink) => {
    render(<SignInForm next="/account" initialError={null} client={fakeClient({ magicLink })} />);
    fireEvent.change(emailBox(), { target: { value: "learner@example.com" } });
    fireEvent.submit(emailForm());
    expect((await screen.findByRole("alert")).textContent).toBe(SEND_FAILED);
    expect(emailBox().value).toBe("learner@example.com");
  });

  it("continues with Google to the next page", () => {
    const client = fakeClient();
    render(<SignInForm next="/account" initialError={null} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(client.google).toHaveBeenCalledWith({ callbackURL: "/account", errorCallbackURL: "/sign-in?next=%2Faccount" });
  });

  it("shows the general message when Google sign-in fails to start", async () => {
    const client = fakeClient({ google: vi.fn<SignInClient["google"]>(async () => ({ error: { message: "nope" } })) });
    render(<SignInForm next="/account" initialError={null} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect((await screen.findByRole("alert")).textContent).toBe(GENERIC);
  });

  it("asks the browser to check the email address", () => {
    render(<SignInForm next="/account" initialError={null} client={fakeClient()} />);
    expect(emailBox().type).toBe("email");
    expect(emailBox().required).toBe(true);
  });

  it("has no em dashes", () => {
    render(<SignInForm next="/account" initialError="INVALID_TOKEN" client={fakeClient()} />);
    expect(document.body.textContent).not.toMatch(/\u2014/);
  });
});
