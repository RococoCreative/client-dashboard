// For a company on demand: where a person's GSRs done inside the open scored review's period stand,
// the figure that review signs off (scoreGsrsInPeriod). A GSR still open is never applied. Sits on
// the impact score cards (the person's Reviews tab and their Home) under the ratings, without
// changing the ratings' number, in place of the locked-in months a company on periods reads there.
// A read that fails says so there rather than leaving the line out.
import { pluralize } from "../../../lib/format.ts";
import { scoreGsrsInPeriod } from "../../../lib/gsr/onDemand.ts";
import { lineItemPercent } from "../../../lib/gsr/scoring.ts";
import { useAsync } from "../../../hooks/useAsync.ts";
import { listPersonGsrs } from "../../../services/gsrOnDemand.ts";
import type { ReviewCycle } from "../../../types/database.ts";

export default function GsrPeriodLine({ companyId, personId, cycle }: { companyId: string; personId: string; cycle: ReviewCycle }) {
  const state = useAsync(() => listPersonGsrs(companyId, personId), [companyId, personId]);
  // A failed read says so in the card's own place, in the friendly words (lib/errors.ts).
  if (state.error && !state.data) {
    return <p role="alert" className="mt-4 border-t border-line pt-3 text-[12.5px] text-danger">{`The GSRs for ${cycle.name} did not load. ${state.error}`}</p>;
  }
  if (!state.data) return null;
  const figure = scoreGsrsInPeriod(cycle, state.data);
  const counted = figure.gsrs.filter((g) => g.counted).length;
  const percent = lineItemPercent(figure);
  return (
    <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-sm">
      <div className="min-w-0">
        <p className="text-ink-2">GSRs, {cycle.name}</p>
        <p className="text-[12px] text-ink-3">
          {counted === 0 ? "Counts once a GSR is marked done." : `${pluralize(counted, "GSR")} done so far; written into the review when it is signed off.`}
        </p>
      </div>
      <span className="tnum text-ink">{percent === null ? "-" : `${percent}%`}</span>
    </div>
  );
}
