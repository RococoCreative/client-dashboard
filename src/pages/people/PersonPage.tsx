// One person, for an admin: the profile the review opens with (position, hire date,
// department, who they report to), their compensation table, this year's KPIs, every review
// with its score, and their goals (editable, so a manager can set goals in a one-on-one).
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Avatar from "../../components/ui/Avatar.tsx";
import Badge from "../../components/ui/Badge.tsx";
import BlurInput from "../../components/ui/BlurInput.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import ScoreRing from "../../components/ui/ScoreRing.tsx";
import { bandClass } from "../../components/ui/bandClass.ts";
import Section from "../../components/ui/Section.tsx";
import Stat from "../../components/ui/Stat.tsx";
import GoalsPanel from "../../components/gsr/GoalsPanel.tsx";
import CompensationTable from "../../components/people/CompensationTable.tsx";
import KpiList from "../../components/people/KpiList.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { inputClass, labelClass, selectClass, tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import { REVIEW_STATUS_TONE } from "../../components/status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCycles, listEmployeeReviews, listPillars, listScoresForReviews } from "../../services/gsr.ts";
import { listCompanyProfiles, updateProfile } from "../../services/profiles.ts";
import { listCompensation, listEmployeeKpis } from "../../services/employees.ts";
import { averageScore, computeReviewScore } from "../../lib/gsr/scoring.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate, formatMoney, formatPeriod, pluralize } from "../../lib/format.ts";
import { formatTenure, totalAnnual } from "../../lib/people.ts";
import { REVIEW_STATUS_LABELS, ROLE_LABELS, keysOf, type Profile, type Role } from "../../types/database.ts";

export default function PersonPage() {
  const { profileId = "" } = useParams();
  const { company, profile: me } = useHub();
  const companyId = company!.id;
  const year = new Date().getFullYear();
  const [error, setError] = useState("");

  const state = useAsync(async () => {
    const [people, reviews, cycles, pillars, kpis, compensation] = await Promise.all([
      listCompanyProfiles(companyId),
      listEmployeeReviews(profileId),
      listCycles(companyId),
      listPillars(companyId),
      listEmployeeKpis(companyId, profileId, year),
      listCompensation(companyId, profileId),
    ]);
    const scores = await listScoresForReviews(reviews.map((r) => r.id));
    return { people, person: people.find((p) => p.id === profileId) ?? null, reviews, cycles, pillars, scores, kpis, compensation };
  }, [companyId, profileId, year]);

  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;
  const { people, person, reviews, cycles, pillars, scores, kpis, compensation } = state.data;
  if (!person) return <Notice tone="error">That person is not in this company.</Notice>;

  const rows = reviews
    .map((review) => {
      const cycle = cycles.find((c) => c.id === review.cycle_id) ?? null;
      const own = scores.filter((s) => s.review_id === review.id);
      return { review, cycle, result: own.length > 0 ? computeReviewScore(pillars, own) : null };
    })
    .sort((a, b) => ((a.cycle?.period_start ?? "") < (b.cycle?.period_start ?? "") ? 1 : -1));
  const latest = rows[0] ?? null;
  const average = averageScore(rows.map((r) => r.result?.overall ?? null));
  const self = person.id === me.id;
  const tenure = formatTenure(person.hire_date);
  const manager = person.reports_to ? people.find((p) => p.id === person.reports_to) ?? null : null;

  async function patch(patchValue: Parameters<typeof updateProfile>[1]) {
    setError("");
    try {
      const next: Profile = await updateProfile(person!.id, patchValue);
      state.setData((prev) => (prev ? { ...prev, person: next, people: prev.people.map((p) => (p.id === next.id ? next : p)) } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        backTo="/people"
        backLabel="People"
        eyebrow={person.title ?? ROLE_LABELS[person.role]}
        title={displayName(person)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {person.email}
            <Badge tone={person.is_active ? "success" : "neutral"}>{person.is_active ? "Active" : "Inactive"}</Badge>
            {person.hire_date ? <span className="text-ink-3">Hired {formatDate(person.hire_date)}{tenure ? ` · ${tenure}` : ""}</span> : null}
            {manager ? <span className="text-ink-3">Reports to {displayName(manager)}</span> : null}
          </span>
        }
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Section eyebrow="Profile" title="Details">
            <div className="flex items-center gap-3">
              <Avatar person={person} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{displayName(person)}</p>
                <p className="truncate text-[12px] text-ink-3">{person.email}</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="person-name" className={labelClass}>Name</label>
                <BlurInput id="person-name" value={person.full_name ?? ""} placeholder="Full name" onSave={(next) => void patch({ full_name: next.trim() || null })} />
              </div>
              <div>
                <label htmlFor="person-title" className={labelClass}>Title</label>
                <BlurInput id="person-title" value={person.title ?? ""} placeholder="Project Manager" onSave={(next) => void patch({ title: next.trim() || null })} />
              </div>
              <div>
                <label htmlFor="person-department" className={labelClass}>Department</label>
                <BlurInput id="person-department" value={person.department ?? ""} placeholder="Production" onSave={(next) => void patch({ department: next.trim() || null })} />
              </div>
              <div>
                <label htmlFor="person-hire-date" className={labelClass}>Hire date</label>
                <input id="person-hire-date" type="date" value={person.hire_date ?? ""} onChange={(e) => void patch({ hire_date: e.target.value || null })} className={inputClass} />
                {tenure ? <p className="mt-1 text-[12px] text-ink-3">{tenure}</p> : null}
              </div>
              <div>
                <label htmlFor="person-reports-to" className={labelClass}>Reports to</label>
                <select id="person-reports-to" value={person.reports_to ?? ""} onChange={(e) => void patch({ reports_to: e.target.value || null })} className={selectClass}>
                  <option value="">Nobody</option>
                  {people.filter((p) => p.id !== person.id && p.is_active).map((p) => (
                    <option key={p.id} value={p.id}>{displayName(p)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="person-phone" className={labelClass}>Phone</label>
                <BlurInput id="person-phone" value={person.phone ?? ""} placeholder="(555) 010-0000" onSave={(next) => void patch({ phone: next.trim() || null })} />
              </div>
              <div>
                <label htmlFor="person-role" className={labelClass}>Role</label>
                <select id="person-role" value={person.role} disabled={self} onChange={(e) => void patch({ role: e.target.value as Role })} className={selectClass}>
                  {keysOf(ROLE_LABELS).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
            </div>
          </Section>
          <div className="grid gap-4">
            <Stat label="Annual compensation" value={formatMoney(totalAnnual(compensation))} hint={compensation.length > 0 ? `${formatMoney(totalAnnual(compensation) / 12)} a month` : "Not recorded"} />
            <Stat label="Latest score" value={<span className={bandClass(latest?.result?.overall ?? null)}>{latest?.result?.overall ?? "-"}</span>} hint={latest?.cycle?.name} />
            <Stat label="Average" value={average ?? "-"} hint={pluralize(rows.length, "review")} />
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Section eyebrow="Compensation" title="Compensation" description="Annual amounts; the monthly figure is derived. Visible to this person and company admins only." padded={false}>
            <CompensationTable companyId={companyId} employeeId={person.id} items={compensation} canEdit onChange={(update) => state.setData((prev) => (prev ? { ...prev, compensation: update(prev.compensation) } : prev))} onError={setError} />
          </Section>

          <Section eyebrow={String(year)} title="Personal KPIs" description="The numbers this person owns for the year. They show at the top of every review.">
            <KpiList companyId={companyId} employeeId={person.id} year={year} kpis={kpis} canEdit onChange={(update) => state.setData((prev) => (prev ? { ...prev, kpis: update(prev.kpis) } : prev))} onError={setError} />
          </Section>

          <Section eyebrow="Reviews" title="Review history" padded={false}>
            {rows.length === 0 ? (
              <p className="p-5 text-sm text-ink-2">No reviews yet. Open a cycle and start one from the team table.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Cycle</th>
                      <th className={thClass}>Period</th>
                      <th className={thClass}>Status</th>
                      <th className={`${thClass} text-right`}>Score</th>
                      <th className={thClass}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ review, cycle, result }) => (
                      <tr key={review.id} className="hover:bg-surface-2/60">
                        <td className={tdClass}>{cycle?.name ?? "Review"}</td>
                        <td className={`${tdClass} text-ink-2`}>{cycle ? formatPeriod(cycle.period_start, cycle.period_end) : "-"}</td>
                        <td className={tdClass}><Badge tone={REVIEW_STATUS_TONE[review.status]}>{REVIEW_STATUS_LABELS[review.status]}</Badge></td>
                        <td className={`${tdClass} tnum text-right font-medium ${bandClass(result?.overall ?? null)}`}>{result?.overall ?? "-"}</td>
                        <td className={`${tdClass} text-right`}><Link to={`/gsr/reviews/${review.id}`} className="text-[13px] text-accent hover:underline">Open</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {latest?.result ? (
            <Section eyebrow="Latest review" title={latest.cycle?.name ?? "Scores"}>
              <div className="flex items-center gap-5">
                <ScoreRing score={latest.result.overall} size={80} />
                <ul className="flex-1 space-y-1 text-sm">
                  {latest.result.pillars.map((p) => (
                    <li key={p.pillarId} className="flex justify-between gap-3">
                      <span className="text-ink-2">{p.name}</span>
                      <span className="tnum text-ink">{p.score === null ? "-" : Math.round(p.score)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          ) : null}
          <div>
            <p className="eyebrow mb-3">Goals</p>
            <GoalsPanel companyId={companyId} employeeId={person.id} canEdit cycles={cycles} />
          </div>
        </div>
      </div>
    </>
  );
}
