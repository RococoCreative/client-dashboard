// The Production section's front page: every live project the company tracks by hand, with how
// many of its milestones and letters are done and the next date it is aiming at. Members read
// it; admins add projects here and edit them on the project page. Below the list sit the
// Production cards whose definitions are still pending, each saying what it waits on.
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import ScaffoldCard from "../../components/scaffold/ScaffoldCard.tsx";
import Button from "../../components/ui/Button.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Field from "../../components/ui/Field.tsx";
import Modal from "../../components/ui/Modal.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { inputClass, tableClass, tdClass, textareaClass, thClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatDate, pluralize } from "../../lib/format.ts";
import { milestoneCounts, nextTargetDate } from "../../lib/milestones.ts";
import { createProject, listCompanyMilestones, listProjects } from "../../services/projects.ts";
import type { Project, ProjectMilestone } from "../../types/database.ts";

function NewProjectDialog({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: (project: Project) => void }) {
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Give the project a name.");
    setBusy(true);
    setError("");
    try {
      onCreated(await createProject({ company_id: companyId, name: name.trim(), reference: reference.trim() || null, notes: notes.trim() || null }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="new-project-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="new-project-title" className="font-display text-lg text-heading">New project</h2>
        <div className="mt-5 space-y-4">
          <Field label="Name" htmlFor="project-name">
            <input id="project-name" type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Reference" htmlFor="project-reference" hint="A project number or any short code your team uses.">
            <input id="project-reference" type="text" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Notes" htmlFor="project-notes">
            <textarea id="project-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${textareaClass} min-h-[64px]`} rows={2} />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Add project"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ProductionPage() {
  const { company, isAdmin } = useHub();
  const companyId = company!.id;
  const [creating, setCreating] = useState(false);
  const state = useAsync(async () => {
    const [projects, milestones] = await Promise.all([listProjects(companyId), listCompanyMilestones(companyId)]);
    return { projects, milestones };
  }, [companyId]);

  const byProject = useMemo(() => {
    const map = new Map<string, ProjectMilestone[]>();
    for (const m of state.data?.milestones ?? []) map.set(m.project_id, [...(map.get(m.project_id) ?? []), m]);
    return map;
  }, [state.data]);

  // PM capacity is its own element so it can be wrapped on its own, apart from the other cards.
  const pmCapacity = (
    <ScaffoldCard
      eyebrow="Production"
      title="PM capacity"
      pending={["The capacity sheet and the tab to read", "How each project manager is matched to a person on the roster", "How capacity is calculated"]}
    />
  );

  const newProject = isAdmin ? <Button size="sm" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> New project</Button> : null;

  return (
    <>
      <PageHeader eyebrow={company!.name} title="Production" description="Projects with their milestones and letters, entered by hand." actions={newProject} />
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : !state.data ? null : state.data.projects.length === 0 ? (
        <EmptyState
          eyebrow="Production"
          title="No projects yet"
          body={isAdmin ? "Add a project to start tracking its milestones and letters." : "Projects appear here once an admin adds them."}
        />
      ) : (
        <Section eyebrow="Projects" title={pluralize(state.data.projects.length, "project")} padded={false}>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>Project</th>
                  <th className={`${thClass} hidden sm:table-cell`}>Reference</th>
                  <th className={thClass}>Milestones</th>
                  <th className={`${thClass} whitespace-nowrap`}>Next target</th>
                </tr>
              </thead>
              <tbody>
                {state.data.projects.map((project) => {
                  const rows = byProject.get(project.id) ?? [];
                  const { done, total } = milestoneCounts(rows);
                  return (
                    <tr key={project.id} className="hover:bg-surface-2/60">
                      <td className={tdClass}>
                        <Link to={`/production/projects/${project.id}`} className="font-medium text-ink hover:text-accent">{project.name}</Link>
                      </td>
                      <td className={`${tdClass} hidden text-ink-2 sm:table-cell`}>{project.reference ?? "-"}</td>
                      <td className={`${tdClass} whitespace-nowrap text-ink-2`}>{`${done} of ${total} done`}</td>
                      <td className={`${tdClass} whitespace-nowrap text-ink-2`}>{formatDate(nextTargetDate(rows))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ScaffoldCard
          eyebrow="Production"
          title="Client score"
          pending={["How a client score is defined, and its scale", "Who enters it, and for which job or period", "Who may see and edit it"]}
        />
        <ScaffoldCard
          eyebrow="Production"
          title="Cleanliness"
          pending={["How cleanliness is scored, and its scale", "Who records it, and for which job or visit", "Who may see and edit it"]}
        />
        <ScaffoldCard eyebrow="Production" title="Job health" pending={["Which signals make a job healthy or at risk", "Where those signals come from"]} />
        <ScaffoldCard eyebrow="Production" title="Warranty" pending={["Where warranty items are tracked today", "What the hub should show about them"]} />
        {pmCapacity}
      </div>

      {creating ? (
        <NewProjectDialog
          companyId={companyId}
          onClose={() => setCreating(false)}
          onCreated={(project) => {
            state.setData((prev) => (prev ? { ...prev, projects: [...prev.projects, project].sort((a, b) => a.name.localeCompare(b.name)) } : prev));
            setCreating(false);
          }}
        />
      ) : null}
    </>
  );
}
