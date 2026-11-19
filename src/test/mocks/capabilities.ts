// In-memory stand-in for services/capabilities.ts, same exports, for page tests and the demo. It
// returns the catalog defaults with any per-company overrides a test set. Set and clear write the same
// store loadCapabilities reads, so a change made through the Permissions page is what a company then gets. setMockCapabilities and
// resetMockCapabilities are test-only extras; src/test/setup.ts resets after every test.
import type { Capability, CapabilityKey, CapabilityLevel, CompanyCapability } from "../../types/database.ts";
import { resolveCapabilities, type CapabilityMap } from "../../lib/capabilities.ts";

const CATALOG: Capability[] = [
  { key: "pay", default_min_role: "admin", sort_order: 1 },
  { key: "company_settings", default_min_role: "admin", sort_order: 2 },
  { key: "audit_log", default_min_role: "rococo", sort_order: 3 },
  { key: "milestones_edit", default_min_role: "admin", sort_order: 4 },
  { key: "wins_post", default_min_role: "admin", sort_order: 5 },
  { key: "sync_run", default_min_role: "admin", sort_order: 6 },
  { key: "production_view", default_min_role: "employee", sort_order: 7 },
];

const overridesByCompany = new Map<string, Partial<CapabilityMap>>();

export function setMockCapabilities(companyId: string, overrides: Partial<CapabilityMap>): void {
  overridesByCompany.set(companyId, { ...overrides });
}

export function resetMockCapabilities(): void {
  overridesByCompany.clear();
}

function overrideRows(companyId: string): CompanyCapability[] {
  return Object.entries(overridesByCompany.get(companyId) ?? {}).map(([capability, min_role]) => ({
    id: `${companyId}-${capability}`,
    company_id: companyId,
    capability: capability as CompanyCapability["capability"],
    min_role: min_role!,
  }));
}

// The same map loadCapabilities resolves, read synchronously, for the test hub's can().
export function mockCapabilityMap(companyId: string): CapabilityMap {
  return resolveCapabilities(CATALOG, overrideRows(companyId));
}

export async function loadCapabilities(companyId: string): Promise<CapabilityMap> {
  return mockCapabilityMap(companyId);
}

export async function listCompanyCapabilities(companyId: string): Promise<CompanyCapability[]> {
  return overrideRows(companyId);
}

export async function listCapabilityCatalog(): Promise<Capability[]> {
  return CATALOG.map((c) => ({ ...c }));
}

export async function listAllCompanyCapabilities(): Promise<CompanyCapability[]> {
  return [...overridesByCompany.keys()].flatMap(overrideRows);
}

export async function setCompanyCapability(companyId: string, capability: CapabilityKey, level: CapabilityLevel): Promise<CompanyCapability> {
  overridesByCompany.set(companyId, { ...overridesByCompany.get(companyId), [capability]: level });
  return { id: `${companyId}-${capability}`, company_id: companyId, capability, min_role: level };
}

export async function clearCompanyCapability(companyId: string, capability: CapabilityKey): Promise<void> {
  const next = { ...overridesByCompany.get(companyId) };
  delete next[capability];
  overridesByCompany.set(companyId, next);
}
