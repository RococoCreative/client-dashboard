// A person's own financial figures for one year: what they own (closed sales, revenue
// managed), the target, where it stands, and where the number came from. Manual entry today;
// QuickBooks and GoHighLevel later write the same rows with their own source, and a figure an
// admin corrects by hand is marked as a hand entry again. Edited on the person page; read on
// the person's dashboard when their job role carries the module.
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import { inputClass } from "../ui/forms.ts";
import { createEmployeeFinancial, deleteEmployeeFinancial, updateEmployeeFinancial } from "../../services/employees.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatMoney, formatPercent, parseMoney } from "../../lib/format.ts";
import { financialProgress } from "../../lib/people.ts";
import { FINANCIAL_SOURCE_LABELS, type EmployeeFinancial } from "../../types/database.ts";

export default function FinancialsTable({
  employeeId,
  year,
  rows,
  canEdit,
  onChange,
  onError,
}: {
  employeeId: string;
  year: number;
  rows: EmployeeFinancial[];
  canEdit: boolean;
  onChange: (update: (rows: EmployeeFinancial[]) => EmployeeFinancial[]) => void;
  onError: (message: string) => void;
}) {
  const [metric, setMetric] = useState("");
  const [target, setTarget] = useState("");
  const [deleting, setDeleting] = useState<EmployeeFinancial | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(row: EmployeeFinancial, patch: Parameters<typeof updateEmployeeFinancial>[1]) {
    try {
      const next = await updateEmployeeFinancial(row.id, patch);
      onChange((list) => list.map((r) => (r.id === next.id ? next : r)));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = metric.trim();
    if (!text) return;
    try {
      const created = await createEmployeeFinancial({ employee_id: employeeId, year, metric: text, target: parseMoney(target), sort_order: rows.length + 1 });
      onChange((list) => [...list, created]);
      setMetric("");
      setTarget("");
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      const id = deleting.id;
      await deleteEmployeeFinancial(id);
      onChange((list) => list.filter((r) => r.id !== id));
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {rows.length === 0 ? <p className="text-sm text-ink-2">No figures for {year} yet.</p> : null}
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const progress = financialProgress(row);
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                {canEdit ? (
                  <BlurInput value={row.metric} ariaLabel={`Figure ${row.metric}`} onSave={(next) => void save(row, { metric: next.trim() || row.metric })} className={`${inputClass} mt-0 text-[13px]`} />
                ) : (
                  <p className="text-sm text-ink">{row.metric}</p>
                )}
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {FINANCIAL_SOURCE_LABELS[row.source]}
                  {progress === null ? "" : ` · ${formatPercent(progress)} of target`}
                </p>
              </div>
              <div className="w-32">
                {canEdit ? (
                  <BlurInput value={row.target === null ? "" : String(row.target)} placeholder="Target" ariaLabel={`Target for ${row.metric}`} onSave={(next) => void save(row, { target: parseMoney(next), source: "manual" })} className={`${inputClass} tnum mt-0 text-[13px]`} />
                ) : (
                  <span className="tnum text-sm text-ink-2">{formatMoney(row.target)}</span>
                )}
              </div>
              <div className="w-32">
                {canEdit ? (
                  <BlurInput value={row.current === null ? "" : String(row.current)} placeholder="Current" ariaLabel={`Current for ${row.metric}`} onSave={(next) => void save(row, { current: parseMoney(next), source: "manual" })} className={`${inputClass} tnum mt-0 text-[13px]`} />
                ) : (
                  <span className="tnum text-sm text-ink-2">{formatMoney(row.current)}</span>
                )}
              </div>
              {canEdit ? (
                <IconButton label={`Remove figure ${row.metric}`} onClick={() => setDeleting(row)}>
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canEdit ? (
        <form onSubmit={add} className={`flex flex-wrap gap-2 ${rows.length > 0 ? "mt-4" : "mt-3"}`}>
          <div className="min-w-[220px] flex-1">
            <input type="text" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder={`Add a figure for ${year}`} aria-label={`Add a figure for ${year}`} className={`${inputClass} mt-0`} />
          </div>
          <div className="w-32">
            <input type="text" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target" aria-label="New figure target" className={`${inputClass} tnum mt-0`} />
          </div>
          <Button type="submit" variant="secondary" disabled={!metric.trim()}>
            <Plus size={14} aria-hidden /> Add
          </Button>
        </form>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Remove "${deleting.metric}"?`}
          body={`The ${year} target and where it stands are removed with it.`}
          confirmLabel="Remove figure"
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => { setDeleting(null); setError(""); }}
        />
      ) : null}
    </div>
  );
}
