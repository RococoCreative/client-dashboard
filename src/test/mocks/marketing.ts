import type { CampaignStatus, MarketingCampaign } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const campaigns = fromAll((b) => b.campaigns).map((x) => ({ ...x }));
let counter = 0;
const now = () => new Date().toISOString();

export type CampaignInput = { company_id: string; name: string; status?: CampaignStatus; channel?: string | null; start_date?: string | null; end_date?: string | null; budget?: number | null; actual_spend?: number | null; goal?: string | null; key_metric_label?: string | null; key_metric_value?: number | null; results?: string | null; notes?: string | null; sort_order?: number };

export async function listCampaigns(companyId: string): Promise<MarketingCampaign[]> {
  return campaigns.filter((c) => c.company_id === companyId);
}
export async function createCampaign(input: CampaignInput): Promise<MarketingCampaign> {
  const created: MarketingCampaign = { id: `campaign-new-${++counter}`, channel: null, status: "planned", start_date: null, end_date: null, budget: null, actual_spend: null, goal: null, key_metric_label: null, key_metric_value: null, results: null, notes: null, sort_order: 0, created_by: null, created_at: now(), updated_at: now(), ...input };
  campaigns.push(created);
  return created;
}
export async function updateCampaign(id: string, patch: Partial<Omit<CampaignInput, "company_id">>): Promise<MarketingCampaign> {
  const index = campaigns.findIndex((c) => c.id === id);
  if (index === -1) throw new Error("Campaign not found.");
  campaigns[index] = { ...campaigns[index], ...patch, updated_at: now() } as MarketingCampaign;
  return campaigns[index];
}
export async function deleteCampaign(id: string): Promise<void> {
  const index = campaigns.findIndex((c) => c.id === id);
  if (index !== -1) campaigns.splice(index, 1);
}
