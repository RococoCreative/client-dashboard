// In-memory stand-in for services/connections.ts, same exports, so page tests and `npm run demo`
// run against seeded connection status rows and never touch the network.
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

const ALL_KEYS: Record<ConnectionProvider, boolean> = { gohighlevel: true, quickbooks: true, google_sheets: true };
let setup: Record<ConnectionProvider, boolean> | null = { ...ALL_KEYS };

// Chooses what loadConnectorSetup answers: a key map, or null for "cannot tell".
export function setMockConnectorSetup(value: Record<ConnectionProvider, boolean> | null): void {
  setup = value ? { ...value } : null;
}

// Puts the answer back to all keys present. Called from src/test/setup.ts.
export function resetMockConnectorSetup(): void {
  setup = { ...ALL_KEYS };
}

export async function loadConnectorSetup(companyId: string): Promise<Record<ConnectionProvider, boolean> | null> {
  void companyId;
  return setup ? { ...setup } : null;
}
