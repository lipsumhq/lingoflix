import { globSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_FOLDER = path.resolve(import.meta.dirname, "../src/app");
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** `welcome/page.tsx` is served at `/welcome`, `page.tsx` at `/`. */
function urlPathOf(file: string): string {
  const folder = path.dirname(file);
  return folder === "." ? "/" : `/${folder.split(path.sep).join("/")}`;
}

/** Every page as its path, and every route handler as `METHOD /path`, sorted. */
async function appRoutes(): Promise<string[]> {
  const routes: string[] = [];
  for (const file of globSync("**/{page,route}.{ts,tsx}", { cwd: APP_FOLDER })) {
    if (path.basename(file).startsWith("page.")) {
      routes.push(urlPathOf(file));
      continue;
    }
    const handlers: Record<string, unknown> = await import(path.join(APP_FOLDER, file));
    for (const method of HTTP_METHODS) {
      if (typeof handlers[method] === "function") routes.push(`${method} ${urlPathOf(file)}`);
    }
  }
  return routes.sort();
}

describe("the site's routes", () => {
  it("are the landing, welcome, goodbye, privacy and terms pages and the goodbye endpoint: no sign-in", async () => {
    expect(await appRoutes()).toEqual(["/", "/goodbye", "/privacy", "/terms", "/welcome", "POST /api/goodbye"]);
  });
});
