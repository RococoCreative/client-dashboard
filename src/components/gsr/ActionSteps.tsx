// A goal's action steps: tick what is done, add the next one, remove a stray. Reports the
// whole list through onChange so the caller writes one field. Ticking and editing are
// separate permissions: a person ticks their own steps, an admin also adds and removes.
import { useState } from "react";
import { Plus, X } from "lucide-react";
import Button from "../ui/Button.tsx";
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
  onChange: (steps: ActionStep[]) => void;
  emptyText?: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      {steps.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-ink-3">{emptyText}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {steps.map((step, index) => (
            <li key={index} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={step.done}
                disabled={!canTick}
                aria-label={step.text}
                onChange={(e) => onChange(steps.map((s, i) => (i === index ? { ...s, done: e.target.checked } : s)))}
                className={`${checkboxClass} mt-1`}
              />
              <span className={`flex-1 text-[13px] ${step.done ? "text-ink-3 line-through" : "text-ink"}`}>{step.text}</span>
              {canEdit ? (
                <button type="button" aria-label={`Remove step: ${step.text}`} onClick={() => onChange(steps.filter((_, i) => i !== index))} className="text-ink-3 transition-colors duration-150 hover:text-danger">
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
            const text = draft.trim();
            if (!text) return;
            setDraft("");
            onChange([...steps, { text, done: false }]);
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
