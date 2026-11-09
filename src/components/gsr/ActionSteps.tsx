// A goal's action steps: tick what is done, add the next one, remove a stray. Reports the
// whole list through onChange so the caller writes one field. Ticking and editing are
// separate permissions: a person ticks their own steps, an admin also adds and removes.
//
// Every change is shown at once and builds on the one before it, not on the list the caller
// last saved. The caller writes the whole list, so two quick ticks built from the saved list
// would each carry only their own tick, and whichever landed last would undo the other. For the
// same reason each list waits for the save before it to finish, so the database receives them
// in the order they were made.
import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import Button from "../ui/Button.tsx";
import IconButton from "../ui/IconButton.tsx";
import { checkboxClass, inputClass } from "../ui/forms.ts";
import type { ActionStep } from "../../types/database.ts";

export default function ActionSteps({
  steps,
  canTick,
  canEdit,
  onChange,
  emptyText = "No steps yet.",
}: {
  steps: ActionStep[];
  canTick: boolean;
  canEdit: boolean;
  // Saves the whole list. The next change is not reported until this one settles; the caller
  // says what went wrong itself, and once nothing is waiting the list shown is the caller's again.
  onChange: (steps: ActionStep[]) => Promise<unknown>;
  emptyText?: string;
}) {
  const [draft, setDraft] = useState("");
  // The newest list not yet saved, while any save is still out; null once they have all settled.
  const [pending, setPending] = useState<ActionStep[] | null>(null);
  const latest = useRef<ActionStep[] | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const shown = pending ?? steps;

  function change(edit: (current: ActionStep[]) => ActionStep[]) {
    const next = edit(latest.current ?? steps);
    latest.current = next;
    setPending(next);
    const run = queue.current.catch(() => undefined).then(() => onChange(next));
    queue.current = run;
    void run
      .catch(() => undefined)
      .then(() => {
        if (queue.current !== run) return;
        latest.current = null;
        setPending(null);
      });
  }

  return (
    <div>
      {shown.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-ink-3">{emptyText}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {shown.map((step, index) => (
            <li key={index} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={step.done}
                disabled={!canTick}
                aria-label={step.text}
                onChange={(e) => {
                  const done = e.target.checked;
                  change((current) => current.map((s, i) => (i === index ? { ...s, done } : s)));
                }}
                className={`${checkboxClass} mt-1`}
              />
              <span className={`flex-1 text-[13px] ${step.done ? "text-ink-3 line-through" : "text-ink"}`}>{step.text}</span>
              {canEdit ? (
                <IconButton label={`Remove step: ${step.text}`} onClick={() => change((current) => current.filter((_, i) => i !== index))} className="-my-1.5">
                  <X size={13} aria-hidden />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text) return;
            setDraft("");
            change((current) => [...current, { text, done: false }]);
          }}
          className="mt-2 flex gap-2"
        >
          <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a step" aria-label="New action step" className={`${inputClass} mt-0 flex-1 py-1.5 text-[13px]`} />
          <Button type="submit" variant="secondary" size="sm" disabled={!draft.trim()}>
            <Plus size={13} aria-hidden /> Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}
