// The real auth gate against the mocked data layer, with the app shell swapped for a probe that
// records what the hub says on every render. It proves the gate holds the app back until the
// active company's capabilities are in, offers a retry when they fail, loads again on a company
// switch without a single render on the old company's map, and that a member's can() never
// reaches into another company's configuration.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", async () => {
  const mock = await import("../test/mocks/companies.ts");
  return { ...mock, getCompany: vi.fn(mock.getCompany) };
});
vi.mock("../services/capabilities.ts", async () => {
  const mock = await import("../test/mocks/capabilities.ts");
  return { ...mock, loadCapabilities: vi.fn(mock.loadCapabilities) };
});
vi.mock("../components/AppLayout.tsx", async () => {
  const { useHub } = await import("../context/HubContext.tsx");
  return {
    default: function ProbeLayout() {
      const { company, can, setActiveCompanyId } = useHub();
      switchCompany = setActiveCompanyId;
      probeLog.push({ company: company?.id ?? null, wins: can("wins_post") });
      return (
        <div>
          <p data-testid="probe">{`${company?.id ?? "portfolio"}:${can("wins_post")}`}</p>
          <button onClick={() => setActiveCompanyId("co-klasik")}>Enter Klasik</button>
          <button onClick={() => setActiveCompanyId("co-kingdom")}>Enter Kingdom</button>
        </div>
      );
    },
  };
});

import App from "../App.tsx";
import { loadCapabilities } from "../services/capabilities.ts";
import { getCompany } from "../services/companies.ts";
import { COMPANIES } from "../test/fixtures.ts";
import { CAPABILITY_KEYS } from "../lib/capabilities.ts";
import { mockCapabilityMap, setMockCapabilities } from "../test/mocks/capabilities.ts";

let switchCompany: (id: string | null) => void = () => undefined;
const probeLog: Array<{ company: string | null; wins: boolean }> = [];
const load = vi.mocked(loadCapabilities);
const realLoad = load.getMockImplementation()!;
const realGetCompany = vi.mocked(getCompany).getMockImplementation()!;

function signInAs(persona: string) {
  window.history.pushState({}, "", `/?persona=${persona}&company=klasik`);
}

beforeEach(() => {
  probeLog.length = 0;
  load.mockReset();
  load.mockImplementation(realLoad);
  vi.mocked(getCompany).mockReset();
  vi.mocked(getCompany).mockImplementation(realGetCompany);
});

describe("capabilities in the app", () => {
  it("does not render the app until the active company's capabilities have loaded", async () => {
    let release!: (map: Awaited<ReturnType<typeof loadCapabilities>>) => void;
    load.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    signInAs("admin");
    render(<App />);

    await waitFor(() => expect(load).toHaveBeenCalledWith("co-klasik"));
    expect(screen.getByText("Loading your company")).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
    expect(probeLog).toEqual([]);

    await act(async () => release(mockCapabilityMap("co-klasik")));
    expect(await screen.findByTestId("probe")).toHaveTextContent("co-klasik:true");
  });

  it("shows the retry card when capabilities fail to load, and grants nothing", async () => {
    load.mockRejectedValueOnce(new Error("offline"));
    signInAs("admin");
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Could not load your company" })).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
    expect(probeLog).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("probe")).toHaveTextContent("co-klasik:true");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads capabilities when a Rococo admin switches company, with no render on the old map", async () => {
    setMockCapabilities("co-klasik", { wins_post: "employee" });
    let releaseKingdom!: (map: Awaited<ReturnType<typeof loadCapabilities>>) => void;
    load.mockImplementation((companyId) =>
      companyId === "co-kingdom" ? new Promise((resolve) => (releaseKingdom = resolve)) : realLoad(companyId),
    );
    signInAs("rococo");
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByTestId("probe")).toHaveTextContent("portfolio:true");
    expect(load).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Enter Klasik" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("co-klasik:true"));
    expect(load).toHaveBeenCalledWith("co-klasik");

    const rendersBeforeSwitch = probeLog.length;
    await user.click(screen.getByRole("button", { name: "Enter Kingdom" }));
    expect(await screen.findByText("Loading your company")).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
    expect(probeLog.slice(rendersBeforeSwitch).some((r) => r.company === "co-kingdom")).toBe(false);

    await act(async () => releaseKingdom(mockCapabilityMap("co-kingdom")));
    expect(await screen.findByTestId("probe")).toHaveTextContent("co-kingdom:true");
    expect(load).toHaveBeenCalledWith("co-kingdom");
  });

  it("keeps a company member's can() false for another company's map", async () => {
    // The member's profile says Klasik while the company that loads is Kingdom, whose map is as
    // lenient as it gets. Only the member's own company counts, so nothing is granted.
    vi.mocked(getCompany).mockImplementation(async () => COMPANIES.find((c) => c.id === "co-kingdom")!);
    setMockCapabilities("co-kingdom", Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, "employee"])));
    signInAs("owner");
    render(<App />);
    expect(await screen.findByTestId("probe")).toHaveTextContent("co-kingdom:false");
    expect(probeLog.every((r) => r.wins === false)).toBe(true);
  });

  it("ignores an earlier load that resolves after a later one for the same company", async () => {
    // Klasik, then Kingdom, then Klasik again; the first Klasik response arrives last and carries
    // a map that grants nothing. The active load's map must stand.
    let releaseFirst!: (map: Awaited<ReturnType<typeof loadCapabilities>>) => void;
    let calls = 0;
    load.mockImplementation((companyId) =>
      companyId === "co-klasik" && ++calls === 1 ? new Promise((resolve) => (releaseFirst = resolve)) : realLoad(companyId),
    );
    signInAs("rococo");
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Enter Klasik" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    await act(async () => switchCompany("co-kingdom"));
    expect(await screen.findByTestId("probe")).toHaveTextContent("co-kingdom:true");
    await act(async () => switchCompany("co-klasik"));
    expect(await screen.findByTestId("probe")).toHaveTextContent("co-klasik:true");

    await act(async () => releaseFirst({} as Awaited<ReturnType<typeof loadCapabilities>>));
    expect(screen.getByTestId("probe")).toHaveTextContent("co-klasik:true");
    expect(probeLog.every((r) => r.wins === true)).toBe(true);
  });
});

describe("capabilities when the tab returns", () => {
  function comeBack() {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("reloads the active company's map without a loading screen, at most once every 30 seconds", async () => {
    signInAs("admin");
    render(<App />);
    expect(await screen.findByTestId("probe")).toHaveTextContent("co-klasik:true");
    expect(load).toHaveBeenCalledTimes(1);

    setMockCapabilities("co-klasik", { wins_post: "owner" });
    vi.setSystemTime(Date.now() + 31_000);
    const rendersBefore = probeLog.length;
    await act(async () => comeBack());
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("co-klasik:false"));
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Loading your company")).not.toBeInTheDocument();
    expect(probeLog.slice(rendersBefore).every((r) => r.company === "co-klasik")).toBe(true);

    setMockCapabilities("co-klasik", { wins_post: "employee" });
    vi.setSystemTime(Date.now() + 5_000);
    await act(async () => comeBack());
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("probe")).toHaveTextContent("co-klasik:false");
  });

  it("keeps the current map when the reload fails, and does nothing on the portfolio", async () => {
    signInAs("rococo");
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByTestId("probe")).toHaveTextContent("portfolio:true");
    vi.setSystemTime(Date.now() + 31_000);
    await act(async () => comeBack());
    expect(load).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Enter Klasik" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("co-klasik:true"));
    load.mockRejectedValueOnce(new Error("offline"));
    vi.setSystemTime(Date.now() + 31_000);
    await act(async () => comeBack());
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("probe")).toHaveTextContent("co-klasik:true");
    expect(screen.queryByText("Could not load your company")).not.toBeInTheDocument();
  });
});
