import type { PublicCompany } from "../../types/database.ts";
import { COMPANIES, DOMAINS } from "../fixtures.ts";
import { db } from "./supabase.ts";

export async function lookupCompanyForEmail(email: string): Promise<PublicCompany | null> {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  const match = DOMAINS.find((d) => d.domain === domain);
  const company = match ? COMPANIES.find((c) => c.id === match.company_id) : undefined;
  return company ? { id: company.id, name: company.name, slug: company.slug, theme_key: company.theme_key, logo_url: company.logo_url } : null;
}

export async function listPublicCompanies(): Promise<PublicCompany[]> {
  return COMPANIES.map((c) => ({ id: c.id, name: c.name, slug: c.slug, theme_key: c.theme_key, logo_url: c.logo_url }));
}

export async function sendMagicLink(): Promise<void> {
  return undefined;
}

export async function signOut(): Promise<void> {
  await db().auth.signOut();
}
