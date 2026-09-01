// Empty-state card: eyebrow, display heading, supporting line, optional action. Used for
// zero cycles, zero SOPs, zero resources, and quiet error surfaces.
import type { ReactNode } from "react";

export default function EmptyState({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface px-8 py-12 text-center">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 font-display text-2xl tracking-display text-heading">{title}</h2>
      {body ? <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">{body}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
