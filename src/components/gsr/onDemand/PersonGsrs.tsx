// A person's GSR and goals tab in a company on demand: their rhythm, "New GSR", every GSR they have
// had, newest first, then their goals for this year, next year and their BHAG, as on periods. The
// rhythm and the GSRs sit in one place because a manager has no Setup tab.
//
// Who sees what follows the database: anyone who opens this tab reads the rhythm; an admin of the
// company and anyone who leads the person change it, never the person themself (RhythmRow); the
// person, those who lead them and admins start a GSR for them (useStartGsr); the list holds the
// GSRs the viewer may read. A rhythm save goes straight to the profile and updates the record the
// person page loaded, so the page and this tab agree.
import { PencilLine } from "lucide-react";
import Button from "../../ui/Button.tsx";
import Notice from "../../ui/Notice.tsx";
import Section from "../../ui/Section.tsx";
import SkeletonRows from "../../ui/SkeletonRows.tsx";
import { sectionEyebrowClass, sectionTitleClass } from "../../ui/type.ts";
import GoalsPanel from "../GoalsPanel.tsx";
import GsrList from "./GsrList.tsx";
import RhythmRow from "./RhythmRow.tsx";
import { useStartGsr } from "./useStartGsr.ts";
import { useHub } from "../../../context/HubContext.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { displayName } from "../../../lib/format.ts";
import { ledBy } from "../../../lib/people.ts";
import { listDirectory } from "../../../services/directory.ts";
import { listPersonGsrs } from "../../../services/gsrOnDemand.ts";
import { updateProfile, type ProfilePatch } from "../../../services/profiles.ts";
import type { PersonTabProps } from "../../../pages/people/personTabs.ts";

export default function PersonGsrs({ companyId, data, person, update, onError }: PersonTabProps) {
  const { profile: me, isAdmin } = useHub();
  const { start, busy, error } = useStartGsr();
  const state = useAsync(async () => {
    const [gsrs, directory] = await Promise.all([listPersonGsrs(companyId, person.id), listDirectory(companyId)]);
    return { gsrs, names: new Map(directory.map((entry) => [entry.id, entry.full_name?.trim() || "Unnamed"] as const)) };
  }, [companyId, person.id]);

  const isOwn = me.id === person.id;
  const leads = !isOwn && ledBy(me, data.people).some((p) => p.id === person.id);
  const canSetRhythm = !isOwn && (isAdmin || leads);
  // A Rococo admin placed on a roster has no GSRs of their own.
  const canStart = !person.is_rococo_admin && (isOwn || isAdmin || leads);

  async function patch(change: ProfilePatch): Promise<boolean> {
    try {
      const next = await updateProfile(person.id, change);
      update((prev) => ({ ...prev, person: next, people: prev.people.map((p) => (p.id === next.id ? next : p)) }));
      onError("");
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    }
  }

  return (
    <div className="space-y-6">
      <Section
        eyebrow="Goal setting"
        title="GSRs"
        actions={
          canStart ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p> : null}
              <Button size="sm" disabled={busy} onClick={() => void start(person.id)}>
                <PencilLine size={14} aria-hidden /> New GSR
              </Button>
            </div>
          ) : null
        }
      >
        <RhythmRow person={person} canEdit={canSetRhythm} onPatch={patch} />
        <div className="mt-3">
          {state.error && !state.data ? (
            <Notice tone="error">{state.error}</Notice>
          ) : !state.data ? (
            <SkeletonRows rows={3} />
          ) : (
            <GsrList gsrs={state.data.gsrs} names={state.data.names} />
          )}
        </div>
      </Section>
      <section aria-labelledby="person-goals-heading">
        <div className="mb-3">
          <p className={sectionEyebrowClass}>Goals</p>
          <h2 id="person-goals-heading" className={`mt-1 ${sectionTitleClass}`}>This year, next year and the BHAG</h2>
        </div>
        <GoalsPanel companyId={companyId} employeeId={person.id} canEdit={isAdmin} ownerName={displayName(person).split(" ")[0]} />
      </section>
    </div>
  );
}
