// An employee's own Goal Setting Review for the current month, under their own sidebar entry
// and tabs. The review itself is ReviewPage's monthly branch, mounted here with the id as a prop
// rather than reached by URL, so the sidebar and the tabs stay on My GSR while they work it.
//
// An admin opens the month (the cycle); either side can start the person's review inside it.
// The employee starts theirs to prefill their goals before the meeting (0020 lets them, for
// their own row in an open monthly cycle and nothing else), so the meeting opens on their draft.
import { useState } from "react";
import { PencilLine } from "lucide-react";
import Button from "../../components/ui/Button.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { ensureReview, listCycles, listEmployeeReviews } from "../../services/gsr.ts";
import { activeCycles, sectionOf } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { MY_TABS } from "./myTabs.ts";
import ReviewPage from "./ReviewPage.tsx";

export default function MyGsrPage() {
  const { company, profile } = useHub();
  const companyId = company!.id;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const state = useAsync(async () => {
    const [cycles, reviews] = await Promise.all([listCycles(companyId), listEmployeeReviews(profile.id)]);
    // The live month: the first GSR among the cycles covering today.
    const cycle = activeCycles(cycles).find((c) => sectionOf(c.cadence) === "gsr") ?? null;
    const review = cycle ? (reviews.find((r) => r.cycle_id === cycle.id) ?? null) : null;
    return { cycle, review };
  }, [companyId, profile.id]);

  async function start() {
    const cycle = state.data?.cycle;
    if (!cycle || starting) return;
    setStarting(true);
    setError("");
    try {
      const review = await ensureReview(cycle.id, companyId, profile.id);
      state.setData((prev) => (prev ? { ...prev, review } : prev));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  const cycle = state.data?.cycle ?? null;
  const review = state.data?.review ?? null;

  return (
    <>
      <Tabs items={MY_TABS} />
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : !state.data ? null : !cycle ? (
        <EmptyState eyebrow="Goal Setting Review" title="No month open" body="Your manager opens each month's GSR. This month's appears here the moment they do." />
      ) : !review ? (
        <EmptyState
          eyebrow={cycle.name}
          title="Get ready for your GSR"
          body={`Start your Goal Setting Review for ${cycle.name} to fill in your goals, steps and notes before the meeting. Your manager sees what you add.`}
          action={
            <Button onClick={() => void start()} disabled={starting}>
              <PencilLine size={14} aria-hidden /> Start my GSR
            </Button>
          }
        />
      ) : (
        <ReviewPage reviewId={review.id} embedded />
      )}
    </>
  );
}
