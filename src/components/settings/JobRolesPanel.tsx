// The company's job roles, for an admin in Settings > Roles: the jobs people do here, the
// dashboard modules each role gets, and the metrics the role is scored on each month (its
// scorecard). The goals a role brings into every month are edited in Goals > By role; each card
// lists them and links there. Roles and metrics are rows (rule 12): a company shapes its own set
// and nothing here knows a company by name. Every change saves on its own.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { checkboxClass, inputClass, selectClass } from "../ui/forms.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { createJobRole, deleteJobRole, listJobRoleGoals, listJobRoles, updateJobRole } from "../../services/jobRoles.ts";
import { createRoleMetric, deleteRoleMetric, listRoleMetrics, updateRoleMetric, type RoleMetricPatch } from "../../services/scorecards.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import { roleGoalsPath } from "../goals/roleGoalsAnchor.ts";
import { DASHBOARD_MODULE_LABELS, METRIC_KIND_LABELS, keysOf, type DashboardModule, type JobRole, type JobRoleGoal, type MetricKind, type RoleMetric } from "../../types/database.ts";

const eyebrowClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";

function AddForm({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle("");
    onAdd(text);
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${inputClass} mt-0 flex-1`} />
      <Button type="submit" variant="secondary" disabled={!title.trim()}>
        <Plus size={14} aria-hidden /> {label}
      </Button>
    </form>
  );
}

const SCALES = [2, 3, 4, 5, 6, 7, 8, 9, 10];
// The shared control classes at a compact size for the dense metric rows: the same look, without
// the stacked-form top margin, and one step shorter.
const compact = (cls: string) => `${cls.replace("mt-1.5 ", "").replace("py-2 ", "")} py-1.5 text-[13px]`;
const smallInput = compact(inputClass);
const smallSelect = compact(selectClass);
const toggleLabel = "flex items-center gap-1.5 text-[12.5px] text-ink-2";

// A number typed into a metric field: blank is none, anything else has to read as a number.
function parseNumber(text: string): number | null | undefined {
  const cleaned = text.trim().replace(/,/g, "").replace(/%$/, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

// One metric on a role's scorecard: what it is called, how it is measured (a percent, a rating
// on a scale, or a plain number), its target and which way is better, whether it is entered per
// project, its place in the list, and whether it is still scored. Retiring keeps its results.
function MetricRow({ metric, onSave, onDelete, onError }: { metric: RoleMetric; onSave: (patch: RoleMetricPatch) => void; onDelete: () => void; onError: (message: string) => void }) {
  return (
    <li className={`py-2.5 ${metric.is_active ? "" : "opacity-70"}`}>
      <div className="flex items-center gap-2">
        <BlurInput value={metric.name} required ariaLabel={`Metric name ${metric.name}`} onSave={(next) => onSave({ name: next.trim() })} className={`${smallInput} min-w-0 flex-1 font-medium`} />
        {metric.is_active ? null : <Badge>Retired</Badge>}
        <IconButton label={`Delete metric ${metric.name}`} onClick={onDelete}>
          <Trash2 size={14} aria-hidden />
        </IconButton>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div>
          <select aria-label={`Kind for ${metric.name}`} value={metric.kind} onChange={(e) => onSave({ kind: e.target.value as MetricKind })} className={smallSelect}>
            {keysOf(METRIC_KIND_LABELS).map((k) => (
              <option key={k} value={k}>{METRIC_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        {metric.kind === "rating" ? (
          <div>
            <select aria-label={`Scale for ${metric.name}`} value={metric.scale_max} onChange={(e) => onSave({ scale_max: Number(e.target.value) })} className={smallSelect}>
              {SCALES.map((n) => (
                <option key={n} value={n}>1 to {n}</option>
              ))}
            </select>
          </div>
        ) : null}
        <label className={toggleLabel}>
          <span>Target</span>
          <span className="block w-20">
            <BlurInput
              value={metric.target === null ? "" : String(metric.target)}
              placeholder="None"
              ariaLabel={`Target for ${metric.name}`}
              className={`${smallInput} tnum`}
              onSave={(next) => {
                const value = parseNumber(next);
                if (value === undefined) {
                  onError("A target is a number, or blank for none.");
                  return false;
                }
                onSave({ target: value });
              }}
            />
          </span>
          {metric.kind === "percent" ? <span className="text-ink-3">%</span> : null}
        </label>
        <label className={toggleLabel}>
          <span>Order</span>
          <span className="block w-14">
            <BlurInput
              value={String(metric.sort_order)}
              ariaLabel={`Order for ${metric.name}`}
              className={`${smallInput} tnum`}
              onSave={(next) => {
                const value = parseNumber(next);
                if (value === null || value === undefined || !Number.isInteger(value)) {
                  onError("The order is a whole number.");
                  return false;
                }
                onSave({ sort_order: value });
              }}
            />
          </span>
        </label>
        <label className={toggleLabel}>
          <input type="checkbox" className={checkboxClass} checked={metric.higher_is_better} aria-label={`Higher is better for ${metric.name}`} onChange={(e) => onSave({ higher_is_better: e.target.checked })} />
          <span>Higher is better</span>
        </label>
        <label className={toggleLabel}>
          <input type="checkbox" className={checkboxClass} checked={metric.per_project} aria-label={`Per project for ${metric.name}`} onChange={(e) => onSave({ per_project: e.target.checked })} />
          <span>Per project</span>
        </label>
        <label className={toggleLabel}>
          <input type="checkbox" className={checkboxClass} checked={metric.is_active} aria-label={`Active for ${metric.name}`} onChange={(e) => onSave({ is_active: e.target.checked })} />
          <span>Active</span>
        </label>
      </div>
    </li>
  );
}

// A role's scorecard: its metrics and the form to add one.
function RoleMetrics({
  role,
  metrics,
  onMetrics,
  onDelete,
  onError,
}: {
  role: JobRole;
  metrics: RoleMetric[];
  onMetrics: (update: (list: RoleMetric[]) => RoleMetric[]) => void;
  onDelete: (metric: RoleMetric) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MetricKind>("percent");
  const own = metrics.filter((m) => m.job_role_id === role.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = name.trim();
    if (!text) return;
    onError("");
    try {
      const created = await createRoleMetric({ job_role_id: role.id, name: text, kind, sort_order: Math.max(0, ...own.map((m) => m.sort_order)) + 1 });
      onMetrics((list) => [...list, created]);
      setName("");
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function save(metric: RoleMetric, patch: RoleMetricPatch) {
    onError("");
    try {
      const next = await updateRoleMetric(metric.id, patch);
      onMetrics((list) => list.map((m) => (m.id === next.id ? next : m)));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  return (
    <div className="mt-4">
      <p className={eyebrowClass}>Scorecard metrics</p>
      <p className="mt-0.5 text-[12px] text-ink-3">What people in this role are scored on each month, against target. Results are entered on each person's profile. Untick Active to retire a metric and keep its history.</p>
      {own.length > 0 ? (
        <ul className="mt-2 divide-y divide-line">
          {own.map((metric) => (
            <MetricRow key={metric.id} metric={metric} onSave={(patch) => void save(metric, patch)} onDelete={() => onDelete(metric)} onError={onError} />
          ))}
        </ul>
      ) : null}
      <form onSubmit={(e) => void add(e)} className="mt-2 flex flex-wrap gap-2">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Add a metric for ${role.name}`} aria-label={`Add a metric for ${role.name}`} className={`${inputClass} mt-0 min-w-0 flex-1 basis-48`} />
        <div>
          <select aria-label={`Kind of new metric for ${role.name}`} value={kind} onChange={(e) => setKind(e.target.value as MetricKind)} className={`${selectClass} mt-0`}>
            {keysOf(METRIC_KIND_LABELS).map((k) => (
              <option key={k} value={k}>{METRIC_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary" disabled={!name.trim()}>
          <Plus size={14} aria-hidden /> Add metric
        </Button>
      </form>
    </div>
  );
}

// One role: its name and description, the modules its people see, the role goals it brings (read
// here, edited in Goals > By role), and its scorecard metrics.
function RoleCard({
  role,
  goals,
  metrics,
  onRole,
  onDelete,
  onError,
}: {
  role: JobRole;
  goals: JobRoleGoal[];
  // The scorecard half, or null when the metrics did not load (the rest of the card still works).
  metrics: ReactNode;
  onRole: (role: JobRole) => void;
  onDelete: () => void;
  onError: (message: string) => void;
}) {
  async function save(patch: Parameters<typeof updateJobRole>[1]) {
    try {
      onRole(await updateJobRole(role.id, patch));
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  function toggleModule(module: DashboardModule, on: boolean) {
    const next = on ? [...new Set([...role.dashboard_modules, module])] : role.dashboard_modules.filter((m) => m !== module);
    void save({ dashboard_modules: next });
  }
  return (
    <li className={`rounded-lg border border-line bg-surface p-4 ${role.is_active ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <BlurInput value={role.name} required ariaLabel={`Name for ${role.name}`} onSave={(next) => void save({ name: next.trim() })} className={`${inputClass} mt-0 font-medium`} />
          <BlurInput value={role.description ?? ""} placeholder="What this role owns, in a line" ariaLabel={`Description for ${role.name}`} onSave={(next) => void save({ description: next.trim() || null })} className={`${inputClass} mt-2 text-[13px]`} />
        </div>
        <div className="flex items-center gap-2">
          {role.is_active ? null : <Badge>Retired</Badge>}
          <Button variant="ghost" size="sm" onClick={() => void save({ is_active: !role.is_active })}>
            {role.is_active ? "Retire" : "Restore"}
          </Button>
          <IconButton label={`Delete ${role.name}`} onClick={onDelete}>
            <Trash2 size={14} aria-hidden />
          </IconButton>
        </div>
      </div>
      {role.is_active ? null : (
        <p className="mt-2 text-[12px] text-ink-3">Retired: it stays on the profiles of the people still in it, but no longer adds its dashboard modules or its role goals for them. Restore it to bring both back.</p>
      )}

      <div className="mt-4">
        <p className={eyebrowClass}>Dashboard modules</p>
        <ul className="mt-1.5 space-y-1.5">
          {keysOf(DASHBOARD_MODULE_LABELS).map((module) => (
            <li key={module}>
              <label className="flex items-start gap-2 text-[13px] text-ink">
                <input type="checkbox" className={`${checkboxClass} mt-0.5`} checked={role.dashboard_modules.includes(module)} aria-label={`${DASHBOARD_MODULE_LABELS[module]} for ${role.name}`} onChange={(e) => toggleModule(module, e.target.checked)} />
                <span>{DASHBOARD_MODULE_LABELS[module]}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={eyebrowClass}>Role goals</p>
          <Link to={roleGoalsPath(role.id)} className="text-[12.5px] text-accent hover:underline">
            {goals.length > 0 ? "Edit in Goals, By role" : "Add in Goals, By role"}
          </Link>
        </div>
        {goals.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {goals.map((goal) => (
              <li key={goal.id} className="text-[13px] text-ink">{goal.title}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-0.5 text-[12px] text-ink-3">None yet. Role goals are offered in every month's Goal Setting Review for the people in this role, and are set in Goals, By role.</p>
        )}
      </div>
      {metrics}
    </li>
  );
}

export default function JobRolesPanel({ companyId }: { companyId: string }) {
  const state = useAsync(async () => {
    const [roles, goals] = await Promise.all([listJobRoles(companyId, true), listJobRoleGoals(companyId)]);
    return { roles, goals };
  }, [companyId]);
  // The scorecard metrics load on their own, so a failure there leaves the roles workable.
  const metricState = useAsync(() => listRoleMetrics(companyId, true), [companyId]);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<JobRole | null>(null);
  const [deletingMetric, setDeletingMetric] = useState<RoleMetric | null>(null);
  const [busy, setBusy] = useState(false);
  // The delete dialog reports only its own failure, never an inline save's or an earlier
  // dialog's, so its error is cleared whenever it opens. A delete already sent cannot be called
  // back, so the dialog waits for the answer rather than closing on Cancel mid-flight.
  const [dialogError, setDialogError] = useState("");

  async function add(name: string) {
    setError("");
    try {
      const created = await createJobRole({ company_id: companyId, name, sort_order: (state.data?.roles.length ?? 0) + 1 });
      state.setData((prev) => (prev ? { ...prev, roles: [...prev.roles, created] } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Modal keeps Tab inside the dialog, but focus can still be put on another role's Delete under
  // the scrim some other way. While a delete runs that opens nothing, or the running one's failure
  // would land in the other role's dialog.
  function openDelete(role: JobRole) {
    if (busy) return;
    setDialogError("");
    setDeleting(role);
  }

  function closeDelete() {
    if (busy) return;
    setDeleting(null);
    setDeletingMetric(null);
    setDialogError("");
  }

  function openDeleteMetric(metric: RoleMetric) {
    if (busy) return;
    setDialogError("");
    setDeletingMetric(metric);
  }

  // A metric with results on file is refused by the database, which says to retire it instead;
  // the dialog shows that answer where it will be read.
  async function removeMetric() {
    if (!deletingMetric) return;
    const id = deletingMetric.id;
    setBusy(true);
    setDialogError("");
    try {
      await deleteRoleMetric(id);
      metricState.setData((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
      setDeletingMetric(null);
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    setBusy(true);
    setDialogError("");
    try {
      await deleteJobRole(id);
      state.setData((prev) => (prev ? { roles: prev.roles.filter((r) => r.id !== id), goals: prev.goals.filter((g) => g.job_role_id !== id) } : prev));
      setDeleting(null);
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const roles = state.data?.roles ?? [];
  const goals = state.data?.goals ?? [];

  return (
    <Section
      eyebrow="People"
      title="Job roles"
      description="The jobs people do here. A person's role decides which modules their dashboard carries, which goals their monthly Goal Setting Review offers, and the metrics their scorecard is scored on. Set it on their profile. Retiring a role keeps it on record, but it stops adding its modules and goals for anyone still in it."
    >
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={3} /> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.data ? (
        <>
          <AddForm placeholder="Add a job role" label="Add role" onAdd={(name) => void add(name)} />
          {roles.length === 0 ? (
            <p className="mt-4 text-sm text-ink-2">No job roles yet. Add one, then place people in it from their profiles.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {roles.map((role) => (
                <RoleCard
                  key={role.id}
                  role={role}
                  goals={goals.filter((g) => g.job_role_id === role.id)}
                  metrics={
                    metricState.data ? (
                      <RoleMetrics
                        role={role}
                        metrics={metricState.data}
                        onMetrics={(update) => metricState.setData((prev) => (prev ? update(prev) : prev))}
                        onDelete={openDeleteMetric}
                        onError={setError}
                      />
                    ) : metricState.error ? (
                      <p className="mt-4 text-[12px] text-ink-3">Scorecard metrics did not load. {metricState.error}</p>
                    ) : null
                  }
                  onRole={(next) => state.setData((prev) => (prev ? { ...prev, roles: prev.roles.map((r) => (r.id === next.id ? next : r)) } : prev))}
                  onDelete={() => openDelete(role)}
                  onError={setError}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          body={`People in this role lose it, and its ${pluralize(goals.filter((g) => g.job_role_id === deleting.id).length, "role goal")} go with it. Goals already filed into a review stay. Retire the role instead to keep it on record.`}
          confirmLabel="Delete role"
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={closeDelete}
        />
      ) : null}
      {deletingMetric ? (
        <ConfirmDialog
          title={`Delete "${deletingMetric.name}"?`}
          body="It comes off the role's scorecard for good. A metric with results entered cannot be deleted; untick Active to retire it instead and keep its history."
          confirmLabel="Delete metric"
          busy={busy}
          error={dialogError}
          onConfirm={() => void removeMetric()}
          onCancel={closeDelete}
        />
      ) : null}
    </Section>
  );
}
