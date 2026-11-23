// Which tools a company has asked for from the Connections catalog (0050). Members and Rococo read,
// admins of the company ask and withdraw, by RLS; the database stamps who asked. Asking twice, by
// two admins at once or by a double click, leaves one row, and both callers get that row back.
import type { ConnectorRequest } from "../types/database.ts";
import { db } from "./supabase.ts";
import { NOT_CHANGED_MESSAGE } from "../lib/errors.ts";

const REQUEST_COLUMNS = "id, company_id, connector_key, requested_by, requested_at";

export async function listConnectorRequests(companyId: string): Promise<ConnectorRequest[]> {
  const { data, error } = await db()
    .from("connector_requests")
    .select(REQUEST_COLUMNS)
    .eq("company_id", companyId)
    .order("requested_at");
  if (error) throw error;
  return (data as ConnectorRequest[]) ?? [];
}

// Every company's requests, for Rococo's portfolio. RLS gives anyone else only their own company's.
export async function listAllConnectorRequests(): Promise<ConnectorRequest[]> {
  const { data, error } = await db().from("connector_requests").select(REQUEST_COLUMNS).order("requested_at");
  if (error) throw error;
  return (data as ConnectorRequest[]) ?? [];
}

// An insert that ignores a duplicate (company_id, connector_key), then a read of the stored row,
// whoever's insert made it. No row back means the ask was refused or the row is hidden.
export async function requestConnector(companyId: string, connectorKey: string): Promise<ConnectorRequest> {
  const { error } = await db()
    .from("connector_requests")
    .upsert({ company_id: companyId, connector_key: connectorKey }, { onConflict: "company_id,connector_key", ignoreDuplicates: true });
  if (error) throw error;
  const { data, error: readError } = await db()
    .from("connector_requests")
    .select(REQUEST_COLUMNS)
    .eq("company_id", companyId)
    .eq("connector_key", connectorKey)
    .maybeSingle();
  if (readError) throw readError;
  if (!data) throw new Error(NOT_CHANGED_MESSAGE);
  return data as ConnectorRequest;
}

// A request that is already gone is withdrawn all the same, so this never asks for rows back.
export async function withdrawConnectorRequest(companyId: string, connectorKey: string): Promise<void> {
  const { error } = await db()
    .from("connector_requests")
    .delete()
    .eq("company_id", companyId)
    .eq("connector_key", connectorKey);
  if (error) throw error;
}
