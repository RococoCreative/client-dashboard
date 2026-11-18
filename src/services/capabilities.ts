// Data layer for capabilities: the catalog plus one company's overrides, merged into the map the
// hub answers can() from, and the override rows themselves, which the company Activity tab reads
// to name the capability an edit was about. Both tables are readable by a company's members (0040).
// Only a Rococo admin writes override rows (0040 RLS): the Permissions page sets or clears one
// company's level here, and reads every company's rows back. Throws on error; the caller decides
// what to say.
import type { Capability, CapabilityKey, CapabilityLevel, CompanyCapability } from "../types/database.ts";
import { resolveCapabilities, type CapabilityMap } from "../lib/capabilities.ts";
import { requireRows } from "../lib/errors.ts";
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

export async function listCompanyCapabilities(companyId: string): Promise<CompanyCapability[]> {
  const { data, error } = await db()
    .from("company_capabilities")
    .select("id, company_id, capability, min_role")
    .eq("company_id", companyId);
  if (error) throw error;
  return (data as CompanyCapability[]) ?? [];
}

export async function listCapabilityCatalog(): Promise<Capability[]> {
  const { data, error } = await db()
    .from("capabilities")
    .select("key, default_min_role, sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data as Capability[]) ?? [];
}

// Every company's override rows; RLS decides what the caller may see (a Rococo admin sees all).
export async function listAllCompanyCapabilities(): Promise<CompanyCapability[]> {
  const { data, error } = await db().from("company_capabilities").select("id, company_id, capability, min_role");
  if (error) throw error;
  return (data as CompanyCapability[]) ?? [];
}

// Returns the row as stored, so the caller shows what the database holds, not what it asked for.
export async function setCompanyCapability(
  companyId: string,
  capability: CapabilityKey,
  level: CapabilityLevel,
): Promise<CompanyCapability> {
  const { data, error } = await db()
    .from("company_capabilities")
    .upsert({ company_id: companyId, capability, min_role: level }, { onConflict: "company_id,capability" })
    .select("id, company_id, capability, min_role")
    .single();
  if (error) throw error;
  return requireRows(data ? [data as CompanyCapability] : [])[0];
}

// Back to the catalog default. A row that is already gone is not an error, and a delete that
// removes nothing returns no error either, so the caller reads the rows back to see what is stored.
export async function clearCompanyCapability(companyId: string, capability: CapabilityKey): Promise<void> {
  const { error } = await db().from("company_capabilities").delete().eq("company_id", companyId).eq("capability", capability);
  if (error) throw error;
}
