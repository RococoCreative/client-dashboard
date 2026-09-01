// The handful of shared numbers leadership tracks for the year (revenue, closed sales,
// jobs delivered). Display strings carry the units people say; numerics are optional.
import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Field from "../../components/ui/Field.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import Modal from "../../components/ui/Modal.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { checkboxClass, inputClass, selectClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { createCompanyGoal, deleteCompanyGoal, listCompanyGoals, updateCompanyGoal } from "../../services/gsr.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { CompanyGoal } from "../../types/database.ts";

function GoalDialog({ companyId, year, goal, count, onClose, onSaved }: { companyId: string; year: number; goal: CompanyGoal | null; count: number; onClose: () => void; onSaved: (g: CompanyGoal) => void }) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal?.target_display ?? "");
  const [current, setCurrent] = useState(goal?.current_display ?? "");
  const [isHit, setIsHit] = useState(goal?.is_hit ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Name the goal.");
    setBusy(true);
    setError("");
    try {
      const payload = { name: name.trim(), target_display: target.trim() || null, current_display: current.trim() || null, is_hit: isHit };
      const saved = goal ? await updateCompanyGoal(goal.id, payload) : await createCompanyGoal({ company_id: companyId, year, sort_order: count, ...payload });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="company-goal-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="company-goal-title" className="font-display text-lg text-heading">{goal ? "Edit goal" : `New goal for ${year}`}</h2>
        <div className="mt-5 space-y-4">
          <Field label="Goal" htmlFor="cg-name">
            <input id="cg-name" type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="$10M in closed sales" className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target" htmlFor="cg-target">
              <input id="cg-target" type="text" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="$10M" className={inputClass} />
            </Field>
            <Field label="Current" htmlFor="cg-current">
              <input id="cg-current" type="text" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="$6.2M" className={inputClass} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={isHit} onChange={(e) => setIsHit(e.target.checked)} className={checkboxClass} /> Goal hit
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function CompanyGoalsPage() {
  const { company } = useHub();
  const companyId = company!.id;
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [dialog, setDialog] = useState<{ goal: CompanyGoal | null } | null>(null);
  const [deleting, setDeleting] = useState<CompanyGoal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = useAsync(() => listCompanyGoals(companyId, year), [companyId, year]);

  const goals = state.data ?? [];

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteCompanyGoal(deleting.id);
      state.setData((prev) => (prev ? prev.filter((g) => g.id !== deleting.id) : prev));
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleHit(goal: CompanyGoal) {
    try {
      const next = await updateCompanyGoal(goal.id, { is_hit: !goal.is_hit });
      state.setData((prev) => (prev ? prev.map((g) => (g.id === next.id ? next : g)) : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        backTo="/gsr"
        backLabel="Review cycles"
        eyebrow="Company goals"
        title={`Company goals ${year}`}
        description="The shared numbers the whole team is chasing. They show on the dashboard for everyone."
        actions={
          <>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className={`${selectClass} mt-0 w-auto`}>
              {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <Button size="sm" onClick={() => setDialog({ goal: null })}><Plus size={14} aria-hidden /> Add goal</Button>
          </>
        }
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {!state.data && !state.error ? (
        <SkeletonRows rows={3} />
      ) : goals.length === 0 ? (
        <EmptyState eyebrow={String(year)} title="No company goals yet" body="Add the three to six numbers leadership reviews every month." action={<Button onClick={() => setDialog({ goal: null })}>Add goal</Button>} />
      ) : (
        <ul className="space-y-3">
          {goals.map((goal) => (
            <li key={goal.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{goal.name}</p>
                <p className="tnum mt-0.5 text-[13px] text-ink-2">{goal.current_display || "-"} of {goal.target_display || "-"}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void toggleHit(goal)} aria-label={goal.is_hit ? "Mark not hit" : "Mark hit"}>
                  <Badge tone={goal.is_hit ? "success" : "neutral"}>{goal.is_hit ? "Hit" : "In progress"}</Badge>
                </button>
                <IconButton label="Edit goal" onClick={() => setDialog({ goal })}><Pencil size={14} aria-hidden /></IconButton>
                <IconButton label="Delete goal" onClick={() => setDeleting(goal)}><Trash2 size={14} aria-hidden /></IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {dialog ? (
        <GoalDialog
          companyId={companyId}
          year={year}
          goal={dialog.goal}
          count={goals.length}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            state.setData((prev) => {
              const list = prev ?? [];
              return list.some((g) => g.id === saved.id) ? list.map((g) => (g.id === saved.id ? saved : g)) : [...list, saved];
            });
            setDialog(null);
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog title={`Delete "${deleting.name}"?`} body="This removes the goal from the dashboard for everyone." confirmLabel="Delete goal" busy={busy} onConfirm={() => void handleDelete()} onCancel={() => setDeleting(null)} />
      ) : null}
    </>
  );
}
