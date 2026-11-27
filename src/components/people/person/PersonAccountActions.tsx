// The Account block on a person's Setup tab: Deactivate or Reactivate, Remove for someone who never
// signed in, and Delete person for someone who has, with the roster's rules and their confirm copy.
// Split out of PersonSetup so that file keeps the details fields. The pending-invitation list is
// read only when Remove could be offered: the person has no account, the viewer may change them,
// and it is not the viewer's own row.
//
// Delete person (0049) deletes everything on the profile and the person's sign-in, and their
// address can only come back with a new invitation, so it asks for more than a click: the dialog
// says what goes, offers Deactivate as the softer way, and holds its button until the person's
// full name is typed exactly. It is offered to an owner or admin (or Rococo) who may change this
// person, never on yourself, never on someone ranked above you and never on a Rococo admin's
// profile unless you are Rococo; the database holds all of that, and the last owner, as well. An
// admin who sees only some divisions manages only the people ranked below them (0038), so a peer
// admin is not offered to them; everyone the page shows them below their rank is in their reach.
// Who gets Remove or Delete person is removalFor (lib/people.ts), the same rule the Access dialog
// reads the person's history on.
//
// Remove deletes everything set up for someone who never signed in, and since 0049 that includes
// goals and notes in a closed or locked month. So when the page has loaded any reviews, GSRs or
// goals for them, Remove asks for their name typed the same way; with none it stays one click. A
// caller that could not learn their history (counts left out, as when the roster's Access dialog
// failed to read it) gets the safe reading: history unknown counts as history, so Remove still asks
// for the typed name, without the counts line. The Setup tab always passes counts, so it reads as
// it did.
//
// AccountControls is the body without its Section, so the People roster's access lightbox can show
// the same controls. Given onGone it reports a finished remove or delete instead of navigating away,
// and given pendingInvitation (the roster already holds it) it reads no invitations itself.
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../ui/Button.tsx";
import ConfirmDialog from "../../ui/ConfirmDialog.tsx";
import Section from "../../ui/Section.tsx";
import { secondaryClass } from "../../ui/type.ts";
import { useHub } from "../../../context/HubContext.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { listInvitations } from "../../../services/invitations.ts";
import { listPersonGsrs } from "../../../services/gsrOnDemand.ts";
import { deletePerson, deleteStaffProfile, type ProfilePatch } from "../../../services/profiles.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { displayName, pluralize } from "../../../lib/format.ts";
import { canGrantRole, hasAccount, removalFor, type ProfileCounts } from "../../../lib/people.ts";
import { inputClass } from "../../ui/forms.ts";
import type { Gsr, Invitation, Profile } from "../../../types/database.ts";

type Patch = (patch: ProfilePatch) => Promise<boolean>;

function countsLine(counts: ProfileCounts): string {
  const parts = [pluralize(counts.reviews, "review"), pluralize(counts.gsrs, "GSR"), pluralize(counts.goals, "goal")];
  return `On their profile now: ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
}

// The typed confirmation both deletes use: the full name shown in its own case (the uppercase field
// label would hide the case the match needs), and the field it is typed into.
function TypedName({ id, name, value, disabled, onChange }: { id: string; name: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-ink-2">
        Type <span className="font-medium text-ink">{name}</span> to confirm
      </label>
      <input id={id} className={inputClass} value={value} autoComplete="off" spellCheck={false} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// The counts type lives with historyCounts in lib/people.ts; callers of this file may still name it here.
export type { ProfileCounts };

// What a finished remove or delete reports to a caller that stays on its own screen.
export type AccessGone = { kind: "removed" | "deleted"; name: string };

export function AccountControls({
  companyId,
  person,
  counts,
  onPatch,
  onGone,
  pendingInvitation,
}: {
  companyId: string;
  person: Profile;
  counts?: ProfileCounts;
  onPatch: Patch;
  // Omitted: navigate to /people as the Setup tab does. Given: called instead of navigating.
  onGone?: (gone: AccessGone) => void;
  // undefined: read the invitations here. Given (null or one): use it and read nothing.
  pendingInvitation?: Invitation | null;
}) {
  const { profile: me, can, company } = useHub();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const name = displayName(person);
  const first = name.split(" ")[0];
  const self = person.id === me.id;
  const canChange = canGrantRole(me, person.role);
  const account = hasAccount(person);
  const removal = removalFor(me, person);
  const mayRemove = removal === "remove";
  const mayDelete = removal === "delete";
  const fullName = name.trim();
  const nameMatches = typed.trim() === fullName;
  // Unknown history (no counts given) is treated as history, so Remove never goes in one click blind.
  const hasHistory = counts === undefined || counts.reviews + counts.gsrs + counts.goals > 0;
  // Invitations are read only when Remove could be offered; every other case resolves empty.
  // A caller that already holds the pending invitation passes it, and nothing is read here.
  const given = pendingInvitation !== undefined;
  const invitations = useAsync(() => (mayRemove && !given ? listInvitations(companyId) : Promise.resolve([] as Invitation[])), [companyId, mayRemove, given]);
  const invitation = given ? pendingInvitation : (invitations.data?.find((i) => !i.accepted_at && (i.profile_id === person.id || i.email === person.email)) ?? null);
  // A company on demand keeps GSRs outside the months the page loaded; read only once the delete
  // dialog is open. If the read fails the dialog goes without the counts.
  const onDemand = company?.gsr_mode === "on_demand";
  const standalone = useAsync(
    () => (deleting && onDemand ? listPersonGsrs(companyId, person.id) : Promise.resolve([] as Gsr[])),
    [companyId, person.id, deleting, onDemand],
  );
  const shownCounts = counts && standalone.data && !standalone.error ? { ...counts, gsrs: counts.gsrs + (onDemand ? standalone.data.length : 0) } : null;

  async function switchActive() {
    setSwitching(true);
    try {
      await onPatch({ is_active: !person.is_active });
    } finally {
      setSwitching(false);
    }
  }

  // deleteStaffProfile throws when nothing went (they signed in meanwhile, or the database refused),
  // so the dialog stays open on the reason instead of closing as if they were gone.
  async function remove() {
    if (hasHistory && !nameMatches) return;
    setBusy(true);
    setDialogError("");
    try {
      await deleteStaffProfile(person.id);
      if (onGone) onGone({ kind: "removed", name: fullName });
      else navigate("/people");
    } catch (err) {
      setDialogError(errorMessage(err, "They were not removed. Try again."));
      setBusy(false);
    }
  }

  // deletePerson throws on a refusal (the guard's own words) or when nothing went, so the dialog
  // stays open on the reason.
  async function deleteForGood() {
    if (!nameMatches) return;
    setBusy(true);
    setDialogError("");
    try {
      await deletePerson(companyId, person.id);
      if (onGone) onGone({ kind: "deleted", name: fullName });
      else navigate("/people", { state: { deleted: fullName } });
    } catch (err) {
      setDialogError(errorMessage(err, "They were not deleted. Try again."));
      setBusy(false);
    }
  }

  function closeDelete() {
    setDeleting(false);
    setTyped("");
    setDialogError("");
  }

  // The softer way, from inside the dialog: deactivate and keep everything.
  async function deactivateInstead() {
    setBusy(true);
    try {
      if (await onPatch({ is_active: false })) closeDelete();
    } finally {
      setBusy(false);
    }
  }

  let removeLine: ReactNode = null;
  if (mayRemove) {
    if (!given && invitations.error && !invitations.data) removeLine = <p className={secondaryClass}>Invitations did not load, so Remove is not offered. {invitations.error}</p>;
    else if (!given && !invitations.data) removeLine = null;
    else if (invitation) {
      removeLine = (
        <p className={secondaryClass}>
          {given ? `${first} has a pending invitation. Cancel their invitation above first, then remove them.` : `${first} has a pending invitation. Cancel their invitation on the roster first, then remove them here.`}
        </p>
      );
    }
    else {
      removeLine = (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={secondaryClass}>Remove deletes their profile and everything set up for them.</p>
          <Button variant="danger" size="sm" aria-label={`Remove ${name}`} onClick={() => setRemoving(true)}>
            Remove
          </Button>
        </div>
      );
    }
  } else if (mayDelete) {
    removeLine = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={secondaryClass}>Delete removes {first}, everything on their profile and their sign-in. It cannot be undone.</p>
        <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
          Delete person
        </Button>
      </div>
    );
  } else if (account && canChange && !self) {
    removeLine = <p className={secondaryClass}>{first} has signed in, so their record stays. Deactivate keeps them out.</p>;
  }

  return (
    <>
      {self ? (
        <p className={secondaryClass}>This is you. Another admin deactivates your account if it comes to that.</p>
      ) : !canChange ? (
        <p className={secondaryClass}>Only an owner or Rococo can deactivate or remove this person.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={secondaryClass}>
              {person.is_active
                ? "Deactivating keeps them out of the hub and keeps everything set up for them on record."
                : "Inactive: they cannot sign in, and their record is kept. Reactivate to let them back in."}
            </p>
            <Button variant="secondary" size="sm" disabled={switching} aria-label={`${person.is_active ? "Deactivate" : "Reactivate"} ${name}`} onClick={() => void switchActive()}>
              {person.is_active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
          {removeLine ? <div className="border-t border-line pt-4">{removeLine}</div> : null}
        </div>
      )}
      {removing ? (
        <ConfirmDialog
          title={`Remove ${name} from the team?`}
          body={`This deletes their profile and everything set up for them, including reviews, ${can("pay") ? "goals, KPIs and compensation" : "goals and KPIs"}. It does not stop an address on one of this company's sign-in domains from signing in. To keep their history, or to keep them out, deactivate them instead.`}
          confirmLabel={hasHistory ? `Remove ${first} for good` : "Remove"}
          confirmDisabled={hasHistory && !nameMatches}
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={() => { setRemoving(false); setTyped(""); setDialogError(""); }}
        >
          {hasHistory ? (
            <>
              <p className="text-sm text-ink">{counts ? `${countsLine(counts)} This cannot be undone.` : "This cannot be undone."}</p>
              <TypedName id="remove-person-name" name={fullName} value={typed} disabled={busy} onChange={setTyped} />
            </>
          ) : null}
        </ConfirmDialog>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${fullName}?`}
          body={`This deletes ${fullName} and everything on their profile: reviews and scores, GSRs, goals, notes, KPIs and compensation. Tasks they assigned or completed stay, without their name. Their sign-in is removed and their address can only come back with a new invitation. This cannot be undone.`}
          confirmLabel={`Delete ${first} for good`}
          confirmDisabled={!nameMatches}
          busy={busy}
          error={dialogError}
          onConfirm={() => void deleteForGood()}
          onCancel={closeDelete}
        >
          {shownCounts ? <p className="text-sm text-ink">{countsLine(shownCounts)}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5">
            <p className={secondaryClass}>
              {person.is_active ? "To keep their history, deactivate them instead." : "To keep their history, leave them inactive instead."}
            </p>
            {person.is_active ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void deactivateInstead()}>
                Deactivate
              </Button>
            ) : null}
          </div>
          <TypedName id="delete-person-name" name={fullName} value={typed} disabled={busy} onChange={setTyped} />
        </ConfirmDialog>
      ) : null}
    </>
  );
}

export default function AccountActions({ companyId, person, counts, onPatch }: { companyId: string; person: Profile; counts?: ProfileCounts; onPatch: Patch }) {
  return (
    <Section eyebrow="Hub access" title="Account">
      <AccountControls companyId={companyId} person={person} counts={counts} onPatch={onPatch} />
    </Section>
  );
}
