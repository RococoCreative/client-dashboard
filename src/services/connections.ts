// A company's own connections to outside systems. The browser only ever reads the status rows;
// starting a connection, finishing it, and disconnecting all go through the connections Edge
// Function, which is the only thing that holds a provider token. Rule 6's posture, extended:
// no provider secret and no provider token ever reaches the app or Vercel.
import type { CompanyConnection, ConnectionProvider } from "../types/database.ts";
import { db } from "./supabase.ts";

const COLUMNS = "id, company_id, provider, status, external_account_id, external_account_name, scopes, connected_by, connected_at, last_synced_at, last_error, settings, created_at, updated_at";

export async function listConnections(companyId: string): Promise<CompanyConnection[]> {
  const { data, error } = await db().from("company_connections").select(COLUMNS).eq("company_id", companyId).order("provider");
  if (error) throw error;
  return (data as CompanyConnection[]) ?? [];
}

// The Edge Function answers errors as JSON with a plain message; surface that line rather than
// the generic "non-2xx status code" the client library reports.
async function invoke<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke<T>(path, { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const message = await context
      ?.clone()
      .json()
      .then((body: { error?: string } | undefined) => body?.error ?? "")
      .catch(() => "");
    throw new Error(message || "The connection service did not answer. Try again in a moment.");
  }
  return data as T;
}

// Returns the provider's sign-in URL for this company. The caller sends the browser there; the
// provider sends it back to the Edge Function, which finishes the connection and returns the
// browser to the settings page with ?connected=<provider> or ?connect_error=<message>.
export async function startConnection(companyId: string, provider: ConnectionProvider, returnTo: string): Promise<string> {
  const result = await invoke<{ url: string }>("connections/start", { company_id: companyId, provider, return_to: returnTo });
  if (!result?.url) throw new Error("The connection service did not return a sign-in link.");
  return result.url;
}

export async function disconnectConnection(companyId: string, provider: ConnectionProvider): Promise<void> {
  await invoke<{ ok: boolean }>("connections/disconnect", { company_id: companyId, provider });
}
