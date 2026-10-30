// Goals for one person beyond the month: this year's, next year's and their BHAG, grouped by
// kind, each with a completion slider where 100 is complete. The goal itself (title, description,
// kind, period, completion) is shared with the person's admins, who see it on the profile and on
// every quarterly review. Its action steps and progress notes are the person's alone: the
// database keeps them in tables only the owner can read (0021), so this panel only asks for them,
// and only shows them, when the owner is the one looking. Employees own their goals (this panel is
// their My Goals page); admins see and edit the shared part on a person's page. Steps and
// completion save as they change; text saves on blur.
import { useState, type FormEvent } from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import ActionSteps from "./ActionSteps.tsx";
import GoalNotes from "./GoalNotes.tsx";
import Badge from "../ui/Badge.tsx";
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
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { createGoal, deleteGoal, listGoalNotes, listGoalPrivate, listGoals, saveGoalSteps, updateGoal } from "../../services/gsr.ts";
import { GOAL_KIND_ORDER, goalOutcome, goalPeriodLabel, goalSettled, progressPatch, stepsTaken } from "../../lib/gsr/goals.ts";
import { errorMessage } from "../../lib/errors.ts";
import { GOAL_KIND_LABELS, type ActionStep, type Goal, type GoalKind, type GoalNote, type GoalPrivate } from "../../types/database.ts";

const eyebrowClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";

// The period a goal belongs to, as one select value: "year:2026" or "bhag".
type Period = Pick<Goal, "scope" | "year">;

function periodKey(period: Period, thisYear: number): string {
  return period.scope === "bhag" ? "bhag" : `year:${period.year ?? thisYear}`;
}

function parsePeriod(key: string): Period {
  return key === "bhag" ? { scope: "bhag", year: null } : { scope: "year", year: Number(key.slice(5)) };
}

function GoalDialog({
  companyId,
  employeeId,
  goal,
  goals,
  onClose,
  onSaved,
}: {
  companyId: string;
  employeeId: string;
  goal: Goal | null;
  // Everything already filed for this person, so a new goal gets a sort_order that puts it at
  // the end of its group instead of defaulting to 0 and jumping to the top on the next load.
  goals: Goal[];
  onClose: () => void;
  onSaved: (goal: Goal) => void;
}) {
  const thisYear = new Date().getFullYear();
  const [title, setTitle] = useState(goal?.title ?? "");
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "professional");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [period, setPeriod] = useState<string>(periodKey(goal ?? { scope: "year", year: thisYear }, thisYear));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // This year, next year, or a BHAG. A goal being edited keeps the year it is stamped with as an
  // option when that year is neither, so opening an older goal never moves it to a year it does
  // not belong to without anyone choosing that.
  const periods: Period[] = [
    { scope: "year", year: thisYear },
    { scope: "year", year: thisYear + 1 },
    { scope: "bhag", year: null },
    ...(goal?.scope === "year" && goal.year !== null && goal.year !== thisYear && goal.year !== thisYear + 1 ? [{ scope: "year" as const, year: goal.year }] : []),
  ];

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
        year: where.year,
        cycle_id: null,
      };
      const saved = goal
        ? await updateGoal(goal.id, payload)
        : await createGoal({
            company_id: companyId,
            employee_id: employeeId,
            ...payload,
            sort_order: goals.filter((g) => g.kind === kind).length + 1,
          });
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
            <input id="goal-title" type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="What is a goal you want to achieve?" className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind" htmlFor="goal-kind">
              <select id="goal-kind" value={kind} onChange={(e) => setKind(e.target.value as GoalKind)} className={selectClass}>
                {GOAL_KIND_ORDER.map((k) => (
                  <option key={k} value={k}>{GOAL_KIND_LABELS[k]}</option>
                ))}
              </select>
            </Field>
            <Field label="Period" htmlFor="goal-period" hint="A BHAG is the big goal, three to five years out.">
              <select id="goal-period" value={period} onChange={(e) => setPeriod(e.target.value)} className={selectClass}>
                {periods.map((p) => (
                  <option key={periodKey(p, thisYear)} value={periodKey(p, thisYear)}>{goalPeriodLabel(p, thisYear)}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Description (optional)" htmlFor="goal-description">
            <textarea id="goal-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does success look like?" className={textareaClass} rows={3} />
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
  isOwner,
  canEdit,
  steps,
  notes,
  onChange,
  onSteps,
  onNotes,
  onEdit,
  onDelete,
  onError,
}: {
  goal: Goal;
  isOwner: boolean;
  canEdit: boolean;
  // The owner's private steps for this goal; nobody else is given any.
  steps: ActionStep[];
  notes: GoalNote[];
  onChange: (goal: Goal) => void;
  onSteps: (steps: ActionStep[]) => void;
  onNotes: (update: (notes: GoalNote[]) => GoalNote[]) => void;
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
  // A yearly goal settles once its year is behind us and a BHAG never does; neither needs cycles.
  const outcome = goalOutcome(goal, goalSettled(goal, []));
  const { done, total } = stepsTaken({ action_steps: steps });

  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">{goal.title}</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">{goalPeriodLabel(goal)}</p>
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

      <div className="mt-3">
        <p className={eyebrowClass}>Completion</p>
        <ProgressSlider className="mt-1" label={`Completion for ${goal.title}`} value={goal.progress} disabled={!canEdit} onCommit={(next) => void save(progressPatch(next, goal.status))} />
      </div>

      {isOwner ? (
        <>
          <div className="mt-3">
            <p className={`${eyebrowClass} flex items-baseline gap-2`}>
              Action steps
              {total > 0 ? <span className="tnum text-[12px] normal-case tracking-normal text-ink-3">{done} of {total} done</span> : null}
            </p>
            <ActionSteps steps={steps} canTick={canEdit} canEdit={canEdit} onChange={onSteps} />
          </div>
          {canEdit || notes.length > 0 ? (
            <div className="mt-3">
              <p className={eyebrowClass}>Progress notes</p>
              <GoalNotes goal={goal} notes={notes} canWrite={canEdit} onNotes={onNotes} onError={onError} />
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

interface PanelData {
  goals: Goal[];
  // The owner's own; empty for anyone else.
  privateSteps: GoalPrivate[];
  notes: GoalNote[];
}

export default function GoalsPanel({
  companyId,
  employeeId,
  canEdit,
  ownerName,
}: {
  companyId: string;
  employeeId: string;
  canEdit: boolean;
  // The person's first name, for the line that tells anyone else what stays private.
  ownerName?: string;
}) {
  const { profile } = useHub();
  // Steps and notes are the owner's alone. The database would hand anyone else no rows, so the
  // panel does not ask, and shows the shared part of each goal instead.
  const isOwner = profile.id === employeeId;
  const state = useAsync<PanelData>(async () => {
    const [goals, privateSteps, notes] = await Promise.all([
      listGoals(companyId, employeeId),
      isOwner ? listGoalPrivate(companyId, employeeId) : Promise.resolve([]),
      isOwner ? listGoalNotes(companyId, employeeId) : Promise.resolve([]),
    ]);
    return { goals, privateSteps, notes };
  }, [companyId, employeeId, isOwner]);
  const [dialog, setDialog] = useState<{ goal: Goal | null } | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(change: (data: PanelData) => PanelData) {
    state.setData((prev) => (prev ? change(prev) : prev));
  }

  function upsert(goal: Goal) {
    update((data) => ({
      ...data,
      goals: data.goals.some((g) => g.id === goal.id) ? data.goals.map((g) => (g.id === goal.id ? goal : g)) : [...data.goals, goal],
    }));
  }

  async function saveSteps(goal: Goal, steps: ActionStep[]) {
    try {
      const saved = await saveGoalSteps({ goal_id: goal.id, company_id: goal.company_id, employee_id: goal.employee_id, action_steps: steps });
      update((data) => ({ ...data, privateSteps: [...data.privateSteps.filter((row) => row.goal_id !== saved.goal_id), saved] }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteGoal(deleting.id);
      const id = deleting.id;
      update((data) => ({ ...data, goals: data.goals.filter((g) => g.id !== id) }));
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // The year's goals and BHAGs. A monthly goal belongs to its Goal Setting Review and is never
  // listed or editable here. Sorted the way listGoals sorts, so the position a goal is shown in is
  // the position it keeps through the next load rather than sliding out from under the pointer.
  const goals = (state.data?.goals ?? [])
    .filter((g) => g.scope !== "cycle")
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const stepsFor = (goal: Goal): ActionStep[] => state.data?.privateSteps.find((row) => row.goal_id === goal.id)?.action_steps ?? [];
  const notesFor = (goal: Goal): GoalNote[] => (state.data?.notes ?? []).filter((n) => n.goal_id === goal.id);

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
          body="Goals for this year or next, or a BHAG three to five years out, each with the action steps that get there."
          action={canEdit ? <Button onClick={() => setDialog({ goal: null })}><Plus size={14} aria-hidden /> New goal</Button> : undefined}
        />
      ) : (
        <>
          {!isOwner || canEdit ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {!isOwner ? (
                <p className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
                  <Lock size={12} aria-hidden /> Action steps and progress notes are private to {ownerName ?? "the person whose goals these are"}.
                </p>
              ) : <span />}
              {canEdit ? <Button size="sm" onClick={() => setDialog({ goal: null })}><Plus size={14} aria-hidden /> New goal</Button> : null}
            </div>
          ) : null}
          {GOAL_KIND_ORDER.map((kind) => {
            const group = goals.filter((g) => g.kind === kind);
            if (group.length === 0) return null;
            return (
              <Section key={kind} eyebrow={GOAL_KIND_LABELS[kind]} title={`${GOAL_KIND_LABELS[kind]} goals`} padded={false}>
                <ul className="space-y-3 p-4">
                  {group.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      isOwner={isOwner}
                      canEdit={canEdit}
                      steps={stepsFor(goal)}
                      notes={notesFor(goal)}
                      onChange={upsert}
                      onSteps={(steps) => void saveSteps(goal, steps)}
                      onNotes={(change) => update((data) => ({ ...data, notes: change(data.notes) }))}
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
          goals={goals}
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
          body="The goal, its action steps and its progress notes are removed. Leave it below 100 instead to keep the miss on record."
          confirmLabel="Delete goal"
          busy={busy}
          error={error}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
