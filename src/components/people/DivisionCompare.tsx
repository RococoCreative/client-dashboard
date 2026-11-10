// The division compare strip: each division next to the whole company for one month, on the
// numbers leadership compares them by. Average optimization rate against target (each person
// against their own role's target), how many people that average covers, and how many of the
// month's reviews are complete. Shared by the dashboard and the Scorecards report; the figures
// arrive worked out (compare.ts, over lib/scorecard.ts), so this only lays them out.
import { formatMetricValue } from "../../lib/scorecard.ts";
import type { CompareRow } from "../scorecards/compare.ts";

const PERCENT = { kind: "percent", scale_max: 5 } as const;

function gapLine(gap: number | null): { text: string; tone: string } {
  if (gap === null) return { text: "No target to compare", tone: "text-ink-3" };
  const points = Math.round(Math.abs(gap) * 10) / 10;
  if (points === 0) return { text: "On target", tone: "text-success" };
  const unit = points === 1 ? "pt" : "pts";
  return gap > 0 ? { text: `${points} ${unit} above target`, tone: "text-success" } : { text: `${points} ${unit} below target`, tone: "text-danger" };
}

export default function DivisionCompare({ rows, monthLabel, active }: { rows: readonly CompareRow[]; monthLabel: string; active?: string }) {
  return (
    <section aria-label="Division compare" className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
        <p className="eyebrow">Divisions compared</p>
        <p className="text-[12px] text-ink-3">{monthLabel} · optimization rate against each role's target</p>
      </header>
      <ul className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none lg:divide-x">
        {rows.map((row) => {
          const { optimization: o } = row;
          const gap = gapLine(o.averageGap);
          return (
            <li key={row.key || "combined"} aria-label={row.label} className={`px-4 py-3 ${active === row.key ? "bg-accent/5" : ""}`}>
              <p className={`text-[12px] font-medium ${active === row.key ? "text-accent" : "text-ink-2"}`}>{row.label}</p>
              <p className="tnum mt-1 text-xl font-medium text-heading">{formatMetricValue(PERCENT, o.average)}</p>
              <p className={`tnum text-[12px] ${gap.tone}`}>
                {gap.text}
                {o.judged > 0 ? <span className="text-ink-3"> · {o.hits} of {o.judged} hit</span> : null}
              </p>
              <dl className="tnum mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-ink-2">
                <div className="flex gap-1">
                  <dt className="text-ink-3">People counted</dt>
                  <dd>
                    {o.counted} of {row.people}
                  </dd>
                </div>
                <div className="flex gap-1">
                  <dt className="text-ink-3">Reviews complete</dt>
                  <dd>{row.reviews ? `${row.reviews.complete}/${row.reviews.total}` : "-"}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
