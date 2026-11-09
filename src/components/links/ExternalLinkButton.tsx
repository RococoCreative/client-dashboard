// One link to a company's own outside tool, as a quiet bordered row that says where it goes and
// that it opens in a new tab. The hub never signs anyone in to that tool: its own sign-in applies.
import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import { LINK_PROVIDER_LABELS, type ExternalLink } from "../../types/database.ts";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function ExternalLinkButton({ link }: { link: ExternalLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${link.label}, opens in a new tab`}
      className="group flex items-start justify-between gap-3 rounded-md border border-line px-3 py-2 transition-colors duration-150 hover:border-line-strong"
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink transition-colors duration-150 group-hover:text-accent">{link.label}</span>
          <Badge tone="neutral">{LINK_PROVIDER_LABELS[link.provider]}</Badge>
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-ink-3">
          <span className="break-all">{hostOf(link.url)}</span>
          <span>Opens in a new tab</span>
        </span>
        {link.destination_note ? <span className="mt-0.5 block text-[12.5px] text-ink-2">{link.destination_note}</span> : null}
      </span>
      <ExternalLinkIcon size={14} aria-hidden className="mt-1 shrink-0 text-ink-3 transition-colors duration-150 group-hover:text-accent" />
    </a>
  );
}
