// What a company's role may do, read from data: the catalog names each power and its default
// level, a company's override row replaces that level, and meets() is the one place the app ranks
// a role against a level. The database enforces the same rule; this only decides what to show.
import type { Capability, CapabilityKey, CapabilityLevel, CompanyCapability, Role } from "../types/database.ts";
import { ROLE_RANK } from "./people.ts";

export type CapabilityMap = Record<CapabilityKey, CapabilityLevel>;

export const CAPABILITY_KEYS: readonly CapabilityKey[] = [
  "pay",
  "company_settings",
  "audit_log",
  "milestones_edit",
  "wins_post",
  "sync_run",
  "production_view",
];

// A company's row wins over the catalog default. A key the catalog does not carry stays out of
// the map, and meets() refuses a missing level, so an unknown capability is never granted.
export function resolveCapabilities(catalog: Capability[], overrides: CompanyCapability[]): CapabilityMap {
  const map: Partial<CapabilityMap> = {};
  for (const c of catalog) map[c.key] = c.default_min_role;
  for (const o of overrides) if (o.capability in map) map[o.capability] = o.min_role;
  return map as CapabilityMap;
}

// Rococo admins meet every level. A company role meets a role level when it ranks at or above it,
// and never meets "rococo". An undefined level (a capability that did not load) is refused.
export function meets(role: Role, isRococo: boolean, level: CapabilityLevel | undefined): boolean {
  if (!level) return false;
  if (isRococo) return true;
  if (level === "rococo") return false;
  return ROLE_RANK[role] >= ROLE_RANK[level];
}
