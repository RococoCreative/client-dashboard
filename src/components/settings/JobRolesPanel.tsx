// The company's job roles, for an admin in Company Settings: the jobs people do here, the
// dashboard modules each role gets, and the goals a role brings into every month's Goal
// Setting Review. Roles are rows (rule 12): a company shapes its own set and nothing here knows
// a company by name. Every change saves on its own.
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { SkeletonRows } from "../ui/Skeleton.tsx";
import { checkboxClass, inputClass } from "../ui/forms.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { createJobRole, createJobRoleGoal, deleteJobRole, deleteJobRoleGoal, listJobRoleGoals, listJobRoles, updateJobRole, updateJobRoleGoal } from "../../services/jobRoles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import { DASHBOARD_MODULE_LABELS, keysOf, type DashboardModule, type JobRole, type JobRoleGoal } from "../../types/database.ts";

const eyebrowClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";

function AddForm({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle("");
    onAdd(text);
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${inputClass} mt-0 flex-1`} />
      <Button type="submit" variant="secondary" disabled={!title.trim()}>
        <Plus size={14} aria-hidden /> {label}
      </Button>
    </form>
  );
}

// One role: its name and description, the modules its people see, and its goal templates.
function RoleCard({
  role,
  goals,
  onRole,
  onGoals,
  onDelete,
  onError,
}: {
  role: JobRole;
  goals: JobRoleGoal[];
  onRole: (role: JobRole) => void;
  onGoals: (update: (goals: JobRoleGoal[]) => JobRoleGoal[]) => void;
  onDelete: () => void;
  onError: (message: string) => void;
}) {
  async function save(patch: Parameters<typeof updateJobRole>[1]) {
    try {
      onRole(await updateJobRole(role.id, patch));
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  function toggleModule(module: DashboardModule, on: boolean) {
    const next = on ? [...new Set([...role.dashboard_modules, module])] : role.dashboard_modules.filter((m) => m !== module);
    void save({ dashboard_modules: next });
  }
  async function addGoal(title: string) {
    try {
      const created = await createJobRoleGoal({ job_role_id: role.id, title, sort_order: goals.length + 1 });
      onGoals((list) => [...list, created]);
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  async function renameGoal(goal: JobRoleGoal, title: string) {
    try {
      const next = await updateJobRoleGoal(goal.id, { title: title.trim() || goal.title });
      onGoals((list) => list.map((g) => (g.id === next.id ? next : g)));
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  async function removeGoal(goal: JobRoleGoal) {
    try {
      await deleteJobRoleGoal(goal.id);
      onGoals((list) => list.filter((g) => g.id !== goal.id));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  return (
    <li className={`rounded-lg border border-line bg-surface p-4 ${role.is_active ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <BlurInput value={role.name} ariaLabel={`Name for ${role.name}`} onSave={(next) => void save({ name: next.trim() || role.name })} className={`${inputClass} mt-0 font-medium`} />
          <BlurInput value={role.description ?? ""} placeholder="What this role owns, in a line" ariaLabel={`Description for ${role.name}`} onSave={(next) => void save({ description: next.trim() || null })} className={`${inputClass} mt-2 text-[13px]`} />
        </div>
        <div className="flex items-center gap-2">
          {role.is_active ? null : <Badge>Retired</Badge>}
          <Button variant="ghost" size="sm" onClick={() => void save({ is_active: !role.is_active })}>
            {role.is_active ? "Retire" : "Restore"}
          </Button>
          <IconButton label={`Delete ${role.name}`} onClick={onDelete}>
            <Trash2 size={14} aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="mt-4">
        <p className={eyebrowClass}>Dashboard modules</p>
        <ul className="mt-1.5 space-y-1.5">
          {keysOf(DASHBOARD_MODULE_LABELS).map((module) => (
            <li key={module}>
              <label className="flex items-start gap-2 text-[13px] text-ink">
                <input type="checkbox" className={`${checkboxClass} mt-0.5`} checked={role.dashboard_modules.includes(module)} aria-label={`${DASHBOARD_MODULE_LABELS[module]} for ${role.name}`} onChange={(e) => toggleModule(module, e.target.checked)} />
                <span>{DASHBOARD_MODULE_LABELS[module]}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <p className={eyebrowClass}>Role goals</p>
        <p className="mt-0.5 text-[12px] text-ink-3">Offered in every month's Goal Setting Review for the people in this role, one click to file.</p>
        {goals.length > 0 ? (
          <ul className="mt-2 divide-y divide-line">
            {goals.map((goal) => (
              <li key={goal.id} className="flex items-center gap-2 py-1.5">
                <BlurInput value={goal.title} ariaLabel={`Role goal ${goal.title}`} onSave={(next) => void renameGoal(goal, next)} className={`${inputClass} mt-0 flex-1 text-[13px]`} />
                <IconButton label={`Remove role goal ${goal.title}`} onClick={() => void removeGoal(goal)}>
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2">
          <AddForm placeholder={`Add a goal for ${role.name}`} label="Add" onAdd={(title) => void addGoal(title)} />
        </div>
      </div>
    </li>
  );
}

export default function JobRolesPanel({ companyId }: { companyId: string }) {
  const state = useAsync(async () => {
    const [roles, goals] = await Promise.all([listJobRoles(companyId, true), listJobRoleGoals(companyId)]);
    return { roles, goals };
  }, [companyId]);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<JobRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  async function add(name: string) {
    setError("");
    try {
      const created = await createJobRole({ company_id: companyId, name, sort_order: (state.data?.roles.length ?? 0) + 1 });
      state.setData((prev) => (prev ? { ...prev, roles: [...prev.roles, created] } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setDialogError("");
    try {
      const id = deleting.id;
      await deleteJobRole(id);
      state.setData((prev) => (prev ? { roles: prev.roles.filter((r) => r.id !== id), goals: prev.goals.filter((g) => g.job_role_id !== id) } : prev));
      setDeleting(null);
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const roles = state.data?.roles ?? [];
  const goals = state.data?.goals ?? [];

  return (
    <Section
      eyebrow="People"
      title="Job roles"
      description="The jobs people do here. A person's role decides which modules their dashboard carries and which goals their monthly Goal Setting Review offers. Set it on their profile."
    >
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={3} /> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.data ? (
        <>
          <AddForm placeholder="Add a job role" label="Add role" onAdd={(name) => void add(name)} />
          {roles.length === 0 ? (
            <p className="mt-4 text-sm text-ink-2">No job roles yet. Add one, then place people in it from their profiles.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {roles.map((role) => (
                <RoleCard
                  key={role.id}
                  role={role}
                  goals={goals.filter((g) => g.job_role_id === role.id)}
                  onRole={(next) => state.setData((prev) => (prev ? { ...prev, roles: prev.roles.map((r) => (r.id === next.id ? next : r)) } : prev))}
                  onGoals={(update) => state.setData((prev) => (prev ? { ...prev, goals: update(prev.goals) } : prev))}
                  onDelete={() => setDeleting(role)}
                  onError={setError}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          body={`People in this role lose it, and its ${pluralize(goals.filter((g) => g.job_role_id === deleting.id).length, "role goal")} go with it. Goals already filed into a review stay. Retire the role instead to keep it on record.`}
          confirmLabel="Delete role"
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={() => { setDeleting(null); setDialogError(""); }}
        />
      ) : null}
    </Section>
  );
}
