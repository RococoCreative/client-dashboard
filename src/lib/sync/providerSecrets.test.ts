// Proves the one list of provider secret names agrees with the registry the catalog shows, that
// the key status rule needs both values, and that the app's reader of that status never throws.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_KEYS } from "../../../supabase/functions/_shared/providers.ts";
import { PROVIDER_SECRETS, keysPresent } from "../../../supabase/functions/_shared/providerSecrets.ts";
import { CONNECTORS } from "../connectors.ts";

vi.mock("../../services/invoke.ts", () => ({ invokeFunction: vi.fn() }));
vi.mock("../../services/supabase.ts", () => ({ db: () => ({}), isSupabaseConfigured: true }));

describe("PROVIDER_SECRETS", () => {
  it("names a secret pair for every provider key", () => {
    for (const key of PROVIDER_KEYS) {
      expect(PROVIDER_SECRETS[key].id).toBeTruthy();
      expect(PROVIDER_SECRETS[key].secret).toBeTruthy();
    }
  });

  it("matches the secret names the registry shows", () => {
    const live = CONNECTORS.filter((c) => c.provider && c.secretNames);
    expect(live.length).toBe(PROVIDER_KEYS.length);
    for (const c of live) {
      const pair = PROVIDER_SECRETS[c.provider as (typeof PROVIDER_KEYS)[number]];
      expect(c.secretNames).toEqual([pair.id, pair.secret]);
    }
  });

  it("reports a provider present only when both values are non-empty", () => {
    const env = { QBO_CLIENT_ID: "a", QBO_CLIENT_SECRET: "b", GHL_CLIENT_ID: "a", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "x" } as Record<string, string>;
    expect(keysPresent((n) => env[n])).toEqual({ quickbooks: true, gohighlevel: false, google_sheets: false });
  });
});

describe("loadConnectorSetup", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns null when the function answers 404", async () => {
    const { invokeFunction } = await import("../../services/invoke.ts");
    vi.mocked(invokeFunction).mockRejectedValue(new Error("No such route."));
    const { loadConnectorSetup } = await import("../../services/connections.ts");
    expect(await loadConnectorSetup("c1")).toBeNull();
  });

  it("returns null when the answer has no keys object of booleans", async () => {
    const { invokeFunction } = await import("../../services/invoke.ts");
    const { loadConnectorSetup } = await import("../../services/connections.ts");
    vi.mocked(invokeFunction).mockResolvedValue({ keys: { quickbooks: "yes" } });
    expect(await loadConnectorSetup("c1")).toBeNull();
    vi.mocked(invokeFunction).mockResolvedValue(null);
    expect(await loadConnectorSetup("c1")).toBeNull();
  });

  it("returns the keys when the answer is well formed", async () => {
    const { invokeFunction } = await import("../../services/invoke.ts");
    const { loadConnectorSetup } = await import("../../services/connections.ts");
    const keys = { quickbooks: true, gohighlevel: false, google_sheets: true };
    vi.mocked(invokeFunction).mockResolvedValue({ keys });
    expect(await loadConnectorSetup("c1")).toEqual(keys);
  });
});
