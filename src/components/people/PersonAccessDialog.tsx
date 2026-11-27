// The Access dialog the People roster opens from a person's row: everything about their hub access
// in one place. It says where they stand (active, invited, not invited yet, inactive), carries the
// invitation controls the roster rows used to (Send invite, or Copy link, Email again and Cancel
// invitation, with the same words, the same one-at-a-time sending and the same email line), and
// under a hairline the Account controls from the Setup tab, so Deactivate, Reactivate, Remove and
// Delete person keep one set of rules and one set of confirm copy. Those controls need the person's
// history to keep Remove's safeguard (a typed name for someone with reviews, GSRs or goals), so the
// dialog reads it when it opens, as the person page does, and holds a skeleton in their place until
// it is in. A read that fails leaves the counts out, which the controls take as history unknown and
// so still ask for the typed name. A Rococo admin's access is Rococo's (0029): as on Setup, they get
// no Account controls here, and nothing is read for them.
//
// The roster owns the rows. The dialog never reloads anything: a created or cancelled invitation, a
// saved profile and a finished remove or delete go back through the callbacks, and the roster hands
// the live person and invitation back in. That is how Remove turns up here the moment an invitation
// is cancelled. On a remove or delete the roster closes the dialog, since the person is gone.
//
// As on the roster, an invitation never depends on its email: when the email does not go out the
// link is copied instead and the line says why. While an invitation is being created or emailed the
// dialog holds still (Escape, the backdrop and Done wait, and Open profile and the Account controls
// are inert), so the line that carries the outcome, and the link when the clipboard refused it, is
// not closed away unseen. When a send or a cancel takes away the button that had focus, focus goes
// to the title rather than dropping out of the dialog.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Send } from "lucide-react";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import Skeleton from "../ui/Skeleton.tsx";
import { tapTargetClass } from "../ui/tap.ts";
import { secondaryClass } from "../ui/type.ts";
import { AccountControls, type AccessGone } from "./person/PersonAccountActions.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCycles, listEmployeeReviews, listGoals } from "../../services/gsr.ts";
import { createInvitation, deleteInvitation, emailInvitation, inviteLink } from "../../services/invitations.ts";
import { updateProfile, type ProfilePatch } from "../../services/profiles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName } from "../../lib/format.ts";
import { hasAccount, historyCounts } from "../../lib/people.ts";
import type { Invitation, Profile } from "../../types/database.ts";

// Where the person stands, in one line under the title.
function statusLine(person: Profile, invitation: Invitation | null): string {
  if (!person.is_active) return "Inactive. They cannot sign in, and their record is kept.";
  if (hasAccount(person)) return `Active. They sign in as ${person.email}.`;
  if (invitation) return "Invited. Waiting for them to sign in.";
  return "Not invited yet.";
}

export default function PersonAccessDialog({
  companyId,
  companySlug,
  person,
  invitation,
  canInvite,
  onInvitationCreated,
  onInvitationCancelled,
  onPatched,
  onGone,
  onClose,
}: {
  companyId: string;
  companySlug: string;
  person: Profile;
  // The roster's pending invitation for this person, or null.
  invitation: Invitation | null;
  // The roster's Send invite rule: the viewer may change this person and they are active.
  canInvite: boolean;
  onInvitationCreated: (invitation: Invitation) => void;
  onInvitationCancelled: (invitationId: string) => void;
  onPatched: (next: Profile) => void;
  onGone: (gone: AccessGone) => void;
  onClose: () => void;
}) {
  const name = displayName(person);
  const account = hasAccount(person);
  // A Rococo admin's access is Rococo's to manage, so they get no Account controls (as on Setup).
  const showAccount = !person.is_rococo_admin;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The person's history, for Remove's and Delete's confirms: read only when the controls show.
  const history = useAsync(
    () => (showAccount ? Promise.all([listEmployeeReviews(companyId, person.id), listCycles(companyId), listGoals(companyId, person.id)]) : Promise.resolve(null)),
    [companyId, person.id, showAccount],
  );
  const counts = history.data ? historyCounts(...history.data) : undefined;
  const historyPending = showAccount && !history.data && !history.error;
  const [cancelling, setCancelling] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // The invitation being created, and the invitation whose email is on its way, so a second press
  // does nothing and the button can say Sending.
  const [inviting, setInviting] = useState(false);
  const [emailing, setEmailing] = useState<string | null>(null);
  // One invitation action at a time, so two sends never race for the email line.
  const inviteBusy = inviting || emailing !== null;
  // What the last invitation email came to: emailed, or ready with its link copied instead.
  const [emailLine, setEmailLine] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The cancel confirm reports only its own failure, so it never opens on an older one.
  const [dialogError, setDialogError] = useState("");
  // A Deactivate or Reactivate that did not save, said under the Account controls.
  const [patchError, setPatchError] = useState("");

  function close() {
    if (!inviteBusy) onClose();
  }

  function linkFor(invite: Invitation): string {
    return `${inviteLink(invite.email)}&company=${encodeURIComponent(companySlug)}`;
  }

  async function copyLink(invite: Invitation) {
    try {
      await navigator.clipboard.writeText(linkFor(invite));
      setCopied(invite.id);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Could not copy. The link is: " + linkFor(invite));
    }
  }

  // Emails a waiting invitation through the notify function. The invitation stands whatever the
  // email does: when it does not go out, the link is copied instead and the line says why.
  async function emailIt(invite: Invitation) {
    if (inviteBusy) return;
    setEmailing(invite.id);
    setEmailLine(null);
    let reason: string | null = null;
    try {
      const result = await emailInvitation(invite.id);
      if (result?.sent !== true) reason = result?.reason || "the email service did not send it";
    } catch (err) {
      reason = errorMessage(err);
    }
    if (reason === null) {
      setEmailLine({ tone: "success", text: `Invitation emailed to ${invite.email}.` });
    } else {
      const why = reason.trim().replace(/\.+$/, "");
      let copiedIt = true;
      try {
        await navigator.clipboard.writeText(linkFor(invite));
        setCopied(invite.id);
        setTimeout(() => setCopied(null), 1600);
      } catch {
        copiedIt = false;
      }
      setEmailLine({
        tone: "warning",
        text: copiedIt
          ? `The invitation is ready but the email did not go out: ${why}. Its link is copied, so you can send it yourself.`
          : `The invitation is ready but the email did not go out: ${why}. Send them this link yourself: ${linkFor(invite)}`,
      });
    }
    setEmailing(null);
  }

  async function sendInvite() {
    if (inviteBusy) return;
    setError("");
    setEmailLine(null);
    setInviting(true);
    let created: Invitation;
    try {
      created = await createInvitation({
        company_id: companyId,
        email: person.email,
        role: person.role,
        title: person.title,
        profile_id: person.id,
      });
    } catch (err) {
      setError(errorMessage(err));
      setInviting(false);
      return;
    }
    onInvitationCreated(created);
    setInviting(false);
    // Send invite gives way to Copy link and Email again, so focus moves to the title.
    headingRef.current?.focus();
    await emailIt(created);
  }

  async function handleCancelInvite() {
    if (!cancelling) return;
    setBusy(true);
    setDialogError("");
    try {
      await deleteInvitation(cancelling.id);
      onInvitationCancelled(cancelling.id);
      setCancelling(null);
      // The confirm and the Cancel invitation button that opened it both go, so focus moves to the title.
      headingRef.current?.focus();
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Saves a profile change from the Account controls and reports whether it landed.
  async function patch(change: ProfilePatch): Promise<boolean> {
    setPatchError("");
    try {
      onPatched(await updateProfile(person.id, change));
      return true;
    } catch (err) {
      setPatchError(errorMessage(err));
      return false;
    }
  }

  return (
    <>
      <Modal onClose={close} labelledBy="access-title">
        <div className="p-6">
          <h2 id="access-title" ref={headingRef} tabIndex={-1} className="font-display text-lg text-heading break-words outline-none">Access for {name}</h2>
          <p className={`mt-1 break-words ${secondaryClass}`}>{statusLine(person, invitation)}</p>

          {!account && invitation ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {person.is_active ? (
                <>
                  <Button variant="secondary" size="sm" aria-label={`Copy sign-in link for ${name}`} onClick={() => void copyLink(invitation)}>
                    {copied === invitation.id ? <><Check size={13} aria-hidden /> Copied</> : <><Copy size={13} aria-hidden /> Copy link</>}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Email the invitation to ${name} again`}
                    disabled={inviteBusy}
                    onClick={() => void emailIt(invitation)}
                  >
                    <Send size={13} aria-hidden /> {emailing === invitation.id ? "Sending..." : "Email again"}
                  </Button>
                </>
              ) : null}
              <Button variant="danger" size="sm" aria-label={`Cancel invitation for ${name}`} onClick={() => setCancelling(invitation)}>
                Cancel invitation
              </Button>
            </div>
          ) : !account && canInvite && person.is_active ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" aria-label={`Send the invitation to ${name}`} disabled={inviteBusy} onClick={() => void sendInvite()}>
                <Send size={13} aria-hidden /> {inviting ? "Sending..." : "Send invite"}
              </Button>
            </div>
          ) : null}
          {error ? <Notice tone="error" className="mt-4 break-words">{error}</Notice> : null}
          {emailLine ? <Notice tone={emailLine.tone} className="mt-4 break-words">{emailLine.text}</Notice> : null}

          {showAccount ? (
            <div className="mt-5 border-t border-line pt-5" inert={inviteBusy}>
              {historyPending ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <AccountControls companyId={companyId} person={person} counts={counts} onPatch={patch} onGone={onGone} pendingInvitation={invitation} />
              )}
              {patchError ? <Notice tone="error" className="mt-4">{patchError}</Notice> : null}
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Link to={`/people/${person.id}`} inert={inviteBusy} className={`text-sm font-medium text-link hover:underline ${tapTargetClass}`}>
              Open profile
            </Link>
            <Button variant="secondary" disabled={inviteBusy} onClick={close}>Done</Button>
          </div>
        </div>
      </Modal>
      {cancelling ? (
        <ConfirmDialog
          title={`Cancel the invitation for ${name}?`}
          body="They stay on the team here, and the invitation no longer lets them sign up. An address on one of this company's sign-in domains can still sign in without one, so deactivate them as well if they should not get in. Send a new invitation whenever you are ready."
          confirmLabel="Cancel invitation"
          busy={busy}
          error={dialogError}
          onConfirm={() => void handleCancelInvite()}
          onCancel={() => { setCancelling(null); setDialogError(""); }}
        />
      ) : null}
    </>
  );
}
