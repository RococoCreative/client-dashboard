// Tab strip shared by the Sales & Finance pages: reporting and the QuickBooks controls. Kept out
// of the page files so each of them exports only its component, which Fast Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";

export const SALES_FINANCE_TABS: TabItem[] = [
  { to: "/sales-finance", label: "Reporting", end: true },
  { to: "/sales-finance/controls", label: "Controls" },
];
