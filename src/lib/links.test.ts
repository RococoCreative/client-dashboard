// Pins how links are grouped for reading: the fixed category order, General first, each sorted by
// the order an admin set and then by label, with empty categories left out.
import { describe, expect, it } from "vitest";
import type { ExternalLink, LinkNavGroup } from "../types/database.ts";
import { LINK_GROUP_LABELS, groupLinks } from "./links.ts";

function link(id: string, nav_group: LinkNavGroup, sort_order: number, label = id): ExternalLink {
  return {
    id, company_id: "co-1", nav_group, label, destination_note: null, url: `https://example.com/${id}`, provider: "other",
    embed_url: null, embed_is_public: false, audience: "everyone", sort_order, created_by: null, updated_by: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("groupLinks", () => {
  it("orders categories General, Sales & Finance, Production, People and drops empty ones", () => {
    const groups = groupLinks([link("a", "production", 1), link("b", "home", 2), link("c", "people_hr", 1)]);
    expect(groups.map((g) => LINK_GROUP_LABELS[g.group])).toEqual(["General", "Production", "People"]);
  });

  it("sorts within a category by order, then label", () => {
    const groups = groupLinks([link("x", "home", 2, "Zeta"), link("y", "home", 1, "Beta"), link("z", "home", 1, "Alpha")]);
    expect(groups[0].links.map((l) => l.label)).toEqual(["Alpha", "Beta", "Zeta"]);
  });

  it("is empty with no links", () => {
    expect(groupLinks([])).toEqual([]);
  });
});
