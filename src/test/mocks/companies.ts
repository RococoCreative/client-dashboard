// In-memory stand-in for services/companies.ts, same exports, so page tests and `npm run demo`
// run against the seeded companies and their domains and never touch the network.
import type { Company, CompanyDomain, ThemeKey } from "../../types/database.ts";
import { COMPANIES, DOMAINS } from "../fixtures.ts";

const companies: Company[] = COMPANIES.map((c) => ({ ...c, modules: [...c.modules] }));
const domains: CompanyDomain[] = DOMAINS.map((d) => ({ ...d }));

// The company's time zone, read live so the tasks mock counts a repeating task's next due date
// from the zone an admin set during a demo session, as recur_task does (0037).
export function timeZoneOf(companyId: string): string {
  return companies.find((c) => c.id === companyId)?.time_zone ?? "America/New_York";
}

// guard_company_time_zone, near enough: a zone the browser cannot read is refused.
function checkTimeZone(zone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new Error("That time zone is not recognized.");
  }
}

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
  const created: Company = { id: `co-${input.slug}`, logo_url: null, modules: [], time_zone: "America/New_York", created_at: now, updated_at: now, ...input };
  companies.push(created);
  return created;
}

export type CompanyPatch = Partial<Pick<Company, "name" | "logo_url" | "theme_key" | "slug" | "modules" | "time_zone">>;

export async function updateCompany(id: string, patch: CompanyPatch): Promise<Company> {
  const index = companies.findIndex((c) => c.id === id);
  if (index === -1) throw new Error("Company not found.");
  if (patch.time_zone !== undefined) checkTimeZone(patch.time_zone);
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

export async function listCompanyDomains(companyId: string): Promise<CompanyDomain[]> {
  return domains.filter((d) => d.company_id === companyId);
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
