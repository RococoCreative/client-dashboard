// A person's own GSR on Home, in a company whose GSRs are on demand: their current GSR (the newest
// open one) with the day it began, its progress so far and "Open my GSR", or "Start a GSR" when none
// is open, and "A GSR is due." whenever their rhythm says one is due or overdue. It holds the page's
// one primary button, as the month's GSR card does in a company on periods. Marking a GSR done is for
// whoever leads the person, so nothing here offers it. Every figure and flag comes from lib/gsr:
// currentGsr and dueFor for which GSR and whether one is due, monthTotal over its own goals (against
// the company's number of mandatory goals, where it scores its GSRs) for the progress.
import { useNavigate } from "react-router-dom";
import { ArrowRight, PencilLine } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { metaClass } from "../ui/type.ts";
import { useStartGsr } from "../gsr/onDemand/useStartGsr.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { monthTotal } from "../../lib/gsr/goals.ts";
import { lastStartedOn } from "../../lib/gsr/gsrStanding.ts";
import { currentGsr, dueFor, gsrGoals } from "../../lib/gsr/onDemand.ts";
import { formatDate, pluralize } from "../../lib/format.ts";
import { companyToday } from "../../lib/wins.ts";
import { listGoals, listPillars } from "../../services/gsr.ts";
import { listPersonGsrs } from "../../services/gsrOnDemand.ts";
import type { Profile } from "../../types/database.ts";

export default function GsrCardOnDemand({ person, className = "" }: { person: Profile; className?: string }) {
  const { company } = useHub();
  const companyId = company!.id;
  const navigate = useNavigate();
  const { start, busy, error: startError } = useStartGsr();
  const state = useAsync(async () => {
    const [gsrs, goals, pillars] = await Promise.all([listPersonGsrs(companyId, person.id), listGoals(companyId, person.id), listPillars(companyId)]);
    const required = pillars.find((p) => p.scoring_type === "gsr_goals" && p.is_active)?.required_goals ?? null;
    return { gsrs, goals, required };
  }, [companyId, person.id]);

  const body = () => {
    if (state.error && !state.data) return <Notice tone="error">Your GSR did not load. {state.error}</Notice>;
    if (!state.data) return <SkeletonRows rows={2} />;
    const { gsrs, goals, required } = state.data;
    const current = currentGsr(gsrs);
    const due = dueFor(person.gsr_cadence, lastStartedOn(gsrs), companyToday(company!.time_zone)).state;
    const isDue = due === "due" || due === "overdue";
    const own = current ? gsrGoals(goals, current.id) : [];
    const total = required ? monthTotal(own, required) : null;
    return (
      <>
        {current ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                Started {formatDate(current.started_on)}
                <Badge tone="info">In progress</Badge>
              </p>
              <p className={`tnum mt-1 ${metaClass}`}>
                {pluralize(own.length, "goal")} set{total ? ` · ${total.total}% of ${total.cap}% so far` : ""}
              </p>
            </div>
            <Button size="sm" onClick={() => navigate(`/gsr/reviews/${current.id}`)}>
              Open my GSR <ArrowRight size={14} aria-hidden />
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2">No GSR is open. Start one to set your goals before you meet.</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {startError ? <p role="alert" className="text-[12.5px] text-danger">{startError}</p> : null}
              <Button size="sm" disabled={busy} onClick={() => void start(person.id)}>
                <PencilLine size={14} aria-hidden /> Start a GSR
              </Button>
            </div>
          </div>
        )}
        {isDue ? <p className="mt-3 text-[13px] font-medium text-ink">A GSR is due.</p> : null}
      </>
    );
  };

  return (
    <Section eyebrow="Goal setting" title="Your GSR" className={className}>
      {body()}
    </Section>
  );
}
