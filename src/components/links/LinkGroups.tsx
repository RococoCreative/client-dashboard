// A company's links to its outside tools, read-only, in their categories (lib/links.ts): the list
// Resources > Links shows to everyone who is not managing links, and the body of the Home card.
// It shows whatever links the database returns: who reads each one is decided by RLS on its
// audience, never here. Plain links only, no embeds, so a page of them stays light.
import { useId } from "react";
import ExternalLinkButton from "./ExternalLinkButton.tsx";
import { groupLinks, LINK_GROUP_LABELS } from "../../lib/links.ts";
import type { ExternalLink, LinkNavGroup } from "../../types/database.ts";

function Group({ group, links, columns }: { group: LinkNavGroup; links: ExternalLink[]; columns: boolean }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId}>
      <p id={headingId} className="eyebrow">{LINK_GROUP_LABELS[group]}</p>
      <ul className={`mt-2 grid gap-2 ${columns ? "sm:grid-cols-2" : ""}`}>
        {links.map((link) => (
          <li key={link.id} className="min-w-0">
            <ExternalLinkButton link={link} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LinkGroups({ links, columns = false }: { links: readonly ExternalLink[]; columns?: boolean }) {
  return (
    <div className="space-y-4">
      {groupLinks(links).map((g) => (
        <Group key={g.group} group={g.group} links={g.links} columns={columns} />
      ))}
    </div>
  );
}
