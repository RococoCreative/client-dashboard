// The Home card that sends people from the dashboard to the programs where their work lives: the
// company's links to its outside tools, in their categories, each opening in a new tab. Shown on
// the admin and the employee dashboard when the company carries the external links module. Who
// reads each link is RLS's decision, so every returned link is listed. Managed in Resources > Links.
// Home loads the links (useHomeLinks) so it can tell an empty list apart: with none, this card
// steps aside and NoLinksLine says so in one line at the end of the page.
import { Link } from "react-router-dom";
import LinkGroups from "../links/LinkGroups.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import type { ExternalLink } from "../../types/database.ts";
import { tapTargetClass } from "../ui/tap.ts";

export default function WhereWorkLivesCard({
  links,
  error,
  isAdmin,
  className = "",
}: {
  // Null while loading, or when the load failed.
  links: ExternalLink[] | null;
  error: string;
  isAdmin: boolean;
  className?: string;
}) {
  if (links && links.length === 0) return null;
  return (
    <Section
      eyebrow="Links"
      title="Where the work lives"
      className={className}
      actions={
        <Link to="/resources/links" className={`text-[13px] font-medium text-link hover:underline ${tapTargetClass}`}>
          {isAdmin ? "Manage links" : "All links"}
        </Link>
      }
    >
      {error && !links ? <Notice tone="error">{error}</Notice> : null}
      {!links && !error ? <SkeletonRows rows={2} /> : null}
      {links ? <LinkGroups links={links} /> : null}
    </Section>
  );
}
