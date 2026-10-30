// Where a person's monthly GSRs stand inside the open scored review, for a company that scores
// them: the figure that review signs off, months so far. Sits on the impact score cards (the
// dashboard and the person page) under the ratings, without changing the ratings' number, so the
// one card says both what is rated and what the months are adding up to.
import type { GsrMonthsFigure } from "../../lib/gsr/goals.ts";
import type { ReviewCycle } from "../../types/database.ts";

export default function GsrQuarterLine({ cycle, figure }: { cycle: ReviewCycle; figure: GsrMonthsFigure<ReviewCycle> }) {
  if (figure.target === 0) return null;
  return (
    <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-sm">
      <div className="min-w-0">
        <p className="text-ink-2">Monthly GSRs, {cycle.name}</p>
        <p className="text-[12px] text-ink-3">So far; written into the review when it is signed off.</p>
      </div>
      <span className="tnum text-ink">{Math.round((figure.actual / figure.target) * 100)}%</span>
    </div>
  );
}
