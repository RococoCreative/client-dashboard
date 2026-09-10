// A person's KPIs for one year: the target as people say it, where it stands, hit or not.
// Full editor on the person page (rename, retarget, add, remove); compact on the review,
// where the manager updates the current figure and the hit mark during the meeting.
import { useState, type FormEvent } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import IconButton from "../ui/IconButton.tsx";
import { inputClass } from "../ui/forms.ts";
import { createEmployeeKpi, deleteEmployeeKpi, updateEmployeeKpi } from "../../services/employees.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { EmployeeKpi } from "../../types/database.ts";

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

  async function save(kpi: EmployeeKpi, patch: Parameters<typeof updateEmployeeKpi>[1]) {
    try {
      const next = await updateEmployeeKpi(kpi.id, patch);
      onChange((list) => list.map((k) => (k.id === next.id ? next : k)));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = name.trim();
    if (!text) return;
    try {
      const created = await createEmployeeKpi({ company_id: companyId, employee_id: employeeId, year, name: text, target_display: target.trim() || null, sort_order: kpis.length + 1 });
      onChange((list) => [...list, created]);
      setName("");
      setTarget("");
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function remove(kpi: EmployeeKpi) {
    try {
      await deleteEmployeeKpi(kpi.id);
      onChange((list) => list.filter((k) => k.id !== kpi.id));
    } catch (err) {
      onError(errorMessage(err));
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
                <BlurInput value={kpi.name} ariaLabel={`KPI ${kpi.name}`} onSave={(next) => void save(kpi, { name: next.trim() || kpi.name })} className={`${inputClass} mt-0 text-[13px]`} />
              ) : (
                <p className="text-sm text-ink">{kpi.name}</p>
              )}
              {compact ? (
                <div className="tnum mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                  {canEdit ? (
                    <div className="w-20">
                      <BlurInput value={kpi.current_display ?? ""} placeholder="Current" ariaLabel={`Current for ${kpi.name}`} onSave={(next) => void save(kpi, { current_display: next.trim() || null })} className={`${inputClass} mt-0 py-0.5 text-[12px]`} />
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
                  {canEdit ? <BlurInput value={kpi.target_display ?? ""} placeholder="Target" ariaLabel={`Target for ${kpi.name}`} onSave={(next) => void save(kpi, { target_display: next.trim() || null })} className={`${inputClass} tnum mt-0 text-[13px]`} /> : <span className="tnum text-sm text-ink-2">{kpi.target_display || "-"}</span>}
                </div>
                <div className="w-28">
                  {canEdit ? <BlurInput value={kpi.current_display ?? ""} placeholder="Current" ariaLabel={`Current for ${kpi.name}`} onSave={(next) => void save(kpi, { current_display: next.trim() || null })} className={`${inputClass} tnum mt-0 text-[13px]`} /> : <span className="tnum text-sm text-ink-2">{kpi.current_display || "-"}</span>}
                </div>
              </>
            ) : null}
            <div className="flex items-center gap-1.5">
              {canEdit ? (
                <button type="button" onClick={() => void save(kpi, { is_hit: !kpi.is_hit })} aria-label={kpi.is_hit ? `Mark ${kpi.name} not hit` : `Mark ${kpi.name} hit`}>
                  {hitBadge(kpi)}
                </button>
              ) : (
                hitBadge(kpi)
              )}
              {canEdit && !compact ? (
                <IconButton label={`Remove KPI ${kpi.name}`} onClick={() => void remove(kpi)}>
                  <Trash2 size={14} aria-hidden />
                </IconButton>
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
          <Button type="submit" variant="secondary" disabled={!name.trim()}>
            <Plus size={14} aria-hidden /> Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}
