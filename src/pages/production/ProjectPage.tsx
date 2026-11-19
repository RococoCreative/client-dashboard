// One project: its details and its milestones and letters, in order. Members read everything
// here; admins edit the details, add, edit, reorder and archive items, and archive the project.
// Loaded by the id in the URL, so it must belong to the active company (lib/tenancy.ts). Milestone
// owners are named from the company directory, so an employee reads every owner's name.
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/ui/Button.tsx";
import BlurInput from "../../components/ui/BlurInput.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { helpClass, inputClass, labelClass, selectClass } from "../../components/ui/forms.ts";
import MilestoneList from "../../components/production/MilestoneList.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import { isComplete, nextSortOrder } from "../../lib/milestones.ts";
import { assertInCompany } from "../../lib/tenancy.ts";
import { directoryById } from "../../lib/people.ts";
import { listDirectory } from "../../services/directory.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { archiveProject, createMilestone, getProject, listMilestones, updateProject, type ProjectPatch } from "../../services/projects.ts";
import { MILESTONE_KIND_LABELS, keysOf, type MilestoneKind, type ProjectMilestone } from "../../types/database.ts";

// By kind, or by whether an item is done: Open is Not started and In progress, Done is Complete.
type Filter = "all" | MilestoneKind | "open" | "done";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "milestone", label: "Milestones" },
  { key: "letter", label: "Letters" },
  { key: "open", label: "Open" },
  { key: "done", label: "Done" },
];

function matchesFilter(m: ProjectMilestone, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return !isComplete(m);
  if (filter === "done") return isComplete(m);
  return m.kind === filter;
}

function AddMilestoneForm({ projectId, all, onAdded }: { projectId: string; all: ProjectMilestone[]; onAdded: (m: ProjectMilestone) => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<MilestoneKind>("milestone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Give it a title.");
    setBusy(true);
    setError("");
    try {
      onAdded(await createMilestone({ project_id: projectId, title: title.trim(), kind, sort_order: nextSortOrder(all) }));
      setTitle("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-line px-5 py-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
        <input type="text" aria-label="New milestone title" placeholder="Add a milestone or letter" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        <select aria-label="New milestone kind" value={kind} onChange={(e) => setKind(e.target.value as MilestoneKind)} className={selectClass}>
          {keysOf(MILESTONE_KIND_LABELS).map((k) => (
            <option key={k} value={k}>{MILESTONE_KIND_LABELS[k]}</option>
          ))}
        </select>
        <div className="mt-1.5">
          <Button type="submit" variant="secondary" disabled={busy}>Add milestone</Button>
        </div>
      </div>
      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
    </form>
  );
}

export default function ProjectPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const { company, isAdmin, can } = useHub();
  // Milestones follow the milestones_edit capability; renaming and archiving the project stay with admins.
  const canMilestones = can("milestones_edit");
  const navigate = useNavigate();
  const companyId = company!.id;
  const [filter, setFilter] = useState<Filter>("all");
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const state = useAsync(async () => {
    const [project, milestones, people, directory] = await Promise.all([getProject(projectId), listMilestones(projectId), listCompanyProfiles(companyId), listDirectory(companyId)]);
    // Edits and archiving are live here, and a Rococo admin's switcher changes company without
    // navigating, so the project must be this company's.
    assertInCompany(project, companyId, "project");
    return { project, milestones, people, directory: directoryById(directory) };
  }, [projectId, companyId]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;

  const { project, milestones, people, directory } = state.data;
  const shown = milestones.filter((m) => matchesFilter(m, filter));

  // Returns whether it saved, so a details field keeps its draft and says "Not saved" when not.
  async function save(patch: ProjectPatch): Promise<boolean> {
    setError("");
    try {
      const next = await updateProject(project.id, patch);
      state.setData((prev) => (prev ? { ...prev, project: next } : prev));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  async function handleArchive() {
    setBusy(true);
    setError("");
    try {
      await archiveProject(project.id);
      navigate("/production");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const setMilestones = (next: ProjectMilestone[]) => state.setData((prev) => (prev ? { ...prev, milestones: next } : prev));

  return (
    <>
      <PageHeader
        backTo="/production"
        backLabel="Production"
        eyebrow="Project"
        title={project.name}
        description={project.reference ? `Reference ${project.reference}` : undefined}
      />
      {error && !archiving ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section
          className="lg:col-span-2"
          eyebrow="Milestones and letters"
          title={pluralize(shown.length, "item")}
          padded={false}
          actions={
            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-150 ${filter === f.key ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          }
        >
          {canMilestones && filter !== "all" ? <p className={`${helpClass} mt-0 border-b border-line px-5 py-2`}>Switch to All to edit or reorder.</p> : null}
          <MilestoneList milestones={shown} people={people} directory={directory} canEdit={canMilestones && filter === "all"} onChanged={setMilestones} />
          {canMilestones && filter === "all" ? (
            <AddMilestoneForm projectId={project.id} all={milestones} onAdded={(m) => setMilestones([...milestones, m])} />
          ) : null}
        </Section>

        <Section title="Details" className="self-start">
          {isAdmin ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="project-name" className={labelClass}>Name</label>
                <BlurInput id="project-name" value={project.name} required ariaLabel="Project name" onSave={(next) => save({ name: next.trim() })} />
              </div>
              <div>
                <label htmlFor="project-reference" className={labelClass}>Reference</label>
                <BlurInput id="project-reference" value={project.reference ?? ""} ariaLabel="Reference" onSave={(next) => save({ reference: next.trim() || null })} />
              </div>
              <div>
                <label htmlFor="project-notes" className={labelClass}>Notes</label>
                <BlurInput id="project-notes" multiline value={project.notes ?? ""} ariaLabel="Notes" onSave={(next) => save({ notes: next.trim() || null })} />
              </div>
              <div className="border-t border-line pt-4">
                <Button variant="danger" size="sm" onClick={() => setArchiving(true)}>Archive project</Button>
              </div>
            </div>
          ) : (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className={labelClass}>Reference</dt>
                <dd className="mt-1 text-ink">{project.reference ?? "-"}</dd>
              </div>
              <div>
                <dt className={labelClass}>Notes</dt>
                <dd className="mt-1 whitespace-pre-line text-ink-2">{project.notes ?? "-"}</dd>
              </div>
            </dl>
          )}
        </Section>
      </div>

      {archiving ? (
        <ConfirmDialog
          title="Archive this project?"
          body="It leaves the project list. Its milestones and letters are kept."
          confirmLabel="Archive"
          busy={busy}
          error={error}
          onConfirm={() => void handleArchive()}
          onCancel={() => {
            setArchiving(false);
            setError("");
          }}
        />
      ) : null}
    </>
  );
}
