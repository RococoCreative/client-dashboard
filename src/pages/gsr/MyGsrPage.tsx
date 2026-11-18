// An employee's own Goal Setting Review for their current period, under their own sidebar entry
// and tabs. The period follows their rhythm (0040): a week, two weeks, a month or a quarter. The
// review itself is ReviewPage's GSR branch, mounted here with the id as a prop rather than reached
// by URL, so the sidebar and the tabs stay on My GSR while they work it.
//
// A GSR period opens itself: when nobody has opened the person's current period yet, "Start my
// GSR" opens it (ensureGsrCycle, an insert any member may make, 0040) and then their review in it.
// Both are inserts that ignore a duplicate, so starting at the same moment as a colleague or an
// admin running Start all lands on the same rows instead of failing. The person starts theirs to
// prefill their goals before the meeting, so the meeting opens on their draft. A period they still
// owe, ended but open with their GSR unfinished, comes first (gsrCycleInPlayFor). A person an admin
// omitted from the period has nothing to start, and the page says so (0034). A company that has
// never run a GSR offers nothing to start.
import { useState } from "react";
import { PencilLine } from "lucide-react";
import Button from "../../components/ui/Button.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { ensureGsrCycle, ensureReview, listCycleOmissions, listCycles, listEmployeeReviews } from "../../services/gsr.ts";
import { gsrCycleInPlayFor, gsrPeriodCopy, gsrPeriodFor, omittedCycleIdsFor, rhythmOf, runsGsrs } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { MY_TABS } from "./myTabs.ts";
import ReviewPage from "./ReviewPage.tsx";

export default function MyGsrPage() {
  const { company, profile } = useHub();
  const companyId = company!.id;
  const rhythm = rhythmOf(profile);
  const copy = gsrPeriodCopy(rhythm);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const state = useAsync(async () => {
    const [cycles, reviews, omissions] = await Promise.all([listCycles(companyId), listEmployeeReviews(companyId, profile.id), listCycleOmissions(companyId)]);
    const omittedIds = omittedCycleIdsFor(omissions, reviews, profile.id);
    // The period to work in: the one of their rhythm covering today, else the latest one still
    // open after it ended with their GSR unfinished.
    const cycle = gsrCycleInPlayFor({ id: profile.id, gsr_cadence: rhythm }, cycles, reviews, new Date(), omittedIds);
    const review = cycle ? (reviews.find((r) => r.cycle_id === cycle.id) ?? null) : null;
    const omitted = cycle ? omittedIds.includes(cycle.id) : false;
    return { cycle, review, omitted, runs: runsGsrs(cycles) };
  }, [companyId, profile.id, rhythm]);

  async function start() {
    if (!state.data || starting) return;
    setStarting(true);
    setError("");
    try {
      const cycle = state.data.cycle ?? (await ensureGsrCycle(companyId, rhythm));
      const review = await ensureReview(cycle.id, companyId, profile.id);
      state.setData((prev) => (prev ? { ...prev, cycle, review } : prev));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  const cycle = state.data?.cycle ?? null;
  const review = state.data?.review ?? null;
  // What starting opens when nothing is open yet: the canonical period of their rhythm.
  const periodName = cycle?.name ?? gsrPeriodFor(rhythm).name;
  const startButton = (
    <Button onClick={() => void start()} disabled={starting}>
      <PencilLine size={14} aria-hidden /> Start my GSR
    </Button>
  );

  return (
    <>
      <Tabs items={MY_TABS} />
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : !state.data ? null : !cycle && !state.data.runs ? (
        <EmptyState eyebrow="Goal Setting Review" title="No GSRs yet" body="An admin starts the company's Goal Setting Reviews. Yours appears here once they do." />
      ) : state.data.omitted && cycle ? (
        <EmptyState
          eyebrow={cycle.name}
          title={`You're not part of the ${cycle.name} GSRs`}
          body={`An admin has left you out of ${copy.possessive} Goal Setting Review, so nothing is needed from you. Anything you had started is kept as it is.`}
        />
      ) : !review ? (
        <EmptyState
          eyebrow={`${copy.heading} · ${periodName}`}
          title="Get ready for your GSR"
          body={`Start your Goal Setting Review for ${periodName} to fill in your goals, steps and notes before the meeting. Your manager sees what you add.`}
          action={startButton}
        />
      ) : (
        <ReviewPage reviewId={review.id} embedded />
      )}
    </>
  );
}
