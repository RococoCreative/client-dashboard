// The control that sets how often a person's Goal Setting Review runs (profiles.gsr_cadence, 0046).
// An admin sets it on Setup; a manager has no Setup tab, so a manager who leads the person sets it
// from the details on Overview. Both read this one select, so the choices and the note under them
// never drift apart. Who may set it is the caller's call (canSetRhythm); the database holds the
// same line. A change applies from their next GSR period; one already started stays as it is.
import { helpClass, selectClass } from "../../ui/forms.ts";
import { GSR_CADENCES, GSR_RHYTHM_LABELS, rhythmOf } from "../../../lib/gsr/cycles.ts";
import type { ProfilePatch } from "../../../services/profiles.ts";
import type { GsrCadence, Profile } from "../../../types/database.ts";

export default function PersonRhythmSelect({ id, person, onPatch }: { id: string; person: Profile; onPatch: (patch: ProfilePatch) => Promise<boolean> }) {
  return (
    <>
      <select id={id} value={rhythmOf(person)} onChange={(e) => void onPatch({ gsr_cadence: e.target.value as GsrCadence })} className={selectClass}>
        {GSR_CADENCES.map((c) => (
          <option key={c} value={c}>{GSR_RHYTHM_LABELS[c]}</option>
        ))}
      </select>
      <p className={helpClass}>How often their Goal Setting Review runs. A change applies from their next GSR; one already started stays as it is.</p>
    </>
  );
}
