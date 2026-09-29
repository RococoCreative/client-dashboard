// The Goals section for admins: everybody's yearly goals, personal, professional and role, with
// where each one stands. One list for the company rather than a panel per person, so the page is
// three reads however large the roster. Editing happens on the person's page.
import { useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../../components/ui/Badge.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { selectClass } from "../../components/ui/forms.ts";
import { GOAL_OUTCOME_TONE } from "../../components/status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCycles, listGoals } from "../../services/gsr.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { goalOutcome, goalSettled, stepsTaken, type GoalOutcome } from "../../lib/gsr/goals.ts";
import { displayName, pluralize } from "../../lib/format.ts";
import { GOAL_KIND_LABELS, type Goal } from "../../types/database.ts";

const OUTCOME_LABELS: Record<GoalOutcome, string> = { hit: "Hit", miss: "Missed", open: "In progress" };

export default function GoalsPage() {
  const { company } = useHub();
  const companyId = company!.id;
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);

  const state = useAsync(async () => {
    const [people, goals, cycles] = await Promise.all([listCompanyProfiles(companyId), listGoals(companyId), listCycles(companyId)]);
    return { people, goals, cycles };
  }, [companyId]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;

  const { people, goals, cycles } = state.data;
  const yearly = goals.filter((g) => g.scope === "year");
  const years = [...new Set([thisYear, ...yearly.map((g) => g.year ?? thisYear)])].sort((a, b) => b - a);
  const shown = yearly.filter((g) => (g.year ?? thisYear) === year);
  const outcome = (goal: Goal) => goalOutcome(goal, goalSettled(goal, cycles));
  const hit = shown.filter((g) => outcome(g) === "hit").length;
  const roster = people.filter((p) => p.is_active).map((person) => ({ person, goals: shown.filter((g) => g.employee_id === person.id) }));

  return (
    <>
      <PageHeader
        eyebrow="The year"
        title="Goals"
        description="Personal, professional and role goals for the year, for everybody. Set and edited on each person's page; read here."
        actions={
          <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${selectClass} mt-0 w-28`}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        }
      />
      {shown.length === 0 ? (
        <EmptyState eyebrow={String(year)} title="No yearly goals yet" body="Open a person's page to set their goals for the year. They show here and on every quarterly review." />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-ink-2">{hit} of {pluralize(shown.length, "goal")} hit so far.</p>
          {roster.map(({ person, goals: own }) =>
            own.length === 0 ? null : (
              <Section key={person.id} eyebrow={person.title ?? ""} title={displayName(person)} padded={false} actions={<Link to={`/people/${person.id}`} className="text-[13px] text-accent hover:underline">Open profile</Link>}>
                <ul className="divide-y divide-line">
                  {own.map((goal) => {
                    const steps = stepsTaken(goal);
                    const result = outcome(goal);
                    return (
                      <li key={goal.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{goal.title}</p>
                          <p className="text-[12px] text-ink-3">
                            {GOAL_KIND_LABELS[goal.kind]}
                            {steps.total > 0 ? ` · ${steps.done}/${steps.total} steps` : ""}
                            {` · ${goal.progress}%`}
                          </p>
                        </div>
                        <Badge tone={GOAL_OUTCOME_TONE[result]}>{OUTCOME_LABELS[result]}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            ),
          )}
        </div>
      )}
    </>
  );
}
