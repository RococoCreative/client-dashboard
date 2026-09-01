import type { Company, CompanyDomain, ThemeKey } from "../../types/database.ts";
import { COMPANIES, DOMAINS } from "../fixtures.ts";

const companies: Company[] = COMPANIES.map((c) => ({ ...c }));
const domains: CompanyDomain[] = DOMAINS.map((d) => ({ ...d }));

export async function listCompanies(): Promise<Company[]> {
  return [...companies].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCompany(id: string): Promise<Company> {
  const found = companies.find((c) => c.id === id);
  if (!found) throw new Error("Company not found.");
  return found;
}

export async function createCompany(input: { slug: string; name: string; theme_key: ThemeKey }): Promise<Company> {
  const now = new Date().toISOString();
  const created: Company = { id: `co-${input.slug}`, logo_url: null, created_at: now, updated_at: now, ...input };
  companies.push(created);
  return created;
}

export type CompanyPatch = Partial<Pick<Company, "name" | "logo_url" | "theme_key" | "slug">>;

export async function updateCompany(id: string, patch: CompanyPatch): Promise<Company> {
  const index = companies.findIndex((c) => c.id === id);
  if (index === -1) throw new Error("Company not found.");
  companies[index] = { ...companies[index], ...patch, updated_at: new Date().toISOString() };
  return companies[index];
}

export async function deleteCompany(id: string): Promise<void> {
  const index = companies.findIndex((c) => c.id === id);
  if (index !== -1) companies.splice(index, 1);
}

export async function listAllDomains(): Promise<CompanyDomain[]> {
  return [...domains];
}

export async function addCompanyDomain(companyId: string, domain: string): Promise<CompanyDomain> {
  const created = { company_id: companyId, domain, created_at: new Date().toISOString() };
  domains.push(created);
  return created;
}

export async function removeCompanyDomain(domain: string): Promise<void> {
  const index = domains.findIndex((d) => d.domain === domain);
  if (index !== -1) domains.splice(index, 1);
}
