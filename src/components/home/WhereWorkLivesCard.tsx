// The Home card that sends people from the dashboard to the programs where their work lives: the
// company's links to its outside tools, in their categories, each opening in a new tab. Shown on
// the admin and the employee dashboard when the company carries the external links module. Who
// reads each link is RLS's decision, so every returned link is listed. Managed in Resources > Links.
import { Link } from "react-router-dom";
import LinkGroups from "../links/LinkGroups.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listExternalLinks } from "../../services/externalLinks.ts";

export default function WhereWorkLivesCard({ companyId, isAdmin, className = "" }: { companyId: string; isAdmin: boolean; className?: string }) {
  const state = useAsync(() => listExternalLinks(companyId), [companyId]);
  const links = state.data ?? [];
  return (
    <Section
      eyebrow="Links"
      title="Where the work lives"
      className={className}
      actions={
        <Link to="/resources/links" className="text-[13px] font-medium text-accent hover:underline">
          {isAdmin ? "Manage links" : "All links"}
        </Link>
      }
    >
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={2} /> : null}
      {state.data && links.length === 0 ? (
        <p className="text-sm text-ink-2">
          {isAdmin ? (
            <>
              No links yet. Add the programs the team works in, such as Monday boards, in{" "}
              <Link to="/resources/links" className="text-accent hover:underline">Resources, Links</Link>, and they show here for everyone.
            </>
          ) : (
            "No links yet. Your admins add the programs the team works in, and they show here."
          )}
        </p>
      ) : null}
      {links.length > 0 ? <LinkGroups links={links} /> : null}
    </Section>
  );
}
