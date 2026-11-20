// My GSR in a company on demand: the person's current GSR (their newest open one) with "Open my
// GSR", or "Start a GSR" when none is open; the line "A GSR is due." when their rhythm says one is
// (dueFor, from the day their last GSR began and the company's today); then every GSR they have
// had, newest first, a done one opening read only. The person starts their own (the database lets
// them, in a company on demand); marking it done is for whoever leads them.
import { useNavigate } from "react-router-dom";
import { ArrowRight, PencilLine } from "lucide-react";
import Badge from "../../ui/Badge.tsx";
import Button from "../../ui/Button.tsx";
import Notice from "../../ui/Notice.tsx";
import PageHeader from "../../ui/PageHeader.tsx";
import Section from "../../ui/Section.tsx";
import SkeletonRows from "../../ui/SkeletonRows.tsx";
import GsrList from "./GsrList.tsx";
import { useStartGsr } from "./useStartGsr.ts";
import MyTabs from "../../../pages/gsr/MyTabs.tsx";
import { useHub } from "../../../context/HubContext.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { currentGsr, dueFor } from "../../../lib/gsr/onDemand.ts";
import { formatDate } from "../../../lib/format.ts";
import { companyToday } from "../../../lib/wins.ts";
import { listDirectory } from "../../../services/directory.ts";
import { listPersonGsrs } from "../../../services/gsrOnDemand.ts";

export default function MyGsrOnDemand() {
  const { company, profile } = useHub();
  const companyId = company!.id;
  const navigate = useNavigate();
  const { start, busy, error } = useStartGsr();
  const state = useAsync(async () => {
    const [gsrs, directory] = await Promise.all([listPersonGsrs(companyId, profile.id), listDirectory(companyId)]);
    return { gsrs, names: new Map(directory.map((entry) => [entry.id, entry.full_name?.trim() || "Unnamed"] as const)) };
  }, [companyId, profile.id]);

  const gsrs = state.data?.gsrs ?? [];
  const current = currentGsr(gsrs);
  const lastStartedOn = gsrs.reduce<string | null>((latest, g) => (latest === null || g.started_on > latest ? g.started_on : latest), null);
  const due = dueFor(profile.gsr_cadence, lastStartedOn, companyToday(company!.time_zone)).state;
  const isDue = due === "due" || due === "overdue";

  return (
    <>
      <PageHeader title="My GSR" />
      <MyTabs />
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : !state.data ? null : (
        <div className="space-y-6">
          <Section eyebrow="Goal setting" title="Current GSR">
            {current ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  Started {formatDate(current.started_on)}
                  <Badge tone="info">In progress</Badge>
                </span>
                <Button size="sm" onClick={() => navigate(`/gsr/reviews/${current.id}`)}>
                  Open my GSR <ArrowRight size={14} aria-hidden />
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[13px] text-ink-2">No GSR is open. Start one to set your goals before you meet.</span>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p> : null}
                  <Button size="sm" disabled={busy} onClick={() => void start(profile.id)}>
                    <PencilLine size={14} aria-hidden /> Start a GSR
                  </Button>
                </div>
              </div>
            )}
            {isDue ? <p className="mt-3 text-[13px] font-medium text-ink">A GSR is due.</p> : null}
          </Section>
          <Section eyebrow="Goal setting" title="Your GSRs">
            <GsrList gsrs={gsrs} names={state.data.names} />
          </Section>
        </div>
      )}
    </>
  );
}
