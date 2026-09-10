// A person's compensation as a table: each line with its annual amount, the monthly figure
// derived, and the total at the foot. Admins edit in place; a note explains a formula-style
// line ("2% of newly closed sales") without the hub pretending to compute it.
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import { inputClass, tableClass, tdClass, thClass } from "../ui/forms.ts";
import { createCompensationItem, deleteCompensationItem, updateCompensationItem } from "../../services/employees.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatMoney } from "../../lib/format.ts";
import { totalAnnual } from "../../lib/people.ts";
import type { CompensationItem } from "../../types/database.ts";

function moneyOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? value : null;
}

export default function CompensationTable({
  companyId,
  employeeId,
  items,
  canEdit,
  onChange,
  onError,
}: {
  companyId: string;
  employeeId: string;
  items: CompensationItem[];
  canEdit: boolean;
  onChange: (update: (items: CompensationItem[]) => CompensationItem[]) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [annual, setAnnual] = useState("");
  const [deleting, setDeleting] = useState<CompensationItem | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(item: CompensationItem, patch: Parameters<typeof updateCompensationItem>[1]) {
    try {
      const next = await updateCompensationItem(item.id, patch);
      onChange((list) => list.map((c) => (c.id === next.id ? next : c)));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = name.trim();
    if (!text) return;
    try {
      const created = await createCompensationItem({ company_id: companyId, employee_id: employeeId, name: text, annual_amount: moneyOrNull(annual) ?? 0, sort_order: items.length + 1 });
      onChange((list) => [...list, created]);
      setName("");
      setAnnual("");
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteCompensationItem(deleting.id);
      const id = deleting.id;
      onChange((list) => list.filter((c) => c.id !== id));
      setDeleting(null);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const total = totalAnnual(items);

  return (
    <div>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-2">{canEdit ? "No compensation recorded yet. Add the base and any stipends below." : "No compensation recorded."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thClass}>Line</th>
                <th className={`${thClass} text-right`}>Monthly</th>
                <th className={`${thClass} text-right`}>Annual</th>
                <th className={thClass}>Note</th>
                {canEdit ? <th className={thClass}></th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className={tdClass}>
                    {canEdit ? <BlurInput value={item.name} ariaLabel={`Line ${item.name}`} onSave={(next) => void save(item, { name: next.trim() || item.name })} className={`${inputClass} mt-0 text-[13px]`} /> : item.name}
                  </td>
                  <td className={`${tdClass} tnum text-right text-ink-2`}>{formatMoney(item.annual_amount / 12)}</td>
                  <td className={`${tdClass} tnum text-right`}>
                    {canEdit ? <div className="ml-auto w-28"><BlurInput value={String(item.annual_amount)} ariaLabel={`Annual for ${item.name}`} onSave={(next) => void save(item, { annual_amount: moneyOrNull(next) ?? 0 })} className={`${inputClass} tnum mt-0 text-right text-[13px]`} /></div> : formatMoney(item.annual_amount)}
                  </td>
                  <td className={`${tdClass} text-ink-2`}>
                    {canEdit ? <BlurInput value={item.note ?? ""} placeholder="Optional" ariaLabel={`Note for ${item.name}`} onSave={(next) => void save(item, { note: next.trim() || null })} className={`${inputClass} mt-0 text-[13px]`} /> : item.note ?? ""}
                  </td>
                  {canEdit ? (
                    <td className={`${tdClass} text-right`}>
                      <IconButton label={`Remove ${item.name}`} onClick={() => setDeleting(item)}>
                        <Trash2 size={14} aria-hidden />
                      </IconButton>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={`${tdClass} border-b-0 font-medium`}>Total compensation</td>
                <td className={`${tdClass} tnum border-b-0 text-right text-ink-2`}>{formatMoney(total / 12)}</td>
                <td className={`${tdClass} tnum border-b-0 text-right font-medium text-heading`}>{formatMoney(total)}</td>
                <td className={`${tdClass} border-b-0`} colSpan={canEdit ? 2 : 1}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {canEdit ? (
        <form onSubmit={add} className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
          <div className="min-w-[220px] flex-1">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a line (base salary, vehicle stipend, match)" aria-label="Add a compensation line" className={`${inputClass} mt-0`} />
          </div>
          <div className="w-32">
            <input type="text" value={annual} onChange={(e) => setAnnual(e.target.value)} placeholder="Annual $" aria-label="New line annual amount" className={`${inputClass} tnum mt-0`} />
          </div>
          <Button type="submit" variant="secondary" disabled={!name.trim()}>
            <Plus size={14} aria-hidden /> Add
          </Button>
        </form>
      ) : null}
      {deleting ? (
        <ConfirmDialog title={`Remove "${deleting.name}"?`} body="The line comes off this person's compensation table." confirmLabel="Remove line" busy={busy} onConfirm={() => void remove()} onCancel={() => setDeleting(null)} />
      ) : null}
    </div>
  );
}
