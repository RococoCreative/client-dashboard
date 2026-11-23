// Settings > Connections as a catalog of tool cards: every company sees the same tools, grouped by
// what they are for, each card reading its state from the company's own rows, modules, links,
// requests and whether Rococo's keys are in. These pin what the page shows and the actions it
// offers, the tool requests, Rococo's setup line, and the return trip from a provider's sign-in.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { useLocation } from "react-router-dom";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/connections.ts", () => import("../test/mocks/connections.ts"));
vi.mock("../services/connectorRequests.ts", () => import("../test/mocks/connectorRequests.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { KINGDOM, KLASIK, makeHub } from "../test/fixtures.ts";
import { setMockConnectorSetup } from "../test/mocks/connections.ts";
import * as connectionsService from "../services/connections.ts";
import * as requestsService from "../services/connectorRequests.ts";
import ConnectionsCatalog from "../components/settings/ConnectionsCatalog.tsx";

// Kingdom carries every module; Klasik carries none, which is where a company starts.
const kingdomAdmin = makeHub("admin", KINGDOM.company);
const klasikAdmin = makeHub("admin", KLASIK.company);
const kingdomRococo = makeHub("rococo", KINGDOM.company);

// Shows the address the page is on, so a test can see the return trip's outcome taken off it.
function Address() {
  const location = useLocation();
  return <p data-testid="address">{location.search}</p>;
}

function renderCatalog(hub = kingdomAdmin, path = "/settings/connections") {
  return renderWithHub(
    <>
      <ConnectionsCatalog company={hub.company!} />
      <Address />
    </>,
    hub,
    { path, pattern: "/settings/connections" },
  );
}

const card = (name: string) => screen.getByRole("article", { name });
const findCard = (name: string) => screen.findByRole("article", { name });
const cardNames = (scope: HTMLElement = document.body) => within(scope).queryAllByRole("article").map((a) => within(a).getByRole("heading", { level: 4 }).textContent);
const group = (label: string) => screen.getByRole("region", { name: label });
const summary = () => screen.getByRole("group", { name: "Summary" });
const figure = (label: string) => within(summary()).getByText(label).previousElementSibling?.textContent;
const filters = () => screen.getByRole("group", { name: "Filter" });

describe("the connections catalog", () => {
  it("shows the four groups in order with every connector card", async () => {
    renderCatalog();
    await findCard("QuickBooks Online");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Financials", "Production", "Marketing & Sales", "Productivity"]);
    // Within a group, what needs a look first, then the order of the registry.
    expect(cardNames(group("Financials"))).toEqual(["Google Sheets", "QuickBooks Online", "Xero"]);
    expect(cardNames(group("Production"))).toEqual(["JobTread", "Buildertrend", "CompanyCam"]);
    expect(cardNames(group("Marketing & Sales"))).toEqual(["GoHighLevel", "HubSpot"]);
    expect(cardNames(group("Productivity"))).toEqual(["Monday.com", "Asana", "Google Calendar"]);
    expect(within(card("Google Sheets")).getByText("Connected")).toBeInTheDocument();
    expect(within(card("QuickBooks Online")).getByText("Not connected")).toBeInTheDocument();
    expect(within(card("QuickBooks Online")).getByRole("button", { name: "Connect QuickBooks Online" })).toBeInTheDocument();
    expect(within(card("JobTread")).getByText("Coming next")).toBeInTheDocument();
    expect(within(card("Xero")).getByText("Coming soon")).toBeInTheDocument();
    expect(within(card("Monday.com")).getByText("Linked")).toBeInTheDocument();
    expect(within(card("GoHighLevel")).getByText("Kingdom Custom Construction (HighLevel)", { exact: false })).toBeInTheDocument();
  });

  it("shows the summary strip counts from the cards", async () => {
    renderCatalog();
    await findCard("QuickBooks Online");
    // Google Sheets, GoHighLevel and Monday's links; nothing in error; QuickBooks ready to connect.
    expect(figure("Connected")).toBe("3");
    expect(figure("Need attention")).toBe("0");
    expect(figure("Available")).toBe("1");
  });

  it("filters by group chip and by the Connected chip, and searches by name or description", async () => {
    const user = userEvent.setup();
    renderCatalog();
    await findCard("QuickBooks Online");
    expect(within(filters()).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Financials", "Production", "Marketing & Sales", "Productivity", "Connected"]);
    expect(within(filters()).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(filters()).getByRole("button", { name: "Production" }));
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Production"]);
    expect(cardNames()).toEqual(["JobTread", "Buildertrend", "CompanyCam"]);

    await user.click(within(filters()).getByRole("button", { name: "Connected" }));
    expect(cardNames()).toEqual(["Google Sheets", "GoHighLevel", "Monday.com"]);

    await user.click(within(filters()).getByRole("button", { name: "All" }));
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "BOOKS");
    // QuickBooks by name, Xero by its description.
    expect(cardNames()).toEqual(["QuickBooks Online", "Xero"]);
    await user.clear(screen.getByRole("searchbox", { name: "Search tools" }));
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "job photos");
    expect(cardNames()).toEqual(["CompanyCam"]);
  });

  it("says 'No tools match. Ask Rococo for the one you use, and it goes on the list.' when nothing matches", async () => {
    const user = userEvent.setup();
    renderCatalog();
    await findCard("QuickBooks Online");
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "nothing like this");
    expect(cardNames()).toEqual([]);
    expect(screen.getByText("No tools match. Ask Rococo for the one you use, and it goes on the list.")).toBeInTheDocument();
  });

  it("shows Not available yet and no Connect when loadConnectorSetup says QuickBooks keys are missing", async () => {
    setMockConnectorSetup({ quickbooks: false, gohighlevel: true, google_sheets: true });
    renderCatalog();
    const qbo = await findCard("QuickBooks Online");
    expect(within(qbo).getByText("Not available yet")).toBeInTheDocument();
    expect(within(qbo).getByText("Rococo is setting this up.")).toBeInTheDocument();
    expect(within(qbo).queryByRole("button")).not.toBeInTheDocument();
    expect(figure("Available")).toBe("0");
  });

  it("treats a null setup status as keys in, and a Rococo admin's line reads 'Setup status unavailable.'", async () => {
    setMockConnectorSetup(null);
    const { unmount } = renderCatalog();
    const qbo = await findCard("QuickBooks Online");
    expect(within(qbo).getByText("Not connected")).toBeInTheDocument();
    expect(within(qbo).getByRole("button", { name: "Connect QuickBooks Online" })).toBeInTheDocument();
    expect(screen.queryByText("Setup status unavailable.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    renderCatalog(kingdomRococo);
    expect(within(await findCard("QuickBooks Online")).getByText("Setup status unavailable.")).toBeInTheDocument();
    expect(within(card("GoHighLevel")).getByText("Setup status unavailable.")).toBeInTheDocument();
  });

  it("shows Google Sheets as Not on for this company without data_sources", async () => {
    renderCatalog(klasikAdmin);
    const sheets = await findCard("Google Sheets");
    expect(within(sheets).getByText("Not on for this company")).toBeInTheDocument();
    expect(within(sheets).getByText("Turn on Data sources to use this.")).toBeInTheDocument();
    expect(within(sheets).queryByRole("button")).not.toBeInTheDocument();
    // Monday follows its module the same way.
    expect(within(card("Monday.com")).getByText("Not on for this company")).toBeInTheDocument();
  });

  it("Ask for this records the request and the button reads Requested; pressing Requested withdraws it", async () => {
    const user = userEvent.setup();
    renderCatalog();
    const xero = await findCard("Xero");
    await user.click(within(xero).getByRole("button", { name: "Ask for this: Xero" }));
    expect(await within(xero).findByRole("button", { name: "Requested: Xero" })).toHaveTextContent("Requested");
    expect((await requestsService.listConnectorRequests(KINGDOM.company.id)).map((r) => r.connector_key)).toEqual(["xero"]);

    await user.click(within(xero).getByRole("button", { name: "Requested: Xero" }));
    expect(await within(xero).findByRole("button", { name: "Ask for this: Xero" })).toHaveTextContent("Ask for this");
    expect(await requestsService.listConnectorRequests(KINGDOM.company.id)).toEqual([]);
  });

  it("a duplicate ask (the service resolving the existing row) still reads Requested and shows no error", async () => {
    const user = userEvent.setup();
    renderCatalog();
    const jobtread = await findCard("JobTread");
    // Another admin asked after this page loaded; this one still shows Ask for this.
    await requestsService.requestConnector(KINGDOM.company.id, "jobtread");
    await user.click(within(jobtread).getByRole("button", { name: "Ask for this: JobTread" }));
    expect(await within(jobtread).findByRole("button", { name: "Requested: JobTread" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await requestsService.listConnectorRequests(KINGDOM.company.id)).toHaveLength(1);
  });

  it("shows a request already on file as Requested", async () => {
    await requestsService.requestConnector(KINGDOM.company.id, "hubspot");
    renderCatalog();
    expect(within(await findCard("HubSpot")).getByRole("button", { name: "Requested: HubSpot" })).toBeInTheDocument();
  });

  it("a Rococo admin sees each card's setup line with the two secret names when keys are missing; a company admin never sees them", async () => {
    setMockConnectorSetup({ quickbooks: false, gohighlevel: true, google_sheets: true });
    const { unmount } = renderCatalog(kingdomRococo);
    expect(within(await findCard("QuickBooks Online")).getByText("Rococo: app keys missing. Add QBO_CLIENT_ID and QBO_CLIENT_SECRET.")).toBeInTheDocument();
    expect(within(card("GoHighLevel")).getByText("Rococo: app keys added.")).toBeInTheDocument();
    expect(within(card("Google Sheets")).getByText("Rococo: app keys added.")).toBeInTheDocument();
    expect(within(card("Monday.com")).getByText("Rococo: nothing to set up.")).toBeInTheDocument();
    // A coming tool is not built, whatever way it will connect.
    expect(within(card("JobTread")).getByText("Rococo: not built yet.")).toBeInTheDocument();
    expect(within(card("Xero")).getByText("Rococo: not built yet.")).toBeInTheDocument();
    unmount();

    renderCatalog(kingdomAdmin);
    await findCard("QuickBooks Online");
    expect(screen.queryByText(/QBO_CLIENT|GHL_CLIENT|GOOGLE_CLIENT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Rococo:/)).not.toBeInTheDocument();
  });

  it("shows the stored error line in the danger colour on a card that needs attention", async () => {
    const rows = await connectionsService.listConnections(KINGDOM.company.id);
    const spy = vi.spyOn(connectionsService, "listConnections").mockResolvedValue(
      rows.map((r) => (r.provider === "gohighlevel" ? { ...r, status: "error" as const, last_error: "The provider refused the saved sign-in." } : r)),
    );
    onTestFinished(() => spy.mockRestore());
    renderCatalog();
    const ghl = await findCard("GoHighLevel");
    expect(within(ghl).getByText("Needs attention")).toBeInTheDocument();
    expect(within(ghl).getByText("The provider refused the saved sign-in.")).toHaveClass("text-danger");
    expect(within(ghl).getByRole("button", { name: "Reconnect GoHighLevel" })).toBeInTheDocument();
    expect(figure("Need attention")).toBe("1");
  });

  it("shows '{Tool} is connected.' once after the provider returns with ?connected= and the row agrees, then clears the address", async () => {
    const { unmount } = renderCatalog(kingdomAdmin, "/settings/connections?connected=gohighlevel&keep=1");
    expect(await screen.findByText("GoHighLevel is connected.")).toBeInTheDocument();
    expect(screen.getAllByText("GoHighLevel is connected.")).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId("address").textContent).toBe("?keep=1"));
    unmount();

    // QuickBooks' row says not connected, so the address alone does not make it so.
    renderCatalog(kingdomAdmin, "/settings/connections?connected=quickbooks");
    await findCard("QuickBooks Online");
    await waitFor(() => expect(screen.getByTestId("address").textContent).toBe(""));
    expect(screen.queryByText("QuickBooks Online is connected.")).not.toBeInTheDocument();
  });

  it("shows the fixed error line for a known ?connect_error= and the generic line for an unknown one", async () => {
    const known = "The sign-in was cancelled or refused. Nothing changed.";
    const { unmount } = renderCatalog(kingdomAdmin, `/settings/connections?connect_error=${encodeURIComponent(known)}`);
    expect(await screen.findByText(known)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("address").textContent).toBe(""));
    unmount();

    renderCatalog(kingdomAdmin, `/settings/connections?connect_error=${encodeURIComponent("Send your password to someone.")}`);
    expect(await screen.findByText("The connection did not finish. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("Send your password to someone.")).not.toBeInTheDocument();
  });
});
