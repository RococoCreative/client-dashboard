// The one form for a task, used to add one and to edit one. An employee's own task has its
// assignee fixed (lockAssigneeTo) and no picker; an admin picks from the whole active roster, with
// people who have not signed in yet marked, never left out. Only admins attach a campaign. Steps
// are typed one per line when the task is added; after that they are edited on the task's page.
// It saves and hands back the task as the database read it; the assignment email is the caller's.
import { useState, type FormEvent } from "react";
import Button from "../ui/Button.tsx";
import Field from "../ui/Field.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import { inputClass, selectClass, textareaClass } from "../ui/forms.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName } from "../../lib/format.ts";
import { hasAccount } from "../../lib/people.ts";
import { PRIORITY_LABELS, RECURRENCE_LABELS } from "../../lib/tasks.ts";
import { createTask, updateTask, type TaskPatch } from "../../services/tasks.ts";
import type { MarketingCampaign, Profile, TaskPriority, TaskRecurrence, TaskWithSteps } from "../../types/database.ts";

const PRIORITIES = Object.keys(PRIORITY_LABELS) as TaskPriority[];
const RECURRENCES = Object.keys(RECURRENCE_LABELS) as TaskRecurrence[];
const NEEDS_DATE = "A repeating task needs a due date.";

function personLabel(person: Profile): string {
  return hasAccount(person) ? displayName(person) : `${displayName(person)} · not signed in yet`;
}

export default function TaskForm({
  companyId,
  people,
  campaigns,
  initial,
  lockAssigneeTo,
  canSetCampaign,
  onSaved,
  onClose,
}: {
  companyId: string;
  people: Profile[];
  campaigns: MarketingCampaign[];
  // A task to edit (it has an id), or fields to start a new one with, such as a campaign.
  initial?: Partial<TaskWithSteps>;
  lockAssigneeTo?: string;
  canSetCampaign: boolean;
  onSaved: (task: TaskWithSteps) => void;
  onClose: () => void;
}) {
  const editing = Boolean(initial?.id);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(initial?.assignee_id ?? "");
  const [dueDate, setDueDate] = useState(initial?.due_date ?? "");
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? "medium");
  const [recurrence, setRecurrence] = useState<TaskRecurrence | "">(initial?.recurrence ?? "");
  const [campaignId, setCampaignId] = useState(initial?.campaign_id ?? "");
  const [stepsText, setStepsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const needsDate = recurrence !== "" && dueDate === "";
  const showPicker = lockAssigneeTo === undefined;
  const showCampaign = canSetCampaign && campaigns.length > 0;
  // The whole active roster, plus the current assignee if they have since been deactivated, so
  // the picker never reads as someone else.
  const choices = people.filter((p) => p.is_active || p.id === initial?.assignee_id);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Give the task a title.");
    if (needsDate) return;
    setBusy(true);
    setError("");
    const fields = {
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      priority,
      recurrence: recurrence || null,
    };
    const assignee = showPicker ? assigneeId || null : lockAssigneeTo;
    try {
      if (editing) {
        const patch: TaskPatch = { ...fields };
        if (showPicker) patch.assignee_id = assignee;
        if (canSetCampaign) patch.campaign_id = campaignId || null;
        onSaved(await updateTask(initial!.id!, patch));
      } else {
        onSaved(
          await createTask({
            company_id: companyId,
            ...fields,
            assignee_id: assignee,
            ...(canSetCampaign ? { campaign_id: campaignId || null } : {}),
            steps: stepsText.split("\n"),
          }),
        );
      }
    } catch (err) {
      setError(errorMessage(err, "The task did not save. Try again."));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="task-form-title" size="lg">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="task-form-title" className="font-display text-lg text-heading">{editing ? "Edit task" : "New task"}</h2>
        <div className="mt-5 space-y-4">
          <Field label="Title" htmlFor="task-title">
            <input id="task-title" type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Description" htmlFor="task-description">
            <textarea id="task-description" value={description} onChange={(e) => setDescription(e.target.value)} className={`${textareaClass} min-h-[64px]`} rows={2} />
          </Field>
          {showPicker ? (
            <Field label="Assignee" htmlFor="task-assignee">
              <select id="task-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={selectClass}>
                <option value="">Unassigned</option>
                {choices.map((person) => (
                  <option key={person.id} value={person.id}>{personLabel(person)}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Due date" htmlFor="task-due">
              <input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Priority" htmlFor="task-priority">
              <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={selectClass}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </Field>
            <Field label="Repeat" htmlFor="task-repeat" error={needsDate ? NEEDS_DATE : undefined}>
              <select id="task-repeat" value={recurrence} onChange={(e) => setRecurrence(e.target.value as TaskRecurrence | "")} className={selectClass}>
                <option value="">Does not repeat</option>
                {RECURRENCES.map((r) => (
                  <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
                ))}
              </select>
            </Field>
          </div>
          {showCampaign ? (
            <Field label="Campaign" htmlFor="task-campaign">
              <select id="task-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={selectClass}>
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          ) : null}
          {editing ? null : (
            <Field label="Steps" htmlFor="task-steps" hint="One step per line. Leave it empty for a task with no steps.">
              <textarea id="task-steps" value={stepsText} onChange={(e) => setStepsText(e.target.value)} className={`${textareaClass} min-h-[64px]`} rows={3} />
            </Field>
          )}
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : editing ? "Save" : "Add task"}</Button>
        </div>
      </form>
    </Modal>
  );
}
