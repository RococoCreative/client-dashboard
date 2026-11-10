// One person's role scorecard for a year: the metrics their job role is scored on, a column per
// month with the result against target, and the year to date. A per-project metric reads as its
// projects combined, with a row per project under it (their assigned projects first). Admins
// enter or correct a month by picking its cell; the person reads their own. Every number comes
// from lib/scorecard.ts (buildYearGrid), so this screen, the report and the review agree.
//
// The caller loads the rows and keeps them: the person page shares them with its Projects
// section, so assigning a project gives it a row here at once.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import { Link } from "react-router-dom";
import Button from "../ui/Button.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { inputClass, labelClass, selectClass, tableClass, thClass } from "../ui/forms.ts";
import { deleteMetricEntry, upsertMetricEntry } from "../../services/scorecards.ts";
import { buildYearGrid, formatMetricValue, monthOf, type GridCell, type GridRow } from "../../lib/scorecard.ts";
import { errorMessage } from "../../lib/errors.ts";
import { METRIC_KIND_LABELS, type MetricEntry, type RoleMetric } from "../../types/database.ts";
import { monthLabel, scorecardYears } from "./months.ts";
import { latestResultMonth } from "./compare.ts";

function toneOf(hit: boolean | null): string {
  return hit === null ? "text-ink" : hit ? "text-success" : "text-danger";
}

function verdict(hit: boolean | null): string {
  return hit === null ? "" : hit ? ", hit" : ", missed";
}

function rowKey(row: GridRow): string {
  return `${row.metric.id}:${row.projectId ?? ""}`;
}

// A cell can be entered on a month-only metric's row and on a project row. A per-project metric's
// own row is its projects combined, so it is read, never typed into.
function editable(row: GridRow): boolean {
  return row.level === "project" || !row.metric.per_project;
}

function parseValue(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "").replace(/%$/, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// The open cell: what it is, its target, the value and the note, and Clear.
function CellEditor({
  row,
  cell,
  label,
  error,
  onValue,
  onNote,
  onClear,
  onClose,
}: {
  row: GridRow;
  cell: GridCell;
  label: string;
  error: string;
  onValue: (value: number) => void;
  onNote: (note: string | null) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { metric } = row;
  const [hint, setHint] = useState("");
  const scale = metric.kind === "percent" ? "0 to 100" : metric.kind === "rating" ? `1 to ${metric.scale_max}` : "any number";
  return (
    <div className="border-t border-line bg-surface-2/50 px-5 py-4" aria-label={`Entering ${label}`} role="group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="tnum mt-0.5 text-[12px] text-ink-3">
            {METRIC_KIND_LABELS[metric.kind]}, {scale}
            {metric.target !== null ? ` · target ${formatMetricValue(metric, metric.target)}` : " · no target"}
            {metric.higher_is_better ? "" : " · lower is better"}
          </p>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X size={14} aria-hidden />
        </IconButton>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="scorecard-value" className={labelClass}>Result</label>
          <BlurInput
            id="scorecard-value"
            value={cell.entry ? String(cell.entry.value) : ""}
            placeholder={metric.kind === "percent" ? "85" : metric.kind === "rating" ? "4" : "0"}
            className={`${inputClass} tnum`}
            onSave={(next) => {
              const value = parseValue(next);
              if (value === null) {
                setHint(next.trim() === "" ? (cell.entry ? "To remove it, use Clear." : "") : "Enter a number.");
                return false;
              }
              setHint("");
              onValue(value);
            }}
          />
        </div>
        <div>
          <label htmlFor="scorecard-note" className={labelClass}>Note</label>
          <BlurInput
            id="scorecard-note"
            value={cell.entry?.note ?? ""}
            disabled={!cell.entry}
            placeholder={cell.entry ? "What sits behind this number" : "Enter the result first"}
            onSave={(next) => onNote(next.trim() || null)}
          />
        </div>
        {cell.entry ? (
          <Button variant="danger" size="sm" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>
      {hint ? <p className="mt-2 text-[12px] text-ink-3">{hint}</p> : null}
      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
    </div>
  );
}

export default function PersonScorecard({
  companyId,
  employeeId,
  roleName,
  roleId,
  year,
  onYear,
  metrics,
  entries,
  projectIds,
  projectName,
  canEdit,
  onEntries,
  title = "Scorecard",
  description,
}: {
  companyId: string;
  employeeId: string;
  roleName: string | null;
  roleId: string | null;
  year: number;
  onYear: (year: number) => void;
  // The company's metrics, retired ones included (a retired metric shows while it has results).
  metrics: readonly RoleMetric[];
  // The person's results for the year; null while that year loads.
  entries: readonly MetricEntry[] | null;
  projectIds: readonly string[];
  projectName: (id: string) => string;
  canEdit: boolean;
  onEntries: (update: (list: MetricEntry[]) => MetricEntry[]) => void;
  title?: string;
  description?: string;
}) {
  const [open, setOpen] = useState<{ key: string; month: string } | null>(null);
  const [editError, setEditError] = useState("");
  const currentYear = new Date().getFullYear();
  const thisMonth = monthOf(new Date());
  const own = metrics.filter((m) => m.job_role_id === roleId);

  // The latest month with a result is what gets read, so a narrow screen opens the grid scrolled
  // to it rather than to January (December for a past year).
  const focusMonth = year === currentYear ? latestResultMonth((entries ?? []).filter((e) => e.employee_id === employeeId), thisMonth) : `${year}-12-01`;
  const scroller = useRef<HTMLDivElement>(null);
  const loaded = entries !== null;
  useEffect(() => {
    const el = scroller.current;
    const current = el?.querySelector<HTMLElement>("th[data-focus]");
    if (!el || !current) return;
    // The year to date column is pinned on the right, so the month lands just left of it.
    const pinned = el.querySelector<HTMLElement>("th[data-ytd]")?.offsetWidth ?? 0;
    el.scrollLeft = Math.max(0, current.offsetLeft + current.offsetWidth - (el.clientWidth - pinned));
  }, [year, loaded, focusMonth]);

  const grid = entries ? buildYearGrid({ metrics: own, entries, employeeId, year, projectIds }) : null;
  const openRow = open && grid ? (grid.rows.find((r) => rowKey(r) === open.key) ?? null) : null;
  const openCell = openRow && open ? (openRow.cells.find((c) => c.month === open.month) ?? null) : null;

  const rowLabel = (row: GridRow) => (row.level === "project" && row.projectId ? `${row.metric.name}, ${projectName(row.projectId)}` : row.metric.name);
  // Every note on the year, newest month first, so the person (and anyone on a phone, where a
  // hover never happens) can read them without opening a cell.
  const notes = (grid?.rows ?? [])
    .flatMap((row) => row.cells.filter((c) => c.entry?.note).map((c) => ({ id: c.entry!.id, month: c.month, label: rowLabel(row), note: c.entry!.note as string })))
    .sort((a, b) => b.month.localeCompare(a.month));

  function pick(row: GridRow, month: string) {
    setEditError("");
    setOpen((prev) => (prev && prev.key === rowKey(row) && prev.month === month ? null : { key: rowKey(row), month }));
  }

  async function save(row: GridRow, cell: GridCell, value: number, note: string | null) {
    setEditError("");
    try {
      const saved = await upsertMetricEntry({
        company_id: companyId,
        employee_id: employeeId,
        metric_id: row.metric.id,
        period_month: cell.month,
        project_id: row.level === "project" ? row.projectId : null,
        value,
        note,
      });
      onEntries((list) => (list.some((e) => e.id === saved.id) ? list.map((e) => (e.id === saved.id ? saved : e)) : [...list, saved]));
    } catch (err) {
      setEditError(errorMessage(err));
    }
  }

  async function clear(entry: MetricEntry) {
    setEditError("");
    try {
      await deleteMetricEntry(entry.id);
      onEntries((list) => list.filter((e) => e.id !== entry.id));
    } catch (err) {
      setEditError(errorMessage(err));
    }
  }

  const yearPicker = (
    <select aria-label="Scorecard year" value={year} onChange={(e) => onYear(Number(e.target.value))} className={`${selectClass} mt-0 w-auto py-1.5 text-[13px]`}>
      {scorecardYears(currentYear).map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
    </select>
  );

  const body = !roleId ? (
    <p className="p-5 text-sm text-ink-2">{canEdit ? "No job role set. Pick one in Details and its metrics show here." : "No job role set yet."}</p>
  ) : own.length === 0 ? (
    <p className="p-5 text-sm text-ink-2">
      {roleName ?? "This role"} has no scorecard metrics yet.
      {canEdit ? (
        <>
          {" "}Admins add a role's metrics in <Link to="/settings/roles" className="text-accent hover:underline">Settings, Roles</Link>.
        </>
      ) : null}
    </p>
  ) : !grid ? (
    <div className="p-5">
      <SkeletonRows rows={4} />
    </div>
  ) : grid.rows.length === 0 ? (
    <p className="p-5 text-sm text-ink-2">No active metrics on {roleName ?? "this role"}.</p>
  ) : (
    <>
      <div ref={scroller} className="overflow-x-auto">
        <table className={`${tableClass} min-w-[60rem]`}>
          <thead>
            <tr>
              <th className={`${thClass} sticky left-0 z-10 min-w-[9rem] border-r bg-surface sm:min-w-[11rem]`}>Metric</th>
              {grid.months.map((m) => (
                <th key={m} data-focus={m === focusMonth ? "" : undefined} className={`${thClass} px-1.5 text-right ${m === thisMonth ? "text-accent" : ""}`}>
                  {monthLabel(m, "short")}
                </th>
              ))}
              <th data-ytd="" className={`${thClass} sticky right-0 z-10 border-l bg-surface text-right`}><span className="sm:hidden">YTD</span><span className="hidden sm:inline">Year to date</span></th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => {
              const key = rowKey(row);
              const label = rowLabel(row);
              const project = row.level === "project";
              return (
                <tr key={key} className="hover:bg-surface-2/40">
                  <th scope="row" className={`sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-2 text-left align-middle font-normal ${project ? "pl-7" : ""}`}>
                    {project && row.projectId ? (
                      <span className="block text-[12.5px] text-ink-2">{projectName(row.projectId)}</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink">
                        {row.metric.name}
                        {row.metric.is_active ? null : <Badge>Retired</Badge>}
                      </span>
                    )}
                    {project ? null : (
                      <span className="tnum block text-[11px] text-ink-3">
                        {row.metric.target === null ? "No target" : `Target ${formatMetricValue(row.metric, row.metric.target)}`}
                        {row.metric.per_project ? " · all projects" : ""}
                      </span>
                    )}
                  </th>
                  {row.cells.map((cell) => {
                    const shown = formatMetricValue(row.metric, cell.value);
                    const cellLabel = `${label}, ${monthLabel(cell.month)}: ${cell.value === null ? "no result" : shown}${verdict(cell.hit)}`;
                    const note = cell.entry?.note ?? null;
                    const inner = (
                      <span className={`tnum ${cell.value === null ? "text-ink-3" : toneOf(cell.hit)}`}>
                        {shown}
                        {note ? <span aria-hidden className="ml-0.5 align-super text-[9px] text-accent">•</span> : null}
                      </span>
                    );
                    const selected = open?.key === key && open.month === cell.month;
                    return (
                      <td key={cell.month} className="border-b border-line px-1 py-1 text-right text-[12.5px]" title={note ?? undefined}>
                        {canEdit && editable(row) ? (
                          <Button variant="row" aria-label={cellLabel} aria-pressed={selected} onClick={() => pick(row, cell.month)} className="justify-end rounded px-1.5 py-1 text-[12.5px]">
                            {inner}
                          </Button>
                        ) : (
                          <span aria-label={cellLabel} className="block px-1.5 py-1">
                            {inner}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 border-b border-l border-line bg-surface px-3 py-2 text-right">
                    <span
                      aria-label={`${label}, year to date: ${row.ytd.value === null ? "no result" : formatMetricValue(row.metric, row.ytd.value)}${verdict(row.ytd.hit)}`}
                      className="inline-flex items-center justify-end gap-1.5"
                    >
                      <span className={`tnum text-[13px] font-medium ${row.ytd.value === null ? "text-ink-3" : toneOf(row.ytd.hit)}`}>{formatMetricValue(row.metric, row.ytd.value)}</span>
                      {row.ytd.hit === null ? null : (
                        <span className="hidden sm:inline">
                          <Badge tone={row.ytd.hit ? "success" : "danger"}>{row.ytd.hit ? "Hit" : "Miss"}</Badge>
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && openRow && openCell ? (
        <CellEditor
          key={`${open!.key}:${open!.month}`}
          row={openRow}
          cell={openCell}
          label={`${rowLabel(openRow)}, ${monthLabel(openCell.month)}`}
          error={editError}
          onValue={(value) => void save(openRow, openCell, value, openCell.entry?.note ?? null)}
          onNote={(note) => (openCell.entry ? void save(openRow, openCell, openCell.entry.value, note) : undefined)}
          onClear={() => (openCell.entry ? void clear(openCell.entry) : undefined)}
          onClose={() => setOpen(null)}
        />
      ) : (
        <p className="px-5 py-3 text-[12px] text-ink-3">
          {canEdit ? "Pick a month to enter or correct its result. " : ""}Green hit its target, red missed it. A dot marks a note.
        </p>
      )}
      {notes.length > 0 ? (
        <div className="border-t border-line px-5 py-3">
          <p className={labelClass}>Notes</p>
          <ul className="mt-1.5 space-y-1 text-[12.5px]">
            {notes.map((n) => (
              <li key={n.id} className="text-ink-2">
                <span className="text-ink-3">{monthLabel(n.month, "short")} · {n.label}:</span> {n.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );

  return (
    <Section
      eyebrow={roleName ? `${roleName} · ${year}` : String(year)}
      title={title}
      description={description}
      actions={roleId && own.length > 0 ? yearPicker : undefined}
      padded={false}
    >
      {body}
    </Section>
  );
}
