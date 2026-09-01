// Data layer for the marketing campaign tracker. Admin-only by RLS.
import { db } from "./supabase.ts";
import type { CampaignStatus, MarketingCampaign } from "../types/database.ts";

const COLUMNS =
  "id, company_id, name, channel, status, start_date, end_date, budget, actual_spend, goal, key_metric_label, key_metric_value, results, notes, sort_order, created_by, created_at, updated_at";

export async function listCampaigns(companyId: string): Promise<MarketingCampaign[]> {
  const { data, error } = await db()
    .from("marketing_campaigns")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .order("sort_order")
    .order("start_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data as MarketingCampaign[]) ?? [];
}

export type CampaignInput = {
  company_id: string;
  name: string;
  status?: CampaignStatus;
  channel?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  budget?: number | null;
  actual_spend?: number | null;
  goal?: string | null;
  key_metric_label?: string | null;
  key_metric_value?: number | null;
  results?: string | null;
  notes?: string | null;
  sort_order?: number;
};

export async function createCampaign(input: CampaignInput): Promise<MarketingCampaign> {
  const { data, error } = await db().from("marketing_campaigns").insert(input).select(COLUMNS).single();
  if (error) throw error;
  return data as MarketingCampaign;
}

export async function updateCampaign(id: string, patch: Partial<Omit<CampaignInput, "company_id">>): Promise<MarketingCampaign> {
  const { data, error } = await db().from("marketing_campaigns").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data as MarketingCampaign;
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await db().from("marketing_campaigns").delete().eq("id", id);
  if (error) throw error;
}
