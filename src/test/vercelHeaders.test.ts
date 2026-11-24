// Holds vercel.json to its cache rule: the app's HTML and every route it serves say no-store, so a
// shared or back-button cache never keeps a signed-in screen, while hashed assets and fonts keep
// normal caching. Each path is matched the way Vercel matches a header source, the whole path
// against the source as a regular expression.
// @vitest-environment node
import { describe, expect, it } from "vitest";

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

async function readHeaderRules(): Promise<HeaderRule[]> {
  // A non-literal specifier keeps node:fs out of the app's type check, which has no Node types.
  const fsModule = "node:fs";
  const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: URL, encoding: "utf8"): string };
  // Through a variable: Vite rewrites a literal new URL(path, import.meta.url) into an asset URL.
  const here = import.meta.url;
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", here), "utf8")) as { headers?: HeaderRule[] };
  return config.headers ?? [];
}

function cacheControlFor(rules: HeaderRule[], path: string): string[] {
  return rules
    .filter((rule) => new RegExp("^" + rule.source + "$").test(path))
    .flatMap((rule) => rule.headers.filter((h) => h.key.toLowerCase() === "cache-control").map((h) => h.value));
}

describe("vercel.json cache headers", () => {
  it("says no-store for the app's HTML and routes", async () => {
    const rules = await readHeaderRules();
    for (const path of ["/", "/settings/connections", "/rococo/permissions", "/index.html"]) {
      expect(cacheControlFor(rules, path), path).toEqual(["no-store"]);
    }
  });

  it("leaves hashed assets and fonts to normal caching", async () => {
    const rules = await readHeaderRules();
    for (const path of ["/assets/index-abc123.js", "/fonts/sample.woff2"]) {
      expect(cacheControlFor(rules, path), path).toEqual([]);
    }
  });
});
