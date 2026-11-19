// One job role's goals on People, Roles: the goals the role brings into every month's Goal Setting
// Review for the people in it, the ones "Add role goals" files for a person in one click. Each goal
// reads as text until its pencil opens it; one Add role goal button opens the one add form. Role
// goals are rows of the role (rule 12), so nothing here knows a company by name.
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import EditRow from "../ui/EditRow.tsx";
import { inputClass } from "../ui/forms.ts";
import { bodyClass, eyebrowLabelClass, metaClass, secondaryClass } from "../ui/type.ts";
import { createJobRoleGoal, deleteJobRoleGoal, updateJobRoleGoal } from "../../services/jobRoles.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { JobRole, JobRoleGoal } from "../../types/database.ts";

// The one add form, opened by Add role goal.
function AddGoalForm({ role, onAdd, onCancel }: { role: JobRole; onAdd: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle("");
    onAdd(text);
  }
  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
      <input
        type="text"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`Add a goal for ${role.name}`}
        aria-label={`Add a goal for ${role.name}`}
        className={`${inputClass} mt-0 min-w-0 flex-1 basis-56`}
      />
      <Button type="submit" variant="secondary" disabled={!title.trim()}>
        Add role goal
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

export default function RoleGoalsSection({
  role,
  goals,
  onGoals,
  onError,
}: {
  role: JobRole;
  goals: JobRoleGoal[];
  onGoals: (update: (goals: JobRoleGoal[]) => JobRoleGoal[]) => void;
  onError: (message: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function add(title: string) {
    onError("");
    try {
      const created = await createJobRoleGoal({ job_role_id: role.id, title, sort_order: goals.length + 1 });
      onGoals((list) => [...list, created]);
      setAdding(false);
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  // True when the new title landed, false once the page shows why not.
  async function rename(goal: JobRoleGoal, title: string): Promise<boolean> {
    onError("");
    try {
      const next = await updateJobRoleGoal(goal.id, { title: title.trim() });
      onGoals((list) => list.map((g) => (g.id === next.id ? next : g)));
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    }
  }
  async function remove(goal: JobRoleGoal) {
    onError("");
    try {
      await deleteJobRoleGoal(goal.id);
      onGoals((list) => list.filter((g) => g.id !== goal.id));
      setEditingId(null);
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  return (
    <section aria-labelledby="role-goals-title" className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="role-goals-title" className={eyebrowLabelClass}>Role goals</h3>
        {adding ? null : (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden /> Add role goal
          </Button>
        )}
      </div>
      <p className={`${metaClass} mt-1`}>Offered in every month's Goal Setting Review for the people in this role. In the month, Add role goals files them for the person in one click.</p>
      {adding ? <AddGoalForm role={role} onAdd={(title) => void add(title)} onCancel={() => setAdding(false)} /> : null}
      {goals.length === 0 ? (
        <p className={`${secondaryClass} mt-3`}>No role goals yet. Add the goals everyone in {role.name} works on every month; each person files them into their month with one click.</p>
      ) : (
        <ul className="mt-2 border-t border-line">
          {goals.map((goal) => (
            <li key={goal.id}>
              <EditRow
                editLabel={`Edit role goal ${goal.title}`}
                editing={editingId === goal.id}
                onEdit={() => setEditingId(goal.id)}
                onDone={() => setEditingId(null)}
                display={<p className={`${bodyClass} break-words`}>{goal.title}</p>}
                footer={
                  <Button variant="danger" size="sm" aria-label={`Remove role goal ${goal.title}`} onClick={() => void remove(goal)}>
                    Remove
                  </Button>
                }
              >
                <BlurInput value={goal.title} required ariaLabel={`Role goal ${goal.title}`} onSave={(next) => rename(goal, next)} className={`${inputClass} mt-0 text-[13px]`} />
              </EditRow>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
