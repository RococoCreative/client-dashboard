// The "Tool requests" list on the Rococo portfolio, against the mocked requests and profiles
// stores: each request reads as company, tool, who asked and when, newest first; a Rococo person
// who asked is marked; a requester who is gone reads as no longer listed; and a failed load
// stays inside its own section while the company cards above still render.
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
vi.mock("../services/gsrOnDemand.ts", () => import("../test/mocks/gsrOnDemand.ts"));
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/sopCategories.ts", () => import("../test/mocks/sopCategories.ts"));
vi.mock("../services/sopSignoffs.ts", () => import("../test/mocks/sopSignoffs.ts"));
vi.mock("../services/financials.ts", () => import("../test/mocks/financials.ts"));
vi.mock("../services/marketing.ts", () => import("../test/mocks/marketing.ts"));
vi.mock("../services/connectorRequests.ts", async () => {
  const mock = await import("../test/mocks/connectorRequests.ts");
  return { ...mock, listAllConnectorRequests: vi.fn(mock.listAllConnectorRequests) };
});

import PortfolioPage from "./rococo/PortfolioPage.tsx";
import { renderWithHub } from "../test/renderWithHub.tsx";
import { COMPANIES, KLASIK, makeHub } from "../test/fixtures.ts";
import { listAllConnectorRequests } from "../services/connectorRequests.ts";
import { requestConnector } from "../test/mocks/connectorRequests.ts";
import { setActingPerson } from "../test/actingPerson.ts";
import type { ConnectorRequest } from "../types/database.ts";

const rococo = makeHub("rococo", null);
const list = vi.mocked(listAllConnectorRequests);
const realList = list.getMockImplementation()!;
const klasikPerson = KLASIK.profiles[0];

beforeEach(() => {
  list.mockReset().mockImplementation(realList);
});

function open() {
  return renderWithHub(<PortfolioPage />, rococo, { path: "/rococo", pattern: "/rococo" });
}

async function section() {
  const heading = await screen.findByRole("heading", { name: "Tool requests" });
  return heading.closest("section") as HTMLElement;
}

describe("Tool requests on the portfolio", () => {
  it("lists each request as company, tool, who asked and when, newest first", async () => {
    const rows: ConnectorRequest[] = [
      { id: "r1", company_id: "co-klasik", connector_key: "quickbooks", requested_by: klasikPerson.id, requested_at: "2026-09-10T12:00:00.000Z" },
      { id: "r2", company_id: "co-rba", connector_key: "jobtread", requested_by: klasikPerson.id, requested_at: "2026-09-14T12:00:00.000Z" },
    ];
    list.mockImplementation(async () => rows);
    open();
    const box = await section();
    const items = await within(box).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("RBA Projects");
    expect(items[0]).toHaveTextContent("JobTread");
    expect(items[0]).toHaveTextContent(klasikPerson.full_name as string);
    expect(items[0]).toHaveTextContent("Sep 14, 2026");
    expect(items[1]).toHaveTextContent("Klasik Construction");
    expect(items[1]).toHaveTextContent("QuickBooks Online");
    expect(items[1]).toHaveTextContent("Sep 10, 2026");
    expect(within(items[0]).queryByText("Rococo")).not.toBeInTheDocument();
  });

  it("marks a request made by a Rococo admin as Rococo", async () => {
    setActingPerson(rococo.profile);
    await requestConnector("co-klasik", "quickbooks");
    open();
    const box = await section();
    const item = (await within(box).findAllByRole("listitem"))[0];
    expect(item).toHaveTextContent(rococo.profile.full_name as string);
    expect(within(item).getByText("Rococo")).toBeInTheDocument();
  });

  it("names a deleted requester as 'someone no longer listed'", async () => {
    list.mockImplementation(async () => [
      { id: "r1", company_id: "co-klasik", connector_key: "quickbooks", requested_by: null, requested_at: "2026-09-10T12:00:00.000Z" },
      { id: "r2", company_id: "co-rba", connector_key: "not-a-tool", requested_by: "no-such-person", requested_at: "2026-09-11T12:00:00.000Z" },
    ]);
    open();
    const box = await section();
    expect(await within(box).findAllByText("someone no longer listed")).toHaveLength(2);
    expect(within(box).getByText("not-a-tool")).toBeInTheDocument();
  });

  it("shows 'No tool requests yet.' when there are none", async () => {
    open();
    expect(await screen.findByText("No tool requests yet.")).toBeInTheDocument();
  });

  it("a failed load shows a plain line and the rest of the portfolio still renders", async () => {
    list.mockImplementation(async () => {
      throw new Error("new row violates row-level security policy");
    });
    open();
    const box = await section();
    expect(await within(box).findByText("You do not have permission to do that.")).toBeInTheDocument();
    for (const company of COMPANIES) {
      expect(await screen.findByRole("heading", { name: company.name })).toBeInTheDocument();
    }
  });
});
