// The person's own figures on Home, when their job role carries the financials module, for an
// admin in a role and an employee in it alike.
import ScoreBar from "../ui/ScoreBar.tsx";
import Section from "../ui/Section.tsx";
import { formatMoney } from "../../lib/format.ts";
import { financialProgress } from "../../lib/people.ts";
import { FINANCIAL_SOURCE_LABELS, type EmployeeFinancial, type JobRole } from "../../types/database.ts";

// The person's own figures, when their job role carries the module. One block for both
// dashboards, so an admin in a role and an employee in it see the same thing, and its copy has to
// be true for both: an owner reading their own figures has no manager keeping them.
export default function YourFigures({ jobRole, financials, year, className = "" }: { jobRole: JobRole; financials: EmployeeFinancial[]; year: number; className?: string }) {
  return (
    <Section eyebrow={`Financials ${year}`} title="Your figures" description={`What ${jobRole.name} owns this year, against target, as recorded on your profile.`} className={className}>
      {financials.length === 0 ? (
        <p className="text-sm text-ink-2">No figures set for {year} yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {financials.map((row) => {
            const progress = financialProgress(row);
            return (
              <li key={row.id}>
                <ScoreBar
                  label={row.metric}
                  percent={progress === null ? null : progress * 100}
                  detail={row.target === null ? formatMoney(row.current) : `${formatMoney(row.current)} of ${formatMoney(row.target)}`}
                />
                <p className="mt-1 text-[12px] text-ink-3">{FINANCIAL_SOURCE_LABELS[row.source]}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
