// A person's KPIs for one year: the target as people say it, where it stands, hit or not.
// Full editor on the person page (rename, retarget, add, remove); compact on the review,
// where the manager updates the current figure and the hit mark during the meeting.
//
// Saves for one KPI queue behind each other, so a current figure left by a click on Hit is two
// writes in order rather than two that can land the wrong way round. Each queued write starts from
// the row the one before it returned, so two quick clicks on Hit come back where they began.
import { useRef, useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import { inputClass } from "../ui/forms.ts";
import { createEmployeeKpi, deleteEmployeeKpi, updateEmployeeKpi } from "../../services/employees.ts";
import { errorMessage } from "../../lib/errors.ts";
import { enqueueWrite } from "../../lib/writeQueue.ts";
import type { EmployeeKpi } from "../../types/database.ts";
import { tapTargetClass } from "../ui/tap.ts";

export default function KpiList({
  companyId,
  employeeId,
  year,
  kpis,
  canEdit,
  compact = false,
  onChange,
  onError,
}: {
  companyId: string;
  employeeId: string;
  year: number;
  kpis: EmployeeKpi[];
  canEdit: boolean;
  compact?: boolean;
  onChange: (update: (kpis: EmployeeKpi[]) => EmployeeKpi[]) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  // Removing a KPI drops the year's target and where it stands, so it is confirmed the same
  // way the compensation table beside it confirms a removed line.
  const [deleting, setDeleting] = useState<EmployeeKpi | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The add form waits for its round trip before it takes another submit, or a quick double
  // Enter files the same KPI twice.
  const [adding, setAdding] = useState(false);
  // Per KPI, the last write in line; it settles to the row that write returned (or nothing when it
  // failed), which is what the next write in line builds on. An empty line starts from the KPI as
  // shown, so a reload that brought a newer row is what the next click flips.
  const saveChains = useRef(new Map<string, Promise<EmployeeKpi | undefined>>());

  type Patch = Parameters<typeof updateEmployeeKpi>[1];

  // True when the change landed, false once the page shows why not. A patch may be worked out
  // from the row as it stands once the writes ahead of it are done.
  async function save(kpi: EmployeeKpi, patch: Patch | ((current: EmployeeKpi) => Patch)): Promise<boolean> {
    const chained = enqueueWrite(saveChains.current, kpi.id, async (latest) => {
      const current = latest ?? kpi;
      const next = await updateEmployeeKpi(kpi.id, typeof patch === "function" ? patch(current) : patch);
      onChange((list) => list.map((k) => (k.id === next.id ? next : k)));
      return next;
    });
    try {
      await chained;
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = name.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const created = await createEmployeeKpi({ company_id: companyId, employee_id: employeeId, year, name: text, target_display: target.trim() || null, sort_order: kpis.length + 1 });
      onChange((list) => [...list, created]);
      setName("");
      setTarget("");
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      const id = deleting.id;
      await deleteEmployeeKpi(id);
      onChange((list) => list.filter((k) => k.id !== id));
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const hitBadge = (kpi: EmployeeKpi) =>
    kpi.is_hit ? (
      <Badge tone="success">
        <Check size={11} aria-hidden /> Hit
      </Badge>
    ) : (
      <Badge>Open</Badge>
    );

  return (
    <div>
      {kpis.length === 0 ? <p className="text-sm text-ink-2">No KPIs set for {year} yet.</p> : null}
      <ul className={compact ? "space-y-2" : "divide-y divide-line"}>
        {kpis.map((kpi) => (
          <li key={kpi.id} className={compact ? "flex flex-wrap items-center justify-between gap-2" : "flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0"}>
            <div className="min-w-0 flex-1">
              {canEdit && !compact ? (
                <BlurInput value={kpi.name} required ariaLabel={`KPI ${kpi.name}`} onSave={(next) => save(kpi, { name: next.trim() })} className={`${inputClass} mt-0 text-[13px]`} />
              ) : (
                <p className="text-sm text-ink">{kpi.name}</p>
              )}
              {compact ? (
                <div className="tnum mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                  {canEdit ? (
                    <div className="w-20">
                      <BlurInput value={kpi.current_display ?? ""} placeholder="Current" ariaLabel={`Current for ${kpi.name}`} onSave={(next) => save(kpi, { current_display: next.trim() || null })} className={`${inputClass} mt-0 py-0.5 text-[12px]`} />
                    </div>
                  ) : (
                    <span>{kpi.current_display || "-"}</span>
                  )}
                  <span className="whitespace-nowrap">of {kpi.target_display || "-"}</span>
                </div>
              ) : null}
            </div>
            {!compact ? (
              <>
                <div className="w-28">
                  {canEdit ? <BlurInput value={kpi.target_display ?? ""} placeholder="Target" ariaLabel={`Target for ${kpi.name}`} onSave={(next) => save(kpi, { target_display: next.trim() || null })} className={`${inputClass} tnum mt-0 text-[13px]`} /> : <span className="tnum text-sm text-ink-2">{kpi.target_display || "-"}</span>}
                </div>
                <div className="w-28">
                  {canEdit ? <BlurInput value={kpi.current_display ?? ""} placeholder="Current" ariaLabel={`Current for ${kpi.name}`} onSave={(next) => save(kpi, { current_display: next.trim() || null })} className={`${inputClass} tnum mt-0 text-[13px]`} /> : <span className="tnum text-sm text-ink-2">{kpi.current_display || "-"}</span>}
                </div>
              </>
            ) : null}
            <div className="flex items-center gap-1.5">
              {canEdit ? (
                <button type="button" onClick={() => void save(kpi, (current) => ({ is_hit: !current.is_hit }))} aria-label={kpi.is_hit ? `Mark ${kpi.name} not hit` : `Mark ${kpi.name} hit`} className={tapTargetClass}>
                  {hitBadge(kpi)}
                </button>
              ) : (
                hitBadge(kpi)
              )}
              {canEdit && !compact ? (
                <Button variant="danger" size="sm" aria-label={`Remove KPI ${kpi.name}`} onClick={() => setDeleting(kpi)}>
                  Remove
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {canEdit && !compact ? (
        <form onSubmit={add} className={`flex flex-wrap gap-2 ${kpis.length > 0 ? "mt-4" : "mt-3"}`}>
          <div className="min-w-[220px] flex-1">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Add a KPI for ${year}`} aria-label={`Add a KPI for ${year}`} className={`${inputClass} mt-0`} />
          </div>
          <div className="w-28">
            <input type="text" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target" aria-label="New KPI target" className={`${inputClass} mt-0`} />
          </div>
          <Button type="submit" variant="secondary" disabled={!name.trim() || adding}>
            <Plus size={14} aria-hidden /> {adding ? "Adding..." : "Add"}
          </Button>
        </form>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Remove "${deleting.name}"?`}
          body={`The ${year} target and where it stands are removed with it.`}
          confirmLabel="Remove KPI"
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => { setDeleting(null); setError(""); }}
        />
      ) : null}
    </div>
  );
}
