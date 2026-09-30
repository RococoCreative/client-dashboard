import type { CompanyConnection, ConnectionProvider } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const connections = fromAll((b) => b.connections).map((x) => ({ ...x }));
const now = () => new Date().toISOString();

export async function listConnections(companyId: string): Promise<CompanyConnection[]> {
  return connections.filter((c) => c.company_id === companyId).sort((a, b) => a.provider.localeCompare(b.provider));
}

export async function startConnection(companyId: string, provider: ConnectionProvider, returnTo: string): Promise<string> {
  return `https://example.com/authorize?provider=${provider}&company=${companyId}&return_to=${encodeURIComponent(returnTo)}`;
}

export async function disconnectConnection(companyId: string, provider: ConnectionProvider): Promise<void> {
  const index = connections.findIndex((c) => c.company_id === companyId && c.provider === provider);
  if (index === -1) throw new Error("Nothing to disconnect.");
  connections[index] = { ...connections[index], status: "not_connected", external_account_id: null, external_account_name: null, scopes: null, connected_by: null, connected_at: null, last_error: null, updated_at: now() };
}
