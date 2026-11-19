// Reviews' tabs, each its own route so a link can land on one: the cycles, and the setup behind
// them (pillars, weights, criteria and deliverable categories). Kept out of the page files so each
// exports only its component, which Fast Refresh relies on. Only an admin reaches either tab.
import type { TabItem } from "../../components/ui/Tabs.tsx";

export type ReviewsTab = "cycles" | "setup";

export const REVIEWS_TABS: Array<TabItem & { key: ReviewsTab }> = [
  { key: "cycles", to: "/reviews", label: "Cycles", end: true },
  { key: "setup", to: "/reviews/setup", label: "Setup" },
];
