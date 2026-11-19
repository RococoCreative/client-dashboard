// A task's checklist. Whoever may act on the task ticks and unticks its steps; whoever may edit it
// also adds, renames, moves and removes them. Every change goes to the database and comes back as
// the whole task re-read, because a tick can complete the task or reopen it, so the page always
// shows what the database decided. A finished copy whose next one is open is locked: its steps
// read as they were left. A step's title reads as text first: ticking and the arrows stay on the
// row, and the pencil opens the title in place with Remove beside Done, one step at a time.
import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import { checkboxClass, inputClass } from "../ui/forms.ts";
import { metaClass } from "../ui/type.ts";
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
  editing,
  onEdit,
  onDone,
  run,
}: {
  step: TaskStep;
  first: boolean;
  last: boolean;
  canTick: boolean;
  canEdit: boolean;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  run: (change: () => Promise<TaskWithSteps>) => Promise<boolean>;
}) {
  const { id, title } = step;
  const done = step.done_at !== null;
  const open = canEdit && editing;
  return (
    <li className="px-4 py-2 sm:px-6">
      <div className="flex min-h-11 items-center gap-3 sm:min-h-9">
        <input
          type="checkbox"
          aria-label={title}
          className={checkboxClass}
          checked={done}
          disabled={!canTick || busy}
          onChange={(e) => void run(() => setStepDone(id, e.target.checked))}
        />
        {open ? (
          <div className="min-w-0 flex-1">
            <BlurInput value={title} required ariaLabel={`Rename ${title}`} onSave={(next) => run(() => renameStep(id, next.trim()))} className={`${inputClass} mt-0 py-1.5`} />
          </div>
        ) : (
          <span className={`min-w-0 flex-1 text-sm [overflow-wrap:anywhere] ${done ? "text-ink-2 line-through" : "text-ink"}`}>{title}</span>
        )}
        {canEdit ? (
          <div className="flex shrink-0 items-center">
            <IconButton label={`Move ${title} up`} disabled={first || busy} onClick={() => void run(() => moveStep(id, "up"))}><ArrowUp size={14} aria-hidden /></IconButton>
            <IconButton label={`Move ${title} down`} disabled={last || busy} onClick={() => void run(() => moveStep(id, "down"))}><ArrowDown size={14} aria-hidden /></IconButton>
            {open ? null : (
              <IconButton label={`Edit ${title}`} onClick={onEdit}><Pencil size={15} aria-hidden /></IconButton>
            )}
          </div>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 flex flex-wrap justify-between gap-2">
          <Button variant="danger" size="sm" aria-label={`Remove ${title}`} disabled={busy} onClick={() => void run(() => removeStep(id))}>Remove</Button>
          <Button variant="secondary" size="sm" onClick={onDone}>Done</Button>
        </div>
      ) : null}
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
  // One step open for editing at a time.
  const [openId, setOpenId] = useState<string | null>(null);
  const editable = canEdit && !locked;

  // True when the change landed, false once the list shows why not, so a rename that failed never
  // reads as saved.
  async function run(change: () => Promise<TaskWithSteps>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      onChange(await change());
      return true;
    } catch (err) {
      setError(errorMessage(err, "That step did not save. Try again."));
      return false;
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
              editing={openId === step.id}
              onEdit={() => setOpenId(step.id)}
              onDone={() => setOpenId(null)}
              run={run}
            />
          ))}
        </ul>
      ) : (
        <p className={`px-4 py-3 sm:px-6 ${metaClass}`}>No steps yet.</p>
      )}
      {editable ? (
        <div className="border-t border-line px-4 py-3 sm:px-6">
          <BlurInput key={added} value="" ariaLabel="Add a step" placeholder="Add a step" disabled={busy} onSave={add} className={`${inputClass} mt-0`} />
        </div>
      ) : null}
      {error ? <Notice tone="error" className="mx-4 my-3 sm:mx-6">{error}</Notice> : null}
    </div>
  );
}
