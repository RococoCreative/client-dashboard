// KPI tile for dashboards: quiet label, big tabular figure, one line of context.
import type { ReactNode } from "react";

export default function Stat({
  label,
  value,
  hint,
  className = "",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-4 ${className}`}>
      <p className="text-[11px] font-medium uppercase tracking-label text-ink-3">{label}</p>
      <p className="tnum mt-2 text-2xl font-medium text-heading">{value}</p>
      {hint ? <p className="mt-1 text-[12px] text-ink-2">{hint}</p> : null}
    </div>
  );
}
