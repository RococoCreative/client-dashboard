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

// What a Rococo admin reads on the Permissions page: each power as a plain sentence, and each level
// as who it lets in. The Activity tab keeps its own shorter names (AUDIT_CAPABILITY_LABELS).
export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  pay: "See pay",
  company_settings: "Change company settings",
  audit_log: "Read the change log",
  milestones_edit: "Edit milestones",
  wins_post: "Record wins",
  sync_run: "Press Sync now",
  production_view: "Open Production",
};

export const LEVEL_LABELS: Record<CapabilityLevel, string> = {
  employee: "Everyone",
  manager: "Managers and up",
  admin: "Admins and owners",
  owner: "Owners only",
  rococo: "Rococo only",
};

// The levels a capability may be set to, lowest first. Pay and settings never go below admin, the
// change log is never opened to managers or below, and Sync now has no owner-only or Rococo-only
// setting. The database accepts any of the five; this is what the page offers.
const ALLOWED_LEVELS: Record<CapabilityKey, CapabilityLevel[]> = {
  pay: ["admin", "owner"],
  company_settings: ["admin", "owner"],
  audit_log: ["admin", "owner", "rococo"],
  milestones_edit: ["employee", "manager", "admin", "owner"],
  wins_post: ["employee", "manager", "admin", "owner"],
  sync_run: ["employee", "manager", "admin"],
  production_view: ["employee", "manager", "admin", "owner"],
};

export function allowedLevels(key: CapabilityKey): CapabilityLevel[] {
  return [...ALLOWED_LEVELS[key]];
}

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
