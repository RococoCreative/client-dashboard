// The projects a person works on, on their person page: each with the role they hold on it.
// Admins assign an existing project, create one by name and assign it in one step, set the
// person's role on it, and unassign. Assignments are rows (0035) and need no production module;
// a per-project scorecard metric gives each assigned project its own row. The caller loads and
// keeps the rows, because the scorecard reads the same ones.
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import IconButton from "../ui/IconButton.tsx";
import Section from "../ui/Section.tsx";
import { inputClass, labelClass, selectClass } from "../ui/forms.ts";
import { assignProject, createProjectAndAssign, unassignProject, updateProjectAssignment } from "../../services/projectAssignments.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { Project, ProjectAssignment } from "../../types/database.ts";

// The pulldown value that means "a project not on the list yet".
const NEW_PROJECT = "new";

// The quiet line under a project's name: its reference, whether it is archived, and (where the
// role is not an editable field) the person's role on it.
function detail(project: Project | undefined, role: string | null): string {
  return [project?.reference ?? null, project?.archived_at ? "Archived" : null, role].filter(Boolean).join(" · ");
}

export default function PersonProjects({
  companyId,
  employeeId,
  firstName,
  assignments,
  projects,
  canEdit,
  linkProjects,
  onAssignments,
  onProjects,
  onError,
}: {
  companyId: string;
  employeeId: string;
  firstName: string;
  assignments: readonly ProjectAssignment[];
  // The company's projects, archived ones included, so an old assignment still has its name.
  projects: readonly Project[];
  canEdit: boolean;
  // Whether project pages exist for this company (the production module), to link to them.
  linkProjects: boolean;
  onAssignments: (update: (list: ProjectAssignment[]) => ProjectAssignment[]) => void;
  onProjects: (update: (list: Project[]) => Project[]) => void;
  onError: (message: string) => void;
}) {
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);

  const byId = new Map(projects.map((p) => [p.id, p]));
  const assignedIds = new Set(assignments.map((a) => a.project_id));
  const open = projects.filter((p) => p.archived_at === null && !assignedIds.has(p.id));
  const ready = choice === NEW_PROJECT ? newName.trim() !== "" : choice !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    onError("");
    try {
      if (choice === NEW_PROJECT) {
        const { project, assignment } = await createProjectAndAssign({ company_id: companyId, name: newName.trim(), employee_id: employeeId, role: role.trim() || null });
        onProjects((list) => [...list, project]);
        onAssignments((list) => [...list, assignment]);
      } else {
        const assignment = await assignProject({ company_id: companyId, project_id: choice, employee_id: employeeId, role: role.trim() || null });
        onAssignments((list) => [...list, assignment]);
      }
      setChoice("");
      setNewName("");
      setRole("");
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveRole(assignment: ProjectAssignment, next: string) {
    onError("");
    try {
      const saved = await updateProjectAssignment(assignment.id, { role: next.trim() || null });
      onAssignments((list) => list.map((a) => (a.id === saved.id ? saved : a)));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function unassign(assignment: ProjectAssignment) {
    onError("");
    try {
      await unassignProject(assignment.id);
      onAssignments((list) => list.filter((a) => a.id !== assignment.id));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  return (
    <Section
      eyebrow="Projects"
      title={assignments.length > 0 ? `On ${assignments.length} ${assignments.length === 1 ? "project" : "projects"}` : "Projects"}
      description={canEdit ? "The jobs this person works on and their part in each. A metric scored per project gets a row for every one." : undefined}
      padded={false}
    >
      {assignments.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-2">{firstName} is not on any project yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {assignments.map((a) => {
            const project = byId.get(a.project_id);
            const name = project?.name ?? "A project no longer listed";
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5">
                <div className="min-w-0 flex-1 basis-48">
                  {linkProjects && project ? (
                    <Link to={`/production/projects/${project.id}`} className="block truncate text-sm text-ink hover:text-accent">
                      {name}
                    </Link>
                  ) : (
                    <p className="truncate text-sm text-ink">{name}</p>
                  )}
                  {detail(project, canEdit ? null : a.role) ? <p className="text-[12px] text-ink-3">{detail(project, canEdit ? null : a.role)}</p> : null}
                </div>
                {canEdit ? (
                  <>
                    <BlurInput
                      value={a.role ?? ""}
                      placeholder="Their role on it"
                      ariaLabel={`Role on ${name}`}
                      onSave={(next) => void saveRole(a, next)}
                      className={`${inputClass} mt-0 w-full py-1.5 text-[13px] sm:w-48`}
                    />
                    <IconButton label={`Unassign ${name}`} onClick={() => void unassign(a)}>
                      <X size={14} aria-hidden />
                    </IconButton>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit ? (
        <form onSubmit={(e) => void submit(e)} className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="assign-project" className={labelClass}>Project</label>
            <select id="assign-project" value={choice} onChange={(e) => setChoice(e.target.value)} className={selectClass}>
              <option value="">Choose a project</option>
              {open.map((p) => (
                <option key={p.id} value={p.id}>{p.reference ? `${p.name} (${p.reference})` : p.name}</option>
              ))}
              <option value={NEW_PROJECT}>A new project...</option>
            </select>
            {choice === NEW_PROJECT ? (
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New project name" aria-label="New project name" className={inputClass} />
            ) : null}
          </div>
          <div>
            <label htmlFor="assign-role" className={labelClass}>Their role</label>
            <input id="assign-role" type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Project manager" className={inputClass} />
          </div>
          <Button type="submit" variant="secondary" disabled={!ready || busy}>
            <Plus size={14} aria-hidden /> {choice === NEW_PROJECT ? "Create and assign" : "Assign"}
          </Button>
        </form>
      ) : null}
    </Section>
  );
}
