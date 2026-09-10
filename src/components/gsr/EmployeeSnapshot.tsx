// The person at the top of a review, the way the dashboard sheet opens: position, tenure,
// department, who they report to, this year's personal KPIs (current against target, hit or
// not), and the company goals everyone is chasing. Admins update KPI progress right here
// during the meeting. Compensation stays on the person page.
import { Link } from "react-router-dom";
import Badge from "../ui/Badge.tsx";
import Section from "../ui/Section.tsx";
import KpiList from "../people/KpiList.tsx";
import { displayName, formatDate } from "../../lib/format.ts";
import { formatTenure } from "../../lib/people.ts";
import type { CompanyGoal, EmployeeKpi, Profile } from "../../types/database.ts";

const eyebrowClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className={eyebrowClass}>{label}</p>
      <p className="mt-0.5 text-sm text-ink">{value ?? <span className="text-ink-3">Not set</span>}</p>
    </div>
  );
}

export default function EmployeeSnapshot({
  employee,
  people,
  year,
  kpis,
  companyGoals,
  isAdmin,
  onKpis,
  onError,
}: {
  employee: Profile;
  people: Profile[];
  year: number;
  kpis: EmployeeKpi[];
  companyGoals: CompanyGoal[];
  isAdmin: boolean;
  onKpis: (update: (kpis: EmployeeKpi[]) => EmployeeKpi[]) => void;
  onError: (message: string) => void;
}) {
  const manager = employee.reports_to ? people.find((p) => p.id === employee.reports_to) ?? null : null;
  const tenure = formatTenure(employee.hire_date);
  return (
    <Section
      eyebrow="Employee"
      title={employee.title ?? "Profile"}
      description={employee.email}
      actions={isAdmin ? <Link to={`/people/${employee.id}`} className="text-[13px] text-accent hover:underline">Full profile</Link> : undefined}
    >
      <div className="grid gap-6 md:grid-cols-3">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-1">
          <Fact label="Hired" value={employee.hire_date ? `${formatDate(employee.hire_date)}${tenure ? ` · ${tenure}` : ""}` : null} />
          <Fact label="Department" value={employee.department} />
          <Fact label="Reports to" value={manager ? displayName(manager) : null} />
        </div>
        <div>
          <p className={eyebrowClass}>Personal KPIs {year}</p>
          <div className="mt-2">
            <KpiList companyId={employee.company_id ?? ""} employeeId={employee.id} year={year} kpis={kpis} canEdit={isAdmin} compact onChange={onKpis} onError={onError} />
          </div>
        </div>
        <div>
          <p className={eyebrowClass}>Company goals {year}</p>
          {companyGoals.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">None set for {year}.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {companyGoals.map((goal) => (
                <li key={goal.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{goal.name}</p>
                    <p className="tnum mt-0.5 text-[12px] text-ink-3">{goal.current_display || "-"} of {goal.target_display || "-"}</p>
                  </div>
                  <Badge tone={goal.is_hit ? "success" : "neutral"}>{goal.is_hit ? "Hit" : "Open"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}
