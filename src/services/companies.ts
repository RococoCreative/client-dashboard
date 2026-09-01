// Data layer for companies and their sign-in domains. Members read their own company;
// company admins may rename it and set a logo; slug, theme, domains, and creation are
// Rococo-only, enforced by RLS and the guard_company_fields trigger, not by this module.
import { db } from "./supabase.ts";
import type { Company, CompanyDomain, ThemeKey } from "../types/database.ts";

const COLUMNS = "id, slug, name, theme_key, logo_url, created_at, updated_at";
const DOMAIN_COLUMNS = "domain, company_id, created_at";

export async function listCompanies(): Promise<Company[]> {
  const { data, error } = await db().from("companies").select(COLUMNS).order("name", { ascending: true });
  if (error) throw error;
  return (data as Company[]) ?? [];
}

export async function getCompany(id: string): Promise<Company> {
  const { data, error } = await db().from("companies").select(COLUMNS).eq("id", id).single();
  if (error) throw error;
  return data as Company;
}

export async function createCompany(input: { slug: string; name: string; theme_key: ThemeKey }): Promise<Company> {
  const { data, error } = await db().from("companies").insert(input).select(COLUMNS).single();
  if (error) throw error;
  return data as Company;
}

export type CompanyPatch = Partial<Pick<Company, "name" | "logo_url" | "theme_key" | "slug">>;

export async function updateCompany(id: string, patch: CompanyPatch): Promise<Company> {
  const { data, error } = await db().from("companies").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data as Company;
}

export async function deleteCompany(id: string): Promise<void> {
  const { error } = await db().from("companies").delete().eq("id", id);
  if (error) throw error;
}

export async function listAllDomains(): Promise<CompanyDomain[]> {
  const { data, error } = await db().from("company_domains").select(DOMAIN_COLUMNS).order("domain");
  if (error) throw error;
  return (data as CompanyDomain[]) ?? [];
}

export async function addCompanyDomain(companyId: string, domain: string): Promise<CompanyDomain> {
  const { data, error } = await db()
    .from("company_domains")
    .insert({ company_id: companyId, domain })
    .select(DOMAIN_COLUMNS)
    .single();
  if (error) throw error;
  return data as CompanyDomain;
}

export async function removeCompanyDomain(domain: string): Promise<void> {
  const { error } = await db().from("company_domains").delete().eq("domain", domain);
  if (error) throw error;
}
