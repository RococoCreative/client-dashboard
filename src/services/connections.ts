// A company's own connections to outside systems. The browser only ever reads the status rows;
// starting a connection, confirming or dropping a sign-in, and disconnecting all go through the
// connections Edge Function, which is the only thing that holds a provider token. Rule 6's
// posture, extended: no provider secret and no provider token ever reaches the app or Vercel.
import { CONNECTION_PROVIDER_LABELS, keysOf, type CompanyConnection, type ConnectionProvider } from "../types/database.ts";
import { parseConnectorSetup, type ConnectorSetup } from "../lib/connectors.ts";
import { parsePendingAnswer, type PendingAnswer } from "../../supabase/functions/_shared/connectFlow.ts";
import { invokeFunction } from "./invoke.ts";
import { db } from "./supabase.ts";

// What a caller sees when the function answered something this app cannot read.
const NO_ANSWER = "The connection service did not answer. Try again in a moment.";

const COLUMNS = "id, company_id, provider, status, external_account_name, scopes, connected_by, connected_at, last_synced_at, last_error, settings, created_at, updated_at";

export async function listConnections(companyId: string): Promise<CompanyConnection[]> {
  const { data, error } = await db().from("company_connections").select(COLUMNS).eq("company_id", companyId).order("provider");
  if (error) throw error;
  return (data as CompanyConnection[]) ?? [];
}

// Returns the provider's sign-in URL for this company. The caller sends the browser there; the
// provider sends it back to the Edge Function, which parks the sign-in and returns the browser to
// returnTo (the app's /settings/connections/<company> path, which App.tsx routes on to Settings)
// with ?pending=<id>, or with ?connect_error=<key> when the sign-in did not finish.
export async function startConnection(companyId: string, provider: ConnectionProvider, returnTo: string): Promise<string> {
  const result = await invokeFunction<{ url: string }>("connections/start", { company_id: companyId, provider, return_to: returnTo });
  if (!result?.url) throw new Error("The connection service did not return a sign-in link.");
  return result.url;
}

// Whether the provider confirmed it let go too; anything but a plain true reads as not, so the
// page says the tool may still list the hub rather than claim it does not.
function revokedIn(answer: unknown): { revoked: boolean } {
  return { revoked: typeof answer === "object" && answer !== null && (answer as { revoked?: unknown }).revoked === true };
}

// The connection goes on the hub's side either way; revoked says whether the provider let go too.
export async function disconnectConnection(companyId: string, provider: ConnectionProvider): Promise<{ revoked: boolean }> {
  return revokedIn(await invokeFunction<unknown>("connections/disconnect", { company_id: companyId, provider }));
}

// What a sign-in that came back is: ready to confirm (the tool, the account name when the tool gave
// one, and the company), started by someone else, or gone. Only whoever started it learns more.
export async function readPendingConnection(pendingId: string): Promise<PendingAnswer> {
  const answer = parsePendingAnswer(await invokeFunction<unknown>("connections/pending", { pending_id: pendingId }));
  if (!answer) throw new Error(NO_ANSWER);
  return answer;
}

// Attaches the sign-in to its company and returns the tool it connected. The function refuses
// anyone but its starter, and an expired or already used one, with a plain line.
export async function finishConnection(pendingId: string): Promise<ConnectionProvider> {
  const answer = await invokeFunction<{ provider?: unknown } | null>("connections/finish", { pending_id: pendingId });
  const provider = keysOf(CONNECTION_PROVIDER_LABELS).find((key) => key === answer?.provider);
  if (!provider) throw new Error(NO_ANSWER);
  return provider;
}

// Drops the sign-in without attaching it; revoked says whether the provider let go of it.
export async function discardConnection(pendingId: string): Promise<{ revoked: boolean }> {
  return revokedIn(await invokeFunction<unknown>("connections/discard", { pending_id: pendingId }));
}

// How long the setup check may take before the catalog stops waiting for it.
const SETUP_TIMEOUT_MS = 8_000;

// Which providers have Rococo's app keys and which connect flow secrets are missing, or null when
// that cannot be known (an older function without the route or without the secrets, a network
// failure, an unexpected answer, or no answer within SETUP_TIMEOUT_MS). Never throws: the catalog
// falls back to what a company's own connection row says.
export async function loadConnectorSetup(companyId: string): Promise<ConnectorSetup | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SETUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([readConnectorSetup(companyId), giveUp]);
  } finally {
    clearTimeout(timer);
  }
}

async function readConnectorSetup(companyId: string): Promise<ConnectorSetup | null> {
  try {
    return parseConnectorSetup(await invokeFunction<unknown>("connections/status", { company_id: companyId }));
  } catch {
    return null;
  }
}
