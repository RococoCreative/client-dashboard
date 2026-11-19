// A person's GSR and goals tab: their current Goal Setting Review, at their rhythm, then their goals
// for this year, next year and their BHAG. A goal's action steps and progress notes are the
// person's own and never show here; a period's goals live in its GSR. The current GSR block is also
// on Overview, so it is exported from here for that tab.
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PencilLine } from "lucide-react";
import Badge from "../../ui/Badge.tsx";
import Button from "../../ui/Button.tsx";
import Notice from "../../ui/Notice.tsx";
import Section from "../../ui/Section.tsx";
import GoalsPanel from "../../gsr/GoalsPanel.tsx";
import { REVIEW_STATUS_TONE } from "../../status.ts";
import { useHub } from "../../../context/HubContext.tsx";
import { ensureGsrCycle, ensureReview } from "../../../services/gsr.ts";
import { GSR_RHYTHM_LABELS, gsrCycleInPlayFor, gsrPeriodCopy, gsrPeriodFor, reviewPath, rhythmOf, runsGsrs } from "../../../lib/gsr/cycles.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { displayName } from "../../../lib/format.ts";
import { ledBy } from "../../../lib/people.ts";
import { REVIEW_STATUS_LABELS, type Profile, type Review, type ReviewCycle } from "../../../types/database.ts";
import type { PersonRecord, PersonTabProps } from "../../../pages/people/personTabs.ts";

// The person's current Goal Setting Review, at their rhythm, for an admin or someone who leads
// them: a link into it when it is open, or a way to start it. The period opens itself (0046), so
// starting opens the period when nobody has yet (ensureGsrCycle) and then their review in it; both
// are inserts that ignore a duplicate, so two people starting at once land on the same rows. A
// period they still owe comes first (gsrCycleInPlayFor), the same one their own My GSR opens. A
// company that has never run a GSR gets nothing here; a person left out of the period, or
// inactive, gets a line saying so.
function CurrentGsrCard({
  companyId,
  person,
  cycles,
  reviews,
  omittedCycleIds,
}: {
  companyId: string;
  person: Profile;
  cycles: ReviewCycle[];
  reviews: Review[];
  omittedCycleIds: string[];
}) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  if (!runsGsrs(cycles)) return null;
  const rhythm = rhythmOf(person);
  const copy = gsrPeriodCopy(rhythm);
  const cycle = gsrCycleInPlayFor(person, cycles, reviews, new Date(), omittedCycleIds);
  const review = cycle ? (reviews.find((r) => r.cycle_id === cycle.id) ?? null) : null;
  const periodName = cycle?.name ?? gsrPeriodFor(rhythm).name;
  const first = displayName(person).split(" ")[0];

  async function start() {
    if (starting) return;
    setStarting(true);
    setError("");
    try {
      const opened = cycle ?? (await ensureGsrCycle(companyId, rhythm));
      const started = await ensureReview(opened.id, companyId, person.id);
      navigate(reviewPath(started.id, opened));
    } catch (err) {
      setError(errorMessage(err));
      setStarting(false);
    }
  }

  let body: ReactNode;
  if (review && cycle) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-ink">
          {cycle.name}
          <Badge tone={REVIEW_STATUS_TONE[review.status]}>{REVIEW_STATUS_LABELS[review.status]}</Badge>
        </span>
        <Link to={reviewPath(review.id, cycle)} className="text-link text-[13px] font-medium hover:underline">Open {cycle.name} GSR</Link>
      </div>
    );
  } else if (cycle && omittedCycleIds.includes(cycle.id)) {
    body = <p className="text-[13px] text-ink-2">{first} is left out of the {cycle.name} GSRs, so there is nothing to start.</p>;
  } else if (!person.is_active) {
    body = <p className="text-[13px] text-ink-2">{first} is inactive, so they are not in the {periodName} GSRs.</p>;
  } else {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-ink-2">{cycle ? `${cycle.name} is open.` : `${periodName} is not open yet.`} {first}'s GSR has not been started.</span>
        <Button size="sm" disabled={starting} onClick={() => void start()}>
          <PencilLine size={14} aria-hidden /> {starting ? "Starting..." : `Start ${copy.possessive} GSR`}
        </Button>
      </div>
    );
  }
  return (
    <Section eyebrow={`Current GSR · ${GSR_RHYTHM_LABELS[rhythm]}`} title={copy.heading} description={`${first}'s Goal Setting Review runs ${copy.every}.`}>
      {body}
      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
    </Section>
  );
}

// The current GSR for whoever runs the record or leads the person. A Rococo admin's row has none.
export function CurrentGsr({ companyId, data, person }: { companyId: string; data: PersonRecord; person: Profile }) {
  const { profile: me, isAdmin } = useHub();
  const isLeader = isAdmin || ledBy(me, data.people).some((p) => p.id === person.id);
  if (!isLeader || person.is_rococo_admin) return null;
  return <CurrentGsrCard companyId={companyId} person={person} cycles={data.cycles} reviews={data.reviews} omittedCycleIds={data.omittedCycleIds} />;
}

export default function PersonGsrGoals({ companyId, data, person }: PersonTabProps) {
  const { isAdmin } = useHub();
  return (
    <div className="space-y-6">
      <CurrentGsr companyId={companyId} data={data} person={person} />
      <section aria-labelledby="person-goals-heading">
        <div className="mb-3">
          <p className="eyebrow">Goals</p>
          <h2 id="person-goals-heading" className="mt-1 font-display text-lg text-heading">This year, next year and the BHAG</h2>
        </div>
        <GoalsPanel companyId={companyId} employeeId={person.id} canEdit={isAdmin} ownerName={displayName(person).split(" ")[0]} />
      </section>
    </div>
  );
}
