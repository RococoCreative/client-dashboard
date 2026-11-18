// The company's roster, and a manager's team. A person here is a person on staff, which is not the
// same thing as an account: an admin adds someone, fills in their profile, and sends the invite
// whenever the company is ready for them. Each row says where the person works, who they report
// to, their role and which state they are in, and carries the one action that moves them along.
// Inviting is still a row plus a link, because the hub holds no mail-sending key, so the admin
// shares the sign-in link and the signup gate lets that address through.
//
// The list is whatever the database shows the viewer (0038): the whole company for an owner, a
// full-scope admin or Rococo; their divisions, their chain and everyone unplaced for any other
// admin; their chain and their divisions for a manager. The division chips, the search box and the
// inactive switch only narrow that list, never widen it. A manager reads the page as "Your team":
// no adding, no invitations (those are admin-only in the database too), no row actions, and the
// role as plain text.
//
// Deactivate is on every row but your own and a Rococo admin's, account or not. An address on one
// of the company's sign-in domains gets in without any invitation and claims its roster row, so
// switching the row off is the one thing that keeps a person out before they ever sign in, and it
// keeps everything set up for them on record, where Remove deletes it. A Rococo admin placed with
// the company shows on the roster too, but their role and access are Rococo's to manage.
// Deactivating, inviting and removing someone ranked above you is refused by the database
// (0033), so those rows offer none of the three.
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Search, Send, Trash2, UserPlus } from "lucide-react";
import Avatar from "../../components/ui/Avatar.tsx";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import Chip from "../../components/ui/Chip.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import Field from "../../components/ui/Field.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import Modal from "../../components/ui/Modal.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { checkboxClass, helpClass, inputClass, labelClass, selectClass, tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listDirectory } from "../../services/directory.ts";
import { listDivisions } from "../../services/divisions.ts";
import { createStaffProfile, deleteStaffProfile, listCompanyProfiles, updateProfile } from "../../services/profiles.ts";
import { createInvitation, deleteInvitation, inviteLink, listInvitations } from "../../services/invitations.ts";
import { errorMessage } from "../../lib/errors.ts";
import { isValidEmail, normalizeEmail } from "../../lib/email.ts";
import { displayName, pluralize } from "../../lib/format.ts";
import {
  canGrantRole,
  directoryById,
  divisionLabel,
  grantableRoles,
  hasAccount,
  inEveryDivision,
  isLeadRole,
  nameFromDirectory,
  viewerDivisions,
} from "../../lib/people.ts";
import { ROLE_LABELS, type CompanyDivision, type DirectoryEntry, type Invitation, type Profile, type Role } from "../../types/database.ts";

// What each role opens up, shown under the Role select when adding someone.
const ROLE_HINTS: Record<Role, string> = {
  owner: "Owners see everything for this company. Only an owner or Rococo can make someone an owner.",
  admin: "Admins see everything for this company, or the divisions an owner gives them.",
  manager: "Sees the people who report to them, and their teams. Assigns their tasks and works their monthly goals.",
  employee: "Employees see their own GSR plus the libraries.",
};

// The division filter: everyone, one division, everyone in every division, or the unplaced.
const ALL = "all";
const EVERY = "every";
const NONE = "none";

function AddStaffDialog({
  companyId,
  granter,
  divisions,
  people,
  onClose,
  onCreated,
}: {
  companyId: string;
  granter: Profile;
  // The divisions this admin may place someone in: the ones they can view.
  divisions: readonly CompanyDivision[];
  // Who they may report to: the active people this admin can see.
  people: readonly Profile[];
  onClose: () => void;
  onCreated: (person: Profile) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [title, setTitle] = useState("");
  const [divisionIds, setDivisionIds] = useState<string[]>([]);
  const [reportsTo, setReportsTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const manager = people.find((p) => p.id === reportsTo) ?? null;

  function toggleDivision(id: string, on: boolean) {
    setDivisionIds((list) => (on ? [...list.filter((d) => d !== id), id] : list.filter((d) => d !== id)));
  }

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
          // In the company's order, whatever order they were ticked in.
          division_ids: divisions.filter((d) => divisionIds.includes(d.id)).map((d) => d.id),
          reports_to: reportsTo || null,
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
            <Field label="Role" htmlFor="staff-role" hint={ROLE_HINTS[role]}>
              <select id="staff-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectClass}>
                {grantableRoles(granter).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </Field>
            <Field label="Title (optional)" htmlFor="staff-title">
              <input id="staff-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project Manager" className={inputClass} />
            </Field>
          </div>
          <div className={`grid gap-3 ${divisions.length > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
            {divisions.length > 0 ? (
              <fieldset>
                <legend className={labelClass}>Division (optional)</legend>
                <div className="mt-2 space-y-1.5">
                  {divisions.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" className={checkboxClass} checked={divisionIds.includes(d.id)} onChange={(e) => toggleDivision(d.id, e.target.checked)} />
                      {d.name}
                    </label>
                  ))}
                </div>
                <p className={helpClass}>Tick more than one for someone who works in several.</p>
              </fieldset>
            ) : null}
            <Field
              label="Reports to (optional)"
              htmlFor="staff-reports-to"
              hint={manager && !isLeadRole(manager.role) ? `${displayName(manager)} is an employee, so they will not see this person until they are a manager.` : undefined}
            >
              <select id="staff-reports-to" value={reportsTo} onChange={(e) => setReportsTo(e.target.value)} className={selectClass}>
                <option value="">Nobody</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{displayName(p)}</option>
                ))}
              </select>
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

// A filter chip with its count beside the label. The count is left out of the chip's name, so
// the chip reads the same to a screen reader whatever the list holds.
function CountChip({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: string }) {
  return (
    <Chip active={active} onClick={onClick}>
      {children}
      <span aria-hidden className="tnum ml-1.5 text-ink-3">{count}</span>
    </Chip>
  );
}

export default function PeoplePage() {
  const { company, profile, isAdmin } = useHub();
  const companyId = company!.id;
  // A lead who is not an admin: a manager, reading their team.
  const teamView = !isAdmin;
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<{ person: Profile; invitation: Invitation } | null>(null);
  const [removing, setRemoving] = useState<Profile | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The cancel and remove dialogs report only their own failure. Sharing `error` with the row
  // actions meant a dialog could open already showing a role change that failed a minute earlier,
  // reading as though the cancel or removal had gone wrong before it was confirmed.
  const [dialogError, setDialogError] = useState("");
  const [division, setDivision] = useState(ALL);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  // Someone switched off or on from this page stays in the list until the next visit, so the
  // Reactivate button is still there to undo a slip.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());

  const state = useAsync(async () => {
    const [people, invitations, divisions, directory] = await Promise.all([
      listCompanyProfiles(companyId),
      // Invitations are an admin's, in the database as well, so a manager never asks for them.
      teamView ? Promise.resolve([] as Invitation[]) : listInvitations(companyId),
      listDivisions(companyId),
      listDirectory(companyId),
    ]);
    return { people, invitations, divisions, directory: directoryById(directory) };
  }, [companyId, teamView]);

  // Sorted the way listCompanyProfiles sorts, names first and the nameless last, so somebody
  // added from the dialog appears where they will still be after the next load instead of at
  // the bottom and then jumping to the top, taking the Send invite button with them. A manager's
  // own row is not part of their team.
  const people = [...(state.data?.people ?? [])]
    .filter((p) => !teamView || p.id !== profile.id)
    .sort(
      (a, b) =>
        Number(a.full_name === null) - Number(b.full_name === null) ||
        (a.full_name ?? "").localeCompare(b.full_name ?? "") ||
        a.email.localeCompare(b.email),
    );
  const invitations = state.data?.invitations ?? [];
  const divisions = state.data?.divisions ?? [];
  const directory: ReadonlyMap<string, DirectoryEntry> = state.data?.directory ?? new Map();
  const pendingFor = (person: Profile): Invitation | null =>
    invitations.find((i) => !i.accepted_at && (i.profile_id === person.id || i.email === person.email)) ?? null;
  const waiting = people.filter((p) => p.is_active && !hasAccount(p));
  const byId = new Map(people.map((p) => [p.id, p]));
  const managerName = (person: Profile) => {
    if (!person.reports_to) return "Nobody";
    const visible = byId.get(person.reports_to) ?? (person.reports_to === profile.id ? profile : undefined);
    return visible ? displayName(visible) : nameFromDirectory(directory, person.reports_to, "Not on the roster");
  };

  // The chips: only the divisions the viewer may view, then Both and No division. Someone in their
  // list who works in a division they cannot view (a manager's chain can reach past their access)
  // still shows under All, and under the chip of any division of theirs the viewer can view. Every
  // chip only narrows what is loaded.
  const chipDivisions = viewerDivisions(profile, divisions);
  const hasDivisions = divisions.length > 0;
  const everyLabel = divisions.length === 2 ? "Both" : "In every division";
  // A division chosen and then lost (deleted, or the company changed) falls back to everyone.
  const activeDivision = division === ALL || division === EVERY || division === NONE || chipDivisions.some((d) => d.id === division) ? division : ALL;
  const inDivision = (person: Profile, key: string) => {
    if (key === ALL) return true;
    if (key === NONE) return person.division_ids.filter((id) => divisions.some((d) => d.id === id)).length === 0;
    if (key === EVERY) return inEveryDivision(person.division_ids, divisions);
    return person.division_ids.includes(key);
  };
  const needle = query.trim().toLowerCase();
  const matches = (person: Profile) =>
    needle === "" || [person.full_name, person.title, person.email].some((field) => (field ?? "").toLowerCase().includes(needle));
  const shownState = (person: Profile) => person.is_active || showInactive || touched.has(person.id);
  const inactiveCount = people.filter((p) => !p.is_active).length;
  // What the chips count: the people the inactive switch shows, before the search.
  const countable = people.filter(shownState);
  const countFor = (key: string) => countable.filter((p) => inDivision(p, key)).length;
  const shown = countable.filter((p) => inDivision(p, activeDivision) && matches(p));
  // Matches hidden only because they are inactive, so an empty result can say so.
  const hiddenInactive = people.filter((p) => !shownState(p) && inDivision(p, activeDivision) && matches(p)).length;

  const scopeName =
    activeDivision === ALL
      ? null
      : activeDivision === NONE
        ? "No division"
        : activeDivision === EVERY
          ? everyLabel
          : (chipDivisions.find((d) => d.id === activeDivision)?.name ?? null);

  function emptyLine(): string {
    if (people.length === 0) {
      return teamView ? "No one reports to you yet. An admin sets Reports to on each person." : "Nobody here yet. Add the first person.";
    }
    if (needle !== "") {
      return scopeName === null
        ? `No one matches "${query.trim()}".`
        : activeDivision === NONE
          ? `No one without a division matches "${query.trim()}".`
          : `No one in ${scopeName} matches "${query.trim()}".`;
    }
    if (activeDivision === NONE) return "Everyone here is placed in a division.";
    if (activeDivision === EVERY) return divisions.length === 2 ? "No one works in both divisions." : "No one works in every division.";
    if (activeDivision !== ALL) {
      return people.some((p) => p.division_ids.length > 0)
        ? `No one in ${scopeName} yet. Set each person's divisions on their page.`
        : "No one has been placed in a division yet. Set each person's divisions on their page.";
    }
    return "Everyone here is inactive.";
  }

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
      if (patch.is_active !== undefined) setTouched((prev) => new Set([...prev, person.id]));
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
    setDialogError("");
    try {
      await deleteInvitation(cancelling.invitation.id);
      const id = cancelling.invitation.id;
      state.setData((prev) => (prev ? { ...prev, invitations: prev.invitations.filter((i) => i.id !== id) } : prev));
      setCancelling(null);
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // deleteStaffProfile throws when nothing went (they signed in meanwhile, or the database refused),
  // so the dialog stays open on the reason instead of closing as if they were gone.
  async function handleRemoveStaff() {
    if (!removing) return;
    setBusy(true);
    setDialogError("");
    try {
      await deleteStaffProfile(removing.id);
      const id = removing.id;
      state.setData((prev) => (prev ? { ...prev, people: prev.people.filter((p) => p.id !== id) } : prev));
      setRemoving(null);
    } catch (err) {
      setDialogError(errorMessage(err, "They were not removed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const filters = state.data ? (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3">
      {hasDivisions ? (
        <div role="group" aria-label="Division" className="flex flex-wrap items-center gap-1.5">
          <CountChip active={activeDivision === ALL} count={countFor(ALL)} onClick={() => setDivision(ALL)}>All</CountChip>
          {chipDivisions.map((d) => (
            <CountChip key={d.id} active={activeDivision === d.id} count={countFor(d.id)} onClick={() => setDivision(d.id)}>
              {d.name}
            </CountChip>
          ))}
          {divisions.length >= 2 ? (
            <CountChip active={activeDivision === EVERY} count={countFor(EVERY)} onClick={() => setDivision(EVERY)}>
              {everyLabel}
            </CountChip>
          ) : null}
          <CountChip active={activeDivision === NONE} count={countFor(NONE)} onClick={() => setDivision(NONE)}>No division</CountChip>
        </div>
      ) : null}
      <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, title or email"
            aria-label="Search people"
            className={`${inputClass} mt-0 py-1.5 pl-8 text-[13px]`}
          />
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" className={checkboxClass} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
          <span className="tnum text-ink-3">({inactiveCount})</span>
        </label>
      </div>
    </div>
  ) : null;

  return (
    <>
      <PageHeader
        eyebrow={company!.name}
        title={teamView ? "Your team" : "People"}
        description={
          teamView
            ? "The people who report to you, and their teams. Open someone for their profile, goals and tasks."
            : "Everyone on the team. Set someone up in full before you invite them; the invitation is the last step, not the first."
        }
        actions={
          teamView ? (
            <Link to={`/people/${profile.id}`} className="text-sm font-medium text-accent hover:text-accent-hover">
              Your profile and team
            </Link>
          ) : (
            <Button size="sm" onClick={() => setAdding(true)}><UserPlus size={14} aria-hidden /> Add staff</Button>
          )
        }
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : !state.data ? null : (
        <Section
          eyebrow={teamView ? "Team" : "Roster"}
          title={shown.length === people.length ? pluralize(people.length, "person", "people") : `${shown.length} of ${pluralize(people.length, "person", "people")}`}
          description={waiting.length > 0 ? `${pluralize(waiting.length, "person", "people")} set up and not signed in yet. They can be reviewed and given goals like anyone else.` : undefined}
          padded={false}
        >
          {people.length > 0 ? filters : null}
          {shown.length === 0 ? (
            <div className="px-5 py-6 text-sm text-ink-2">
              <p>{emptyLine()}</p>
              {hiddenInactive > 0 ? (
                <p className="mt-1 text-[13px] text-ink-3">
                  {pluralize(hiddenInactive, "inactive person matches", "inactive people match")}. Turn on Show inactive to see them.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Person</th>
                    {hasDivisions ? <th className={thClass}>Division</th> : null}
                    <th className={thClass}>Reports to</th>
                    <th className={thClass}>Role</th>
                    <th className={thClass}>Status</th>
                    {teamView ? null : <th className={thClass}><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((person) => {
                    const self = person.id === profile.id;
                    const rococo = person.is_rococo_admin;
                    const canChange = !teamView && canGrantRole(profile, person.role);
                    const invitation = pendingFor(person);
                    const account = hasAccount(person);
                    const placed = divisionLabel(person.division_ids, divisions);
                    const manager = person.reports_to ? byId.get(person.reports_to) : undefined;
                    return (
                      <tr key={person.id} className={`hover:bg-surface-2/60 ${person.is_active ? "" : "opacity-60"}`}>
                        <td className={`${tdClass} py-2`}>
                          <Link to={`/people/${person.id}`} className="flex items-center gap-2.5">
                            <Avatar person={person} size={26} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-ink">{displayName(person)}{self ? " (you)" : ""}</span>
                              <span className="block truncate text-[12px] text-ink-3">{person.title ?? (teamView ? "No title" : person.email)}</span>
                            </span>
                          </Link>
                        </td>
                        {hasDivisions ? (
                          <td className={`${tdClass} py-2 text-[13px]`}>
                            {placed === "No division" && !rococo ? <Badge tone="warning">No division</Badge> : <span className="text-ink-2">{rococo ? "-" : placed}</span>}
                          </td>
                        ) : null}
                        <td className={`${tdClass} py-2 text-[13px] text-ink-2`}>
                          {manager ? (
                            <Link to={`/people/${manager.id}`} className="hover:text-accent">{displayName(manager)}</Link>
                          ) : (
                            managerName(person)
                          )}
                        </td>
                        <td className={`${tdClass} py-2`}>
                          {rococo ? (
                            <Badge>Rococo Creative</Badge>
                          ) : teamView ? (
                            <span className="text-[13px] text-ink-2">{ROLE_LABELS[person.role]}</span>
                          ) : (
                            <select
                              value={person.role}
                              disabled={self || !canChange}
                              aria-label={`Role for ${displayName(person)}`}
                              title={!canChange && !self ? "Only an owner or Rococo can change this person's role." : undefined}
                              onChange={(e) => void patchPerson(person, { role: e.target.value as Role })}
                              className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}
                            >
                              {(canChange ? grantableRoles(profile) : [person.role]).map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className={`${tdClass} py-2`}>
                          {!person.is_active ? (
                            <Badge tone="neutral">Inactive</Badge>
                          ) : account ? (
                            <Badge tone="success">Active</Badge>
                          ) : teamView ? (
                            <Badge tone="warning">Not signed in yet</Badge>
                          ) : invitation ? (
                            <Badge tone="info">Invited</Badge>
                          ) : (
                            <Badge tone="warning">Not invited</Badge>
                          )}
                        </td>
                        {teamView ? null : (
                          <td className={`${tdClass} py-2 text-right`}>
                            <span className="flex items-center justify-end gap-1.5">
                              {!self && !rococo && canChange ? (
                                <Button variant="ghost" size="sm" aria-label={`${person.is_active ? "Deactivate" : "Reactivate"} ${displayName(person)}`} onClick={() => void patchPerson(person, { is_active: !person.is_active })}>
                                  {person.is_active ? "Deactivate" : "Reactivate"}
                                </Button>
                              ) : null}
                              {!account && invitation ? (
                                <>
                                  {person.is_active ? (
                                    <Button variant="secondary" size="sm" aria-label={`Copy sign-in link for ${displayName(person)}`} onClick={() => void copyLink(invitation)}>
                                      {copied === invitation.id ? <><Check size={13} aria-hidden /> Copied</> : <><Copy size={13} aria-hidden /> Copy link</>}
                                    </Button>
                                  ) : null}
                                  <IconButton label={`Cancel the invitation for ${displayName(person)}`} onClick={() => setCancelling({ person, invitation })}>
                                    <Trash2 size={14} aria-hidden />
                                  </IconButton>
                                </>
                              ) : null}
                              {!account && !invitation && canChange ? (
                                <>
                                  {person.is_active ? (
                                    <Button size="sm" aria-label={`Send the invitation to ${displayName(person)}`} onClick={() => void sendInvite(person)}>
                                      <Send size={13} aria-hidden /> Send invite
                                    </Button>
                                  ) : null}
                                  <IconButton label={`Remove ${displayName(person)}`} onClick={() => setRemoving(person)}>
                                    <Trash2 size={14} aria-hidden />
                                  </IconButton>
                                </>
                              ) : null}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {teamView ? (
            <p className="border-t border-line px-5 py-3 text-[12px] text-ink-3">
              Admins add people, place them in divisions and set who they report to. Someone not signed in yet still has
              their goals and tasks waiting on their profile.
            </p>
          ) : (
            <p className="border-t border-line px-5 py-3 text-[12px] text-ink-3">
              Somebody on this list is part of the company whether or not they have signed in: put them in a review cycle,
              set their goals, KPIs and compensation, and it is all waiting on their profile when they arrive. Sending an
              invitation copies a sign-in link to your clipboard. Pass it on however you like; the hub does not send email.
              Anyone whose address is on one of this company's sign-in domains can also sign in without an invitation, and
              either way they take over the profile set up here rather than starting a second one.
            </p>
          )}
        </Section>
      )}

      {adding ? (
        <AddStaffDialog
          companyId={companyId}
          granter={profile}
          divisions={viewerDivisions(profile, divisions)}
          people={people.filter((p) => p.is_active && !p.is_rococo_admin)}
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
          body="They stay on the team here, and the invitation no longer lets them sign up. An address on one of this company's sign-in domains can still sign in without one, so deactivate them as well if they should not get in. Send a new invitation whenever you are ready."
          confirmLabel="Cancel invitation"
          busy={busy}
          error={dialogError}
          onConfirm={() => void handleCancelInvite()}
          onCancel={() => { setCancelling(null); setDialogError(""); }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={`Remove ${displayName(removing)} from the team?`}
          body="This deletes their profile and everything set up for them, including reviews, goals, KPIs and compensation. It does not stop an address on one of this company's sign-in domains from signing in. To keep their history, or to keep them out, deactivate them instead."
          confirmLabel="Remove"
          busy={busy}
          error={dialogError}
          onConfirm={() => void handleRemoveStaff()}
          onCancel={() => { setRemoving(null); setDialogError(""); }}
        />
      ) : null}
    </>
  );
}
