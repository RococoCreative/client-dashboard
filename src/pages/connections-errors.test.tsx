// The confirm panel and Disconnect against the real connections service, with only the Supabase
// client faked: a refused call from the function, or from a gateway in front of it, carries its own
// text, and none of it may reach the screen. A 403 or 410 on the confirm step reads as the spec's
// own lines; anything else reads as the friendly fallback.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Invoke = (path: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>;
const fake = vi.hoisted(() => ({ rows: [] as unknown[], invoke: (async () => ({ data: null, error: null })) as Invoke }));

vi.mock("../services/supabase.ts", () => {
  const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: fake.rows, error: null }) };
  return { isSupabaseConfigured: true, supabase: null, db: () => ({ from: () => chain, functions: { invoke: (path: string, options: { body: Record<string, unknown> }) => fake.invoke(path, options) } }) };
});
vi.mock("../services/connectorRequests.ts", () => import("../test/mocks/connectorRequests.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { KINGDOM, makeHub } from "../test/fixtures.ts";
import ConnectionsCatalog from "../components/settings/ConnectionsCatalog.tsx";
import { PENDING_GONE, PENDING_SOMEONE_ELSE } from "../../supabase/functions/_shared/connectFlow.ts";

const ID = "5f0c7a52-0000-4000-8000-0000000000e1";
const RAW = "upstream connect error or disconnect/reset before headers. reset reason: overflow (gateway 10.0.0.7)";
const FALLBACK = "Something went wrong. Try again.";
const hub = makeHub("admin", KINGDOM.company);

const ok = (data: unknown) => ({ data, error: null });
const refused = (status: number) => ({ data: null, error: { context: new Response(JSON.stringify({ error: RAW }), { status }) } });

// The function's answers by route; a route left out answers the fallback status.
function answer(routes: Record<string, () => { data: unknown; error: unknown }>) {
  fake.invoke = async (path) => {
    if (path === "connections/status") return ok({ keys: { gohighlevel: true, quickbooks: true, google_sheets: true }, secrets: { CONNECTIONS_STATE_SECRET: true, TOKEN_ENCRYPTION_KEY: true } });
    return (routes[path] ?? (() => refused(500)))();
  };
}

const ready = () => ok({ status: "ready", provider: "quickbooks", account_name: "Sample Books LLC", company_name: KINGDOM.company.name });

function render(path = `/settings/connections?pending=${ID}`) {
  return renderWithHub(<ConnectionsCatalog company={hub.company!} />, hub, { path, pattern: "/settings/connections" });
}

beforeEach(() => {
  fake.rows = KINGDOM.connections.map((c) => ({ ...c }));
});

describe("refusals on the confirm step and Disconnect", () => {
  it("never shows the text a refused Connect carried: a 500 reads as the fallback and leaves Connect to try again", async () => {
    const user = userEvent.setup();
    answer({ "connections/pending": ready, "connections/finish": () => refused(500) });
    render();
    const panel = await screen.findByRole("dialog", { name: "Confirm the connection" });
    await user.click(await within(panel).findByRole("button", { name: "Connect" }));
    expect(await within(panel).findByText(FALLBACK)).toBeInTheDocument();
    expect(screen.queryByText(RAW, { exact: false })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Connect" })).not.toBeDisabled();
  });

  it("reads a 410 as expired and a 403 as someone else's, whatever text came with them", async () => {
    const user = userEvent.setup();
    answer({ "connections/pending": ready, "connections/finish": () => refused(410) });
    const { unmount } = render();
    let panel = await screen.findByRole("dialog", { name: "Confirm the connection" });
    await user.click(await within(panel).findByRole("button", { name: "Connect" }));
    expect(await within(panel).findByText(PENDING_GONE)).toBeInTheDocument();
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual(["Close"]);
    expect(screen.queryByText(RAW, { exact: false })).not.toBeInTheDocument();
    unmount();

    answer({ "connections/pending": ready, "connections/discard": () => refused(403) });
    render();
    panel = await screen.findByRole("dialog", { name: "Confirm the connection" });
    await user.click(await within(panel).findByRole("button", { name: "Cancel" }));
    expect(await within(panel).findByText(PENDING_SOMEONE_ELSE)).toBeInTheDocument();
    expect(screen.queryByText(RAW, { exact: false })).not.toBeInTheDocument();
  });

  it("never shows the text a refused read carried", async () => {
    answer({ "connections/pending": () => refused(502) });
    render();
    const panel = await screen.findByRole("dialog", { name: "Confirm the connection" });
    expect(await within(panel).findByText(FALLBACK)).toBeInTheDocument();
    expect(screen.queryByText(RAW, { exact: false })).not.toBeInTheDocument();
  });

  it("never shows the text a refused Disconnect carried", async () => {
    const user = userEvent.setup();
    answer({ "connections/disconnect": () => refused(502) });
    render("/settings/connections");
    await user.click(within(await screen.findByRole("article", { name: "GoHighLevel" })).getByRole("button", { name: "Manage GoHighLevel" }));
    const panel = await screen.findByRole("dialog", { name: "GoHighLevel" });
    await user.click(within(panel).getByRole("button", { name: "Disconnect" }));
    await user.click(within(panel).getByRole("button", { name: "Disconnect for everyone at Kingdom Custom Construction" }));
    await waitFor(() => expect(within(panel).getByText(FALLBACK)).toBeInTheDocument());
    expect(screen.queryByText(RAW, { exact: false })).not.toBeInTheDocument();
  });
});
