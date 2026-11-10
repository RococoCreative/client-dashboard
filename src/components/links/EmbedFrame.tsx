// A view of an outside tool shown inside the hub, only when an admin has flagged it as a public
// share view the tool's owner published. Never a signed-in view: the frame carries no referrer and
// the direct link always sits beside it, so the page can be opened in full in its own tab.
import ExternalLinkButton from "./ExternalLinkButton.tsx";
import type { ExternalLink } from "../../types/database.ts";

export default function EmbedFrame({ link }: { link: ExternalLink }) {
  if (!link.embed_is_public || !link.embed_url) return null;
  return (
    <figure className="space-y-2">
      <iframe
        src={link.embed_url}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerPolicy="no-referrer"
        loading="lazy"
        title={link.label}
        className="h-[420px] w-full rounded-md border border-line bg-surface"
      />
      <figcaption className="text-[12px] text-ink-3">Public share view</figcaption>
      <ExternalLinkButton link={link} />
    </figure>
  );
}
