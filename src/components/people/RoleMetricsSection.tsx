// One job role's scorecard on People, Roles: the metrics people in the role are scored on each
// month, against target. Each metric reads as a line of text until its pencil opens the full set
// of controls (name, kind, scale, target, order, which way is better, per project, active), which
// save on their own. One Add metric button opens the one add form. Metrics are rows of the role
// (rule 12), so nothing here knows a company by name.
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import EditRow from "../ui/EditRow.tsx";
import IconButton from "../ui/IconButton.tsx";
import { checkboxClass, inputClass, selectClass } from "../ui/forms.ts";
import { bodyClass, eyebrowLabelClass, metaClass, secondaryClass } from "../ui/type.ts";
import { createRoleMetric, deleteRoleMetric, updateRoleMetric, type RoleMetricPatch } from "../../services/scorecards.ts";
import { errorMessage } from "../../lib/errors.ts";
import { METRIC_KIND_LABELS, keysOf, type JobRole, type MetricKind, type RoleMetric } from "../../types/database.ts";

const ICON_SIZE = "!h-11 !w-11 sm:!h-9 sm:!w-9";

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

// What a metric reads as when it is not open: how it is measured, its target, which way is
// better, and whether it is entered per project.
function metricFacts(metric: RoleMetric): string {
  const kind = metric.kind === "rating" ? `${METRIC_KIND_LABELS.rating}, 1 to ${metric.scale_max}` : METRIC_KIND_LABELS[metric.kind];
  const target = metric.target === null ? "No target" : `Target ${metric.target}${metric.kind === "percent" ? "%" : ""}`;
  const facts = [kind, target, metric.higher_is_better ? "Higher is better" : "Lower is better"];
  if (metric.per_project) facts.push("Per project");
  return facts.join(" · ");
}

// One metric's controls, shown once its pencil is clicked. Every field saves on its own.
function MetricForm({ metric, onSave, onDelete, onError }: { metric: RoleMetric; onSave: (patch: RoleMetricPatch) => Promise<boolean>; onDelete: () => void; onError: (message: string) => void }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <BlurInput value={metric.name} required ariaLabel={`Metric name ${metric.name}`} onSave={(next) => onSave({ name: next.trim() })} className={`${smallInput} min-w-0 flex-1 font-medium`} />
        <IconButton label={`Delete metric ${metric.name}`} onClick={onDelete} className={ICON_SIZE}>
          <Trash2 size={14} aria-hidden />
        </IconButton>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div>
          <select aria-label={`Kind for ${metric.name}`} value={metric.kind} onChange={(e) => void onSave({ kind: e.target.value as MetricKind })} className={smallSelect}>
            {keysOf(METRIC_KIND_LABELS).map((k) => (
              <option key={k} value={k}>{METRIC_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        {metric.kind === "rating" ? (
          <div>
            <select aria-label={`Scale for ${metric.name}`} value={metric.scale_max} onChange={(e) => void onSave({ scale_max: Number(e.target.value) })} className={smallSelect}>
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
                return onSave({ target: value });
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
                return onSave({ sort_order: value });
              }}
            />
          </span>
        </label>
        <label className={toggleLabel}>
          <input type="checkbox" className={checkboxClass} checked={metric.higher_is_better} aria-label={`Higher is better for ${metric.name}`} onChange={(e) => void onSave({ higher_is_better: e.target.checked })} />
          <span>Higher is better</span>
        </label>
        <label className={toggleLabel}>
          <input type="checkbox" className={checkboxClass} checked={metric.per_project} aria-label={`Per project for ${metric.name}`} onChange={(e) => void onSave({ per_project: e.target.checked })} />
          <span>Per project</span>
        </label>
        <label className={toggleLabel}>
          <input type="checkbox" className={checkboxClass} checked={metric.is_active} aria-label={`Active for ${metric.name}`} onChange={(e) => void onSave({ is_active: e.target.checked })} />
          <span>Active</span>
        </label>
      </div>
    </div>
  );
}

// The one add form, opened by Add metric.
function AddMetricForm({ role, nextOrder, onAdded, onCancel, onError }: { role: JobRole; nextOrder: number; onAdded: (metric: RoleMetric) => void; onCancel: () => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MetricKind>("percent");
  // The add form waits for its round trip, or a quick double Enter files the metric twice.
  const [adding, setAdding] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = name.trim();
    if (!text || adding) return;
    onError("");
    setAdding(true);
    try {
      onAdded(await createRoleMetric({ job_role_id: role.id, name: text, kind, sort_order: nextOrder }));
    } catch (err) {
      onError(errorMessage(err));
      setAdding(false);
    }
  }

  return (
    <form onSubmit={(e) => void add(e)} className="mt-3 flex flex-wrap gap-2">
      <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`Add a metric for ${role.name}`} aria-label={`Add a metric for ${role.name}`} className={`${inputClass} mt-0 min-w-0 flex-1 basis-48`} />
      <div>
        <select aria-label={`Kind of new metric for ${role.name}`} value={kind} onChange={(e) => setKind(e.target.value as MetricKind)} className={`${selectClass} mt-0`}>
          {keysOf(METRIC_KIND_LABELS).map((k) => (
            <option key={k} value={k}>{METRIC_KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary" disabled={!name.trim() || adding}>
        Add metric
      </Button>
      <Button variant="ghost" onClick={onCancel} disabled={adding}>
        Cancel
      </Button>
    </form>
  );
}

export default function RoleMetricsSection({
  role,
  metrics,
  loadError,
  busy,
  onBusy,
  onMetrics,
  onError,
}: {
  role: JobRole;
  // Every metric in the company, or null while they load or when they did not.
  metrics: RoleMetric[] | null;
  loadError: string;
  // A delete running anywhere on the role, shared with the role's own Delete: while one runs, a
  // Delete reached under the scrim opens nothing, so its failure never lands in another dialog.
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onMetrics: (update: (list: RoleMetric[]) => RoleMetric[]) => void;
  onError: (message: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<RoleMetric | null>(null);
  // The delete dialog reports only its own failure, never an inline save's or an earlier
  // dialog's, so its error is cleared whenever it opens. A delete already sent cannot be called
  // back, so the dialog waits for the answer rather than closing on Cancel mid-flight.
  const [dialogError, setDialogError] = useState("");
  const own = (metrics ?? []).filter((m) => m.job_role_id === role.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  // True when the change landed, false once the page shows why not.
  async function save(metric: RoleMetric, patch: RoleMetricPatch): Promise<boolean> {
    onError("");
    try {
      const next = await updateRoleMetric(metric.id, patch);
      onMetrics((list) => list.map((m) => (m.id === next.id ? next : m)));
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    }
  }

  function openDelete(metric: RoleMetric) {
    if (busy) return;
    setDialogError("");
    setDeleting(metric);
  }

  function closeDelete() {
    if (busy) return;
    setDeleting(null);
    setDialogError("");
  }

  // A metric with results on file is refused by the database, which says to retire it instead;
  // the dialog shows that answer where it will be read.
  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    onBusy(true);
    setDialogError("");
    try {
      await deleteRoleMetric(id);
      onMetrics((list) => list.filter((m) => m.id !== id));
      setDeleting(null);
      setEditingId(null);
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      onBusy(false);
    }
  }

  return (
    <section aria-labelledby="role-metrics-title" className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="role-metrics-title" className={eyebrowLabelClass}>Scorecard metrics</h3>
        {metrics && !adding ? (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden /> Add metric
          </Button>
        ) : null}
      </div>
      <p className={`${metaClass} mt-1`}>What people in this role are scored on each month, against target. Results are entered on each person's profile. Untick Active to retire a metric and keep its history.</p>
      {adding ? (
        <AddMetricForm
          role={role}
          nextOrder={Math.max(0, ...own.map((m) => m.sort_order)) + 1}
          onAdded={(created) => {
            onMetrics((list) => [...list, created]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
          onError={onError}
        />
      ) : null}
      {!metrics ? (
        loadError ? <p className={`${metaClass} mt-3`}>Scorecard metrics did not load. {loadError}</p> : null
      ) : own.length === 0 ? (
        <p className={`${secondaryClass} mt-3`}>No metrics yet. People in this role have no scorecard until one is added.</p>
      ) : (
        <ul className="mt-2 border-t border-line">
          {own.map((metric) => (
            <li key={metric.id} className={metric.is_active ? "" : "opacity-70"}>
              <EditRow
                editLabel={`Edit metric ${metric.name}`}
                editing={editingId === metric.id}
                onEdit={() => setEditingId(metric.id)}
                onDone={() => setEditingId(null)}
                display={
                  <>
                    <p className={`${bodyClass} flex flex-wrap items-center gap-2 font-medium`}>
                      <span className="break-words">{metric.name}</span>
                      {metric.is_active ? null : <Badge>Retired</Badge>}
                    </p>
                    <p className={metaClass}>{metricFacts(metric)}</p>
                  </>
                }
              >
                <MetricForm metric={metric} onSave={(patch) => save(metric, patch)} onDelete={() => openDelete(metric)} onError={onError} />
              </EditRow>
            </li>
          ))}
        </ul>
      )}
      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          body="It comes off the role's scorecard for good. A metric with results entered cannot be deleted; untick Active to retire it instead and keep its history."
          confirmLabel="Delete metric"
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={closeDelete}
        />
      ) : null}
    </section>
  );
}
