// How many goals each GSR requires, for GSRs, Setup. It reads as text until its pencil, then offers
// the one to five a Monthly GSRs pillar can carry and saves the choice through updatePillar. It used
// to sit inside the pillar on Reviews, Setup; the pillar card now only reads the number. A refused
// save is reported under the field and the stored number stays on show.
import { useState } from "react";
import EditRow from "../ui/EditRow.tsx";
import { labelClass, selectClass } from "../ui/forms.ts";
import { bodyClass, eyebrowLabelClass } from "../ui/type.ts";
import { updatePillar } from "../../services/gsr.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { GsrPillar } from "../../types/database.ts";

export default function RequiredGoalsField({ pillar, onSaved, label = "Goals each GSR requires" }: { pillar: GsrPillar; onSaved: (pillar: GsrPillar) => void; label?: string }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const id = `required-goals-${pillar.id}`;

  async function save(value: number) {
    setError("");
    try {
      onSaved(await updatePillar(pillar.id, { required_goals: value }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <EditRow
      editLabel={`Edit ${label}`}
      editing={editing}
      onEdit={() => setEditing(true)}
      onDone={() => {
        setError("");
        setEditing(false);
      }}
      display={
        <>
          <p className={eyebrowLabelClass}>{label}</p>
          <p className={`${bodyClass} tnum mt-0.5`}>{pillar.required_goals}</p>
        </>
      }
    >
      <label htmlFor={id} className={labelClass}>{label}</label>
      <select id={id} value={pillar.required_goals} onChange={(e) => void save(Number(e.target.value))} className={selectClass}>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      {error ? <p className="mt-1.5 text-[12px] text-danger" role="alert">{error}</p> : null}
    </EditRow>
  );
}
