// The criteria of one rated pillar, inside the open pillar on Reviews, Setup. Each criterion reads
// as text until its pencil opens it; one Add criterion button opens the one add form. Names and
// descriptions save on blur, Active is a tick, and Delete criterion sits inside the open row.
// The parent owns the writes and the delete dialog, so a refusal is said once, where it happens.
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import EditRow from "../ui/EditRow.tsx";
import { checkboxClass, inputClass } from "../ui/forms.ts";
import { bodyClass, eyebrowLabelClass, metaClass, secondaryClass } from "../ui/type.ts";
import type { GsrCriterion, GsrPillar } from "../../types/database.ts";

type CriterionPatch = Partial<Pick<GsrCriterion, "name" | "description" | "is_active">>;

// The one add form, opened by Add criterion.
function AddCriterionForm({ pillar, saving, onAdd, onCancel }: { pillar: GsrPillar; saving: boolean; onAdd: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = name.trim();
    if (!text || saving) return;
    setName("");
    onAdd(text);
  }
  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New criterion"
        aria-label={`New criterion for ${pillar.name}`}
        className={`${inputClass} mt-0 min-w-0 flex-1 basis-56`}
      />
      <Button type="submit" variant="secondary" size="sm" disabled={!name.trim() || saving}>
        <Plus size={13} aria-hidden /> Add criterion
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

export default function PillarCriteria({
  pillar,
  criteria,
  adding: savingAdd,
  onAdd,
  onPatch,
  onDelete,
}: {
  pillar: GsrPillar;
  criteria: GsrCriterion[];
  adding: boolean;
  onAdd: (name: string) => Promise<boolean>;
  onPatch: (criterion: GsrCriterion, patch: CriterionPatch) => Promise<boolean>;
  onDelete: (criterion: GsrCriterion) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function add(name: string) {
    // The form stays open when the add was refused, so the name is not lost with it.
    if (await onAdd(name)) setAdding(false);
  }

  return (
    <section aria-labelledby={`criteria-title-${pillar.id}`} className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`criteria-title-${pillar.id}`} className={eyebrowLabelClass}>Criteria rated 1 to {pillar.rating_scale_max}</h4>
        {adding ? null : (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden /> Add criterion
          </Button>
        )}
      </div>
      {adding ? <AddCriterionForm pillar={pillar} saving={savingAdd} onAdd={(name) => void add(name)} onCancel={() => setAdding(false)} /> : null}
      {criteria.length === 0 ? (
        <p className={`${secondaryClass} mt-3`}>Add at least one criterion or reviewers will have nothing to rate.</p>
      ) : (
        <ul className="mt-2 border-t border-line">
          {criteria.map((criterion) => (
            <li key={criterion.id} className={criterion.is_active ? "" : "opacity-70"}>
              <EditRow
                editLabel={`Edit criterion ${criterion.name}`}
                editing={editingId === criterion.id}
                onEdit={() => setEditingId(criterion.id)}
                onDone={() => setEditingId(null)}
                display={
                  <>
                    <p className={`${bodyClass} break-words`}>
                      {criterion.name} {criterion.is_active ? null : <Badge>Inactive</Badge>}
                    </p>
                    {criterion.description ? <p className={`${metaClass} break-words`}>{criterion.description}</p> : null}
                  </>
                }
              >
                <div className="space-y-2">
                  <BlurInput ariaLabel="Criterion name" value={criterion.name} required className={`${inputClass} mt-0`} onSave={(next) => onPatch(criterion, { name: next.trim() })} />
                  <BlurInput ariaLabel="Criterion description" value={criterion.description ?? ""} placeholder="Description shown to the reviewer" className={`${inputClass} mt-0`} onSave={(next) => onPatch(criterion, { description: next.trim() || null })} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-[13px] text-ink">
                      <input type="checkbox" checked={criterion.is_active} onChange={(e) => void onPatch(criterion, { is_active: e.target.checked })} className={checkboxClass} /> Active
                    </label>
                    <Button variant="danger" size="sm" onClick={() => onDelete(criterion)}>
                      Delete criterion
                    </Button>
                  </div>
                </div>
              </EditRow>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
