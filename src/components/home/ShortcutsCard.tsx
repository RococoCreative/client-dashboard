// The Home card that points at each working section's first page, read from the same registry
// the sidebar uses (navFor, sectionShortcuts), so the two can never disagree. A flat sidebar has
// no sections, so the card renders nothing there. With external links on, the company's links to
// its own outside tools sit below, grouped by section; this is the only place Home and People / HR
// links appear. Who reads each link is RLS's decision, so every returned link is listed. No embeds.
import { useId } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import ExternalLinkButton from "../links/ExternalLinkButton.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { hasModule } from "../../lib/modules.ts";
import { NAV_GROUP_LABELS, navFor, sectionShortcuts } from "../../lib/navigation.ts";
import { listExternalLinks } from "../../services/externalLinks.ts";
import type { Company, ExternalLink, LinkNavGroup } from "../../types/database.ts";

const LINK_GROUPS: readonly LinkNavGroup[] = ["home", "sales_finance", "production", "people_hr"];

function LinkGroup({ group, links }: { group: LinkNavGroup; links: ExternalLink[] }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId}>
      <p id={headingId} className="eyebrow">{NAV_GROUP_LABELS[group]}</p>
      <ul className="mt-2 space-y-2">
        {links.map((link) => (
          <li key={link.id}>
            <ExternalLinkButton link={link} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExternalLinkGroups({ companyId }: { companyId: string }) {
  const state = useAsync(() => listExternalLinks(companyId), [companyId]);
  if (state.error && !state.data) return <Notice tone="error" className="m-5">{state.error}</Notice>;
  const links = state.data ?? [];
  const groups = LINK_GROUPS.map((group) => ({ group, links: links.filter((link) => link.nav_group === group) })).filter((g) => g.links.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-4 border-t border-line px-5 py-4">
      {groups.map((g) => (
        <LinkGroup key={g.group} group={g.group} links={g.links} />
      ))}
    </div>
  );
}

export default function ShortcutsCard({ company, isAdmin, isRococo }: { company: Company; isAdmin: boolean; isRococo: boolean }) {
  const shortcuts = sectionShortcuts(navFor(company, isAdmin, isRococo));
  if (shortcuts.length === 0) return null;
  return (
    <Section eyebrow="Shortcuts" title="Sections" padded={false}>
      <ul className="divide-y divide-line">
        {shortcuts.map((shortcut) => (
          <li key={shortcut.group}>
            <Link
              to={shortcut.to}
              className="group flex items-center justify-between gap-3 px-5 py-2.5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-2/60 hover:text-accent"
            >
              {shortcut.heading}
              <ArrowRight size={14} aria-hidden className="shrink-0 text-ink-3 transition-colors duration-150 group-hover:text-accent" />
            </Link>
          </li>
        ))}
      </ul>
      {hasModule(company, "external_links") ? <ExternalLinkGroups companyId={company.id} /> : null}
    </Section>
  );
}
