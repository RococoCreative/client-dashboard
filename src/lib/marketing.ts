// Live campaign budget totals, in one place so the Marketing board, the company dashboard and
// the Rococo portfolio card never disagree. Spend against budget only means something when
// both sides cover the same campaigns: a campaign with no budget recorded, counted as zero
// budget with its spend in full, pushed the figure over 100% of a total that did not include
// it. It is left out of both instead and counted on its own, because a campaign with no budget
// is real data and not a zero.
import type { MarketingCampaign } from "../types/database.ts";

type CampaignMoney = Pick<MarketingCampaign, "status" | "budget" | "actual_spend">;

export interface LiveCampaignTotals<T extends CampaignMoney> {
  // Active and paused campaigns.
  live: T[];
  // Live campaigns with no budget set, left out of both totals.
  unbudgeted: number;
  budget: number;
  spend: number;
}

export function liveCampaignTotals<T extends CampaignMoney>(campaigns: T[]): LiveCampaignTotals<T> {
  const live = campaigns.filter((c) => c.status === "active" || c.status === "paused");
  const budgeted = live.filter((c) => c.budget !== null);
  return {
    live,
    unbudgeted: live.length - budgeted.length,
    budget: budgeted.reduce((sum, c) => sum + (c.budget ?? 0), 0),
    spend: budgeted.reduce((sum, c) => sum + (c.actual_spend ?? 0), 0),
  };
}
