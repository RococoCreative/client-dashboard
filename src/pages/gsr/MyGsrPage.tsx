// An employee's own Goal Setting Review for the current month, under their own sidebar entry
// and tabs. The review itself is ReviewPage's monthly branch, mounted here with the id as a prop
// rather than reached by URL, so the sidebar and the tabs stay on My GSR while they work it.
//
// A review row exists only once an admin has started it, and it is the admin who does that: the
// employee's page never creates one, it says who has to. Two quiet states cover most of a month.
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCycles, listEmployeeReviews } from "../../services/gsr.ts";
import { activeCycles, sectionOf } from "../../lib/gsr/cycles.ts";
import { MY_TABS } from "./myTabs.ts";
import ReviewPage from "./ReviewPage.tsx";

export default function MyGsrPage() {
  const { company, profile } = useHub();
  const companyId = company!.id;

  const state = useAsync(async () => {
    const [cycles, reviews] = await Promise.all([listCycles(companyId), listEmployeeReviews(profile.id)]);
    // The live month: the first GSR among the cycles covering today.
    const cycle = activeCycles(cycles).find((c) => sectionOf(c.cadence) === "gsr") ?? null;
    const review = cycle ? (reviews.find((r) => r.cycle_id === cycle.id) ?? null) : null;
    return { cycle, review };
  }, [companyId, profile.id]);

  return (
    <>
      <Tabs items={MY_TABS} />
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : !state.data ? null : !state.data.cycle ? (
        <EmptyState eyebrow="Goal Setting Review" title="No month open" body="Your manager opens each month's GSR. This month's appears here the moment they do." />
      ) : !state.data.review ? (
        <EmptyState
          eyebrow={state.data.cycle.name}
          title="Your GSR is not started yet"
          body={`Your manager has not opened your Goal Setting Review for ${state.data.cycle.name}. Once they do, this month's goals and last month's results are here.`}
        />
      ) : (
        <ReviewPage reviewId={state.data.review.id} embedded />
      )}
    </>
  );
}
