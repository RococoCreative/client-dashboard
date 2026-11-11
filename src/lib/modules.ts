// The module gate. A company carries a raw list of module keys a Rococo admin switched on
// (companies.modules, 0024); this file is the only place that reads it, so a page asks
// hasModule(company, key) and never looks at the list itself. With no modules on, a company
// sees the standard hub.
import type { Company } from "../types/database.ts";

export const MODULE_KEYS = ["switchboard", "production", "wins", "data_sources", "external_links", "tasks"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  switchboard: "Switchboard",
  production: "Production",
  wins: "Wins",
  data_sources: "Data sources",
  external_links: "External links",
  tasks: "Tasks",
};

// One plain line each, shown under the checkbox on Rococo > Companies.
export const MODULE_DESCRIPTIONS: Record<ModuleKey, string> = {
  switchboard: "The Attention and Shortcuts cards on Home, and Freshness with data sources.",
  production: "Projects, milestones and letters, and the Production cards.",
  wins: "The wins page and the Home wins card.",
  data_sources: "Connected Google Sheets and QuickBooks sources, Sales & Finance, and data freshness.",
  external_links: "Links to outside tools, such as Monday: Resources, Links, the Home card, and each section's page.",
  tasks: "Tasks assigned to people, with due dates, steps, and repeats, and the tasks behind each marketing campaign.",
};

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

// The only reader of companies.modules. Null company (portfolio) is false. Unknown keys ignored.
export function hasModule(company: Pick<Company, "modules"> | null | undefined, key: ModuleKey): boolean {
  return (company?.modules ?? []).includes(key);
}

// The known keys a company has on, in MODULE_KEYS order.
export function enabledModules(company: Pick<Company, "modules"> | null | undefined): ModuleKey[] {
  return MODULE_KEYS.filter((key) => hasModule(company, key));
}

// Pure toggle for the Rococo checkboxes: returns a new array, keeps unknown keys untouched,
// never duplicates a key.
export function withModule(modules: readonly string[], key: ModuleKey, on: boolean): string[] {
  const rest = modules.filter((m) => m !== key);
  return on ? [...rest, key] : rest;
}
