// The Account block on a person's Setup tab: Deactivate or Reactivate, and Remove, with the roster's
// rules and its confirm copy. Split out of PersonSetup so that file keeps the details fields. The
// pending-invitation list is read only when Remove could be offered: the person has no account, the
// viewer may change them, and it is not the viewer's own row.
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../ui/Button.tsx";
import ConfirmDialog from "../../ui/ConfirmDialog.tsx";
import Section from "../../ui/Section.tsx";
import { secondaryClass } from "../../ui/type.ts";
import { useHub } from "../../../context/HubContext.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { listInvitations } from "../../../services/invitations.ts";
import { deleteStaffProfile, type ProfilePatch } from "../../../services/profiles.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { displayName } from "../../../lib/format.ts";
import { canGrantRole, hasAccount } from "../../../lib/people.ts";
import type { Invitation, Profile } from "../../../types/database.ts";

type Patch = (patch: ProfilePatch) => Promise<boolean>;

export default function AccountActions({ companyId, person, onPatch }: { companyId: string; person: Profile; onPatch: Patch }) {
  const { profile: me, can } = useHub();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const name = displayName(person);
  const first = name.split(" ")[0];
  const self = person.id === me.id;
  const canChange = canGrantRole(me, person.role);
  const account = hasAccount(person);
  const mayRemove = !account && canChange && !self;
  // Invitations are read only when Remove could be offered; every other case resolves empty.
  const invitations = useAsync(() => (mayRemove ? listInvitations(companyId) : Promise.resolve([] as Invitation[])), [companyId, mayRemove]);
  const invitation = invitations.data?.find((i) => !i.accepted_at && (i.profile_id === person.id || i.email === person.email)) ?? null;

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
    setBusy(true);
    setDialogError("");
    try {
      await deleteStaffProfile(person.id);
      navigate("/people");
    } catch (err) {
      setDialogError(errorMessage(err, "They were not removed. Try again."));
      setBusy(false);
    }
  }

  let removeLine: ReactNode = null;
  if (mayRemove) {
    if (invitations.error && !invitations.data) removeLine = <p className={secondaryClass}>Invitations did not load, so Remove is not offered. {invitations.error}</p>;
    else if (!invitations.data) removeLine = null;
    else if (invitation) removeLine = <p className={secondaryClass}>{first} has a pending invitation. Cancel their invitation on the roster first, then remove them here.</p>;
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
  } else if (account && canChange && !self) {
    removeLine = <p className={secondaryClass}>{first} has signed in, so their record stays. Deactivate keeps them out.</p>;
  }

  return (
    <Section eyebrow="Hub access" title="Account">
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
          confirmLabel="Remove"
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={() => { setRemoving(false); setDialogError(""); }}
        />
      ) : null}
    </Section>
  );
}
