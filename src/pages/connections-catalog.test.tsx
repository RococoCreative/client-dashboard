// Settings > Connections as a catalog of tool cards: every company sees the same tools, grouped by
// what they are for, each card reading its state from the company's own rows, modules, links,
// requests and whether Rococo's keys are in. These pin what the page shows and the actions it
// offers, the tool requests, Rococo's setup line, the return trip from a provider's sign-in, and the
// panels: the detail panel a connected tool opens, the one before the provider's sign-in, and the
// confirm panel a sign-in comes back to before anything is connected.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/connections.ts", () => import("../test/mocks/connections.ts"));
vi.mock("../services/connectorRequests.ts", () => import("../test/mocks/connectorRequests.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
// Settings' other panels, for the test that renders the whole tab.
vi.mock("../services/sync.ts", () => import("../test/mocks/sync.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/audit.ts", () => import("../test/mocks/audit.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { HubContext, type HubValue } from "../context/HubContext.tsx";
import { KINGDOM, KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import { holdMockConnectorSetup, setMockConnectorSetup, setMockMissingSecrets, setMockPending } from "../test/mocks/connections.ts";
import { PENDING_GONE, PENDING_SOMEONE_ELSE } from "../../supabase/functions/_shared/connectFlow.ts";
import * as connectionsService from "../services/connections.ts";
import * as requestsService from "../services/connectorRequests.ts";
import * as linksService from "../services/externalLinks.ts";
import * as directoryService from "../services/directory.ts";
import ConnectionsCatalog from "../components/settings/ConnectionsCatalog.tsx";
import SettingsPage from "./settings/SettingsPage.tsx";
import { formatDate } from "../lib/format.ts";

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

  // The setup check goes through an Edge Function that can be cold or stalled; the cards never wait on it.
  it("shows the cards and reaches Manage and Disconnect while the setup check has not answered", async () => {
    const user = userEvent.setup();
    holdMockConnectorSetup();
    renderCatalog(kingdomRococo);
    const qbo = await findCard("QuickBooks Online");
    // Unknown reads as keys in, and Rococo's line says it cannot tell yet.
    expect(within(qbo).getByText("Not connected")).toBeInTheDocument();
    expect(within(qbo).getByRole("button", { name: "Connect QuickBooks Online" })).toBeInTheDocument();
    expect(within(qbo).getByText("Setup status unavailable.")).toBeInTheDocument();
    await user.click(within(card("GoHighLevel")).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    expect(within(panel).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("turns a Not connected card into Not available yet when a late setup answer says its keys are missing", async () => {
    const release = holdMockConnectorSetup();
    renderCatalog();
    const qbo = await findCard("QuickBooks Online");
    expect(within(qbo).getByText("Not connected")).toBeInTheDocument();
    release({ quickbooks: false, gohighlevel: true, google_sheets: true });
    expect(await within(qbo).findByText("Not available yet")).toBeInTheDocument();
    expect(within(qbo).getByText("Rococo is setting this up.")).toBeInTheDocument();
    expect(within(qbo).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows Google Sheets as Not on for this company without data_sources", async () => {
    renderCatalog(klasikAdmin);
    const sheets = await findCard("Google Sheets");
    expect(within(sheets).getByText("Not on for this company")).toBeInTheDocument();
    expect(within(sheets).getByText("Needs Data sources, which Rococo turns on.")).toBeInTheDocument();
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

  it("shows the line for a known ?connect_error= key and the generic line for an old full sentence or an unknown key", async () => {
    const { unmount } = renderCatalog(kingdomAdmin, "/settings/connections?connect_error=cancelled");
    expect(await screen.findByText("The sign-in was cancelled or refused. Nothing changed.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("address").textContent).toBe(""));
    unmount();

    const generic = "The connection did not finish. Start again from Settings.";
    for (const value of ["The sign-in was cancelled or refused. Nothing changed.", "Send your password to someone.", "x"]) {
      const { unmount: done } = renderCatalog(kingdomAdmin, `/settings/connections?connect_error=${encodeURIComponent(value)}`);
      expect(await screen.findByText(generic)).toBeInTheDocument();
      expect(screen.queryByText(value)).not.toBeInTheDocument();
      done();
    }
  });

  it("with TOKEN_ENCRYPTION_KEY missing, every live sign-in card reads Not available yet and a Rococo admin reads 'Rococo: connections are not set up. Set TOKEN_ENCRYPTION_KEY.'", async () => {
    // Nothing connected yet, so no row keeps a card on Connected.
    const rows = await connectionsService.listConnections(KINGDOM.company.id);
    const spy = vi.spyOn(connectionsService, "listConnections").mockResolvedValue(rows.map((r) => ({ ...r, status: "not_connected" as const })));
    onTestFinished(() => spy.mockRestore());
    setMockMissingSecrets(["TOKEN_ENCRYPTION_KEY"]);
    const { unmount } = renderCatalog(kingdomRococo);
    await findCard("QuickBooks Online");
    for (const name of ["QuickBooks Online", "GoHighLevel", "Google Sheets"]) {
      expect(await within(card(name)).findByText("Not available yet")).toBeInTheDocument();
      expect(within(card(name)).getByText("Rococo: connections are not set up. Set TOKEN_ENCRYPTION_KEY.")).toBeInTheDocument();
      expect(within(card(name)).queryByRole("button")).not.toBeInTheDocument();
    }
    expect(within(card("Monday.com")).getByText("Rococo: nothing to set up.")).toBeInTheDocument();
    unmount();

    renderCatalog(kingdomAdmin);
    expect(await within(await findCard("QuickBooks Online")).findByText("Not available yet")).toBeInTheDocument();
    expect(screen.queryByText(/TOKEN_ENCRYPTION_KEY/)).not.toBeInTheDocument();
  });

  // A bad previous key also reads TOKEN_ENCRYPTION_KEY false; the line names the one to fix.
  it("names TOKEN_ENCRYPTION_KEY_PREVIOUS when the previous key is the one at fault, and both secrets when both are missing", async () => {
    setMockMissingSecrets(["TOKEN_ENCRYPTION_KEY_PREVIOUS"]);
    const { unmount } = renderCatalog(kingdomRococo);
    expect(await within(await findCard("QuickBooks Online")).findByText("Rococo: connections are not set up. Set TOKEN_ENCRYPTION_KEY_PREVIOUS.")).toBeInTheDocument();
    expect(within(card("QuickBooks Online")).getByText("Not available yet")).toBeInTheDocument();
    unmount();

    setMockMissingSecrets(["CONNECTIONS_STATE_SECRET", "TOKEN_ENCRYPTION_KEY"]);
    renderCatalog(kingdomRococo);
    expect(await within(await findCard("QuickBooks Online")).findByText("Rococo: connections are not set up. Set CONNECTIONS_STATE_SECRET and TOKEN_ENCRYPTION_KEY.")).toBeInTheDocument();
  });
});

const PENDING_ID = "5f0c7a52-0000-4000-8000-000000000001";
const pendingPath = (id = PENDING_ID, rest = "") => `/settings/connections?pending=${id}${rest}`;
const ready = (provider: "quickbooks" | "gohighlevel" | "google_sheets", account_name: string | null, company_name = KINGDOM.company.name) =>
  ({ status: "ready", provider, account_name, company_name }) as const;
const confirmPanel = () => screen.findByRole("dialog", { name: "Confirm the connection" });

describe("the confirm panel", () => {
  it("shows 'Connect QuickBooks Online account Sample Books LLC to Kingdom Custom Construction?' and Connect attaches it, says 'QuickBooks Online is connected.' and clears the address", async () => {
    const user = userEvent.setup();
    setMockPending(PENDING_ID, ready("quickbooks", "Sample Books LLC"));
    renderCatalog(kingdomAdmin, pendingPath());
    const panel = await confirmPanel();
    expect(await within(panel).findByText("Connect QuickBooks Online account Sample Books LLC to Kingdom Custom Construction?")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("address").textContent).toBe(""));
    expect(within(card("QuickBooks Online")).getByText("Not connected")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("QuickBooks Online is connected.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(within(card("QuickBooks Online")).getByText("Connected")).toBeInTheDocument());
    expect(screen.getByTestId("address").textContent).toBe("");
  });

  // The id is the one thing that lets its starter finish the connection, so it never stays in the
  // browser's history or in a link someone copies from the address bar.
  it("takes ?pending off the address as soon as it is read, keeping the rest, while the panel stays open", async () => {
    setMockPending(PENDING_ID, ready("quickbooks", "Sample Books LLC"));
    renderCatalog(kingdomAdmin, pendingPath(PENDING_ID, "&keep=1"));
    const panel = await confirmPanel();
    await waitFor(() => expect(screen.getByTestId("address").textContent).toBe("?keep=1"));
    expect(await within(panel).findByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  // Only the id the callback mints is ever read: anything else on the address, from a hand-made
  // link, opens nothing and is never sent to the function, and still comes off the address.
  it("ignores a pending value that is not a well-formed id: no panel, no call, and it leaves the address", async () => {
    const read = vi.spyOn(connectionsService, "readPendingConnection");
    onTestFinished(() => read.mockRestore());
    for (const value of ["not-an-id", `${PENDING_ID}x`, "' or 1=1 --"]) {
      const { unmount } = renderCatalog(kingdomAdmin, `/settings/connections?pending=${encodeURIComponent(value)}&keep=1`);
      await findCard("QuickBooks Online");
      await waitFor(() => expect(screen.getByTestId("address").textContent).toBe("?keep=1"));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      unmount();
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("reads the no-name line when the tool gave no account name", async () => {
    setMockPending(PENDING_ID, ready("gohighlevel", null));
    renderCatalog(kingdomAdmin, pendingPath());
    const panel = await confirmPanel();
    expect(
      await within(panel).findByText("Connect GoHighLevel to Kingdom Custom Construction? GoHighLevel did not give this account's name. Only continue if you just approved access in GoHighLevel."),
    ).toBeInTheDocument();
  });

  it("the confirm line names the pending connection's company", async () => {
    setMockPending(PENDING_ID, ready("quickbooks", "Sample Books LLC", "Klasik Sample"));
    renderCatalog(kingdomAdmin, pendingPath());
    const panel = await confirmPanel();
    expect(await within(panel).findByText("Connect QuickBooks Online account Sample Books LLC to Klasik Sample?")).toBeInTheDocument();
  });

  it("renders an odd account name as text", async () => {
    const odd = '<b>Smith & "Sons"</b>';
    setMockPending(PENDING_ID, ready("quickbooks", odd));
    renderCatalog(kingdomAdmin, pendingPath());
    const panel = await confirmPanel();
    expect(await within(panel).findByText(`Connect QuickBooks Online account ${odd} to Kingdom Custom Construction?`)).toBeInTheDocument();
    expect(panel.querySelector("b")).toBeNull();
  });

  it("Cancel says 'Nothing was connected.'; for GoHighLevel it adds 'GoHighLevel may still list Company Hub; remove it there too.'", async () => {
    const user = userEvent.setup();
    const discard = vi.spyOn(connectionsService, "discardConnection");
    onTestFinished(() => discard.mockRestore());
    setMockPending(PENDING_ID, ready("quickbooks", "Sample Books LLC"));
    const { unmount } = renderCatalog(kingdomAdmin, pendingPath());
    await user.click(await within(await confirmPanel()).findByRole("button", { name: "Cancel" }));
    expect(discard).toHaveBeenCalledWith(PENDING_ID);
    expect(await screen.findByText("Nothing was connected.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/may still list/)).not.toBeInTheDocument();
    expect(within(card("QuickBooks Online")).getByText("Not connected")).toBeInTheDocument();
    unmount();

    const other = "5f0c7a52-0000-4000-8000-000000000002";
    setMockPending(other, ready("gohighlevel", "Sample Location"));
    renderCatalog(kingdomAdmin, pendingPath(other));
    await user.click(await within(await confirmPanel()).findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Nothing was connected. GoHighLevel may still list Company Hub; remove it there too.")).toBeInTheDocument();
  });

  it("someone else's pending reads the someone-else line with only Close", async () => {
    const user = userEvent.setup();
    setMockPending(PENDING_ID, { status: "someone_else" });
    renderCatalog(kingdomAdmin, pendingPath());
    const panel = await confirmPanel();
    expect(await within(panel).findByText(PENDING_SOMEONE_ELSE)).toBeInTheDocument();
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual(["Close"]);
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("address").textContent).toBe("");
  });

  it("an expired or unknown pending reads 'This connection request has expired. Start the connection again.'", async () => {
    setMockPending(PENDING_ID, { status: "gone" });
    const { unmount } = renderCatalog(kingdomAdmin, pendingPath());
    const panel = await confirmPanel();
    expect(await within(panel).findByText("This connection request has expired. Start the connection again.")).toBeInTheDocument();
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual(["Close"]);
    unmount();

    renderCatalog(kingdomAdmin, pendingPath("5f0c7a52-0000-4000-8000-0000000000ff"));
    expect(await within(await confirmPanel()).findByText(PENDING_GONE)).toBeInTheDocument();
  });

  it("a pending link already finished reads the expired line, on opening or on a second Connect", async () => {
    const user = userEvent.setup();
    // A second Connect: the function answers that it is gone, and nothing is attached.
    setMockPending(PENDING_ID, ready("quickbooks", "Sample Books LLC"));
    const finish = vi.spyOn(connectionsService, "finishConnection").mockRejectedValueOnce(new Error(PENDING_GONE));
    onTestFinished(() => finish.mockRestore());
    const { unmount } = renderCatalog(kingdomAdmin, pendingPath());
    const panel = await confirmPanel();
    await user.click(await within(panel).findByRole("button", { name: "Connect" }));
    expect(await within(panel).findByText(PENDING_GONE)).toBeInTheDocument();
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual(["Close"]);
    expect(within(card("QuickBooks Online")).getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("QuickBooks Online is connected.")).not.toBeInTheDocument();
    unmount();

    // Opening a link whose connection was already finished.
    const done = "5f0c7a52-0000-4000-8000-000000000003";
    setMockPending(done, ready("quickbooks", "Sample Books LLC"), KINGDOM.company.id);
    await connectionsService.finishConnection(done);
    renderCatalog(kingdomAdmin, pendingPath(done));
    expect(await within(await confirmPanel()).findByText(PENDING_GONE)).toBeInTheDocument();
  });
});

// Puts GoHighLevel's row for Kingdom in error with a stored line, for the rest of the test.
async function ghlInError(patch: Record<string, unknown> = {}) {
  const rows = await connectionsService.listConnections(KINGDOM.company.id);
  const spy = vi.spyOn(connectionsService, "listConnections").mockResolvedValue(
    rows.map((r) => (r.provider === "gohighlevel" ? { ...r, status: "error" as const, last_error: "The provider refused the saved sign-in.", ...patch } : r)),
  );
  onTestFinished(() => spy.mockRestore());
}

describe("the detail panel", () => {
  it("Manage opens the panel with account, connected by name, since, last read, Read only, and what it feeds", async () => {
    const user = userEvent.setup();
    renderCatalog();
    const ghl = await findCard("GoHighLevel");
    await user.click(within(ghl).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    const owner = KINGDOM.profiles[0].full_name!;
    expect(within(panel).getByText("Kingdom Custom Construction (HighLevel)")).toBeInTheDocument();
    expect(await within(panel).findByText(owner)).toBeInTheDocument();
    expect(within(panel).getByText(formatDate("2026-08-04T15:30:00.000Z"))).toBeInTheDocument();
    expect(within(panel).getByText("Not read yet")).toBeInTheDocument();
    expect(within(panel).getByText("Read only")).toBeInTheDocument();
    expect(within(panel).getByText("Sales & Finance: closed sales")).toBeInTheDocument();
    expect(within(panel).getByText("Sales for each person")).toBeInTheDocument();
    const first = owner.split(" ")[0];
    expect(within(panel).getByText(`Connected once for everyone at Kingdom Custom Construction. If ${first} leaves or loses access to this account, reconnect with an account the company keeps.`)).toBeInTheDocument();
    // Connected, keys in, nothing turned off: Reconnect is there and Disconnect waits for a press.
    expect(within(panel).getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names a connector of the account who is not in the directory as 'someone not on the People list'", async () => {
    const user = userEvent.setup();
    const rows = await connectionsService.listConnections(KINGDOM.company.id);
    const spy = vi.spyOn(connectionsService, "listConnections").mockResolvedValue(rows.map((r) => (r.provider === "gohighlevel" ? { ...r, connected_by: "profile-gone" } : r)));
    onTestFinished(() => spy.mockRestore());
    renderCatalog();
    await user.click(within(await findCard("GoHighLevel")).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    expect(await within(panel).findByText("someone not on the People list")).toBeInTheDocument();
    expect(within(panel).getByText("Connected once for everyone at Kingdom Custom Construction. If the person who connected it leaves or loses access to this account, reconnect with an account the company keeps.")).toBeInTheDocument();
  });

  it("names the signed-in person who connected it from their own profile, though the directory leaves them out", async () => {
    const user = userEvent.setup();
    // A Rococo admin connected it for the company; the company directory leaves Rococo staff out.
    const me = kingdomRococo.profile;
    const rows = await connectionsService.listConnections(KINGDOM.company.id);
    const spy = vi.spyOn(connectionsService, "listConnections").mockResolvedValue(rows.map((r) => (r.provider === "gohighlevel" ? { ...r, connected_by: me.id } : r)));
    onTestFinished(() => spy.mockRestore());
    const directory = await directoryService.listDirectory(KINGDOM.company.id);
    const dirSpy = vi.spyOn(directoryService, "listDirectory").mockResolvedValue(directory.filter((d) => d.id !== me.id));
    onTestFinished(() => dirSpy.mockRestore());
    renderCatalog(kingdomRococo);
    await user.click(within(await findCard("GoHighLevel")).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    const name = me.full_name!;
    expect(await within(panel).findByText(name)).toBeInTheDocument();
    expect(within(panel).queryByText("someone not on the People list")).not.toBeInTheDocument();
    expect(within(panel).getByText(`Connected once for everyone at Kingdom Custom Construction. If ${name.split(" ")[0]} leaves or loses access to this account, reconnect with an account the company keeps.`)).toBeInTheDocument();
  });

  it("names the signed-in person by their email when their name is blank", async () => {
    const user = userEvent.setup();
    const me = { ...kingdomRococo.profile, full_name: "  " };
    const rows = await connectionsService.listConnections(KINGDOM.company.id);
    const spy = vi.spyOn(connectionsService, "listConnections").mockResolvedValue(rows.map((r) => (r.provider === "gohighlevel" ? { ...r, connected_by: me.id } : r)));
    onTestFinished(() => spy.mockRestore());
    const directory = await directoryService.listDirectory(KINGDOM.company.id);
    const dirSpy = vi.spyOn(directoryService, "listDirectory").mockResolvedValue(directory.filter((d) => d.id !== me.id));
    onTestFinished(() => dirSpy.mockRestore());
    renderCatalog({ ...kingdomRococo, profile: me });
    await user.click(within(await findCard("GoHighLevel")).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    expect(await within(panel).findByText(me.email)).toBeInTheDocument();
    expect(within(panel).queryByText("someone not on the People list")).not.toBeInTheDocument();
  });

  it("reads 'Not known right now' for who connected it when the directory cannot be read", async () => {
    const user = userEvent.setup();
    const dirSpy = vi.spyOn(directoryService, "listDirectory").mockRejectedValue(new Error("The directory could not be read."));
    onTestFinished(() => dirSpy.mockRestore());
    renderCatalog();
    await user.click(within(await findCard("GoHighLevel")).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    expect(await within(panel).findByText("Not known right now")).toBeInTheDocument();
    expect(within(panel).queryByText("someone not on the People list")).not.toBeInTheDocument();
    expect(within(panel).getByText("Connected once for everyone at Kingdom Custom Construction. If the person who connected it leaves or loses access to this account, reconnect with an account the company keeps.")).toBeInTheDocument();
  });

  it("reads 'Not recorded' for the account when the row has no account name", async () => {
    const user = userEvent.setup();
    const rows = await connectionsService.listConnections(KINGDOM.company.id);
    const spy = vi.spyOn(connectionsService, "listConnections").mockResolvedValue(
      rows.map((r) => (r.provider === "gohighlevel" ? { ...r, external_account_name: null } : r)),
    );
    onTestFinished(() => spy.mockRestore());
    renderCatalog();
    const ghl = await findCard("GoHighLevel");
    expect(within(ghl).getByText("Account not recorded", { exact: false })).toBeInTheDocument();
    await user.click(within(ghl).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    expect(within(panel).getByText("Account").nextElementSibling).toHaveTextContent("Not recorded");
  });

  it("shows the stored error first for a card that needs attention", async () => {
    const user = userEvent.setup();
    await ghlInError();
    renderCatalog();
    const ghl = await findCard("GoHighLevel");
    // Reconnect still sits on the card, and Manage beside it reaches the panel.
    expect(within(ghl).getByRole("button", { name: "Reconnect GoHighLevel" })).toBeInTheDocument();
    await user.click(within(ghl).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    const error = within(panel).getByText("The provider refused the saved sign-in.");
    expect(error).toHaveClass("text-danger");
    // Before the account and everything else.
    expect(error.compareDocumentPosition(within(panel).getByText("Account")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("reaches Disconnect on a card in error whose keys are missing, with the blocked line in place of Reconnect", async () => {
    const user = userEvent.setup();
    setMockConnectorSetup({ quickbooks: true, gohighlevel: false, google_sheets: true });
    await ghlInError();
    renderCatalog();
    const ghl = await findCard("GoHighLevel");
    expect(within(ghl).queryByRole("button", { name: "Reconnect GoHighLevel" })).not.toBeInTheDocument();
    await user.click(within(ghl).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    expect(within(panel).queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument();
    expect(within(panel).getByText("Rococo is setting this up.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("Disconnect asks again as 'Disconnect for everyone at {company name}' and only the second press disconnects", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(connectionsService, "disconnectConnection");
    onTestFinished(() => spy.mockRestore());
    renderCatalog(kingdomAdmin, "/settings/connections?connected=gohighlevel");
    expect(await screen.findByText("GoHighLevel is connected.")).toBeInTheDocument();
    await user.click(within(card("GoHighLevel")).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    await user.click(within(panel).getByRole("button", { name: "Disconnect" }));
    expect(spy).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole("button", { name: "Disconnect for everyone at Kingdom Custom Construction" }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(KINGDOM.company.id, "gohighlevel");
    // The panel closes, the rows load again, and the return trip's banner goes with the connection.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(within(card("GoHighLevel")).getByText("Not connected")).toBeInTheDocument());
    expect(within(card("GoHighLevel")).getByRole("button", { name: "Connect GoHighLevel" })).toBeInTheDocument();
    expect(screen.queryByText("GoHighLevel is connected.")).not.toBeInTheDocument();
  });

  it("Disconnect of GoHighLevel says 'Disconnected here. GoHighLevel may still list Company Hub; remove it there too.'; a QuickBooks Disconnect says nothing more", async () => {
    const user = userEvent.setup();
    // QuickBooks connected through the confirm step, so both tools are on.
    const id = "5f0c7a52-0000-4000-8000-000000000004";
    setMockPending(id, ready("quickbooks", "Sample Books LLC"), KINGDOM.company.id);
    await connectionsService.finishConnection(id);
    renderCatalog();

    await user.click(within(await findCard("GoHighLevel")).getByRole("button", { name: "Manage GoHighLevel" }));
    const ghl = await screen.findByRole("dialog", { name: "GoHighLevel" });
    await user.click(within(ghl).getByRole("button", { name: "Disconnect" }));
    await user.click(within(ghl).getByRole("button", { name: "Disconnect for everyone at Kingdom Custom Construction" }));
    expect(await screen.findByText("Disconnected here. GoHighLevel may still list Company Hub; remove it there too.")).toBeInTheDocument();
    await waitFor(() => expect(within(card("GoHighLevel")).getByText("Not connected")).toBeInTheDocument());

    await user.click(within(card("QuickBooks Online")).getByRole("button", { name: "Manage QuickBooks Online" }));
    const qbo = await screen.findByRole("dialog", { name: "QuickBooks Online" });
    await user.click(within(qbo).getByRole("button", { name: "Disconnect" }));
    await user.click(within(qbo).getByRole("button", { name: "Disconnect for everyone at Kingdom Custom Construction" }));
    await waitFor(() => expect(within(card("QuickBooks Online")).getByText("Not connected")).toBeInTheDocument());
    expect(screen.queryByText(/may still list/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Disconnected here/)).not.toBeInTheDocument();
  });

  it("Reconnect is absent and the blocked line shows when keys are missing on a connected card", async () => {
    const user = userEvent.setup();
    setMockConnectorSetup({ quickbooks: true, gohighlevel: false, google_sheets: true });
    renderCatalog();
    const ghl = await findCard("GoHighLevel");
    expect(within(ghl).getByText("Connected")).toBeInTheDocument();
    await user.click(within(ghl).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    expect(within(panel).queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument();
    expect(within(panel).getByText("Rococo is setting this up.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("Reconnect in the panel goes through the connect panel", async () => {
    const user = userEvent.setup();
    renderCatalog();
    await user.click(within(await findCard("GoHighLevel")).getByRole("button", { name: "Manage GoHighLevel" }));
    await user.click(within(await screen.findByRole("dialog", { name: "GoHighLevel" })).getByRole("button", { name: "Reconnect" }));
    expect(await screen.findByRole("dialog", { name: "Connect GoHighLevel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to GoHighLevel" })).toBeInTheDocument();
  });
});

describe("the connect panel", () => {
  it("Connect opens the connect panel; Continue to {Tool} calls startConnection with the company's return address", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(connectionsService, "startConnection").mockRejectedValue(new Error("Stopped before leaving the page."));
    onTestFinished(() => spy.mockRestore());
    renderCatalog();
    await user.click(within(await findCard("QuickBooks Online")).getByRole("button", { name: "Connect QuickBooks Online" }));
    expect(spy).not.toHaveBeenCalled();
    const panel = await screen.findByRole("dialog", { name: "Connect QuickBooks Online" });
    expect(within(panel).getByText("You'll go to QuickBooks Online to sign in and approve. Then you come straight back here.")).toBeInTheDocument();
    expect(within(panel).getByText("Use an account the company keeps, like a shared office login. If the person who signs in leaves, the connection stops for everyone.")).toBeInTheDocument();
    expect(within(panel).getByText("Sales & Finance: invoices and balances")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Continue to QuickBooks Online" }));
    expect(spy).toHaveBeenCalledWith(KINGDOM.company.id, "quickbooks", `${window.location.origin}/settings/connections/${KINGDOM.company.id}`);
    // A failure says so in the panel, and Continue is there to try again.
    expect(await within(panel).findByText("Stopped before leaving the page.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Continue to QuickBooks Online" })).not.toBeDisabled();
  });

  it("Reconnect on a card in error opens the connect panel too", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(connectionsService, "startConnection");
    onTestFinished(() => spy.mockRestore());
    await ghlInError();
    renderCatalog();
    await user.click(within(await findCard("GoHighLevel")).getByRole("button", { name: "Reconnect GoHighLevel" }));
    expect(await screen.findByRole("dialog", { name: "Connect GoHighLevel" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Monday's links", () => {
  it("Manage links on Monday lists only Monday links and adds new ones as Monday", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(linksService, "createExternalLink");
    onTestFinished(async () => {
      create.mockRestore();
      for (const link of await linksService.listExternalLinks(KINGDOM.company.id)) {
        if (link.label === "Sample estimating board") await linksService.deleteExternalLink(link.id);
      }
    });
    renderCatalog();
    const monday = await findCard("Monday.com");
    expect(within(monday).getByText("3 boards linked")).toBeInTheDocument();
    await user.click(within(monday).getByRole("button", { name: "Manage links for Monday.com" }));
    const panel = await screen.findByRole("dialog", { name: "Monday.com links" });
    // A General link has no section page, so only another category puts a board there.
    expect(within(panel).getByText("The company's Monday.com boards. Each shows on Home for whoever it is for; a category other than General also puts it on that section's page. People still sign in to Monday.com themselves.")).toBeInTheDocument();
    expect(await within(panel).findByText("Sample sales board")).toBeInTheDocument();
    expect(within(panel).getByText("Sample production board")).toBeInTheDocument();
    expect(within(panel).getByText("Sample schedule view")).toBeInTheDocument();
    // The company's other links stay on Resources.
    expect(within(panel).queryByText("Sample owner report")).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText("Tool")).not.toBeInTheDocument();

    await user.type(within(panel).getByLabelText("Label"), "Sample estimating board");
    await user.type(within(panel).getByLabelText("Link"), "https://example.com/monday/sample-estimating");
    await user.click(within(panel).getByRole("button", { name: "Add link" }));
    expect(await within(panel).findByText("Sample estimating board")).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ company_id: KINGDOM.company.id, provider: "monday", label: "Sample estimating board" }));

    await user.click(within(panel).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(within(card("Monday.com")).getByText("4 boards linked")).toBeInTheDocument());
  });

  it("Add a board link on a Monday card with no links opens the same panel", async () => {
    const user = userEvent.setup();
    const all = await linksService.listExternalLinks(KINGDOM.company.id);
    const spy = vi.spyOn(linksService, "listExternalLinks").mockResolvedValue(all.filter((l) => l.provider !== "monday"));
    onTestFinished(() => spy.mockRestore());
    renderCatalog();
    const monday = await findCard("Monday.com");
    expect(within(monday).getByText("Not set up")).toBeInTheDocument();
    await user.click(within(monday).getByRole("button", { name: "Add a board link for Monday.com" }));
    const panel = await screen.findByRole("dialog", { name: "Monday.com links" });
    expect(await within(panel).findByRole("form", { name: "Add a link" })).toBeInTheDocument();
    expect(within(panel).queryByText("Sample owner report")).not.toBeInTheDocument();
  });
});

describe("switching company", () => {
  function Shell({ hub }: { hub: HubValue }) {
    return (
      <HubContext value={hub}>
        <MemoryRouter initialEntries={["/settings/connections"]}>
          <Routes>
            <Route path="/settings/connections" element={<SettingsPage tab="connections" />} />
          </Routes>
        </MemoryRouter>
      </HubContext>
    );
  }

  it("closes the panel when the active company changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Shell hub={kingdomRococo} />);
    await user.click(within(await findCard("GoHighLevel")).getByRole("button", { name: "Manage GoHighLevel" }));
    expect(await screen.findByRole("dialog", { name: "GoHighLevel" })).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "nothing like this");

    // The sidebar switcher changes company without navigating.
    rerender(<Shell hub={makeHub("rococo", RBA.company)} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("searchbox", { name: "Search tools" })).toHaveValue("");
    expect(await findCard("QuickBooks Online")).toBeInTheDocument();
  });
});
