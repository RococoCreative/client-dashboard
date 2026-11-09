// The one list of outside systems a company can connect. The connections function, the 0028
// company_connections_provider_check and CONNECTION_PROVIDER_LABELS in the app must all agree on
// it; src/lib/sync/providers.test.ts fails when they do not.
export const PROVIDER_KEYS = ["gohighlevel", "quickbooks", "google_sheets"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];
