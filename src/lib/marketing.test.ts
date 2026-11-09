// Live campaign budget totals, read the same way by every screen that shows them.
import { describe, expect, it } from "vitest";
import { liveCampaignTotals } from "./marketing.ts";

describe("liveCampaignTotals", () => {
  it("adds budget and spend over the same live campaigns and counts the unbudgeted apart", () => {
    const totals = liveCampaignTotals([
      { status: "active", budget: 12000, actual_spend: 7400 },
      { status: "paused", budget: 5000, actual_spend: 2100 },
      { status: "active", budget: null, actual_spend: 8000 },
      { status: "active", budget: 1000, actual_spend: null },
      { status: "planned", budget: 8500, actual_spend: 0 },
      { status: "complete", budget: 1500, actual_spend: 1650 },
    ]);
    expect(totals.live).toHaveLength(4);
    expect(totals.unbudgeted).toBe(1);
    expect(totals.budget).toBe(18000);
    // The unbudgeted campaign's 8,000 is left out, so this never reads as over budget.
    expect(totals.spend).toBe(9500);
  });

  it("is all zeros with nothing live", () => {
    expect(liveCampaignTotals([{ status: "planned", budget: 100, actual_spend: 0 }])).toEqual({ live: [], unbudgeted: 0, budget: 0, spend: 0 });
  });
});
