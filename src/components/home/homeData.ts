// What both Home layouts read the same way: the modules a person's own job role carries, and the
// company's links with the rule for when an empty list gives way to one line. Kept apart from the
// layouts so each of those files exports only its component.
import { useAsync } from "../../hooks/useAsync.ts";
import { listEmployeeFinancials } from "../../services/employees.ts";
import { listJobRoles } from "../../services/jobRoles.ts";
import { listExternalLinks } from "../../services/externalLinks.ts";
import { hasModule } from "../../lib/modules.ts";
import type { Company, EmployeeFinancial, ExternalLink, Profile } from "../../types/database.ts";

// The modules a person's job role puts on their dashboard. Active roles only: a retired role
// stays on the person's record but adds nothing. A person with no role skips both reads.
export async function loadOwnModules(companyId: string, profile: Pick<Profile, "id" | "job_role_id">, year: number) {
  if (!profile.job_role_id) return { jobRole: null, financials: [] as EmployeeFinancial[] };
  const [jobRoles, financials] = await Promise.all([listJobRoles(companyId), listEmployeeFinancials(companyId, profile.id, year)]);
  return { jobRole: jobRoles.find((r) => r.id === profile.job_role_id) ?? null, financials };
}

// The company's links, for the Where the work lives card, loaded here so Home can tell an empty
// list apart: a card with links stays where it always was, and an empty list is one line at the
// end of the page. Without the module nothing is read.
export function useHomeLinks(company: Company) {
  const withLinks = hasModule(company, "external_links");
  return useAsync(() => (withLinks ? listExternalLinks(company.id) : Promise.resolve(null)), [company.id, withLinks]);
}

export function noLinks(company: Company, links: ExternalLink[] | null): boolean {
  return hasModule(company, "external_links") && links !== null && links.length === 0;
}
