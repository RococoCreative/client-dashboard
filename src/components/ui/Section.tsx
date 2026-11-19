// A titled card: the page-building block. Eyebrow and title on the left, actions on the
// right, content below. Surface, hairline, generous but dense padding.
import type { ReactNode } from "react";

export default function Section({
  title,
  eyebrow,
  description,
  actions,
  children,
  className = "",
  padded = true,
  flush = false,
}: {
  title?: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  // Pads the body on the sides and bottom but not the top, so a list can sit directly under the
  // header rule. Off by default; ignored when the body is not padded.
  flush?: boolean;
}) {
  const hasHeader = Boolean(title || eyebrow || actions);
  return (
    <section className={`rounded-lg border border-line bg-surface shadow-xs ${className}`}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
          <div className="min-w-0">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className={`font-display text-lg text-heading ${eyebrow ? "mt-1" : ""}`}>{title}</h2> : null}
            {description ? <p className="mt-1 text-[13px] text-ink-2">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className={padded ? (flush ? "p-4 pt-0 sm:p-6 sm:pt-0" : "p-4 sm:p-6") : ""}>{children}</div>
    </section>
  );
}
