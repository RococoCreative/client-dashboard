// The tool requests service on an in-memory list, for page tests and the demo. Same exports as
// src/services/connectorRequests.ts. It starts empty, which is where every company starts; asking
// twice keeps one row, as the database's unique key does (0050), and withdrawing a request that is
// already gone is not an error. The acting person, when a test set one, is stamped as who asked.
import type { ConnectorRequest } from "../../types/database.ts";
import { actingPerson } from "../actingPerson.ts";

const requests: ConnectorRequest[] = [];

let counter = 0;
const nextId = () => `connector-request-new-${++counter}`;

// Empties the list, so one test's asks never reach the next. Called from src/test/setup.ts.
export function resetMockConnectorRequests(): void {
  requests.length = 0;
}

export async function listConnectorRequests(companyId: string): Promise<ConnectorRequest[]> {
  return requests.filter((r) => r.company_id === companyId).map((r) => ({ ...r }));
}

export async function listAllConnectorRequests(): Promise<ConnectorRequest[]> {
  return requests.map((r) => ({ ...r }));
}

export async function requestConnector(companyId: string, connectorKey: string): Promise<ConnectorRequest> {
  let row = requests.find((r) => r.company_id === companyId && r.connector_key === connectorKey);
  if (!row) {
    row = {
      id: nextId(),
      company_id: companyId,
      connector_key: connectorKey,
      requested_by: actingPerson()?.id ?? null,
      requested_at: new Date().toISOString(),
    };
    requests.push(row);
  }
  return { ...row };
}

export async function withdrawConnectorRequest(companyId: string, connectorKey: string): Promise<void> {
  const index = requests.findIndex((r) => r.company_id === companyId && r.connector_key === connectorKey);
  if (index >= 0) requests.splice(index, 1);
}
