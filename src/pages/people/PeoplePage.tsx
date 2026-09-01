// The company's people: everyone with an account (name, title, role, active), and the
// invitations waiting to be used. Inviting is a database row plus a link to send: the hub
// holds no mail-sending key, so the admin shares the sign-in link and the signup gate lets
// that address through.
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Trash2, UserPlus } from "lucide-react";
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
import { listCompanyProfiles, updateProfile } from "../../services/profiles.ts";
import { createInvitation, deleteInvitation, inviteLink, listInvitations } from "../../services/invitations.ts";
import { errorMessage } from "../../lib/errors.ts";
import { isValidEmail, normalizeEmail } from "../../lib/email.ts";
import { displayName, formatDate } from "../../lib/format.ts";
import { ROLE_LABELS, keysOf, type Invitation, type Profile, type Role } from "../../types/database.ts";

function InviteDialog({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: (inv: Invitation) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!isValidEmail(email)) return setError("Enter a valid email address.");
    setBusy(true);
    setError("");
    try {
      onCreated(await createInvitation({ company_id: companyId, email: normalizeEmail(email), role, title: title.trim() || null }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="invite-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="invite-title" className="font-display text-lg text-heading">Invite someone</h2>
        <p className="mt-1 text-[13px] text-ink-2">They sign in with this email and land in the company automatically. You will get a link to send them.</p>
        <div className="mt-5 space-y-4">
          <Field label="Email" htmlFor="invite-email">
            <input id="invite-email" type="email" value={email} autoFocus onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role" htmlFor="invite-role" hint={role === "admin" ? "Admins see everything for this company." : "Employees see their own GSR plus the libraries."}>
              <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectClass}>
                {keysOf(ROLE_LABELS).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </Field>
            <Field label="Title (optional)" htmlFor="invite-title-field">
              <input id="invite-title-field" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project Manager" className={inputClass} />
            </Field>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Inviting..." : "Create invitation"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function PeoplePage() {
  const { company, profile } = useHub();
  const companyId = company!.id;
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const state = useAsync(async () => {
    const [people, invitations] = await Promise.all([listCompanyProfiles(companyId), listInvitations(companyId)]);
    return { people, invitations };
  }, [companyId]);

  const people = state.data?.people ?? [];
  const pending = (state.data?.invitations ?? []).filter((i) => !i.accepted_at);

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

  async function handleRemoveInvitation() {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteInvitation(removing.id);
      state.setData((prev) => (prev ? { ...prev, invitations: prev.invitations.filter((i) => i.id !== removing.id) } : prev));
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
        description="Who has access, what they can see, and who is still to sign in."
        actions={<Button size="sm" onClick={() => setInviting(true)}><UserPlus size={14} aria-hidden /> Invite</Button>}
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="space-y-6">
          <Section eyebrow="Team" title={`${people.length} ${people.length === 1 ? "person" : "people"}`} padded={false}>
            {people.length === 0 ? (
              <p className="p-5 text-sm text-ink-2">Nobody here yet. Invite the first person.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Person</th>
                      <th className={thClass}>Title</th>
                      <th className={thClass}>Role</th>
                      <th className={thClass}>Status</th>
                      <th className={thClass}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => {
                      const self = person.id === profile.id;
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
                          <td className={tdClass}>
                            <select value={person.role} disabled={self} aria-label={`Role for ${displayName(person)}`} onChange={(e) => void patchPerson(person, { role: e.target.value as Role })} className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}>
                              {keysOf(ROLE_LABELS).map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                              ))}
                            </select>
                          </td>
                          <td className={tdClass}>
                            <Badge tone={person.is_active ? "success" : "neutral"}>{person.is_active ? "Active" : "Inactive"}</Badge>
                          </td>
                          <td className={`${tdClass} text-right`}>
                            {!self ? (
                              <Button variant="ghost" size="sm" onClick={() => void patchPerson(person, { is_active: !person.is_active })}>
                                {person.is_active ? "Deactivate" : "Reactivate"}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section eyebrow="Invitations" title={`${pending.length} pending`} description="Send each person their link. They enter this email on the sign-in screen and are placed here automatically." padded={false}>
            {pending.length === 0 ? (
              <p className="p-5 text-sm text-ink-2">No pending invitations.</p>
            ) : (
              <ul className="divide-y divide-line">
                {pending.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{invitation.email}</p>
                      <p className="text-[12px] text-ink-3">
                        {ROLE_LABELS[invitation.role]}{invitation.title ? ` · ${invitation.title}` : ""} · invited {formatDate(invitation.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button variant="secondary" size="sm" onClick={() => void copyLink(invitation)}>
                        {copied === invitation.id ? <><Check size={13} aria-hidden /> Copied</> : <><Copy size={13} aria-hidden /> Copy sign-in link</>}
                      </Button>
                      <IconButton label="Cancel invitation" onClick={() => setRemoving(invitation)}><Trash2 size={14} aria-hidden /></IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      {inviting ? (
        <InviteDialog
          companyId={companyId}
          onClose={() => setInviting(false)}
          onCreated={(invitation) => {
            state.setData((prev) => (prev ? { ...prev, invitations: [invitation, ...prev.invitations] } : prev));
            setInviting(false);
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog title={`Cancel the invitation for ${removing.email}?`} body="They will no longer be able to sign in with this address unless it matches a company domain." confirmLabel="Cancel invitation" busy={busy} onConfirm={() => void handleRemoveInvitation()} onCancel={() => setRemoving(null)} />
      ) : null}
    </>
  );
}
