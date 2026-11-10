// The outside tools for one section of the hub, such as the company's Monday boards on the
// Production page. It shows whatever links the database returns: who reads each one is decided by
// RLS on its audience, never here. Nothing shows while loading or when the section has no links.
import EmbedFrame from "./EmbedFrame.tsx";
import ExternalLinkButton from "./ExternalLinkButton.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { LINK_GROUP_LABELS } from "../../lib/links.ts";
import { listExternalLinks } from "../../services/externalLinks.ts";
import type { LinkNavGroup } from "../../types/database.ts";

export default function ExternalLinksList({ companyId, navGroup }: { companyId: string; navGroup: LinkNavGroup }) {
  const state = useAsync(() => listExternalLinks(companyId, { navGroup }), [companyId, navGroup]);
  if (state.error && !state.data) return <Notice tone="error" className="mt-6">{state.error}</Notice>;
  if (!state.data || state.data.length === 0) return null;
  return (
    <Section eyebrow={LINK_GROUP_LABELS[navGroup]} title="Outside tools" className="mt-6">
      <ul className="space-y-2">
        {state.data.map((link) => (
          <li key={link.id}>
            {link.embed_is_public && link.embed_url ? <EmbedFrame link={link} /> : <ExternalLinkButton link={link} />}
          </li>
        ))}
      </ul>
    </Section>
  );
}
