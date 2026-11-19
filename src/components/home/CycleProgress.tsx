// One live review cycle's card on an admin's Home: everyone the cycle covers, their score where the
// cycle is scored, and where their review stands. A cycle with more than CYCLE_CARD_ROWS_SHOWN + 1
// people shows the status counts and only the people still owing something, with a link to the
// whole roster on the cycle page; presentation only, the roster and the statuses are the same.
import { Link } from "react-router-dom";
import Badge from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import Section from "../ui/Section.tsx";
import { tapTargetClass } from "../ui/tap.ts";
import { REVIEW_STATUS_TONE } from "../status.ts";
import { CADENCE_LABELS, cycleProgress, cyclePath, cycleSettled } from "../../lib/gsr/cycles.ts";
import { displayName, formatPeriod } from "../../lib/format.ts";
import { REVIEW_STATUS_LABELS, type ReviewStatus, type Profile, type Review, type ReviewCycle } from "../../types/database.ts";

const CYCLE_CARD_ROWS_SHOWN = 5;

// One live review cycle's progress: everyone the cycle covers, their score where the cycle is
// scored, and where their review stands. Scoped to the cycle by cycle_id, because a person has a
// review in every live cycle at once and matching on the person alone picks whichever came back
// first.
export default function CycleProgress({
  cycle,
  people,
  omittedCount,
  scored,
}: {
  cycle: ReviewCycle;
  // The cycle's roster (cycleRoster): everybody active, plus anyone deactivated since whose review
  // in it was signed off, less anyone omitted from it.
  people: Profile[];
  omittedCount: number;
  scored: Array<{ review: Review; score: number | null }>;
}) {
  const own = scored.filter((s) => s.review.cycle_id === cycle.id);
  // Counted over the roster the cycle covers, so a person with no review row yet reads as a
  // review still owed rather than vanishing from both halves of the fraction.
  const progress = cycleProgress(people, own.map((s) => s.review), cycle.id);
  // A monthly cycle is a Goal Setting Review and carries no scores, so it shows no score column.
  const showScore = cycle.cadence !== "monthly";
  // Still open after its period: the reviews in it are being finished, and it says so.
  const ended = cycleSettled(cycle);
  const statusOf = (person: Profile): ReviewStatus => own.find((s) => s.review.employee_id === person.id)?.review.status ?? "not_started";
  const capped = people.length > CYCLE_CARD_ROWS_SHOWN + 1;
  const counts = { complete: 0, in_progress: 0, not_started: 0 };
  for (const person of people) counts[statusOf(person)] += 1;
  // In progress first, then not started, each in the roster's own order; the completed are counted, not listed.
  const shown = capped
    ? [...people.filter((p) => statusOf(p) === "in_progress"), ...people.filter((p) => statusOf(p) === "not_started")].slice(0, CYCLE_CARD_ROWS_SHOWN)
    : people;
  return (
    <Section
      eyebrow={showScore ? CADENCE_LABELS[cycle.cadence] : `${CADENCE_LABELS[cycle.cadence]} · Goal Setting Review`}
      title={cycle.name}
      description={`${formatPeriod(cycle.period_start, cycle.period_end)} · ${progress.complete} of ${progress.total} complete${omittedCount > 0 ? ` · ${omittedCount} omitted` : ""}${ended ? " · Period ended, still open" : ""}`}
      actions={
        <Link to={cyclePath(cycle)}>
          <Button variant="secondary" size="sm">Open cycle</Button>
        </Link>
      }
    >
      {people.length === 0 && omittedCount > 0 ? (
        <p className="text-sm text-ink-2">Everyone is omitted from this cycle.</p>
      ) : people.length === 0 ? (
        <p className="text-sm text-ink-2">Nobody on the roster yet. Add the team in People and their reviews appear here.</p>
      ) : (
        <>
          {capped ? (
            <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
              {(["complete", "in_progress", "not_started"] as const).map((status) => (
                <span key={status} className="tnum">{REVIEW_STATUS_LABELS[status]} {counts[status]}</span>
              ))}
            </p>
          ) : null}
          {shown.length === 0 ? (
            <p className="text-sm text-ink-2">Everyone is complete.</p>
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((person) => {
                const entry = own.find((s) => s.review.employee_id === person.id);
                const status = statusOf(person);
                return (
                  <li key={person.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{displayName(person)}</p>
                      <p className="truncate text-[12px] text-ink-3">{person.title ?? person.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {showScore ? <span className="tnum text-sm text-ink">{entry?.score ?? "-"}</span> : null}
                      <Badge tone={REVIEW_STATUS_TONE[status]}>{REVIEW_STATUS_LABELS[status]}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {capped ? (
            <p className="mt-2 text-[13px]">
              <Link to={cyclePath(cycle)} className={`text-link hover:underline ${tapTargetClass}`}>All {people.length} people</Link>
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}
