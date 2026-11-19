// A person's Setup tab, for an admin: their details (name, title, department, hire date, phone,
// who they report to, their job role), their hub role, the divisions they work in and what they may
// view, their compensation where the company gives the viewer pay, and the account actions that
// used to sit on the roster row: Deactivate or Reactivate, and Remove. Every setting reads as text
// first with a pencil to change it, so a page of them is calm to scan and nothing changes by
// accident. Writes go through the page's profile queue.
//
// The account actions keep the roster's rules. Deactivate is offered for anyone but yourself and a
// Rococo admin, account or not: an address on one of the company's sign-in domains gets in without
// an invitation, so switching the row off is what keeps a person out, and it keeps everything set
// up for them on record. Remove deletes the profile and all of it, so it is offered only for
// someone who has never signed in and has no pending invitation. Anything to do with someone ranked
// above the viewer is refused by the database (0033), so none of it is offered. A Rococo admin placed
// on the roster keeps their role, divisions and access with Rococo (0029): their details are the
// company's to edit, but the role and divisions read only and there are no account actions.
import { useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import Badge from "../../ui/Badge.tsx";
import BlurInput from "../../ui/BlurInput.tsx";
import Button from "../../ui/Button.tsx";
import ConfirmDialog from "../../ui/ConfirmDialog.tsx";
import EditRow from "../../ui/EditRow.tsx";
import Section from "../../ui/Section.tsx";
import Stat from "../../ui/Stat.tsx";
import { checkboxClass, helpClass, labelClass, selectClass } from "../../ui/forms.ts";
import { secondaryClass } from "../../ui/type.ts";
import CompensationTable from "../CompensationTable.tsx";
import { useHub } from "../../../context/HubContext.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { listDivisions } from "../../../services/divisions.ts";
import { listInvitations } from "../../../services/invitations.ts";
import { deleteStaffProfile, type ProfilePatch } from "../../../services/profiles.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { displayName, formatDate, formatMoney } from "../../../lib/format.ts";
import { canGrantRole, canSetDivisionAccess, canViewDivision, divisionLabel, formatTenure, grantableRoles, hasAccount, totalAnnual } from "../../../lib/people.ts";
import { ROLE_LABELS, type CompanyDivision, type Profile, type Role } from "../../../types/database.ts";
import { reportsTo, type PersonTabProps } from "../../../pages/people/personTabs.ts";

type Patch = (patch: ProfilePatch) => Promise<boolean>;

// A setting as it reads before anyone edits it: its label, then its value.
function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <p className={labelClass}>{label}</p>
      <div className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">{children}</div>
    </>
  );
}

// Ids in the company's division order, with anything not one of its divisions kept at the end, so a
// write never drops an id the viewer was not shown.
function inDivisionOrder(ids: readonly string[], divisions: readonly CompanyDivision[]): string[] {
  const known = divisions.map((d) => d.id).filter((id) => ids.includes(id));
  return [...known, ...ids.filter((id) => !known.includes(id))];
}

// Toggles one id in a list kept in the company's division order.
function toggled(ids: readonly string[], id: string, on: boolean, divisions: readonly CompanyDivision[]): string[] {
  return inDivisionOrder(on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id), divisions);
}

// A list being saved: what the boxes show while writes are in flight, so two quick ticks build on
// each other, and the stored value again once every write has settled.
function usePendingList(stored: readonly string[]) {
  const [pending, setPending] = useState<string[] | null>(null);
  const inflight = useRef(0);
  async function save(next: string[], write: () => Promise<boolean>) {
    setPending(next);
    inflight.current += 1;
    try {
      await write();
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setPending(null);
    }
  }
  return { value: pending ?? [...stored], save };
}

// What a manager or an admin may see beyond where they work, set by an owner or Rococo only: every
// division, chosen divisions, or none. Kept apart from membership on purpose, and from the
// dashboard split toggle below it, which only changes the figures they see.
function ViewAccessFields({ person, divisions, onPatch }: { person: Profile; divisions: CompanyDivision[]; onPatch: Patch }) {
  const [choosing, setChoosing] = useState(false);
  const [pendingAll, setPendingAll] = useState<boolean | null>(null);
  const ids = usePendingList(person.view_division_ids);
  const all = pendingAll ?? person.view_all_divisions;
  const mode = all ? "all" : ids.value.length > 0 || choosing ? "chosen" : "none";
  const first = displayName(person).split(" ")[0];
  const group = `view-access-${person.id}`;

  async function setAll(next: boolean, extra: ProfilePatch = {}) {
    setPendingAll(next);
    try {
      await onPatch({ view_all_divisions: next, ...extra });
    } finally {
      setPendingAll(null);
    }
  }

  function pick(next: "all" | "chosen" | "none") {
    if (next === mode) return;
    setChoosing(next === "chosen");
    if (next === "all") void setAll(true);
    else if (next === "chosen") {
      if (all) void setAll(false);
    }
    else void ids.save([], () => setAll(false, { view_division_ids: [] }).then(() => true));
  }

  return (
    <fieldset className="space-y-1.5">
      <legend className={labelClass}>Can view</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(
          [
            ["all", "All divisions"],
            ["chosen", "Chosen divisions"],
            ["none", "None"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline-flex items-center gap-1.5 text-[13px] text-ink">
            <input type="radio" name={group} value={value} checked={mode === value} onChange={() => pick(value)} />
            {label}
          </label>
        ))}
      </div>
      {mode === "chosen" ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {divisions.map((d) => (
            <label key={d.id} className="inline-flex items-center gap-1.5 text-[13px] text-ink">
              <input
                type="checkbox"
                className={checkboxClass}
                aria-label={`Can view ${d.name}`}
                checked={ids.value.includes(d.id)}
                onChange={(e) => {
                  const next = toggled(ids.value, d.id, e.target.checked, divisions);
                  void ids.save(next, () => onPatch({ view_division_ids: next }));
                }}
              />
              {d.name}
            </label>
          ))}
        </div>
      ) : null}
      <p className={helpClass}>
        Whose records {first} may open, apart from where they work. They always see the people who report to them and the people below those.{" "}
        {person.role === "admin" ? "As an admin they also see everyone not placed in a division." : "As a manager they see only employees in these divisions."}{" "}
        A role change made by anyone but an owner or Rococo clears this.
      </p>
    </fieldset>
  );
}

// The divisions a person works in, then, for an owner or Rococo, what an admin or a manager may see
// and whether they see the division split. An admin places people only in divisions they can view;
// any other division a person is in shows, ticked and locked.
function DivisionFields({ person, me, divisions, onPatch }: { person: Profile; me: Profile; divisions: CompanyDivision[]; onPatch: Patch }) {
  const membership = usePendingList(person.division_ids);
  const current = membership.value;
  const owner = person.role === "owner";
  const leadsPeople = person.role === "admin" || person.role === "manager";
  const setsAccess = canSetDivisionAccess(me);
  const locked = divisions.filter((d) => !canViewDivision(me, d.id));
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className={labelClass}>Divisions</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {divisions.map((d) => {
            const canPlace = canViewDivision(me, d.id);
            return (
              <label key={d.id} className={`inline-flex items-center gap-1.5 text-[13px] ${canPlace ? "text-ink" : "text-ink-3"}`}>
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={current.includes(d.id)}
                  disabled={!canPlace}
                  onChange={(e) => {
                    const next = toggled(current, d.id, e.target.checked, divisions);
                    void membership.save(next, () => onPatch({ division_ids: next }));
                  }}
                />
                {d.name}
              </label>
            );
          })}
        </div>
        <p className={helpClass}>
          Works in: {divisionLabel(current, divisions)}.{divisions.length === 2 ? " Tick both for Both." : ""}
          {locked.length > 0 ? ` ${locked.map((d) => d.name).join(", ")} is outside the divisions you can view, so it stays as it is.` : ""}
        </p>
      </fieldset>
      {leadsPeople && setsAccess ? (
        <ViewAccessFields person={person} divisions={divisions} onPatch={onPatch} />
      ) : leadsPeople ? (
        <p className={helpClass}>
          Can view {person.view_all_divisions ? "all divisions" : person.view_division_ids.length > 0 ? divisionLabel(person.view_division_ids, divisions) : "no divisions beyond their own team"}. Only an owner or Rococo can change that.
        </p>
      ) : null}
      {setsAccess ? (
        <div>
          <label className="flex items-start gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              className={`${checkboxClass} mt-0.5`}
              checked={owner || person.can_view_divisions}
              disabled={owner}
              onChange={(e) => void onPatch({ can_view_divisions: e.target.checked })}
            />
            <span>Can view divisions</span>
          </label>
          <p className={helpClass}>
            {owner
              ? "Owners always see the split."
              : "The division split on the dashboard and the Scorecards report: each division next to the combined company. It changes the figures they see, not whose records they can open."}
          </p>
        </div>
      ) : person.can_view_divisions ? (
        <p className={helpClass}>Sees the division split on the dashboard. Only an owner or Rococo can change that.</p>
      ) : null}
    </div>
  );
}

// The divisions row: what they work in and may view, read first. Shown only once the company has
// divisions, so a company that does not split reads as it always has.
function DivisionsRow({ companyId, person, me, editing, onEdit, onDone, onPatch }: { companyId: string; person: Profile; me: Profile; editing: boolean; onEdit: () => void; onDone: () => void; onPatch: Patch }) {
  const state = useAsync(() => listDivisions(companyId), [companyId]);
  if (state.error && !state.data) return <p className="py-3 text-[12px] text-ink-3">Divisions did not load. {state.error}</p>;
  // Nothing until the divisions are in, so the row never reads "No division" for a moment.
  if (!state.data) return null;
  const divisions = state.data;
  if (divisions.length === 0 && person.division_ids.length === 0) return null;
  if (person.is_rococo_admin) {
    return (
      <div className="border-b border-line py-3">
        <Value label="Divisions">{divisionLabel(person.division_ids, divisions)}</Value>
      </div>
    );
  }
  const leadsPeople = person.role === "admin" || person.role === "manager";
  const access = person.view_all_divisions ? "All divisions" : person.view_division_ids.length > 0 ? divisionLabel(person.view_division_ids, divisions) : "No divisions beyond their own team";
  return (
    <EditRow
      editLabel="Edit divisions and view access"
      editing={editing}
      onEdit={onEdit}
      onDone={onDone}
      display={
        <div className="space-y-3">
          <Value label="Divisions">{divisionLabel(person.division_ids, divisions)}</Value>
          {leadsPeople ? <Value label="Can view">{access}</Value> : null}
          {person.role === "owner" || person.can_view_divisions ? <p className={secondaryClass}>Sees the division split on the dashboard.</p> : null}
        </div>
      }
    >
      <DivisionFields person={person} me={me} divisions={divisions} onPatch={onPatch} />
    </EditRow>
  );
}

// Deactivate or Reactivate, and Remove, with the roster's rules and its confirm copy. Whether they
// have a pending invitation is read here, for an admin, only when Setup is open.
function AccountActions({ companyId, person, onPatch }: { companyId: string; person: Profile; onPatch: Patch }) {
  const { profile: me, can } = useHub();
  const navigate = useNavigate();
  const invitations = useAsync(() => listInvitations(companyId), [companyId]);
  const [switching, setSwitching] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const name = displayName(person);
  const first = name.split(" ")[0];
  const self = person.id === me.id;
  const canChange = canGrantRole(me, person.role);
  const account = hasAccount(person);
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
  if (!account && canChange && !self) {
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

export default function PersonSetup({ companyId, data, person, update, onError, patch }: PersonTabProps & { patch: Patch }) {
  const { profile: me, isAdmin, can } = useHub();
  const canSeePay = isAdmin && can("pay");
  const [editing, setEditing] = useState<string | null>(null);
  const row = (key: string) => ({ editing: editing === key, onEdit: () => setEditing(key), onDone: () => setEditing(null) });
  const { people, jobRoles, compensation } = data;
  const self = person.id === me.id;
  const canChangeRole = canGrantRole(me, person.role);
  const tenure = formatTenure(person.hire_date);
  const manager = reportsTo(data, person);
  const managerChoices = people.filter((p) => p.id !== person.id && p.is_active);
  const keepCurrentManager = person.reports_to !== null && !managerChoices.some((p) => p.id === person.reports_to);
  // A chain gives an employee nothing: they see this person once they are a manager.
  const managerIsEmployee = manager.manager?.role === "employee";
  const managerWarning = managerIsEmployee ? <p className="mt-1 text-[12px] text-warning">They will not see this person until they are a manager.</p> : null;
  const jobRole = jobRoles.find((r) => r.id === person.job_role_id) ?? null;
  const roleRetired = jobRole !== null && !jobRole.is_active;
  const jobRoleNotes = (
    <>
      {jobRoles.length === 0 ? (
        <p className="mt-1 text-[12px] text-ink-3">
          No job roles yet. Admins add them in <Link to="/people/roles" className="text-link hover:underline">People, Roles</Link>.
        </p>
      ) : null}
      {roleRetired && jobRole ? (
        <p className="mt-1 text-[12px] text-warning">
          {jobRole.name} is retired, so it no longer puts its modules on their dashboard or offers its role goals. Pick a current role.
        </p>
      ) : null}
    </>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Section eyebrow="Profile" title="Details">
        <div className="-my-3">
          <EditRow editLabel="Edit name" {...row("name")} display={<Value label="Name">{person.full_name || "Not set"}</Value>}>
            <label htmlFor="person-name" className={labelClass}>Name</label>
            <BlurInput id="person-name" value={person.full_name ?? ""} placeholder="Full name" onSave={(next) => patch({ full_name: next.trim() || null })} />
          </EditRow>
          <EditRow editLabel="Edit title" {...row("title")} display={<Value label="Title">{person.title || "Not set"}</Value>}>
            <label htmlFor="person-title" className={labelClass}>Title</label>
            <BlurInput id="person-title" value={person.title ?? ""} placeholder="Their position" onSave={(next) => patch({ title: next.trim() || null })} />
          </EditRow>
          <EditRow editLabel="Edit department" {...row("department")} display={<Value label="Department">{person.department || "Not set"}</Value>}>
            <label htmlFor="person-department" className={labelClass}>Department</label>
            <BlurInput id="person-department" value={person.department ?? ""} placeholder="Their department" onSave={(next) => patch({ department: next.trim() || null })} />
          </EditRow>
          <EditRow
            editLabel="Edit hire date"
            {...row("hire")}
            display={<Value label="Hire date">{person.hire_date ? `${formatDate(person.hire_date)}${tenure ? ` · ${tenure}` : ""}` : "Not set"}</Value>}
          >
            <label htmlFor="person-hire-date" className={labelClass}>Hire date</label>
            <BlurInput id="person-hire-date" type="date" value={person.hire_date ?? ""} onSave={(next) => patch({ hire_date: next || null })} />
            {tenure ? <p className="mt-1 text-[12px] text-ink-3">{tenure}</p> : null}
          </EditRow>
          <EditRow editLabel="Edit phone" {...row("phone")} display={<Value label="Phone">{person.phone || "Not set"}</Value>}>
            <label htmlFor="person-phone" className={labelClass}>Phone</label>
            <BlurInput id="person-phone" value={person.phone ?? ""} placeholder="(555) 010-0000" onSave={(next) => patch({ phone: next.trim() || null })} />
          </EditRow>
          <EditRow
            editLabel="Edit reports to"
            {...row("reports")}
            display={
              <Value label="Reports to">
                {manager.name ? `${manager.name}${manager.inactive ? " (inactive)" : ""}` : "Nobody"}
                {managerWarning}
              </Value>
            }
          >
            <label htmlFor="person-reports-to" className={labelClass}>Reports to</label>
            <select id="person-reports-to" value={person.reports_to ?? ""} onChange={(e) => void patch({ reports_to: e.target.value || null })} className={selectClass}>
              <option value="">Nobody</option>
              {keepCurrentManager && person.reports_to ? (
                <option value={person.reports_to}>{manager.name}{manager.inactive ? " (inactive)" : ""}</option>
              ) : null}
              {managerChoices.map((p) => (
                <option key={p.id} value={p.id}>{displayName(p)}</option>
              ))}
            </select>
            {managerWarning}
          </EditRow>
          <EditRow
            editLabel="Edit job role"
            {...row("job")}
            display={
              <Value label="Job role">
                {jobRole ? `${jobRole.name}${jobRole.is_active ? "" : " (retired)"}` : "Not set"}
                {jobRoleNotes}
              </Value>
            }
          >
            <label htmlFor="person-job-role" className={labelClass}>Job role</label>
            <select id="person-job-role" value={person.job_role_id ?? ""} onChange={(e) => void patch({ job_role_id: e.target.value || null })} className={selectClass}>
              <option value="">Not set</option>
              {jobRoles.filter((r) => r.is_active || r.id === person.job_role_id).map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.is_active ? "" : " (retired)"}</option>
              ))}
            </select>
            {jobRoleNotes}
          </EditRow>
        </div>
      </Section>

      <div className="min-w-0 space-y-6">
        <Section eyebrow="Hub access" title="Role and divisions">
          <div className="-my-3">
            {person.is_rococo_admin ? (
              <div className="border-b border-line py-3">
                <Value label="Role">
                  <Badge>Rococo Creative</Badge>
                </Value>
              </div>
            ) : (
              <EditRow editLabel="Edit role" {...row("role")} display={<Value label="Role">{ROLE_LABELS[person.role]}</Value>}>
                <label htmlFor="person-role" className={labelClass}>Role</label>
                <select id="person-role" value={person.role} disabled={self || !canChangeRole} onChange={(e) => void patch({ role: e.target.value as Role })} className={selectClass}>
                  {(canChangeRole ? grantableRoles(me) : [person.role]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                {!canChangeRole && !self ? <p className="mt-1 text-[12px] text-ink-3">Only an owner or Rococo can change this person's role.</p> : null}
              </EditRow>
            )}
            <DivisionsRow companyId={companyId} person={person} me={me} {...row("divisions")} onPatch={patch} />
          </div>
        </Section>
        {person.is_rococo_admin ? null : <AccountActions companyId={companyId} person={person} onPatch={patch} />}
      </div>

      {canSeePay ? (
        <div className="space-y-4 lg:col-span-2">
          <Stat label="Annual compensation" value={formatMoney(totalAnnual(compensation))} hint={compensation.length > 0 ? `${formatMoney(totalAnnual(compensation) / 12)} a month` : "Not recorded"} />
          <Section eyebrow="Compensation" title="Compensation" description="Annual amounts; the monthly figure is derived. Only people the company gives pay access see this." padded={false}>
            <CompensationTable companyId={companyId} employeeId={person.id} items={compensation} canEdit onChange={(change) => update((prev) => ({ ...prev, compensation: change(prev.compensation) }))} onError={onError} />
          </Section>
        </div>
      ) : null}
    </div>
  );
}
