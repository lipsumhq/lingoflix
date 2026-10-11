// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AddToChrome } from "@/components/AddToChrome";
import { Pricing } from "@/components/Pricing";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

afterEach(cleanup);

const EM_DASH = /\u2014/;
const STORE_URL = "https://chromewebstore.google.com/detail/lingoflix/abcdefghijklmnopabcdefghijklmnop";

describe("SiteHeader", () => {
  it("links home, pricing and the account page", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "LingoFlix" }).getAttribute("href")).toBe("/");
    expect(within(nav).getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/#pricing");
    expect(within(nav).getByRole("link", { name: "Account" }).getAttribute("href")).toBe("/account");
  });
});

describe("SiteFooter", () => {
  it("has the legal links, the Netflix disclaimer and the copyright line", () => {
    render(<SiteFooter />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    expect(within(nav).getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
    expect(within(nav).getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
    expect(within(nav).getByRole("link", { name: "Account" }).getAttribute("href")).toBe("/account");
    expect(screen.getByText("Not affiliated with or endorsed by Netflix.")).toBeTruthy();
    expect(screen.getByText("© 2026 LingoFlix")).toBeTruthy();
  });
});

describe("Pricing", () => {
  it("shows both prices, the trial, what Premium includes and the trial button", () => {
    render(<Pricing />);
    const section = screen.getByRole("region", { name: "LingoFlix Premium" });
    expect(section.id).toBe("pricing");
    expect(within(section).getByText("7 days free, then $7.99/month or $59.99/year.")).toBeTruthy();
    for (const item of [
      "Hover any line for an explanation that fits the scene",
      "Ask follow-up questions about any line",
      "Save suggestions for words, phrases, idioms and whole lines",
      "Anki and CSV export of your Study Log",
    ]) {
      expect(within(section).getByText(item)).toBeTruthy();
    }
    const trial = within(section).getByRole("link", { name: "Start your 7-day free trial" });
    expect(trial.getAttribute("href")).toBe("/upgrade");
    expect(within(section).getByText("Cancel any time before the trial ends and you won't be charged.")).toBeTruthy();
  });
});

describe("AddToChrome", () => {
  it("links to the Chrome Web Store listing when there is one", () => {
    render(<AddToChrome storeUrl={STORE_URL} />);
    expect(screen.getByRole("link", { name: "Add to Chrome" }).getAttribute("href")).toBe(STORE_URL);
  });

  it("says it is coming soon when there is no listing yet", () => {
    render(<AddToChrome storeUrl={null} />);
    expect(screen.queryByRole("link", { name: "Add to Chrome" })).toBeNull();
    expect(screen.getByText("Coming soon to the Chrome Web Store")).toBeTruthy();
  });
});

describe("copy", () => {
  it("has no em dashes", () => {
    render(
      <>
        <SiteHeader />
        <Pricing />
        <AddToChrome storeUrl={null} />
        <SiteFooter />
      </>,
    );
    expect(document.body.textContent).not.toMatch(EM_DASH);
  });
});
