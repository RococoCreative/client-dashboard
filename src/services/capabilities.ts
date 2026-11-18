// Data layer for capabilities: the catalog plus one company's overrides, merged into the map the
// hub answers can() from. Both tables are readable by a company's members (0040); writes are not
// here. Throws on error; the caller decides what to say.
import type { Capability, CompanyCapability } from "../types/database.ts";
import { resolveCapabilities, type CapabilityMap } from "../lib/capabilities.ts";
import { db } from "./supabase.ts";

export async function loadCapabilities(companyId: string): Promise<CapabilityMap> {
  const [catalog, overrides] = await Promise.all([
    db().from("capabilities").select("key, default_min_role, sort_order").order("sort_order", { ascending: true }),
    db().from("company_capabilities").select("id, company_id, capability, min_role").eq("company_id", companyId),
  ]);
  if (catalog.error) throw catalog.error;
  if (overrides.error) throw overrides.error;
  return resolveCapabilities((catalog.data as Capability[]) ?? [], (overrides.data as CompanyCapability[]) ?? []);
}
