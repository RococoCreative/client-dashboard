// Resources: the one place people go for how the company works and where the work lives. Three
// tabs, each its own route: SOPs (the SOP library), Files & media (templates, documents, videos),
// and Links (the programs the team works in), which shows when the company carries the external
// links module (rule 12: the module decides, never the company's name). Everyone reads every tab;
// admins add and edit, and on Links an admin gets the editor in place of the list.
import { Navigate, useLocation } from "react-router-dom";
import ExternalLinksPanel from "../../components/links/ExternalLinksPanel.tsx";
import LinkGroups from "../../components/links/LinkGroups.tsx";
import FilesPanel from "../../components/resources/FilesPanel.tsx";
import SopsPanel from "../../components/resources/SopsPanel.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import PanelHeader from "../../components/ui/PanelHeader.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { hasModule } from "../../lib/modules.ts";
import { listExternalLinks } from "../../services/externalLinks.ts";
import { resourcesTabsFor, type ResourcesTab } from "./resourcesTabs.ts";

// The read-only Links tab: every link the person may see, in its categories.
function LinksDirectory({ companyId }: { companyId: string }) {
  const state = useAsync(() => listExternalLinks(companyId), [companyId]);
  return (
    <>
      <PanelHeader
        eyebrow="Where the work lives"
        title="Links"
        description="The programs the team works in, each opening in a new tab. Sign in to each tool as usual."
      />
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={4} /> : null}
      {state.data && state.data.length === 0 ? (
        <EmptyState eyebrow="Links" title="No links yet" body="Your admins add links to the programs the team works in, such as Monday boards. They show here and on Home." />
      ) : null}
      {state.data && state.data.length > 0 ? <LinkGroups links={state.data} columns /> : null}
    </>
  );
}

export default function ResourcesPage({ tab }: { tab: ResourcesTab }) {
  const { company, isAdmin } = useHub();
  const location = useLocation();
  const current = company!;
  // Links is the module's tab; anywhere else the address lands on the SOP library.
  if (tab === "links" && !hasModule(current, "external_links")) {
    return <Navigate to={{ pathname: "/resources/sops", search: location.search }} replace />;
  }
  return (
    <>
      <PageHeader
        eyebrow={current.name}
        title="Resources"
        description={
          hasModule(current, "external_links")
            ? "How the company works and where the work lives: the SOP library, files and media, and links to the programs the team uses."
            : "How the company works: the SOP library, and the files and media the team reaches for."
        }
      />
      <Tabs items={resourcesTabsFor(current)} label="Resources" />
      {tab === "sops" ? <SopsPanel /> : null}
      {tab === "files" ? <FilesPanel /> : null}
      {tab === "links" ? isAdmin ? <ExternalLinksPanel companyId={current.id} /> : <LinksDirectory companyId={current.id} /> : null}
    </>
  );
}
