// In-memory stand-in for services/connections.ts, same exports, so page tests and `npm run demo`
// run against seeded connection status rows and never touch the network. A sign-in that came back
// is a pending id a test sets with setMockPending; finishing it connects that company's row once.
import type { CompanyConnection, ConnectionProvider } from "../../types/database.ts";
import type { ConnectorSetup } from "../../lib/connectors.ts";
import type { FlowSecretName } from "../../../supabase/functions/_shared/providerSecrets.ts";
import { PENDING_GONE, PENDING_SOMEONE_ELSE, type PendingAnswer } from "../../../supabase/functions/_shared/connectFlow.ts";
import { actingPerson } from "../actingPerson.ts";
import { fromAll } from "../fixtures.ts";

const seeded = () => fromAll((b) => b.connections).map((x) => ({ ...x }));
const connections = seeded();
const now = () => new Date().toISOString();

// The sign-ins waiting to be confirmed, by id, each with the company it is for (null: the company
// the page last listed, which is the one on screen).
const pending = new Map<string, { answer: PendingAnswer; companyId: string | null }>();
let shownCompanyId: string | null = null;

// Puts every company's rows back as seeded and forgets every pending sign-in, so a Disconnect or a
// confirm in one test is not still in effect in the next. Called from src/test/setup.ts.
export function resetMockConnections(): void {
  connections.splice(0, connections.length, ...seeded());
  pending.clear();
  shownCompanyId = null;
}

export async function listConnections(companyId: string): Promise<CompanyConnection[]> {
  shownCompanyId = companyId;
  return connections.filter((c) => c.company_id === companyId).sort((a, b) => a.provider.localeCompare(b.provider));
}

export async function startConnection(companyId: string, provider: ConnectionProvider, returnTo: string): Promise<string> {
  return `https://example.com/authorize?provider=${provider}&company=${companyId}&return_to=${encodeURIComponent(returnTo)}`;
}

// GoHighLevel offers no revoke, so the mock answers as the function does for it.
const revokes = (provider: ConnectionProvider) => provider !== "gohighlevel";

export async function disconnectConnection(companyId: string, provider: ConnectionProvider): Promise<{ revoked: boolean }> {
  const index = connections.findIndex((c) => c.company_id === companyId && c.provider === provider);
  if (index === -1) throw new Error("Nothing to disconnect.");
  connections[index] = { ...connections[index], status: "not_connected", external_account_name: null, scopes: null, connected_by: null, connected_at: null, last_error: null, updated_at: now() };
  return { revoked: revokes(provider) };
}

// Parks a sign-in under an id, as the callback does. The company defaults to the one on screen.
export function setMockPending(id: string, answer: PendingAnswer, companyId?: string): void {
  pending.set(id, { answer: { ...answer }, companyId: companyId ?? null });
}

export async function readPendingConnection(pendingId: string): Promise<PendingAnswer> {
  const entry = pending.get(pendingId);
  return entry ? { ...entry.answer } : { status: "gone" };
}

// The entry a finish or discard may act on, or the line the function refuses with.
function claim(pendingId: string): { answer: Extract<PendingAnswer, { status: "ready" }>; companyId: string | null } {
  const entry = pending.get(pendingId);
  if (entry?.answer.status === "someone_else") throw new Error(PENDING_SOMEONE_ELSE);
  if (!entry || entry.answer.status !== "ready") throw new Error(PENDING_GONE);
  pending.delete(pendingId);
  return { answer: entry.answer, companyId: entry.companyId };
}

export async function finishConnection(pendingId: string): Promise<ConnectionProvider> {
  const { answer, companyId: chosen } = claim(pendingId);
  const companyId = chosen ?? shownCompanyId;
  if (!companyId) throw new Error(PENDING_GONE);
  const at = now();
  const fields = { status: "connected" as const, external_account_name: answer.account_name, connected_by: actingPerson()?.id ?? null, connected_at: at, last_error: null, updated_at: at };
  const index = connections.findIndex((c) => c.company_id === companyId && c.provider === answer.provider);
  if (index === -1) {
    connections.push({ id: `conn-${pendingId}`, company_id: companyId, provider: answer.provider, scopes: null, last_synced_at: null, settings: {}, created_at: at, ...fields });
  } else {
    connections[index] = { ...connections[index], ...fields };
  }
  return answer.provider;
}

export async function discardConnection(pendingId: string): Promise<{ revoked: boolean }> {
  return { revoked: revokes(claim(pendingId).answer.provider) };
}

const ALL_KEYS: Record<ConnectionProvider, boolean> = { gohighlevel: true, quickbooks: true, google_sheets: true };
let setup: Record<ConnectionProvider, boolean> | null = { ...ALL_KEYS };
let missingSecrets: FlowSecretName[] = [];

// Chooses which providers loadConnectorSetup says have their keys, or null for "cannot tell".
export function setMockConnectorSetup(value: Record<ConnectionProvider, boolean> | null): void {
  setup = value ? { ...value } : null;
}

// Chooses which connect flow secrets loadConnectorSetup says are missing.
export function setMockMissingSecrets(names: FlowSecretName[]): void {
  missingSecrets = [...names];
}

// While set, loadConnectorSetup waits on this instead of answering at once, so a test can hold the
// setup check back (a slow or stalled function) and let it land later, or never.
let held: Promise<Record<ConnectionProvider, boolean> | null> | null = null;

// Holds every setup check until the returned function is called with the key map it should give.
export function holdMockConnectorSetup(): (value: Record<ConnectionProvider, boolean> | null) => void {
  let release: (value: Record<ConnectionProvider, boolean> | null) => void = () => {};
  held = new Promise((resolve) => {
    release = resolve;
  });
  return (value) => release(value ? { ...value } : null);
}

// Puts the answer back to all keys present and no secret missing, answered at once. Called from
// src/test/setup.ts.
export function resetMockConnectorSetup(): void {
  setup = { ...ALL_KEYS };
  missingSecrets = [];
  held = null;
}

export async function loadConnectorSetup(companyId: string): Promise<ConnectorSetup | null> {
  void companyId;
  const keys = held ? await held : setup;
  return keys ? { keys: { ...keys }, missingSecrets: [...missingSecrets] } : null;
}
