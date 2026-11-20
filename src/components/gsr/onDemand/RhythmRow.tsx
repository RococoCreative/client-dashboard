// A person's GSR rhythm (profiles.gsr_cadence) on their GSR and goals tab, in a company on demand:
// how often they are due a GSR, from None (never due) to Quarterly. It reads first, as a setup row
// does, and only an admin of the company or someone who leads the person gets the pencil; the
// person themself and everyone else read it. Who may change it is the caller's call (canEdit); the
// database holds the same line. A refused save keeps the stored rhythm on show and says why.
import { useState } from "react";
import EditRow from "../../ui/EditRow.tsx";
import { helpClass, labelClass, selectClass } from "../../ui/forms.ts";
import { bodyClass, eyebrowLabelClass } from "../../ui/type.ts";
import { GSR_RHYTHMS, GSR_RHYTHM_LABELS } from "../../../lib/gsr/onDemand.ts";
import type { ProfilePatch } from "../../../services/profiles.ts";
import type { GsrCadence, Profile } from "../../../types/database.ts";

const LABEL = "GSR rhythm";

export default function RhythmRow({ person, canEdit, onPatch }: { person: Profile; canEdit: boolean; onPatch: (patch: ProfilePatch) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const id = `gsr-rhythm-${person.id}`;
  const display = (
    <>
      <p className={eyebrowLabelClass}>{LABEL}</p>
      <p className={`${bodyClass} mt-0.5`}>{GSR_RHYTHM_LABELS[person.gsr_cadence]}</p>
    </>
  );
  if (!canEdit) {
    return (
      <div className="flex min-h-9 items-center border-b border-line pb-3 tap:min-h-11">
        <div className="min-w-0">{display}</div>
      </div>
    );
  }
  return (
    <EditRow
      className="border-b border-line pb-3"
      editLabel={`Edit ${LABEL}`}
      editing={editing}
      onEdit={() => setEditing(true)}
      onDone={() => setEditing(false)}
      display={display}
    >
      <label htmlFor={id} className={labelClass}>{LABEL}</label>
      <select id={id} value={person.gsr_cadence} onChange={(e) => void onPatch({ gsr_cadence: e.target.value as GsrCadence })} className={selectClass}>
        {GSR_RHYTHMS.map((rhythm) => (
          <option key={rhythm} value={rhythm}>{GSR_RHYTHM_LABELS[rhythm]}</option>
        ))}
      </select>
      <p className={helpClass}>How often a GSR is due. None means one is never due. A GSR already started stays as it is.</p>
    </EditRow>
  );
}
