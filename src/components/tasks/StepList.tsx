// A task's checklist. Whoever may act on the task ticks and unticks its steps; whoever may edit it
// also adds, renames, moves and removes them. Every change goes to the database and comes back as
// the whole task re-read, because a tick can complete the task or reopen it, so the page always
// shows what the database decided. A finished copy whose next one is open is locked: its steps
// read as they were left.
import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import { checkboxClass, inputClass } from "../ui/forms.ts";
import { errorMessage } from "../../lib/errors.ts";
import { addStep, moveStep, removeStep, renameStep, setStepDone } from "../../services/tasks.ts";
import type { TaskStep, TaskWithSteps } from "../../types/database.ts";

function StepRow({
  step,
  first,
  last,
  canTick,
  canEdit,
  busy,
  run,
}: {
  step: TaskStep;
  first: boolean;
  last: boolean;
  canTick: boolean;
  canEdit: boolean;
  busy: boolean;
  run: (change: () => Promise<TaskWithSteps>) => void;
}) {
  const { id, title } = step;
  const done = step.done_at !== null;
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <input
        type="checkbox"
        aria-label={title}
        className={checkboxClass}
        checked={done}
        disabled={!canTick || busy}
        onChange={(e) => run(() => setStepDone(id, e.target.checked))}
      />
      {canEdit ? (
        <>
          <div className="min-w-0 flex-1">
            <BlurInput value={title} required ariaLabel={`Rename ${title}`} onSave={(next) => run(() => renameStep(id, next.trim()))} className={`${inputClass} mt-0 py-1.5`} />
          </div>
          <div className="flex shrink-0 items-center">
            <IconButton label={`Move ${title} up`} disabled={first || busy} onClick={() => run(() => moveStep(id, "up"))}><ArrowUp size={14} aria-hidden /></IconButton>
            <IconButton label={`Move ${title} down`} disabled={last || busy} onClick={() => run(() => moveStep(id, "down"))}><ArrowDown size={14} aria-hidden /></IconButton>
            <IconButton label={`Remove ${title}`} disabled={busy} onClick={() => run(() => removeStep(id))}><X size={14} aria-hidden /></IconButton>
          </div>
        </>
      ) : (
        <span className={`min-w-0 flex-1 text-sm ${done ? "text-ink-2 line-through" : "text-ink"}`}>{title}</span>
      )}
    </li>
  );
}

export default function StepList({
  task,
  canEdit,
  locked,
  canTick = true,
  onChange,
}: {
  task: TaskWithSteps;
  canEdit: boolean;
  locked: boolean;
  // Ticking is for the assignee and admins; editing the list is for whoever may edit the task.
  canTick?: boolean;
  onChange: (task: TaskWithSteps) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A new key clears the add field once its step is on the list.
  const [added, setAdded] = useState(0);
  const editable = canEdit && !locked;

  async function run(change: () => Promise<TaskWithSteps>) {
    setBusy(true);
    setError("");
    try {
      onChange(await change());
    } catch (err) {
      setError(errorMessage(err, "That step did not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  function add(title: string) {
    if (title.trim() === "") return;
    void run(async () => {
      const next = await addStep(task.id, title.trim());
      setAdded((n) => n + 1);
      return next;
    });
  }

  return (
    <div>
      {task.steps.length > 0 ? (
        <ul className="divide-y divide-line" aria-label="Steps">
          {task.steps.map((step, i) => (
            <StepRow
              key={step.id}
              step={step}
              first={i === 0}
              last={i === task.steps.length - 1}
              canTick={canTick && !locked}
              canEdit={editable}
              busy={busy}
              run={(change) => void run(change)}
            />
          ))}
        </ul>
      ) : (
        <p className="px-5 py-3 text-[13px] text-ink-2">No steps yet.</p>
      )}
      {editable ? (
        <div className="border-t border-line px-5 py-3">
          <BlurInput key={added} value="" ariaLabel="Add a step" placeholder="Add a step" disabled={busy} onSave={add} className={`${inputClass} mt-0`} />
        </div>
      ) : null}
      {error ? <Notice tone="error" className="mx-5 my-3">{error}</Notice> : null}
    </div>
  );
}
