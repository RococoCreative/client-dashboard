// A person's own financial figures for one year: what they own (closed sales, revenue
// managed), the target, where it stands, and where the number came from. Manual entry today;
// QuickBooks and GoHighLevel later write the same rows with their own source, and a figure an
// admin corrects by hand is marked as a hand entry again. Edited on the person page; read on
// the person's dashboard when their job role carries the module.
//
// A target or current figure may be left blank, which clears it. Text that does not read as money
// is refused with a message and the box goes back to the stored figure, never saved as a blank
// nobody chose. Saves for one figure queue behind each other, so two quick edits never land out of
// order and put the older number back on screen.
import { useRef, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import { inputClass } from "../ui/forms.ts";
import { createEmployeeFinancial, deleteEmployeeFinancial, updateEmployeeFinancial } from "../../services/employees.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatMoney, formatPercent, moneyFieldError, parseMoney } from "../../lib/format.ts";
import { financialProgress } from "../../lib/people.ts";
import { FINANCIAL_SOURCE_LABELS, type EmployeeFinancial } from "../../types/database.ts";

// Why typed text will not save as a target or current figure, or null when it will. Blank is fine.
function figureProblem(label: string, text: string): string | null {
  return moneyFieldError(label, text, "250000");
}

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
  // The add form waits for its round trip before it takes another submit, or a quick double
  // Enter files the same figure twice.
  const [adding, setAdding] = useState(false);
  // Each response carries the whole row: a target and a current typed one after the other are two
  // writes in flight, and out of order the older response put the first number back on screen.
  const saveChains = useRef(new Map<string, Promise<unknown>>());

  // True when the change landed, false once the page shows why not.
  async function save(row: EmployeeFinancial, patch: Parameters<typeof updateEmployeeFinancial>[1]): Promise<boolean> {
    const chained = (saveChains.current.get(row.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const next = await updateEmployeeFinancial(row.id, patch);
      onChange((list) => list.map((r) => (r.id === next.id ? next : r)));
    });
    saveChains.current.set(row.id, chained);
    try {
      await chained;
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    }
  }

  function saveFigure(row: EmployeeFinancial, field: "target" | "current", text: string): Promise<boolean> | false {
    const problem = figureProblem(field === "target" ? "the target" : "the current figure", text);
    if (problem) {
      onError(problem);
      return false;
    }
    return save(row, { [field]: parseMoney(text), source: "manual" });
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = metric.trim();
    if (!text || adding) return;
    const problem = figureProblem("the target", target);
    if (problem) return onError(problem);
    setAdding(true);
    try {
      const created = await createEmployeeFinancial({ employee_id: employeeId, year, metric: text, target: parseMoney(target), sort_order: rows.length + 1 });
      onChange((list) => [...list, created]);
      setMetric("");
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
                  <BlurInput value={row.metric} required ariaLabel={`Figure ${row.metric}`} onSave={(next) => save(row, { metric: next.trim() })} className={`${inputClass} mt-0 text-[13px]`} />
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
                  <BlurInput value={row.target === null ? "" : String(row.target)} placeholder="Target" ariaLabel={`Target for ${row.metric}`} onSave={(next) => saveFigure(row, "target", next)} className={`${inputClass} tnum mt-0 text-[13px]`} />
                ) : (
                  <span className="tnum text-sm text-ink-2">{formatMoney(row.target)}</span>
                )}
              </div>
              <div className="w-32">
                {canEdit ? (
                  <BlurInput value={row.current === null ? "" : String(row.current)} placeholder="Current" ariaLabel={`Current for ${row.metric}`} onSave={(next) => saveFigure(row, "current", next)} className={`${inputClass} tnum mt-0 text-[13px]`} />
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
          <Button type="submit" variant="secondary" disabled={!metric.trim() || adding}>
            <Plus size={14} aria-hidden /> {adding ? "Adding..." : "Add"}
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
