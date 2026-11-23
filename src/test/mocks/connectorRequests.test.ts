// Pins the in-memory tool requests the page tests and the demo use: asking twice keeps one row and
// returns it, a withdrawn request goes, withdrawing one already gone is fine, each company reads
// only its own, and the reset empties the list between tests.
import { describe, expect, it } from "vitest";
import {
  listAllConnectorRequests,
  listConnectorRequests,
  requestConnector,
  resetMockConnectorRequests,
  withdrawConnectorRequest,
} from "./connectorRequests.ts";

describe("mock tool requests", () => {
  it("starts empty", async () => {
    await expect(listAllConnectorRequests()).resolves.toEqual([]);
  });

  it("keeps one row per company per tool and reads by company", async () => {
    const first = await requestConnector("co-1", "jobtread");
    const second = await requestConnector("co-1", "jobtread");
    await requestConnector("co-2", "jobtread");
    expect(second).toEqual(first);
    expect(first).toMatchObject({ company_id: "co-1", connector_key: "jobtread" });
    expect(await listConnectorRequests("co-1")).toEqual([first]);
    expect(await listAllConnectorRequests()).toHaveLength(2);
    resetMockConnectorRequests();
  });

  it("withdraws, and withdrawing again is not an error", async () => {
    await requestConnector("co-1", "xero");
    await withdrawConnectorRequest("co-1", "xero");
    await expect(withdrawConnectorRequest("co-1", "xero")).resolves.toBeUndefined();
    expect(await listConnectorRequests("co-1")).toEqual([]);
  });

  it("is emptied by the reset", async () => {
    await requestConnector("co-1", "asana");
    resetMockConnectorRequests();
    expect(await listAllConnectorRequests()).toEqual([]);
  });
});
