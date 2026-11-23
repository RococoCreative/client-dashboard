// In-memory stand-in for services/connections.ts, same exports, so page tests and `npm run demo`
// run against seeded connection status rows and never touch the network.
import type { CompanyConnection, ConnectionProvider } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const seeded = () => fromAll((b) => b.connections).map((x) => ({ ...x }));
const connections = seeded();
const now = () => new Date().toISOString();

// Puts every company's rows back as seeded, so a Disconnect in one test is not still in effect in
// the next. Called from src/test/setup.ts.
export function resetMockConnections(): void {
  connections.splice(0, connections.length, ...seeded());
}

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

// While set, loadConnectorSetup waits on this instead of answering at once, so a test can hold the
// setup check back (a slow or stalled function) and let it land later, or never.
let held: Promise<Record<ConnectionProvider, boolean> | null> | null = null;

// Holds every setup check until the returned function is called with the answer it should give.
export function holdMockConnectorSetup(): (value: Record<ConnectionProvider, boolean> | null) => void {
  let release: (value: Record<ConnectionProvider, boolean> | null) => void = () => {};
  held = new Promise((resolve) => {
    release = resolve;
  });
  return (value) => release(value ? { ...value } : null);
}

// Puts the answer back to all keys present, answered at once. Called from src/test/setup.ts.
export function resetMockConnectorSetup(): void {
  setup = { ...ALL_KEYS };
  held = null;
}

export async function loadConnectorSetup(companyId: string): Promise<Record<ConnectionProvider, boolean> | null> {
  void companyId;
  if (held) return held;
  return setup ? { ...setup } : null;
}
