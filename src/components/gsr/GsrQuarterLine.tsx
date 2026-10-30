// Where a person's monthly GSRs stand inside the open scored review, for a company that scores
// them: the months an admin has locked in, averaged, which is the figure that review signs off. A
// month that is not locked yet is never applied. Sits on the impact score cards (the dashboard and
// the person page) under the ratings, without changing the ratings' number, so the one card says
// both what is rated and what the months are adding up to.
import { pluralize } from "../../lib/format.ts";
import type { GsrMonthsFigure } from "../../lib/gsr/goals.ts";
import type { ReviewCycle } from "../../types/database.ts";

export default function GsrQuarterLine({ cycle, figure }: { cycle: ReviewCycle; figure: GsrMonthsFigure<ReviewCycle> }) {
  const locked = figure.months.filter((m) => m.locked !== null).length;
  return (
    <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-sm">
      <div className="min-w-0">
        <p className="text-ink-2">Monthly GSRs, {cycle.name}</p>
        <p className="text-[12px] text-ink-3">
          {locked === 0 ? "Counts once a month is locked in." : `${pluralize(locked, "month")} locked in so far; written into the review when it is signed off.`}
        </p>
      </div>
      <span className="tnum text-ink">{figure.target === 0 ? "-" : `${Math.round((figure.actual / figure.target) * 100)}%`}</span>
    </div>
  );
}
