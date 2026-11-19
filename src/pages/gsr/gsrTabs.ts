// GSRs' tabs, each its own route so a link can land on one: the GSR periods at every rhythm, and the setup
// behind them (the focus topic calendar and how many goals each GSR requires). Kept out of the page
// files so each exports only its component, which Fast Refresh relies on. Only an admin reaches
// the Setup tab.
import type { TabItem } from "../../components/ui/Tabs.tsx";

export type GsrTab = "periods" | "setup";

export const GSR_TABS: Array<TabItem & { key: GsrTab }> = [
  { key: "periods", to: "/gsr", label: "Periods", end: true },
  { key: "setup", to: "/gsr/setup", label: "Setup" },
];
