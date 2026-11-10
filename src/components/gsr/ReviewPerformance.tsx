// "Performance this month" on a monthly review: the person's role scorecard for the review's month,
// each result against its target, with the year to date through that month. A per-project metric
// reads as the month's combined result with one row under it per assigned project. Admins enter
// and correct results here, in the meeting, each with an optional note; the person reads them.
//
// Every number comes from src/lib/scorecard.ts (buildYearGrid, formatMetricValue), the only
// scorecard math there is. This file only decides what is shown and writes what is typed.
import { useState } from "react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { inputClass } from "../ui/forms.ts";
import { deleteMetricEntry, upsertMetricEntry } from "../../services/scorecards.ts";
import { buildYearGrid, formatMetricValue, type GridCell, type GridRow, type MetricResult, type YtdResult } from "../../lib/scorecard.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, moneyProblem, parseDate, parseMoney, pluralize } from "../../lib/format.ts";
import type { MetricEntry, Profile, Project, ProjectAssignment, RoleMetric } from "../../types/database.ts";

const eyebrowClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";

type EntriesUpdate = (update: (entries: MetricEntry[]) => MetricEntry[]) => void;

// The unit typed after a value, beside its box.
function unitOf(metric: RoleMetric): string {
  return metric.kind === "percent" ? "%" : metric.kind === "rating" ? `/ ${metric.scale_max}` : "";
}

// How the metric is judged, in a few words: "Target 80%", "No target · per project".
function targetLine(metric: RoleMetric): string {
  const parts = [metric.target === null ? "No target" : `Target ${formatMetricValue(metric, metric.target)}${metric.kind === "number" ? " a month" : ""}`];
  if (metric.target !== null && !metric.higher_is_better) parts.push("lower is better");
  if (metric.per_project) parts.push("per project");
  return parts.join(" · ");
}

// The month's hit or miss. Nothing to judge (no result, or no target) shows nothing.
function MonthBadge({ metric, result }: { metric: RoleMetric; result: MetricResult }) {
  if (result.hit === null || result.gap === null) return null;
  if (result.hit) return <Badge tone="success">Hit</Badge>;
  // The size of a miss reads in the metric's own unit; a rating's in points.
  const by = formatMetricValue(metric.kind === "rating" ? { ...metric, kind: "number" } : metric, Math.abs(result.gap));
  return <Badge tone="warning">Miss by {by}</Badge>;
}

function YearToDate({ metric, ytd }: { metric: RoleMetric; ytd: YtdResult }) {
  return (
    <div className="w-24 text-right">
      <p className={eyebrowClass}>Year to date</p>
      <p className="tnum mt-0.5 text-sm text-ink">{formatMetricValue(metric, ytd.value)}</p>
      {ytd.hit === null ? null : <p className={`text-[11.5px] ${ytd.hit ? "text-success" : "text-warning"}`}>{ytd.hit ? "On target" : "Off target"}</p>}
    </div>
  );
}

export default function ReviewPerformance({
  companyId,
  employee,
  month,
  metrics,
  entries,
  assignments,
  projects,
  canEnter,
  isOwn,
  onEntries,
}: {
  companyId: string;
  employee: Profile;
  // The review's month, "2026-09-01".
  month: string;
  // The company's metrics, retired ones too; the person's role picks theirs.
  metrics: RoleMetric[];
  // The person's results for the month's year.
  entries: MetricEntry[];
  assignments: ProjectAssignment[];
  // The company's projects, to name the assigned ones.
  projects: Project[];
  canEnter: boolean;
  isOwn: boolean;
  onEntries: EntriesUpdate;
}) {
  const [error, setError] = useState("");
  // A refused save bumps this so the boxes go back to what is stored rather than keep text the
  // database never took.
  const [refusals, setRefusals] = useState(0);
  // Entries whose note box an admin has opened.
  const [noting, setNoting] = useState<string[]>([]);
  const date = parseDate(month);
  const monthLabel = date ? date.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : month;
  const monthShort = date ? date.toLocaleDateString("en-US", { month: "short" }) : month;
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const first = displayName(employee).split(" ")[0];

  const roleMetrics = employee.job_role_id ? metrics.filter((m) => m.job_role_id === employee.job_role_id) : [];
  // The year to date runs through the review's month, so a past month reads as it stood then.
  const through = entries.filter((e) => e.employee_id === employee.id && e.period_month <= month);
  const projectIds = assignments.map((a) => a.project_id);
  const grid = buildYearGrid({ metrics: roleMetrics, entries: through, employeeId: employee.id, year, projectIds });
  // Each metric with its project rows under it. A retired metric is listed only for a month it has
  // a result in.
  const groups: Array<{ head: GridRow; projects: GridRow[] }> = [];
  for (const row of grid.rows) {
    if (row.level === "metric") groups.push({ head: row, projects: [] });
    else groups[groups.length - 1]?.projects.push(row);
  }
  const shown = groups.filter(({ head, projects: rows }) => head.metric.is_active || head.cells[monthIndex].value !== null || rows.some((r) => r.cells[monthIndex].value !== null));
  const judged = shown.map(({ head }) => head.cells[monthIndex]).filter((c) => c.hit !== null);
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "A project";

  function upsertInState(saved: MetricEntry) {
    onEntries((list) => (list.some((e) => e.id === saved.id) ? list.map((e) => (e.id === saved.id ? saved : e)) : [...list, saved]));
  }

  async function write(run: () => Promise<void>) {
    setError("");
    try {
      await run();
    } catch (err) {
      setError(errorMessage(err));
      setRefusals((n) => n + 1);
    }
  }

  // A typed result: blank removes the month's entry, anything else replaces it. "85%" and "1,250"
  // read as typed.
  function saveValue(metric: RoleMetric, projectId: string | null, entry: MetricEntry | null, text: string): void | false {
    const typed = text.replace(/%/g, "").trim();
    if (typed === "") {
      if (entry) void write(async () => {
        await deleteMetricEntry(entry.id);
        onEntries((list) => list.filter((e) => e.id !== entry.id));
      });
      return;
    }
    if (moneyProblem(typed) === "not_a_number") {
      setError("Enter a number.");
      return false;
    }
    const value = parseMoney(typed) as number;
    void write(async () => {
      upsertInState(await upsertMetricEntry({ company_id: companyId, employee_id: employee.id, metric_id: metric.id, period_month: month, project_id: projectId, value, note: entry?.note ?? null }));
    });
  }

  function saveNote(entry: MetricEntry, text: string) {
    void write(async () => {
      upsertInState(await upsertMetricEntry({ company_id: companyId, employee_id: employee.id, metric_id: entry.metric_id, period_month: entry.period_month, project_id: entry.project_id, value: entry.value, note: text.trim() || null }));
    });
  }

  // The box (or the figure, for a reader) a result is entered in: a month-only metric's own row, or
  // one project's row. Plain render helpers rather than components, so a re-render never remounts
  // a box someone is typing in.
  function resultBox(metric: RoleMetric, cell: GridCell, projectId: string | null, label: string) {
    const entry = cell.entry;
    if (!canEnter) return <span className="tnum text-sm text-ink">{formatMetricValue(metric, cell.value)}</span>;
    return (
      <span className="flex items-center gap-1.5">
        <span className="w-20 shrink-0">
        <BlurInput
          key={refusals}
          value={entry ? String(entry.value) : ""}
          ariaLabel={`${label}, ${monthLabel}`}
          placeholder="-"
          onSave={(next) => saveValue(metric, projectId, entry, next)}
          className={`${inputClass} tnum mt-0 py-1.5 text-right`}
        />
        </span>
        <span className="w-8 text-[12px] text-ink-3">{unitOf(metric)}</span>
      </span>
    );
  }

  // A note box only once there is a note, or once an admin asks for one, so a scorecard of empty
  // boxes does not crowd the results.
  function noteBox(entry: MetricEntry | null, label: string) {
    if (canEnter && entry && !entry.note && !noting.includes(entry.id)) {
      return (
        <Button variant="link" size="sm" className="mt-1" onClick={() => setNoting((ids) => [...ids, entry.id])} aria-label={`Add a note on ${label}, ${monthLabel}`}>
          Add a note
        </Button>
      );
    }
    if (canEnter && entry) {
      return (
        <BlurInput
          key={`${entry.id}:${refusals}`}
          value={entry.note ?? ""}
          ariaLabel={`Note on ${label}, ${monthLabel}`}
          placeholder="Note (optional)"
          onSave={(next) => saveNote(entry, next)}
          className={`${inputClass} mt-2 py-1.5 text-[12.5px]`}
        />
      );
    }
    return entry?.note ? <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{entry.note}</p> : null;
  }

  return (
    <Section
      eyebrow={monthLabel}
      title="Performance this month"
      description={`${isOwn ? "Your" : `${first}'s`} role scorecard for ${monthLabel}: each result against its target, and the year to date through ${monthShort}.${canEnter ? " Type a result to enter it; clear it to remove it." : ""}`}
      actions={judged.length > 0 ? <span className="tnum text-[12.5px] text-ink-2">{judged.filter((c) => c.hit).length} of {pluralize(judged.length, "target")} hit</span> : undefined}
    >
      {error ? <Notice tone="error" className="mb-3">{error}</Notice> : null}
      {shown.length === 0 ? (
        <p className="text-sm text-ink-2">
          No scorecard metrics for {isOwn ? "your" : `${first}'s`} role yet.{canEnter ? " Add them to the job role in settings and they show here." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map(({ head, projects: rows }) => {
            const metric = head.metric;
            const cell = head.cells[monthIndex];
            return (
              <li key={metric.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-sm font-medium text-ink">
                      {metric.name}
                      {metric.is_active ? null : <span className="ml-2 text-[12px] font-normal text-ink-3">Retired</span>}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-3">{targetLine(metric)}</p>
                  </div>
                  <div className="flex shrink-0 items-start gap-4">
                    <div className="flex min-h-[34px] items-center gap-2">
                      {metric.per_project ? (
                        <span className="tnum text-sm text-ink">{formatMetricValue(metric, cell.value)}</span>
                      ) : (
                        resultBox(metric, cell, null, metric.name)
                      )}
                      <MonthBadge metric={metric} result={cell} />
                    </div>
                    <YearToDate metric={metric} ytd={head.ytd} />
                  </div>
                </div>
                {metric.per_project ? null : noteBox(cell.entry, metric.name)}
                {metric.per_project ? (
                  rows.length === 0 ? (
                    <p className="mt-2 text-[12.5px] text-ink-3">
                      No projects assigned{canEnter ? "; assign them on the profile to enter this per project." : "."}
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2 border-l border-line pl-3">
                      {rows.map((row) => {
                        const projectCell = row.cells[monthIndex];
                        const name = projectName(row.projectId);
                        return (
                          <li key={row.projectId}>
                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                              <p className="min-w-0 flex-1 basis-40 text-[13px] text-ink-2">{name}</p>
                              <div className="flex items-center gap-2">
                                {resultBox(metric, projectCell, row.projectId, `${metric.name}, ${name}`)}
                                <MonthBadge metric={metric} result={projectCell} />
                              </div>
                            </div>
                            {noteBox(projectCell.entry, `${metric.name}, ${name}`)}
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
