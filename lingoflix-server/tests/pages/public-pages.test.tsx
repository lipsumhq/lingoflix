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
  it("is dated the day the free site ships", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeTruthy();
    expect(screen.getByText("Last updated: October 11, 2026")).toBeTruthy();
  });

  it("says everything stays on the computer, with no accounts or cookies", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText(
        "Your Study Log, settings, reminders (including the show you last watched) and your API key stay on your computer.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("LingoFlix has no accounts, and this site sets no cookies.")).toBeTruthy();
  });

  it("says what an explanation sends, straight to Anthropic or OpenAI and never through LingoFlix's server", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText(
        "When you ask for an explanation or a follow-up, the extension sends these straight from your browser to Anthropic or OpenAI (whichever your key belongs to), with your key and never through LingoFlix's server:",
      ),
    ).toBeTruthy();
    const sent = within(screen.getByRole("region", { name: "When you ask for an explanation" })).getByRole("list");
    expect(
      within(sent)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "The line and the dialogue around it.",
      "The show and episode.",
      'The story so far, if "Send the story so far" is on.',
      "Your recent saved items and explained lines.",
    ]);
    expect(screen.getByText("Requests to OpenAI ask it not to store them.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Anthropic's privacy policy" }).getAttribute("href")).toBe(
      "https://www.anthropic.com/legal/privacy",
    );
    expect(screen.getByRole("link", { name: "OpenAI's privacy policy" }).getAttribute("href")).toBe(
      "https://openai.com/policies/privacy-policy/",
    );
  });

  it("says the site keeps only the optional uninstall answer", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText(
        "Only your optional answer on the uninstall page: the reason, the comment and the time, with no IP address or account.",
      ),
    ).toBeTruthy();
  });

  it("lists the services and the contact email", () => {
    render(<PrivacyPage />);
    const services = within(screen.getByRole("region", { name: "Services" })).getByRole("list");
    expect(
      within(services)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Anthropic or OpenAI (your own account) write the explanations and answers.",
      "Vercel hosts this site.",
      "Neon hosts its database.",
      "Cloudflare forwards email sent to support.",
    ]);
    const contact = screen.getByRole("link", { name: "support@lingoflix.lipsum.fun" });
    expect(contact.getAttribute("href")).toBe("mailto:support@lingoflix.lipsum.fun");
  });

  it("says nothing about Stripe, Premium, sign-in or our server, and mentions accounts only to say there are none", () => {
    render(<PrivacyPage />);
    expect(document.body.textContent).not.toMatch(/Stripe|Premium|our server|sign in|sign-in|subscription/i);
    expect(screen.getAllByText(/account/i).map((element) => element.textContent)).toEqual([
      "LingoFlix has no accounts, and this site sets no cookies.",
      "Only your optional answer on the uninstall page: the reason, the comment and the time, with no IP address or account.",
      "Anthropic or OpenAI (your own account) write the explanations and answers.",
    ]);
  });
});

describe("terms of service", () => {
  it("states the free terms, dated the day the free site ships", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Terms of service" })).toBeTruthy();
    expect(screen.getByText("Last updated: October 11, 2026")).toBeTruthy();
    for (const sentence of [
      "LingoFlix is free and provided as is, without warranty.",
      "You need your own Netflix subscription and your own Claude or OpenAI API key.",
      "Anthropic or OpenAI bills you for what your key uses, under its own terms.",
      "AI answers can be wrong.",
      "LingoFlix isn't affiliated with Netflix, Anthropic or OpenAI.",
      "Donations are voluntary and unlock nothing.",
      "These terms may change. The date at the top shows when they last did.",
    ]) {
      expect(screen.getByText(sentence)).toBeTruthy();
    }
    const contact = screen.getByRole("link", { name: "support@lingoflix.lipsum.fun" });
    expect(contact.getAttribute("href")).toBe("mailto:support@lingoflix.lipsum.fun");
  });

  it("says nothing about Premium, Stripe, prices, trials, refunds or accounts", () => {
    render(<TermsPage />);
    expect(document.body.textContent).not.toMatch(/Premium|Stripe|\$|trial|refund|account/i);
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
