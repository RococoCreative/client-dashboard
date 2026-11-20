// GSRs' tabs, each its own route so a link can land on one: the monthly periods, and the setup
// behind them (the focus topic calendar and how many goals each GSR requires). Kept out of the page
// files so each exports only its component, which Fast Refresh relies on. Only an admin reaches
// the Setup tab. A company whose GSRs are on demand has no periods: there the first tab holds the
// GSRs log and reads GSRs; a company on periods reads exactly what it always has.
import type { TabItem } from "../../components/ui/Tabs.tsx";
import type { GsrMode } from "../../types/database.ts";

export type GsrTab = "periods" | "setup";

export const GSR_TABS: Array<TabItem & { key: GsrTab }> = [
  { key: "periods", to: "/gsr", label: "Periods", end: true },
  { key: "setup", to: "/gsr/setup", label: "Setup" },
];

export function gsrTabsFor(mode: GsrMode): Array<TabItem & { key: GsrTab }> {
  return mode === "on_demand" ? GSR_TABS.map((tab) => (tab.key === "periods" ? { ...tab, label: "GSRs" } : tab)) : GSR_TABS;
}
