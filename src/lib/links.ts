// How a company's links to its outside tools are grouped for reading: one category per link
// (external_links.nav_group, 0031), in a fixed order, each sorted by the order an admin set and
// then by label. The category also decides which section page repeats the link (Sales & Finance,
// Production); General links show on Home and Resources only. Shared by every screen that lists
// links, so Resources, Home and the admin panel always agree.
import type { ExternalLink, LinkNavGroup } from "../types/database.ts";

export const LINK_GROUPS: readonly LinkNavGroup[] = ["home", "sales_finance", "production", "people_hr"];

export const LINK_GROUP_LABELS: Record<LinkNavGroup, string> = {
  home: "General",
  sales_finance: "Sales & Finance",
  production: "Production",
  people_hr: "People",
};

export function byLinkOrder(a: ExternalLink, b: ExternalLink): number {
  return a.sort_order - b.sort_order || a.label.localeCompare(b.label);
}

// The links in their categories, empty categories left out.
export function groupLinks(links: readonly ExternalLink[]): Array<{ group: LinkNavGroup; links: ExternalLink[] }> {
  return LINK_GROUPS.map((group) => ({ group, links: links.filter((link) => link.nav_group === group).sort(byLinkOrder) })).filter((g) => g.links.length > 0);
}
