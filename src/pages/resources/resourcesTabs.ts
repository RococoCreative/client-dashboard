// Resources' tabs, each its own route so a link can land on one: the SOP library, the files and
// media library, and, for a company with the external links module, the links to the programs
// where the work lives. Kept out of the page file so it exports only its component, which Fast
// Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";
import { hasModule } from "../../lib/modules.ts";
import type { Company } from "../../types/database.ts";

export type ResourcesTab = "sops" | "files" | "links";

const ALL: Array<TabItem & { key: ResourcesTab }> = [
  { key: "sops", to: "/resources/sops", label: "SOPs" },
  { key: "files", to: "/resources/files", label: "Files & media" },
  { key: "links", to: "/resources/links", label: "Links" },
];

export function resourcesTabsFor(company: Pick<Company, "modules">): Array<TabItem & { key: ResourcesTab }> {
  return ALL.filter((tab) => tab.key !== "links" || hasModule(company, "external_links"));
}
