// The one list of the secret names each provider's app keys live under, and the rule for whether
// a provider has them. The connections function reads its provider definitions and its /status
// route from here, and src/lib/sync/providerSecrets.test.ts pins it to the registry the catalog
// shows. Names only: no value is read or held here.
import { PROVIDER_KEYS, type ProviderKey } from "./providers.ts";

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
