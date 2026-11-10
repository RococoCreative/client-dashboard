// Goals > By role: the goals each job role brings into every month's Goal Setting Review, the ones
// "Add role goals" files for a person in one click. One card per role, every title editable in
// place (saves on blur), with how many people are in the role today. Roles themselves (their names,
// dashboard modules and scorecard metrics) are set in Settings > Roles; role goals are rows of the
// role (rule 12), so nothing here knows a company by name.
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import EmptyState from "../ui/EmptyState.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import PanelHeader from "../ui/PanelHeader.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { inputClass } from "../ui/forms.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { createJobRoleGoal, deleteJobRoleGoal, listJobRoleGoals, listJobRoles, updateJobRoleGoal } from "../../services/jobRoles.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import type { JobRole, JobRoleGoal } from "../../types/database.ts";
import { roleGoalsAnchor } from "./roleGoalsAnchor.ts";

function AddGoalForm({ role, onAdd }: { role: JobRole; onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle("");
    onAdd(text);
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`Add a goal for ${role.name}`}
        aria-label={`Add a goal for ${role.name}`}
        className={`${inputClass} mt-0 min-w-0 flex-1 basis-56`}
      />
      <Button type="submit" variant="secondary" disabled={!title.trim()}>
        <Plus size={14} aria-hidden /> Add role goal
      </Button>
    </form>
  );
}

function RoleGoalsCard({
  role,
  goals,
  people,
  onGoals,
  onError,
}: {
  role: JobRole;
  goals: JobRoleGoal[];
  people: number;
  onGoals: (update: (goals: JobRoleGoal[]) => JobRoleGoal[]) => void;
  onError: (message: string) => void;
}) {
  async function add(title: string) {
    onError("");
    try {
      const created = await createJobRoleGoal({ job_role_id: role.id, title, sort_order: goals.length + 1 });
      onGoals((list) => [...list, created]);
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  async function rename(goal: JobRoleGoal, title: string) {
    onError("");
    try {
      const next = await updateJobRoleGoal(goal.id, { title: title.trim() });
      onGoals((list) => list.map((g) => (g.id === next.id ? next : g)));
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  async function remove(goal: JobRoleGoal) {
    onError("");
    try {
      await deleteJobRoleGoal(goal.id);
      onGoals((list) => list.filter((g) => g.id !== goal.id));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  return (
    <div id={roleGoalsAnchor(role.id)} className="scroll-mt-6">
      <Section
        className={role.is_active ? "" : "opacity-70"}
        eyebrow={people > 0 ? `${pluralize(people, "person")} in this role` : "Nobody in this role yet"}
        title={role.name}
        actions={role.is_active ? undefined : <Badge>Retired</Badge>}
      >
        {role.is_active ? null : <p className="mb-3 text-[12px] text-ink-3">Retired roles no longer offer their goals. Restore the role in Settings, Roles to bring them back.</p>}
        {goals.length === 0 ? (
          <p className="text-[13px] text-ink-2">No role goals yet. Add the goals everyone in {role.name} works on every month; each person files them into their month with one click.</p>
        ) : (
          <ul className="divide-y divide-line">
            {goals.map((goal) => (
              <li key={goal.id} className="flex items-center gap-2 py-1.5">
                <BlurInput value={goal.title} required ariaLabel={`Role goal ${goal.title}`} onSave={(next) => void rename(goal, next)} className={`${inputClass} mt-0 flex-1 text-[13px]`} />
                <IconButton label={`Remove role goal ${goal.title}`} onClick={() => void remove(goal)}>
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <AddGoalForm role={role} onAdd={(title) => void add(title)} />
        </div>
      </Section>
    </div>
  );
}

export default function RoleGoalsPanel({ companyId }: { companyId: string }) {
  const state = useAsync(async () => {
    const [roles, goals, people] = await Promise.all([listJobRoles(companyId, true), listJobRoleGoals(companyId), listCompanyProfiles(companyId)]);
    return { roles, goals, people };
  }, [companyId]);
  const [error, setError] = useState("");
  const { hash } = useLocation();
  const loaded = state.data !== null;

  // A link from Settings > Roles names one role's card; bring it into view once the cards are in.
  useEffect(() => {
    if (!loaded || !hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: "start" });
  }, [loaded, hash]);

  const header = (
    <PanelHeader
      eyebrow="Each job role, every month"
      title="Role goals"
      description="The goals a job role brings into every month's Goal Setting Review for the people in it. In the month, Add role goals files them for the person in one click. Roles are set up in Settings, Roles."
      actions={
        <Link to="/settings/roles">
          <Button variant="secondary" size="sm">Job roles</Button>
        </Link>
      }
    />
  );

  if (state.error && !state.data) {
    return (
      <>
        {header}
        <Notice tone="error">{state.error}</Notice>
      </>
    );
  }
  if (!state.data) {
    return (
      <>
        {header}
        <SkeletonRows rows={4} />
      </>
    );
  }

  const { roles, goals, people } = state.data;
  // Active roles first, the retired ones after, so the roles in use read first.
  const ordered = [...roles].sort((a, b) => Number(b.is_active) - Number(a.is_active));
  return (
    <>
      {header}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {roles.length === 0 ? (
        <EmptyState
          eyebrow="Role goals"
          title="No job roles yet"
          body="Role goals belong to a job role. An admin adds the company's job roles in Settings, Roles, then sets each role's goals here."
          action={
            <Link to="/settings/roles">
              <Button>Add job roles</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {ordered.map((role) => (
            <RoleGoalsCard
              key={role.id}
              role={role}
              goals={goals.filter((g) => g.job_role_id === role.id)}
              people={people.filter((p) => p.is_active && p.job_role_id === role.id).length}
              onGoals={(update) => state.setData((prev) => (prev ? { ...prev, goals: update(prev.goals) } : prev))}
              onError={setError}
            />
          ))}
        </div>
      )}
    </>
  );
}
