// Page title block: optional back link, eyebrow, display title, one-line description, and
// the page's primary actions on the right.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backTo,
  backLabel,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {backTo ? (
          <Link
            to={backTo}
            className="mb-3 inline-flex items-center gap-1 text-[12px] text-ink-2 transition-colors duration-150 hover:text-ink"
          >
            <ArrowLeft size={13} aria-hidden /> {backLabel ?? "Back"}
          </Link>
        ) : null}
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="mt-1 font-display text-3xl tracking-display text-heading">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
