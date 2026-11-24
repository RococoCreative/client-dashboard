// The one list of the secret names each provider's app keys live under, and the rule for whether
// a provider has them, plus the connect flow's own two secrets and whether they are usable. The
// connections function reads its provider definitions and its /status route from here, and
// src/lib/sync/providerSecrets.test.ts pins it to the registry the catalog shows. Names and
// booleans only: no value is held here or returned.
import { PROVIDER_KEYS, type ProviderKey } from "./providers.ts";
import { tokenKeyProblem } from "./tokenCrypto.ts";

export const PROVIDER_SECRETS: Record<ProviderKey, { id: string; secret: string }> = {
  gohighlevel: { id: "GHL_CLIENT_ID", secret: "GHL_CLIENT_SECRET" },
  quickbooks: { id: "QBO_CLIENT_ID", secret: "QBO_CLIENT_SECRET" },
  google_sheets: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
};

// True for a provider only when both of its values are set and non-empty.
export function keysPresent(read: (name: string) => string | undefined): Record<ProviderKey, boolean> {
  const out = {} as Record<ProviderKey, boolean>;
  for (const key of PROVIDER_KEYS) {
    out[key] = Boolean(read(PROVIDER_SECRETS[key].id)) && Boolean(read(PROVIDER_SECRETS[key].secret));
  }
  return out;
}

// The secrets every Connect needs whatever the provider: the state signing secret and the token
// encryption key.
export const FLOW_SECRETS = ["CONNECTIONS_STATE_SECRET", "TOKEN_ENCRYPTION_KEY"] as const;
export type FlowSecret = (typeof FLOW_SECRETS)[number];
const PREVIOUS_KEY = "TOKEN_ENCRYPTION_KEY_PREVIOUS";

// TOKEN_ENCRYPTION_KEY reads true only when the keys load, so anything that checks FLOW_SECRETS
// alone never treats a bad previous key as ready. When the previous key is the one at fault it is
// reported too, so the setup line can name the secret to fix rather than the good one.
export type FlowSecretsStatus = Record<FlowSecret, boolean> & { [PREVIOUS_KEY]?: false };

// A secret the setup line can name: one of the flow's two, or the previous key when it is the fault.
export type FlowSecretName = FlowSecret | typeof PREVIOUS_KEY;

export function flowSecretsReady(read: (name: string) => string | undefined): FlowSecretsStatus {
  const problem = tokenKeyProblem(read);
  const out: FlowSecretsStatus = {
    CONNECTIONS_STATE_SECRET: Boolean(read("CONNECTIONS_STATE_SECRET")),
    TOKEN_ENCRYPTION_KEY: problem === null,
  };
  if (problem === PREVIOUS_KEY) out[PREVIOUS_KEY] = false;
  return out;
}

// The secrets to set, in order, each named exactly: the previous key in place of the current one
// when the previous key is the fault.
export function missingFlowSecrets(status: FlowSecretsStatus): FlowSecretName[] {
  const out: FlowSecretName[] = [];
  if (!status.CONNECTIONS_STATE_SECRET) out.push("CONNECTIONS_STATE_SECRET");
  if (status[PREVIOUS_KEY] === false) out.push(PREVIOUS_KEY);
  else if (!status.TOKEN_ENCRYPTION_KEY) out.push("TOKEN_ENCRYPTION_KEY");
  return out;
}
