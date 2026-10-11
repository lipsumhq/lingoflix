// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AddToChrome } from "@/components/AddToChrome";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

afterEach(cleanup);

const EM_DASH = /\u2014/;
const STORE_URL = "https://chromewebstore.google.com/detail/lingoflix/abcdefghijklmnopabcdefghijklmnop";

/** Every link in `container` as [text, href], in page order. */
const linksIn = (container: HTMLElement) =>
  within(container)
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);

describe("SiteHeader", () => {
  it("links home and the Support section, and nothing else", () => {
    render(<SiteHeader />);
    expect(linksIn(screen.getByRole("navigation", { name: "Main" }))).toEqual([
      ["LingoFlix", "/"],
      ["Support", "/#support"],
    ]);
  });
});

describe("SiteFooter", () => {
  it("links privacy, terms, the support email and both donation pages, with the disclaimer and copyright", () => {
    render(<SiteFooter />);
    expect(linksIn(screen.getByRole("navigation", { name: "Footer" }))).toEqual([
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["support@lingoflix.lipsum.fun", "mailto:support@lingoflix.lipsum.fun"],
      ["Buy Me a Coffee", "https://buymeacoffee.com/jaycho1214"],
      ["GitHub Sponsors", "https://github.com/sponsors/jaycho1214"],
    ]);
    expect(screen.getByText("Not affiliated with or endorsed by Netflix.")).toBeTruthy();
    expect(screen.getByText("© 2026 LingoFlix")).toBeTruthy();
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
        <AddToChrome storeUrl={null} />
        <SiteFooter />
      </>,
    );
    expect(document.body.textContent).not.toMatch(EM_DASH);
  });
});
