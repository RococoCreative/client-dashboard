// Goals for one person, grouped by kind: yearly goals and the ones tied to a review cycle,
// each with action steps to tick and a progress slider where 100 is complete. Employees own
// their goals (this panel is their My Goals page); admins see and edit the same panel on a
// person's page. Steps and progress save as they change; text saves on blur.
import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import ActionSteps from "./ActionSteps.tsx";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import EmptyState from "../ui/EmptyState.tsx";
import Field from "../ui/Field.tsx";
import IconButton from "../ui/IconButton.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import ProgressSlider from "../ui/ProgressSlider.tsx";
import Section from "../ui/Section.tsx";
import { SkeletonRows } from "../ui/Skeleton.tsx";
import { inputClass, selectClass, textareaClass } from "../ui/forms.ts";
import { GOAL_OUTCOME_TONE } from "../status.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { createGoal, deleteGoal, listGoals, updateGoal } from "../../services/gsr.ts";
import { goalOutcome, progressPatch, stepsTaken } from "../../lib/gsr/goals.ts";
import { cycleSettled } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { GOAL_KIND_LABELS, keysOf, type Goal, type GoalKind, type ReviewCycle } from "../../types/database.ts";

// The period a goal belongs to, as one select value: "year:2026" or "cycle:<id>".
type Period = { scope: "year"; year: number } | { scope: "cycle"; cycle_id: string | null };

function periodKey(period: Period): string {
  return period.scope === "year" ? `year:${period.year}` : `cycle:${period.cycle_id ?? ""}`;
}

function parsePeriod(key: string): Period {
  if (key.startsWith("year:")) return { scope: "year", year: Number(key.slice(5)) };
  return { scope: "cycle", cycle_id: key.slice(6) || null };
}

function goalPeriod(goal: Goal): Period {
  return goal.scope === "year" ? { scope: "year", year: goal.year ?? new Date().getFullYear() } : { scope: "cycle", cycle_id: goal.cycle_id };
}

function GoalDialog({
  companyId,
  employeeId,
  goal,
  cycles,
  onClose,
  onSaved,
}: {
  companyId: string;
  employeeId: string;
  goal: Goal | null;
  cycles: ReviewCycle[];
  onClose: () => void;
  onSaved: (goal: Goal) => void;
}) {
  const thisYear = new Date().getFullYear();
  const [title, setTitle] = useState(goal?.title ?? "");
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "professional");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [period, setPeriod] = useState<string>(goal ? periodKey(goalPeriod(goal)) : `year:${thisYear}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const legacyOngoing = goal !== null && goal.scope === "cycle" && goal.cycle_id === null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Give the goal a title.");
    setBusy(true);
    setError("");
    try {
      const where = parsePeriod(period);
      const payload = {
        title: title.trim(),
        kind,
        description: description.trim() || null,
        scope: where.scope,
        year: where.scope === "year" ? where.year : null,
        cycle_id: where.scope === "cycle" ? where.cycle_id : null,
      };
      const saved = goal
        ? await updateGoal(goal.id, payload)
        : await createGoal({ company_id: companyId, employee_id: employeeId, ...payload });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="goal-dialog-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="goal-dialog-title" className="font-display text-lg text-heading">{goal ? "Edit goal" : "New goal"}</h2>
        <div className="mt-5 space-y-4">
          <Field label="Goal" htmlFor="goal-title">
            <input id="goal-title" type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="What does success look like?" className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind" htmlFor="goal-kind">
              <select id="goal-kind" value={kind} onChange={(e) => setKind(e.target.value as GoalKind)} className={selectClass}>
                {keysOf(GOAL_KIND_LABELS).map((k) => (
                  <option key={k} value={k}>{GOAL_KIND_LABELS[k]}</option>
                ))}
              </select>
            </Field>
            <Field label="Period" htmlFor="goal-period" hint="A yearly goal, or one tied to a review cycle so it shows up in that review.">
              <select id="goal-period" value={period} onChange={(e) => setPeriod(e.target.value)} className={selectClass}>
                <option value={`year:${thisYear}`}>Yearly goal, {thisYear}</option>
                <option value={`year:${thisYear + 1}`}>Yearly goal, {thisYear + 1}</option>
                {cycles.map((c) => (
                  <option key={c.id} value={`cycle:${c.id}`}>{c.name}</option>
                ))}
                {legacyOngoing ? <option value="cycle:">Ongoing</option> : null}
              </select>
            </Field>
          </div>
          <Field label="Description (optional)" htmlFor="goal-description">
            <textarea id="goal-description" value={description} onChange={(e) => setDescription(e.target.value)} className={textareaClass} rows={3} />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : goal ? "Save" : "Add goal"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function GoalCard({
  goal,
  canEdit,
  periodLabel,
  settled,
  onChange,
  onEdit,
  onDelete,
  onError,
}: {
  goal: Goal;
  canEdit: boolean;
  periodLabel: string;
  settled: boolean;
  onChange: (goal: Goal) => void;
  onEdit: () => void;
  onDelete: () => void;
  onError: (message: string) => void;
}) {
  async function save(patch: Parameters<typeof updateGoal>[1]) {
    try {
      onChange(await updateGoal(goal.id, patch));
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  const outcome = goalOutcome(goal, settled);
  const { done, total } = stepsTaken(goal);

  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">{goal.title}</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {periodLabel}
            {total > 0 ? ` · ${done}/${total} steps done` : ""}
          </p>
          {goal.description ? <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{goal.description}</p> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {outcome === "open" && goal.progress === 0 ? (
            <Badge>Not started</Badge>
          ) : (
            <Badge tone={GOAL_OUTCOME_TONE[outcome]}>{outcome === "hit" ? "Achieved" : outcome === "miss" ? `Missed at ${goal.progress}%` : "In progress"}</Badge>
          )}
          {canEdit ? (
            <>
              <IconButton label="Edit goal" onClick={onEdit}><Pencil size={14} aria-hidden /></IconButton>
              <IconButton label="Delete goal" onClick={onDelete}><Trash2 size={14} aria-hidden /></IconButton>
            </>
          ) : null}
        </div>
      </div>

      <ProgressSlider className="mt-3" label={`Progress for ${goal.title}`} value={goal.progress} disabled={!canEdit} onCommit={(next) => void save(progressPatch(next, goal.status))} />

      <div className="mt-3">
        <p className="text-[11px] font-medium uppercase tracking-label text-ink-3">Action steps</p>
        <ActionSteps steps={goal.action_steps} canTick={canEdit} canEdit={canEdit} onChange={(steps) => void save({ action_steps: steps })} />
      </div>

      {canEdit || goal.progress_notes ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-label text-ink-3">Progress notes</p>
          {canEdit ? (
            <BlurInput multiline rows={2} value={goal.progress_notes ?? ""} placeholder="Where things stand" ariaLabel={`Progress notes for ${goal.title}`} onSave={(next) => void save({ progress_notes: next.trim() || null })} className={`${textareaClass} mt-1.5 min-h-[56px] text-[13px]`} />
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-2">{goal.progress_notes}</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default function GoalsPanel({
  companyId,
  employeeId,
  canEdit,
  cycles = [],
}: {
  companyId: string;
  employeeId: string;
  canEdit: boolean;
  cycles?: ReviewCycle[];
}) {
  const state = useAsync(() => listGoals(companyId, employeeId), [companyId, employeeId]);
  const [dialog, setDialog] = useState<{ goal: Goal | null } | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function upsert(goal: Goal) {
    state.setData((prev) => {
      const list = prev ?? [];
      return list.some((g) => g.id === goal.id) ? list.map((g) => (g.id === goal.id ? goal : g)) : [...list, goal];
    });
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteGoal(deleting.id);
      state.setData((prev) => (prev ? prev.filter((g) => g.id !== deleting.id) : prev));
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const goals = state.data ?? [];
  const thisYear = new Date().getFullYear();
  const periodLabel = (goal: Goal): string => {
    if (goal.scope === "year") return `${goal.year} goal`;
    return goal.cycle_id ? (cycles.find((c) => c.id === goal.cycle_id)?.name ?? "Review cycle") : "Ongoing";
  };
  // A goal reads as hit or miss once its period is over: a closed or past cycle, or a past year.
  const settled = (goal: Goal): boolean => {
    if (goal.scope === "year") return (goal.year ?? thisYear) < thisYear;
    const cycle = goal.cycle_id ? cycles.find((c) => c.id === goal.cycle_id) : undefined;
    return cycle ? cycleSettled(cycle) : false;
  };

  return (
    <div className="space-y-6">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? (
        <SkeletonRows rows={4} />
      ) : goals.length === 0 ? (
        <EmptyState
          eyebrow="Goals"
          title={canEdit ? "Set the first goal" : "No goals yet"}
          body="Professional, personal, or role goals, each with the action steps that get you there."
          action={canEdit ? <Button onClick={() => setDialog({ goal: null })}><Plus size={14} aria-hidden /> New goal</Button> : undefined}
        />
      ) : (
        <>
          {canEdit ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setDialog({ goal: null })}><Plus size={14} aria-hidden /> New goal</Button>
            </div>
          ) : null}
          {keysOf(GOAL_KIND_LABELS).map((kind) => {
            const group = goals.filter((g) => g.kind === kind);
            if (group.length === 0) return null;
            return (
              <Section key={kind} eyebrow={GOAL_KIND_LABELS[kind]} title={`${GOAL_KIND_LABELS[kind]} goals`} padded={false}>
                <ul className="space-y-3 p-4">
                  {group.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      canEdit={canEdit}
                      periodLabel={periodLabel(goal)}
                      settled={settled(goal)}
                      onChange={upsert}
                      onEdit={() => setDialog({ goal })}
                      onDelete={() => setDeleting(goal)}
                      onError={setError}
                    />
                  ))}
                </ul>
              </Section>
            );
          })}
        </>
      )}

      {dialog ? (
        <GoalDialog
          companyId={companyId}
          employeeId={employeeId}
          goal={dialog.goal}
          cycles={cycles}
          onClose={() => setDialog(null)}
          onSaved={(goal) => {
            upsert(goal);
            setDialog(null);
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          body="The goal and its action steps are removed. Leave it below 100 instead to keep the miss on record."
          confirmLabel="Delete goal"
          busy={busy}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
