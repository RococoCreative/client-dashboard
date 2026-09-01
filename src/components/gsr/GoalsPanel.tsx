// Goals for one person, grouped by kind, with action steps you can tick off. Employees own
// their goals (this panel is their My Goals page); admins see and edit the same panel on a
// person's page. Action steps save as they are ticked; text saves on blur.
import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import EmptyState from "../ui/EmptyState.tsx";
import Field from "../ui/Field.tsx";
import IconButton from "../ui/IconButton.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { SkeletonRows } from "../ui/Skeleton.tsx";
import { checkboxClass, inputClass, selectClass, textareaClass } from "../ui/forms.ts";
import { GOAL_STATUS_TONE } from "../status.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { createGoal, deleteGoal, listGoals, updateGoal } from "../../services/gsr.ts";
import { errorMessage } from "../../lib/errors.ts";
import {
  GOAL_KIND_LABELS,
  GOAL_STATUS_LABELS,
  keysOf,
  type ActionStep,
  type Goal,
  type GoalKind,
  type GoalStatus,
  type ReviewCycle,
} from "../../types/database.ts";

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
  const [title, setTitle] = useState(goal?.title ?? "");
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "professional");
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? "not_started");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [cycleId, setCycleId] = useState(goal?.cycle_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Give the goal a title.");
    setBusy(true);
    setError("");
    try {
      const payload = {
        title: title.trim(),
        kind,
        status,
        description: description.trim() || null,
        cycle_id: cycleId || null,
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
            <Field label="Status" htmlFor="goal-status">
              <select id="goal-status" value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)} className={selectClass}>
                {keysOf(GOAL_STATUS_LABELS).map((k) => (
                  <option key={k} value={k}>{GOAL_STATUS_LABELS[k]}</option>
                ))}
              </select>
            </Field>
          </div>
          {cycles.length > 0 ? (
            <Field label="Review cycle (optional)" htmlFor="goal-cycle" hint="Tie the goal to a period so it shows up alongside that review.">
              <select id="goal-cycle" value={cycleId} onChange={(e) => setCycleId(e.target.value)} className={selectClass}>
                <option value="">Ongoing</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          ) : null}
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
  cycleName,
  onChange,
  onEdit,
  onDelete,
  onError,
}: {
  goal: Goal;
  canEdit: boolean;
  cycleName: string | null;
  onChange: (goal: Goal) => void;
  onEdit: () => void;
  onDelete: () => void;
  onError: (message: string) => void;
}) {
  const [newStep, setNewStep] = useState("");

  async function saveSteps(steps: ActionStep[]) {
    try {
      onChange(await updateGoal(goal.id, { action_steps: steps }));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function saveStatus(status: GoalStatus) {
    try {
      onChange(await updateGoal(goal.id, { status }));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function saveNotes(progress_notes: string) {
    try {
      onChange(await updateGoal(goal.id, { progress_notes: progress_notes.trim() || null }));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  const done = goal.action_steps.filter((s) => s.done).length;

  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">{goal.title}</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {cycleName ?? "Ongoing"}
            {goal.action_steps.length > 0 ? ` · ${done}/${goal.action_steps.length} steps done` : ""}
          </p>
          {goal.description ? <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{goal.description}</p> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {canEdit ? (
            <select value={goal.status} onChange={(e) => void saveStatus(e.target.value as GoalStatus)} aria-label={`Status for ${goal.title}`} className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}>
              {keysOf(GOAL_STATUS_LABELS).map((k) => (
                <option key={k} value={k}>{GOAL_STATUS_LABELS[k]}</option>
              ))}
            </select>
          ) : (
            <Badge tone={GOAL_STATUS_TONE[goal.status]}>{GOAL_STATUS_LABELS[goal.status]}</Badge>
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
        <p className="text-[11px] font-medium uppercase tracking-label text-ink-3">Action steps</p>
        {goal.action_steps.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-ink-3">No steps yet.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {goal.action_steps.map((step, index) => (
              <li key={index} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={step.done}
                  disabled={!canEdit}
                  aria-label={step.text}
                  onChange={(e) => void saveSteps(goal.action_steps.map((s, i) => (i === index ? { ...s, done: e.target.checked } : s)))}
                  className={`${checkboxClass} mt-1`}
                />
                <span className={`flex-1 text-[13px] ${step.done ? "text-ink-3 line-through" : "text-ink"}`}>{step.text}</span>
                {canEdit ? (
                  <button type="button" aria-label="Remove step" onClick={() => void saveSteps(goal.action_steps.filter((_, i) => i !== index))} className="text-ink-3 hover:text-danger">
                    <X size={13} aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = newStep.trim();
              if (!text) return;
              setNewStep("");
              void saveSteps([...goal.action_steps, { text, done: false }]);
            }}
            className="mt-2 flex gap-2"
          >
            <input type="text" value={newStep} onChange={(e) => setNewStep(e.target.value)} placeholder="Add a step" aria-label="New action step" className={`${inputClass} mt-0 flex-1 py-1.5 text-[13px]`} />
            <Button type="submit" variant="secondary" size="sm" disabled={!newStep.trim()}><Plus size={13} aria-hidden /> Add</Button>
          </form>
        ) : null}
      </div>

      {canEdit || goal.progress_notes ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-label text-ink-3">Progress notes</p>
          {canEdit ? (
            <BlurInput multiline rows={2} value={goal.progress_notes ?? ""} placeholder="Where things stand" ariaLabel={`Progress notes for ${goal.title}`} onSave={(next) => void saveNotes(next)} className={`${textareaClass} mt-1.5 min-h-[56px] text-[13px]`} />
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
  const cycleName = (id: string | null) => (id ? (cycles.find((c) => c.id === id)?.name ?? null) : null);

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
                      cycleName={cycleName(goal.cycle_id)}
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
          body="The goal and its action steps are removed. Mark it achieved or missed instead to keep the history."
          confirmLabel="Delete goal"
          busy={busy}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
