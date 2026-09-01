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
}: {
  title?: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  const hasHeader = Boolean(title || eyebrow || actions);
  return (
    <section className={`rounded-lg border border-line bg-surface shadow-xs ${className}`}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className={`font-display text-lg text-heading ${eyebrow ? "mt-1" : ""}`}>{title}</h2> : null}
            {description ? <p className="mt-1 text-[13px] text-ink-2">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}
