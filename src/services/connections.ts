// A company's own connections to outside systems. The browser only ever reads the status rows;
// starting a connection, finishing it, and disconnecting all go through the connections Edge
// Function, which is the only thing that holds a provider token. Rule 6's posture, extended:
// no provider secret and no provider token ever reaches the app or Vercel.
import type { CompanyConnection, ConnectionProvider } from "../types/database.ts";
import { invokeFunction } from "./invoke.ts";
import { db } from "./supabase.ts";

const COLUMNS = "id, company_id, provider, status, external_account_id, external_account_name, scopes, connected_by, connected_at, last_synced_at, last_error, settings, created_at, updated_at";

export async function listConnections(companyId: string): Promise<CompanyConnection[]> {
  const { data, error } = await db().from("company_connections").select(COLUMNS).eq("company_id", companyId).order("provider");
  if (error) throw error;
  return (data as CompanyConnection[]) ?? [];
}

// Returns the provider's sign-in URL for this company. The caller sends the browser there; the
// provider sends it back to the Edge Function, which finishes the connection and returns the
// browser to returnTo (the app's /settings/connections/<company> path, which App.tsx routes on to
// Settings) with ?connected=<provider> or ?connect_error=<message>.
export async function startConnection(companyId: string, provider: ConnectionProvider, returnTo: string): Promise<string> {
  const result = await invokeFunction<{ url: string }>("connections/start", { company_id: companyId, provider, return_to: returnTo });
  if (!result?.url) throw new Error("The connection service did not return a sign-in link.");
  return result.url;
}

export async function disconnectConnection(companyId: string, provider: ConnectionProvider): Promise<void> {
  await invokeFunction<{ ok: boolean }>("connections/disconnect", { company_id: companyId, provider });
}

// Which providers have Rococo's app keys, or null when that cannot be known (an older function
// without the route, a network failure, an unexpected answer). Never throws: the catalog falls
// back to what a company's own connection row says.
export async function loadConnectorSetup(companyId: string): Promise<Record<ConnectionProvider, boolean> | null> {
  try {
    const result = await invokeFunction<{ keys?: unknown }>("connections/status", { company_id: companyId });
    const keys = result?.keys;
    if (!keys || typeof keys !== "object") return null;
    const values = Object.values(keys as Record<string, unknown>);
    if (values.some((v) => typeof v !== "boolean")) return null;
    return keys as Record<ConnectionProvider, boolean>;
  } catch {
    return null;
  }
}
