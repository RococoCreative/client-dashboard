// Everything about one job role, in the order an admin sets a role up: its name, what it owns and
// the dashboard modules its people get, who holds it (with a way to put someone in it), the goals
// it brings into every month, and its scorecard metrics, with Retire and Delete at the foot, away
// from the everyday controls. Setup fields read as text until their pencil. Roles are rows (rule
// 12), so nothing here knows a company by name.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import EditRow from "../ui/EditRow.tsx";
import Notice from "../ui/Notice.tsx";
import { checkboxClass, inputClass, selectClass } from "../ui/forms.ts";
import { bodyClass, eyebrowLabelClass, metaClass, secondaryClass, sectionTitleClass } from "../ui/type.ts";
import RoleGoalsSection from "./RoleGoalsSection.tsx";
import RoleMetricsSection from "./RoleMetricsSection.tsx";
import { deleteJobRole, updateJobRole } from "../../services/jobRoles.ts";
import { updateProfile } from "../../services/profiles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, pluralize } from "../../lib/format.ts";
import { divisionLabel } from "../../lib/people.ts";
import { DASHBOARD_MODULE_LABELS, keysOf, type CompanyDivision, type DashboardModule, type JobRole, type JobRoleGoal, type Profile, type RoleMetric } from "../../types/database.ts";

function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = `role-part-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="mt-8">
      <h3 id={id} className={eyebrowLabelClass}>{title}</h3>
      {children}
    </section>
  );
}

// The people whose job role this is, each linking to their profile, and the select that puts
// someone else in it, offered only while the role is active: a retired role lists its holders and
// takes no more (the person page offers a retired role only to people already in it). A person
// without an account yet is a person all the same (rule 5).
function Holders({ role, people, divisions, onPeople, onError }: { role: JobRole; people: Profile[]; divisions: CompanyDivision[]; onPeople: (update: (list: Profile[]) => Profile[]) => void; onError: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const byName = (a: Profile, b: Profile) => displayName(a).localeCompare(displayName(b));
  const holders = people.filter((p) => p.is_active && p.job_role_id === role.id).sort(byName);
  const others = people.filter((p) => p.is_active && p.job_role_id !== role.id).sort(byName);

  async function place(id: string) {
    if (!id) return;
    onError("");
    setSaving(true);
    try {
      const next = await updateProfile(id, { job_role_id: role.id });
      onPeople((list) => list.map((p) => (p.id === next.id ? next : p)));
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Part title="Who holds this role">
      {holders.length === 0 ? (
        <p className={`${secondaryClass} mt-2`}>Nobody in this role yet.</p>
      ) : (
        <ul className="mt-2 border-t border-line">
          {holders.map((person) => (
            <li key={person.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line py-2.5">
              <Link to={`/people/${person.id}`} className="text-[14px] text-link hover:underline">{displayName(person)}</Link>
              {divisions.length > 0 ? <span className={metaClass}>{divisionLabel(person.division_ids, divisions)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {role.is_active && others.length > 0 ? (
        <select aria-label="Put someone in this role" value="" disabled={saving} onChange={(e) => void place(e.target.value)} className={`${selectClass} mt-3 sm:max-w-sm`}>
          <option value="">Put someone in this role</option>
          {others.map((person) => (
            <option key={person.id} value={person.id}>{displayName(person)}</option>
          ))}
        </select>
      ) : null}
    </Part>
  );
}

// The writes in flight on one role, held by the page so they outlive this component: leaving a role
// and coming back remounts it, and a first write may still be out. queue orders the writes, pending
// is the module list as ticked while writes are out, inFlight counts them.
export interface RoleWrites {
  queue: Promise<unknown>;
  pending: DashboardModule[] | null;
  inFlight: number;
}

export default function RoleDetail({
  role,
  getWrites,
  goals,
  metrics,
  metricsError,
  people,
  divisions,
  onRole,
  onGoals,
  onMetrics,
  onPeople,
  onDeleted,
}: {
  role: JobRole;
  // This role's writes in flight, from the page. Called from handlers only, never while rendering.
  getWrites: () => RoleWrites;
  goals: JobRoleGoal[];
  metrics: RoleMetric[] | null;
  metricsError: string;
  people: Profile[];
  divisions: CompanyDivision[];
  onRole: (role: JobRole) => void;
  onGoals: (update: (goals: JobRoleGoal[]) => JobRoleGoal[]) => void;
  onMetrics: (update: (list: RoleMetric[]) => RoleMetric[]) => void;
  onPeople: (update: (list: Profile[]) => Profile[]) => void;
  onDeleted: (id: string) => void;
}) {
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<"name" | "description" | "modules" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  // The delete dialog reports only its own failure, never an inline save's, so its error is
  // cleared whenever it opens. A delete already sent cannot be called back, so the dialog waits
  // for the answer rather than closing on Cancel mid-flight. busy covers a metric's delete too, so
  // while either runs no other Delete opens a dialog.
  const [dialogError, setDialogError] = useState("");

  // Every write to the role returns the whole row, so writes to one role queue behind each other:
  // out of order, an older response would put an older module list or name back on screen. The
  // queue and the ticked module list live in the role's RoleWrites, held by the page per role, so they hold
  // across a switch to another role and back. Each tick builds on the ticked list rather than on
  // the stored one, so two quick ticks never lose the first.
  const [pendingModules, setPendingModules] = useState<DashboardModule[] | null>(null);

  // True when the change landed, false once the page shows why not.
  async function save(patch: Parameters<typeof updateJobRole>[1]): Promise<boolean> {
    const writes = getWrites();
    const write = writes.queue.catch(() => undefined).then(async () => onRole(await updateJobRole(role.id, patch)));
    writes.queue = write;
    try {
      await write;
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }
  async function toggleModule(module: DashboardModule, on: boolean) {
    const writes = getWrites();
    const base = writes.pending ?? role.dashboard_modules;
    const next = on ? [...new Set([...base, module])] : base.filter((m) => m !== module);
    writes.pending = next;
    setPendingModules(next);
    writes.inFlight += 1;
    await save({ dashboard_modules: next });
    writes.inFlight -= 1;
    // Once the last write settles the boxes read the role as stored again: the saved list, or the
    // one before it when the write failed and the error is on screen.
    if (writes.inFlight === 0) {
      writes.pending = null;
      setPendingModules(null);
    }
  }
  const shownModules = pendingModules ?? role.dashboard_modules;

  function openDelete() {
    if (busy) return;
    setDialogError("");
    setDeleting(true);
  }
  function closeDelete() {
    if (busy) return;
    setDeleting(false);
    setDialogError("");
  }
  async function remove() {
    setBusy(true);
    setDialogError("");
    try {
      await deleteJobRole(role.id);
      onDeleted(role.id);
    } catch (err) {
      setDialogError(errorMessage(err));
      setBusy(false);
    }
  }

  const edit = (field: typeof editing) => ({ editing: editing === field, onEdit: () => setEditing(field), onDone: () => setEditing(null) });

  return (
    <div>
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      <EditRow
        editLabel="Rename role"
        {...edit("name")}
        display={
          <>
            <p className={eyebrowLabelClass}>Job role</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className={`${sectionTitleClass} min-w-0 break-words`}>{role.name}</h2>
              {role.is_active ? null : <Badge>Retired</Badge>}
            </div>
          </>
        }
      >
        <label className={eyebrowLabelClass} htmlFor={`role-name-${role.id}`}>Role name</label>
        <BlurInput id={`role-name-${role.id}`} value={role.name} required ariaLabel={`Name for ${role.name}`} onSave={(next) => save({ name: next.trim() })} className={`${inputClass} font-medium`} />
      </EditRow>
      {role.is_active ? null : (
        <p className={`${metaClass} mt-3`}>Retired: it stays on the profiles of the people still in it, but no longer adds its dashboard modules or its role goals for them. Restore it to bring both back.</p>
      )}

      <Part title="About">
        <EditRow
          editLabel="Edit description"
          {...edit("description")}
          display={role.description ? <p className={`${bodyClass} break-words`}>{role.description}</p> : <p className={secondaryClass}>No description yet.</p>}
        >
          <BlurInput value={role.description ?? ""} placeholder="What this role owns, in a line" ariaLabel={`Description for ${role.name}`} onSave={(next) => save({ description: next.trim() || null })} className={`${inputClass} mt-0`} />
        </EditRow>
        <EditRow
          editLabel="Edit dashboard modules"
          {...edit("modules")}
          display={
            <>
              <p className={metaClass}>Dashboard modules</p>
              <p className={`${bodyClass} break-words`}>
                {shownModules.length === 0 ? "None" : keysOf(DASHBOARD_MODULE_LABELS).filter((m) => shownModules.includes(m)).map((m) => DASHBOARD_MODULE_LABELS[m]).join(", ")}
              </p>
            </>
          }
        >
          <p className={metaClass}>Dashboard modules</p>
          <ul className="mt-1.5 space-y-1.5">
            {keysOf(DASHBOARD_MODULE_LABELS).map((module) => (
              <li key={module}>
                <label className="flex items-start gap-2 text-[13px] text-ink">
                  <input type="checkbox" className={`${checkboxClass} mt-0.5`} checked={shownModules.includes(module)} aria-label={`${DASHBOARD_MODULE_LABELS[module]} for ${role.name}`} onChange={(e) => void toggleModule(module, e.target.checked)} />
                  <span>{DASHBOARD_MODULE_LABELS[module]}</span>
                </label>
              </li>
            ))}
          </ul>
        </EditRow>
      </Part>

      <Holders role={role} people={people} divisions={divisions} onPeople={onPeople} onError={setError} />
      <RoleGoalsSection role={role} goals={goals} onGoals={onGoals} onError={setError} />
      <RoleMetricsSection role={role} metrics={metrics} loadError={metricsError} busy={busy} onBusy={setBusy} onMetrics={onMetrics} onError={setError} />

      <div className="mt-8 border-t border-line pt-5">
        {role.is_active ? <p className={`${metaClass} mb-3`}>Retiring a role keeps it on record, but it stops adding its modules and goals for anyone still in it.</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void save({ is_active: !role.is_active })}>
            {role.is_active ? "Retire" : "Restore"}
          </Button>
          <Button variant="danger" onClick={openDelete}>
            Delete
          </Button>
        </div>
      </div>

      {deleting ? (
        <ConfirmDialog
          title={`Delete "${role.name}"?`}
          body={`People in this role lose it, and its ${pluralize(goals.length, "role goal")} go with it. Goals already filed into a review stay. Retire the role instead to keep it on record.`}
          confirmLabel="Delete role"
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={closeDelete}
        />
      ) : null}
    </div>
  );
}
