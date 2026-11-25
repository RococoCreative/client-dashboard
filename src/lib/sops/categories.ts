// SOP categories as a choice in a form: the company's own (0053), the starters it has not named
// yet, Uncategorized, or a name typed in. A starter or a typed name becomes a real category row
// only when an SOP is filed under it, so nothing is created speculatively. Pure.
import type { SopCategory } from "../../types/database.ts";

// Offered until a company has a category of that name. The five the library used before 0053.
export const SUGGESTED_SOP_CATEGORIES = ["Safety", "Process", "Client", "Admin", "Field"] as const;

export type CategoryChoice = { kind: "none" } | { kind: "existing"; id: string } | { kind: "new"; name: string };

export const NO_CATEGORY = "";
export const CUSTOM_CATEGORY = "custom";

export function encodeChoice(choice: CategoryChoice): string {
  if (choice.kind === "none") return NO_CATEGORY;
  return choice.kind === "existing" ? `id:${choice.id}` : `new:${choice.name}`;
}

export function decodeChoice(value: string): CategoryChoice {
  if (value.startsWith("id:")) return { kind: "existing", id: value.slice(3) };
  if (value.startsWith("new:")) return { kind: "new", name: value.slice(4) };
  return { kind: "none" };
}

// The options a category select offers: active categories in order (plus the current one even
// if retired), then starters the company lacks, marked new.
export function categoryOptions(categories: SopCategory[], currentId: string | null): Array<{ value: string; label: string }> {
  const live = categories.filter((c) => c.retired_at === null || c.id === currentId);
  const taken = new Set(categories.map((c) => c.name.trim().toLowerCase()));
  return [
    { value: NO_CATEGORY, label: "Uncategorized" },
    ...live.map((c) => ({ value: `id:${c.id}`, label: c.retired_at ? `${c.name} (retired)` : c.name })),
    ...SUGGESTED_SOP_CATEGORIES.filter((name) => !taken.has(name.toLowerCase())).map((name) => ({ value: `new:${name}`, label: `${name} (new)` })),
  ];
}

// An existing category of that name in any case, so typing "safety" files under "Safety".
export function findCategoryByName(categories: SopCategory[], name: string): SopCategory | undefined {
  const key = name.trim().toLowerCase();
  return categories.find((c) => c.name.trim().toLowerCase() === key);
}

// Where a new category goes in the order: after the last one.
export function nextSortOrder(categories: SopCategory[]): number {
  return categories.reduce((max, c) => Math.max(max, c.sort_order), 0) + 1;
}
