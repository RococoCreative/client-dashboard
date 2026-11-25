// The SOP library's filters and the reader's own standing on each SOP, kept pure so the panel only
// renders. Filters live in the address (?q=&cat=&tag=&status=&show=&sort=), so a filtered view can
// be linked to and survives a reload.
import type { Sop, SopSignoff, SopStatus } from "../../types/database.ts";

export type LibraryShow = "all" | "assigned" | "unsigned";
export type LibrarySort = "updated" | "title";
export const UNCATEGORIZED = "none";

export type LibraryFilters = {
  q: string;
  cat: string; // "" all, "none" uncategorized, or a category id
  tag: string;
  status: SopStatus | "";
  show: LibraryShow;
  sort: LibrarySort;
};

export function readFilters(params: URLSearchParams): LibraryFilters {
  const status = params.get("status");
  const show = params.get("show");
  return {
    q: params.get("q") ?? "",
    cat: params.get("cat") ?? "",
    tag: params.get("tag") ?? "",
    status: status === "draft" || status === "published" || status === "archived" ? status : "",
    show: show === "assigned" || show === "unsigned" ? show : "all",
    sort: params.get("sort") === "title" ? "title" : "updated",
  };
}

// Only what differs from the defaults goes in the address.
export function writeFilters(filters: LibraryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.cat) params.set("cat", filters.cat);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.status) params.set("status", filters.status);
  if (filters.show !== "all") params.set("show", filters.show);
  if (filters.sort !== "updated") params.set("sort", filters.sort);
  return params;
}

// Where the reader stands on an SOP: signed its current version, signed an older one, or not.
export type Standing = { kind: "signed"; version: number } | { kind: "outdated"; version: number } | { kind: "none" };

export function standingOn(sop: Pick<Sop, "id" | "current_version">, signoffs: SopSignoff[]): Standing {
  const mine = signoffs.filter((s) => s.sop_id === sop.id);
  if (!mine.length) return { kind: "none" };
  const best = Math.max(...mine.map((s) => s.version));
  return best >= sop.current_version ? { kind: "signed", version: best } : { kind: "outdated", version: best };
}

export function filterSops(
  sops: Sop[],
  filters: LibraryFilters,
  ctx: { signoffs: SopSignoff[]; assignedSopIds: Set<string> },
): Sop[] {
  const tag = filters.tag.toLowerCase();
  const out = sops.filter((sop) => {
    if (filters.cat === UNCATEGORIZED ? sop.category_id !== null : filters.cat && sop.category_id !== filters.cat) return false;
    if (tag && !sop.tags.some((t) => t.toLowerCase() === tag)) return false;
    if (filters.status && sop.status !== filters.status) return false;
    if (filters.show === "assigned" && !ctx.assignedSopIds.has(sop.id)) return false;
    if (filters.show === "unsigned" && (sop.status !== "published" || standingOn(sop, ctx.signoffs).kind === "signed")) return false;
    return true;
  });
  if (filters.sort === "title") return [...out].sort((a, b) => a.title.localeCompare(b.title));
  return out;
}
