// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import WelcomePage from "@/app/welcome/page";

afterEach(cleanup);

const EM_DASH = /\u2014/;
const STORE_URL = "https://chromewebstore.google.com/detail/lingoflix/abcdefghijklmnopabcdefghijklmnop";

/** Every link in `container` as [text, href], in page order. */
const linksIn = (container: HTMLElement) =>
  within(container)
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);

describe("home page", () => {
  it("leads with what LingoFlix does", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Understand every line on Netflix" })).toBeTruthy();
    for (const feature of ["Explain any line", "Save what you learn", "Line by line", "Voice shadowing", "Study reminders"]) {
      expect(screen.getByRole("heading", { level: 3, name: feature })).toBeTruthy();
    }
    expect(
      screen.getByText(
        "Hover a subtitle or press E. LingoFlix explains what it means in this scene, the key expressions, and how to use them, with your own Claude or OpenAI key.",
      ),
    ).toBeTruthy();
  });

  it("says it is free with your own key, with no plans or prices", () => {
    render(<HomePage />);
    const free = screen.getByRole("region", { name: "Free, with your own key" });
    expect(
      within(free).getByText(
        "LingoFlix is free. Explanations use your own Claude or OpenAI API key, so they're billed by Anthropic or OpenAI at their prices. Everything else costs nothing.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Premium|pricing|trial|\$/i);
  });

  it("asks for support, with both donation links, in the section the header links to", () => {
    render(<HomePage />);
    const support = screen.getByRole("region", { name: "Support LingoFlix" });
    expect(support.id).toBe("support");
    expect(within(support).getByText("If LingoFlix helps you learn, you can support it.")).toBeTruthy();
    expect(linksIn(support)).toEqual([
      ["Buy Me a Coffee", "https://buymeacoffee.com/jaycho1214"],
      ["GitHub Sponsors", "https://github.com/sponsors/jaycho1214"],
    ]);
  });

  it("shows Add to Chrome when the store listing URL is set", () => {
    vi.stubEnv("NEXT_PUBLIC_CHROME_STORE_URL", STORE_URL);
    render(<HomePage />);
    expect(screen.getByRole("link", { name: "Add to Chrome" }).getAttribute("href")).toBe(STORE_URL);
  });

  it.each(["", "https://evil.example/lingoflix"])("shows the coming-soon label when the store URL is %j", (value) => {
    vi.stubEnv("NEXT_PUBLIC_CHROME_STORE_URL", value);
    render(<HomePage />);
    expect(screen.queryByRole("link", { name: "Add to Chrome" })).toBeNull();
    expect(screen.getByText("Coming soon to the Chrome Web Store")).toBeTruthy();
  });
});

describe("welcome page", () => {
  it("thanks the learner and lists the main shortcuts", () => {
    render(<WelcomePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Thanks for installing LingoFlix" })).toBeTruthy();
    const table = screen.getByRole("table", { name: "Main shortcuts" });
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => [within(row).getByRole("rowheader").textContent, within(row).getByRole("cell").textContent]);
    expect(rows).toEqual([
      ["Explain the current line", "E"],
      ["Go to the previous or next line", "A / D"],
      ["Replay the current line", "R"],
      ["Hide or show subtitles", "C"],
    ]);
  });

  it("says how to add a Claude or OpenAI key, with no trial or sign-in", () => {
    render(<WelcomePage />);
    const key = screen.getByRole("region", { name: "Add your key" });
    expect(
      within(key)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual([
      "Get an API key from Anthropic (console.anthropic.com) or OpenAI (platform.openai.com).",
      "Click the LingoFlix icon in Chrome's toolbar, then Add your API key.",
      "Paste the key, press Save, then Test key.",
    ]);
    expect(within(key).getByText("Usage is billed by Anthropic or OpenAI. Your key stays on this computer.")).toBeTruthy();
    // The only links on the page are the two key pages: nothing to /upgrade or /sign-in.
    expect(linksIn(document.body)).toEqual([
      ["console.anthropic.com", "https://console.anthropic.com/settings/keys"],
      ["platform.openai.com", "https://platform.openai.com/api-keys"],
    ]);
    expect(document.body.textContent).not.toMatch(/Premium|trial|sign in/i);
  });
});

describe("privacy policy", () => {
  it("says what the server receives, that it keeps none of the text, and who helps run it", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeTruthy();
    expect(screen.getByText("Last updated: October 10, 2026")).toBeTruthy();
    expect(screen.getByText(/Our server passes this to Anthropic to write the answer and does not keep it\./)).toBeTruthy();
    expect(screen.getByText(/Never the subtitle text, your questions or the answers\./)).toBeTruthy();
    expect(
      screen.getByText("The IP address and browser of each sign-in, to keep your account secure. Signing out deletes them."),
    ).toBeTruthy();
    expect(
      screen.getByText("If you sign in with Google: your name, profile picture and the sign-in tokens Google gives us."),
    ).toBeTruthy();
    for (const service of ["Anthropic", "Stripe", "Vercel", "Neon", "Cloudflare"]) {
      expect(screen.getByText(service, { selector: "strong" })).toBeTruthy();
    }
    expect(screen.getByText(/we store your answer with the time and nothing else/)).toBeTruthy();
    const contact = screen.getByRole("link", { name: "support@lingoflix.lipsum.fun" });
    expect(contact.getAttribute("href")).toBe("mailto:support@lingoflix.lipsum.fun");
  });
});

describe("terms of service", () => {
  it("states the plan, the trial, cancellation, refunds and fair use", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Terms of service" })).toBeTruthy();
    expect(screen.getByText(/\$7\.99\/month or \$59\.99\/year/)).toBeTruthy();
    expect(screen.getByText(/Unless you cancel before the trial ends, your subscription starts and you're charged\./)).toBeTruthy();
    expect(screen.getByText("Uninstalling the extension doesn't cancel your subscription.")).toBeTruthy();
    expect(screen.getByText("If you were charged and didn't use Premium, email us within 14 days and we'll refund you.")).toBeTruthy();
    expect(
      screen.getByText("After heavy use in a billing period, answers may come from a faster model until your next billing date."),
    ).toBeTruthy();
    expect(screen.getByText("LingoFlix is not affiliated with or endorsed by Netflix.")).toBeTruthy();
  });
});

describe("copy", () => {
  it.each([
    ["home", HomePage],
    ["welcome", WelcomePage],
    ["privacy", PrivacyPage],
    ["terms", TermsPage],
  ])("the %s page has no em dashes", (_name, Page) => {
    render(<Page />);
    expect(document.body.textContent).not.toMatch(EM_DASH);
  });
});
