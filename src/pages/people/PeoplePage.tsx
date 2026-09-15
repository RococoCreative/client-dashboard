// The company's roster. A person here is a person on staff, which is not the same thing as an
// account: an admin adds someone, fills in their profile, and sends the invite whenever the
// company is ready for them. Each row says which of the three states they are in, and carries
// the one action that moves them along. Inviting is still a row plus a link, because the hub
// holds no mail-sending key, so the admin shares the sign-in link and the signup gate lets that
// address through.
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Send, Trash2, UserPlus } from "lucide-react";
import Avatar from "../../components/ui/Avatar.tsx";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import Field from "../../components/ui/Field.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import Modal from "../../components/ui/Modal.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { inputClass, selectClass, tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { createStaffProfile, deleteStaffProfile, listCompanyProfiles, updateProfile } from "../../services/profiles.ts";
import { createInvitation, deleteInvitation, inviteLink, listInvitations } from "../../services/invitations.ts";
import { errorMessage } from "../../lib/errors.ts";
import { isValidEmail, normalizeEmail } from "../../lib/email.ts";
import { displayName, formatDate, pluralize } from "../../lib/format.ts";
import { formatTenure, hasAccount } from "../../lib/people.ts";
import { ROLE_LABELS, keysOf, type Invitation, type Profile, type Role } from "../../types/database.ts";

function AddStaffDialog({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: (person: Profile) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Give the person a name.");
    if (!isValidEmail(email)) return setError("Enter the email address they will sign in with.");
    setBusy(true);
    setError("");
    try {
      onCreated(
        await createStaffProfile({
          company_id: companyId,
          email: normalizeEmail(email),
          full_name: name.trim(),
          title: title.trim() || null,
          role,
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="add-staff-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="add-staff-title" className="font-display text-lg text-heading">Add someone to the team</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          This sets up their profile only. Nothing is sent. Invite them whenever the company is ready.
        </p>
        <div className="mt-5 space-y-4">
          <Field label="Name" htmlFor="staff-name">
            <input id="staff-name" type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Taylor Reed" className={inputClass} />
          </Field>
          <Field label="Email" htmlFor="staff-email" hint="The address they will sign in with when you invite them.">
            <input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role" htmlFor="staff-role" hint={role === "admin" ? "Admins see everything for this company." : "Employees see their own GSR plus the libraries."}>
              <select id="staff-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectClass}>
                {keysOf(ROLE_LABELS).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </Field>
            <Field label="Title (optional)" htmlFor="staff-title">
              <input id="staff-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project Manager" className={inputClass} />
            </Field>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Adding..." : "Add to team"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function PeoplePage() {
  const { company, profile } = useHub();
  const companyId = company!.id;
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<{ person: Profile; invitation: Invitation } | null>(null);
  const [removing, setRemoving] = useState<Profile | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const state = useAsync(async () => {
    const [people, invitations] = await Promise.all([listCompanyProfiles(companyId), listInvitations(companyId)]);
    return { people, invitations };
  }, [companyId]);

  const people = state.data?.people ?? [];
  const invitations = state.data?.invitations ?? [];
  const pendingFor = (person: Profile): Invitation | null =>
    invitations.find((i) => !i.accepted_at && (i.profile_id === person.id || i.email === person.email)) ?? null;
  const waiting = people.filter((p) => !hasAccount(p));

  function linkFor(invitation: Invitation): string {
    return `${inviteLink(invitation.email)}&company=${encodeURIComponent(company!.slug)}`;
  }

  async function copyLink(invitation: Invitation) {
    try {
      await navigator.clipboard.writeText(linkFor(invitation));
      setCopied(invitation.id);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Could not copy. The link is: " + linkFor(invitation));
    }
  }

  async function patchPerson(person: Profile, patch: Parameters<typeof updateProfile>[1]) {
    setError("");
    try {
      const next = await updateProfile(person.id, patch);
      state.setData((prev) => (prev ? { ...prev, people: prev.people.map((p) => (p.id === next.id ? next : p)) } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function sendInvite(person: Profile) {
    setError("");
    try {
      const created = await createInvitation({
        company_id: companyId,
        email: person.email,
        role: person.role,
        title: person.title,
        profile_id: person.id,
      });
      state.setData((prev) => (prev ? { ...prev, invitations: [created, ...prev.invitations] } : prev));
      await copyLink(created);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCancelInvite() {
    if (!cancelling) return;
    setBusy(true);
    try {
      await deleteInvitation(cancelling.invitation.id);
      const id = cancelling.invitation.id;
      state.setData((prev) => (prev ? { ...prev, invitations: prev.invitations.filter((i) => i.id !== id) } : prev));
      setCancelling(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveStaff() {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteStaffProfile(removing.id);
      const id = removing.id;
      state.setData((prev) => (prev ? { ...prev, people: prev.people.filter((p) => p.id !== id) } : prev));
      setRemoving(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={company!.name}
        title="People"
        description="Everyone on the team, what they can see, and who is still waiting on an invitation."
        actions={<Button size="sm" onClick={() => setAdding(true)}><UserPlus size={14} aria-hidden /> Add staff</Button>}
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : (
        <Section
          eyebrow="Team"
          title={`${people.length} ${people.length === 1 ? "person" : "people"}`}
          description={waiting.length > 0 ? `${pluralize(waiting.length, "person", "people")} set up and not signed in yet.` : undefined}
          padded={false}
        >
          {people.length === 0 ? (
            <p className="p-5 text-sm text-ink-2">Nobody here yet. Add the first person.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Person</th>
                    <th className={thClass}>Title</th>
                    <th className={thClass}>Department</th>
                    <th className={thClass}>Hired</th>
                    <th className={thClass}>Role</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}></th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => {
                    const self = person.id === profile.id;
                    const invitation = pendingFor(person);
                    const account = hasAccount(person);
                    return (
                      <tr key={person.id} className={`hover:bg-surface-2/60 ${person.is_active ? "" : "opacity-60"}`}>
                        <td className={tdClass}>
                          <Link to={`/people/${person.id}`} className="flex items-center gap-3">
                            <Avatar person={person} size={28} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-ink">{displayName(person)}{self ? " (you)" : ""}</span>
                              <span className="block truncate text-[12px] text-ink-3">{person.email}</span>
                            </span>
                          </Link>
                        </td>
                        <td className={`${tdClass} text-ink-2`}>{person.title ?? "-"}</td>
                        <td className={`${tdClass} text-ink-2`}>{person.department ?? "-"}</td>
                        <td className={`${tdClass} text-ink-2`}>
                          {person.hire_date ? (
                            <span className="block">
                              <span className="block">{formatDate(person.hire_date)}</span>
                              <span className="block text-[12px] text-ink-3">{formatTenure(person.hire_date)}</span>
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className={tdClass}>
                          <select value={person.role} disabled={self} aria-label={`Role for ${displayName(person)}`} onChange={(e) => void patchPerson(person, { role: e.target.value as Role })} className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}>
                            {keysOf(ROLE_LABELS).map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        </td>
                        <td className={tdClass}>
                          {account ? (
                            <Badge tone={person.is_active ? "success" : "neutral"}>{person.is_active ? "Active" : "Inactive"}</Badge>
                          ) : invitation ? (
                            <Badge tone="info">Invited</Badge>
                          ) : (
                            <Badge tone="warning">Not invited</Badge>
                          )}
                        </td>
                        <td className={`${tdClass} text-right`}>
                          <span className="flex items-center justify-end gap-1.5">
                            {account && !self ? (
                              <Button variant="ghost" size="sm" onClick={() => void patchPerson(person, { is_active: !person.is_active })}>
                                {person.is_active ? "Deactivate" : "Reactivate"}
                              </Button>
                            ) : null}
                            {!account && invitation ? (
                              <>
                                <Button variant="secondary" size="sm" aria-label={`Copy sign-in link for ${displayName(person)}`} onClick={() => void copyLink(invitation)}>
                                  {copied === invitation.id ? <><Check size={13} aria-hidden /> Copied</> : <><Copy size={13} aria-hidden /> Copy link</>}
                                </Button>
                                <IconButton label={`Cancel the invitation for ${displayName(person)}`} onClick={() => setCancelling({ person, invitation })}>
                                  <Trash2 size={14} aria-hidden />
                                </IconButton>
                              </>
                            ) : null}
                            {!account && !invitation ? (
                              <>
                                <Button size="sm" aria-label={`Send the invitation to ${displayName(person)}`} onClick={() => void sendInvite(person)}>
                                  <Send size={13} aria-hidden /> Send invite
                                </Button>
                                <IconButton label={`Remove ${displayName(person)}`} onClick={() => setRemoving(person)}>
                                  <Trash2 size={14} aria-hidden />
                                </IconButton>
                              </>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-5 py-3 text-[12px] text-ink-3">
            Sending an invitation copies a sign-in link to your clipboard. Pass it on however you like; the hub does not
            send email. Anyone whose address is on one of this company's sign-in domains can also sign in without an
            invitation, and either way they take over the profile set up here rather than starting a second one.
          </p>
        </Section>
      )}

      {adding ? (
        <AddStaffDialog
          companyId={companyId}
          onClose={() => setAdding(false)}
          onCreated={(person) => {
            state.setData((prev) => (prev ? { ...prev, people: [...prev.people, person] } : prev));
            setAdding(false);
          }}
        />
      ) : null}
      {cancelling ? (
        <ConfirmDialog
          title={`Cancel the invitation for ${displayName(cancelling.person)}?`}
          body="They stay on the team here and the link stops working. Send a new invitation whenever you are ready."
          confirmLabel="Cancel invitation"
          busy={busy}
          onConfirm={() => void handleCancelInvite()}
          onCancel={() => setCancelling(null)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={`Remove ${displayName(removing)} from the team?`}
          body="This deletes their profile along with anything set up for them. They have never signed in, so nothing they did is lost."
          confirmLabel="Remove"
          busy={busy}
          onConfirm={() => void handleRemoveStaff()}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
}
