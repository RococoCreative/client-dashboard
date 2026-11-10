// Proves the one list of provider keys agrees with the database's provider check (0030) and with
// the labels the app shows, so a provider added in one place and not the others fails here.
import { describe, expect, it } from "vitest";
import { PROVIDER_KEYS } from "../../../supabase/functions/_shared/providers.ts";
import { CONNECTION_PROVIDER_LABELS, keysOf } from "../../types/database.ts";

describe("PROVIDER_KEYS", () => {
  it("matches the company_connections provider check in 0030", async () => {
    // A non-literal specifier keeps node:fs out of the app's type check, which has no Node types.
    const fsModule = "node:fs";
    const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: URL, encoding: "utf8"): string };
    // Through a variable: Vite rewrites a literal new URL(path, import.meta.url) into an asset URL.
    const here = import.meta.url;
    const sql = readFileSync(new URL("../../../supabase/migrations/0030_sync_engine.sql", here), "utf8");
    const match = /company_connections_provider_check\s+check\s*\(\s*provider\s+in\s*\(([^)]*)\)/i.exec(sql);
    expect(match).not.toBeNull();
    const allowed = [...match![1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    expect(new Set(allowed)).toEqual(new Set(PROVIDER_KEYS));
    expect(allowed).toHaveLength(PROVIDER_KEYS.length);
  });

  it("matches the connection provider labels", () => {
    expect([...PROVIDER_KEYS].sort()).toEqual(keysOf(CONNECTION_PROVIDER_LABELS).sort());
  });
});
