// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSummary } from "@/app/account/AccountSummary";
import { SignOutButton } from "@/app/account/SignOutButton";

afterEach(cleanup);

describe("AccountSummary", () => {
  it("shows the email and the Free plan", () => {
    render(<AccountSummary email="learner@example.com" />);
    expect(screen.getByText("learner@example.com")).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("Free")).toBeTruthy();
  });
});

describe("SignOutButton", () => {
  it("signs out, then goes to the home page", async () => {
    const signOut = vi.fn(async () => {});
    const navigate = vi.fn();
    render(<SignOutButton signOut={signOut} navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("button", { name: "Signing out..." })).toBeTruthy();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("says so when sign-out fails and lets the learner try again", async () => {
    const navigate = vi.fn();
    render(<SignOutButton signOut={vi.fn(async () => Promise.reject(new Error("offline")))} navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't sign out. Please try again.");
    expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
