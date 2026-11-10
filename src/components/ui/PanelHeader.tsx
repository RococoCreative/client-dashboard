// The heading of one tab inside a hub page (Goals, Settings, Resources): a smaller title than the
// page's own, the line that says who it applies to and when it shows, and the tab's actions. The
// page header names the place; this names the area within it.
import type { ReactNode } from "react";

export default function PanelHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 className={`font-display text-lg text-heading ${eyebrow ? "mt-1" : ""}`}>{title}</h2>
        {description ? <p className="mt-1 max-w-2xl text-[13px] text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
