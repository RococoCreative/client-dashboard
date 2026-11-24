// Proves the one list of provider secret names agrees with the registry the catalog shows, that
// the key status rule needs both values, that the connect flow's own secrets read ready only when
// usable and name the exact one at fault, and that the app's reader of that status never throws.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_KEYS } from "../../../supabase/functions/_shared/providers.ts";
import { FLOW_SECRETS, PROVIDER_SECRETS, flowSecretsReady, keysPresent, missingFlowSecrets } from "../../../supabase/functions/_shared/providerSecrets.ts";
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

const keyOf = (bytes: number) => btoa(String.fromCharCode(...new Uint8Array(bytes).fill(7)));
const VALID_KEY = keyOf(32);

describe("flowSecretsReady", () => {
  const ready = (env: Record<string, string | undefined>) => flowSecretsReady((name) => env[name]);

  it("names the connect flow's two secrets", () => {
    expect(FLOW_SECRETS).toEqual(["CONNECTIONS_STATE_SECRET", "TOKEN_ENCRYPTION_KEY"]);
  });

  it("reads all true with a state secret and a valid key", () => {
    expect(ready({ CONNECTIONS_STATE_SECRET: "sample-state", TOKEN_ENCRYPTION_KEY: VALID_KEY })).toEqual({ CONNECTIONS_STATE_SECRET: true, TOKEN_ENCRYPTION_KEY: true });
    expect(ready({ CONNECTIONS_STATE_SECRET: "sample-state", TOKEN_ENCRYPTION_KEY: VALID_KEY, TOKEN_ENCRYPTION_KEY_PREVIOUS: keyOf(32) })).toEqual({
      CONNECTIONS_STATE_SECRET: true,
      TOKEN_ENCRYPTION_KEY: true,
    });
  });

  it("reads an empty state secret as false", () => {
    expect(ready({ CONNECTIONS_STATE_SECRET: "", TOKEN_ENCRYPTION_KEY: VALID_KEY }).CONNECTIONS_STATE_SECRET).toBe(false);
    expect(ready({ TOKEN_ENCRYPTION_KEY: VALID_KEY }).CONNECTIONS_STATE_SECRET).toBe(false);
  });

  it("reads a short key, a missing key, or a malformed previous key as TOKEN_ENCRYPTION_KEY false", () => {
    const state = { CONNECTIONS_STATE_SECRET: "sample-state" };
    expect(ready({ ...state, TOKEN_ENCRYPTION_KEY: keyOf(16) }).TOKEN_ENCRYPTION_KEY).toBe(false);
    expect(ready({ ...state }).TOKEN_ENCRYPTION_KEY).toBe(false);
    expect(ready({ ...state, TOKEN_ENCRYPTION_KEY: VALID_KEY, TOKEN_ENCRYPTION_KEY_PREVIOUS: keyOf(16) }).TOKEN_ENCRYPTION_KEY).toBe(false);
  });

  it("reads a key with a trailing newline as true", () => {
    expect(ready({ CONNECTIONS_STATE_SECRET: "sample-state", TOKEN_ENCRYPTION_KEY: `${VALID_KEY}\n` }).TOKEN_ENCRYPTION_KEY).toBe(true);
  });

  // The previous key is reported only when it is the one at fault, so the setup line can name it.
  it("reports TOKEN_ENCRYPTION_KEY_PREVIOUS only when it is the secret at fault", () => {
    const state = { CONNECTIONS_STATE_SECRET: "sample-state" };
    expect(ready({ ...state, TOKEN_ENCRYPTION_KEY: VALID_KEY, TOKEN_ENCRYPTION_KEY_PREVIOUS: "not a key" })).toEqual({
      CONNECTIONS_STATE_SECRET: true,
      TOKEN_ENCRYPTION_KEY: false,
      TOKEN_ENCRYPTION_KEY_PREVIOUS: false,
    });
    expect(ready({ ...state, TOKEN_ENCRYPTION_KEY: keyOf(16), TOKEN_ENCRYPTION_KEY_PREVIOUS: "not a key" })).not.toHaveProperty("TOKEN_ENCRYPTION_KEY_PREVIOUS");
    expect(ready({ ...state, TOKEN_ENCRYPTION_KEY: VALID_KEY, TOKEN_ENCRYPTION_KEY_PREVIOUS: "" })).not.toHaveProperty("TOKEN_ENCRYPTION_KEY_PREVIOUS");
  });
});

describe("missingFlowSecrets", () => {
  const missing = (env: Record<string, string | undefined>) => missingFlowSecrets(flowSecretsReady((name) => env[name]));

  it("names nothing when the flow is ready", () => {
    expect(missing({ CONNECTIONS_STATE_SECRET: "sample-state", TOKEN_ENCRYPTION_KEY: VALID_KEY })).toEqual([]);
  });

  it("names each secret at fault, in order, and the previous key rather than the current one when that is the fault", () => {
    expect(missing({})).toEqual(["CONNECTIONS_STATE_SECRET", "TOKEN_ENCRYPTION_KEY"]);
    expect(missing({ CONNECTIONS_STATE_SECRET: "sample-state", TOKEN_ENCRYPTION_KEY: keyOf(16) })).toEqual(["TOKEN_ENCRYPTION_KEY"]);
    expect(missing({ TOKEN_ENCRYPTION_KEY: VALID_KEY, TOKEN_ENCRYPTION_KEY_PREVIOUS: keyOf(16) })).toEqual(["CONNECTIONS_STATE_SECRET", "TOKEN_ENCRYPTION_KEY_PREVIOUS"]);
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

  // A partial answer would read every provider it leaves out as keys missing, and hide Connect on
  // a tool that works, so anything short of a boolean for every provider is "cannot tell".
  it("returns null unless every provider has a boolean", async () => {
    const { invokeFunction } = await import("../../services/invoke.ts");
    const { loadConnectorSetup } = await import("../../services/connections.ts");
    const secrets = { CONNECTIONS_STATE_SECRET: true, TOKEN_ENCRYPTION_KEY: true };
    for (const keys of [{}, { quickbooks: true, gohighlevel: true }, [true, true, true]]) {
      vi.mocked(invokeFunction).mockResolvedValue({ keys, secrets });
      expect(await loadConnectorSetup("c1")).toBeNull();
    }
  });

  // A cold or stalled function must not keep the catalog guessing: after about eight seconds the
  // check gives up and reads as "cannot tell".
  it("returns null when the function has not answered within eight seconds", async () => {
    // Keeps the fixed clock from src/test/setup.ts and fakes the timers too; its afterEach puts them back.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: Date.now() });
    const { invokeFunction } = await import("../../services/invoke.ts");
    const { loadConnectorSetup } = await import("../../services/connections.ts");
    vi.mocked(invokeFunction).mockReturnValue(new Promise(() => {}));
    let settled: unknown = "pending";
    const answer = loadConnectorSetup("c1").then((value) => {
      settled = value;
    });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    await answer;
    expect(settled).toBeNull();
  });

  // An older function answers keys alone; without the flow secrets the setup cannot be told.
  it("returns null when the answer has keys but no secrets", async () => {
    const { invokeFunction } = await import("../../services/invoke.ts");
    const { loadConnectorSetup } = await import("../../services/connections.ts");
    vi.mocked(invokeFunction).mockResolvedValue({ keys: { quickbooks: true, gohighlevel: true, google_sheets: true } });
    expect(await loadConnectorSetup("c1")).toBeNull();
  });

  it("returns the keys and the secrets to set when the answer is well formed", async () => {
    const { invokeFunction } = await import("../../services/invoke.ts");
    const { loadConnectorSetup } = await import("../../services/connections.ts");
    const keys = { quickbooks: true, gohighlevel: false, google_sheets: true };
    vi.mocked(invokeFunction).mockResolvedValue({ keys, secrets: { CONNECTIONS_STATE_SECRET: true, TOKEN_ENCRYPTION_KEY: true } });
    expect(await loadConnectorSetup("c1")).toEqual({ keys, missingSecrets: [] });
    vi.mocked(invokeFunction).mockResolvedValue({ keys, secrets: { CONNECTIONS_STATE_SECRET: true, TOKEN_ENCRYPTION_KEY: false, TOKEN_ENCRYPTION_KEY_PREVIOUS: false } });
    expect(await loadConnectorSetup("c1")).toEqual({ keys, missingSecrets: ["TOKEN_ENCRYPTION_KEY_PREVIOUS"] });
  });
});
