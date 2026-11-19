// The wins a company records by hand, newest first. Members read the list; admins add a win,
// edit each one in place (every field saves on its own) and remove it (stored as archived_at).
// Every win here is manual: the database forces that for any write from the browser (0027).
// When the company limits how many days a win stays on Home, the page splits in two: Recent (the
// wins still on Home) and Archive (older ones). With no setting it is one list, as it always was.
import { useRef, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import Badge from "../components/ui/Badge.tsx";
import BlurInput from "../components/ui/BlurInput.tsx";
import Button from "../components/ui/Button.tsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.tsx";
import EmptyState from "../components/ui/EmptyState.tsx";
import Field from "../components/ui/Field.tsx";
import IconButton from "../components/ui/IconButton.tsx";
import Modal from "../components/ui/Modal.tsx";
import Notice from "../components/ui/Notice.tsx";
import PageHeader from "../components/ui/PageHeader.tsx";
import Section from "../components/ui/Section.tsx";
import SkeletonRows from "../components/ui/SkeletonRows.tsx";
import { inputClass, labelClass, selectClass, textareaClass } from "../components/ui/forms.ts";
import { useHub } from "../context/HubContext.tsx";
import { useAsync } from "../hooks/useAsync.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatDate } from "../lib/format.ts";
import { companyToday, homeCutoff } from "../lib/wins.ts";
import { hasModule } from "../lib/modules.ts";
import { listProjects } from "../services/projects.ts";
import { archiveWin, createWin, listWins, updateWin, type WinPatch } from "../services/wins.ts";
import { WIN_SOURCE_LABELS, type Project, type Win } from "../types/database.ts";

// The order the service reads them in: by the date won, then by when each was entered.
function newestFirst(a: Win, b: Win): number {
  return b.won_on.localeCompare(a.won_on) || b.created_at.localeCompare(a.created_at);
}

type View = "recent" | "archive";

// Two views of one list, switched in place. Styled like the route tabs; no route of its own.
function ViewTabs({ view, onChange }: { view: View; onChange: (next: View) => void }) {
  const items: Array<{ key: View; label: string }> = [
    { key: "recent", label: "Recent" },
    { key: "archive", label: "Archive" },
  ];
  return (
    <div role="tablist" aria-label="Wins" className="relative -mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-line px-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={view === item.key}
          onClick={() => onChange(item.key)}
          className={
            "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors duration-150 " +
            (view === item.key ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")
          }
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function SourceBadge({ win }: { win: Win }) {
  return <Badge tone="neutral">{WIN_SOURCE_LABELS[win.source_type]}</Badge>;
}

function ProjectSelect({ id, label, value, projects, onChange }: { id: string; label: string; value: string; projects: Project[]; onChange: (next: string) => void }) {
  return (
    <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
      <option value="">No project</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>{project.name}</option>
      ))}
    </select>
  );
}

function ReadOnlyRow({ win, projects }: { win: Win; projects: Project[] }) {
  const project = projects.find((p) => p.id === win.project_id);
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-0 text-sm font-medium text-ink">{win.title}</span>
        <SourceBadge win={win} />
      </div>
      <p className="mt-1 text-[12.5px] text-ink-2">
        {formatDate(win.won_on)}
        {project ? (
          <>
            <span className="px-1.5 text-ink-3" aria-hidden>·</span>
            <span>{project.name}</span>
          </>
        ) : null}
      </p>
      {win.description ? <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{win.description}</p> : null}
    </li>
  );
}

function EditableRow({ win, projects, withProjects, onSave, onArchive }: { win: Win; projects: Project[]; withProjects: boolean; onSave: (patch: WinPatch) => Promise<boolean>; onArchive: () => void }) {
  const { id, title } = win;
  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <BlurInput value={title} required ariaLabel={`Title of ${title}`} onSave={(next) => onSave({ title: next.trim() })} className={`${inputClass} font-medium`} />
        </div>
        <div className="mt-2 flex shrink-0 items-center gap-1">
          <SourceBadge win={win} />
          <IconButton label={`Remove ${title}`} onClick={onArchive}><X size={14} aria-hidden /></IconButton>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-[12rem_minmax(0,20rem)]">
        <div>
          <label htmlFor={`${id}-won`} className={labelClass}>Won on</label>
          <BlurInput id={`${id}-won`} type="date" required value={win.won_on} ariaLabel={`Won on for ${title}`} onSave={(next) => onSave({ won_on: next })} className={inputClass} />
        </div>
        {withProjects ? (
          <div>
            <label htmlFor={`${id}-project`} className={labelClass}>Project</label>
            <ProjectSelect id={`${id}-project`} label={`Project for ${title}`} value={win.project_id ?? ""} projects={projects} onChange={(next) => void onSave({ project_id: next || null })} />
          </div>
        ) : null}
      </div>
      <div className="mt-2">
        <BlurInput multiline rows={2} value={win.description ?? ""} ariaLabel={`Description of ${title}`} placeholder="Description" onSave={(next) => onSave({ description: next.trim() || null })} className={`${inputClass} leading-relaxed`} />
      </div>
    </li>
  );
}

// The date starts on the company's own day, the same day the Home cut-off reads, not the browser's.
function NewWinDialog({ companyId, timeZone, projects, withProjects, onClose, onCreated }: { companyId: string; timeZone: string; projects: Project[]; withProjects: boolean; onClose: () => void; onCreated: (win: Win) => void }) {
  const [title, setTitle] = useState("");
  const [wonOn, setWonOn] = useState(() => companyToday(timeZone));
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Give the win a title.");
    if (!wonOn) return setError("Pick the date it was won.");
    setBusy(true);
    setError("");
    try {
      onCreated(
        await createWin({
          company_id: companyId,
          title: title.trim(),
          won_on: wonOn,
          description: description.trim() || null,
          project_id: projectId || null,
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="new-win-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="new-win-title" className="font-display text-lg text-heading">New win</h2>
        <div className="mt-5 space-y-4">
          <Field label="Title" htmlFor="win-title">
            <input id="win-title" type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Won on" htmlFor="win-won-on">
            <input id="win-won-on" type="date" value={wonOn} onChange={(e) => setWonOn(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Description" htmlFor="win-description">
            <textarea id="win-description" value={description} onChange={(e) => setDescription(e.target.value)} className={`${textareaClass} min-h-[64px]`} rows={2} />
          </Field>
          {withProjects ? (
            <Field label="Project" htmlFor="win-project">
              <ProjectSelect id="win-project" label="Project" value={projectId} projects={projects} onChange={setProjectId} />
            </Field>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Add win"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function WinsPage() {
  const { company, isAdmin, can } = useHub();
  const companyId = company!.id;
  // Projects exist only for a company with the production module; without it there is nothing
  // to pick and no call for them.
  const withProjects = hasModule(company, "production");
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<Win | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The cut-off is the company's own day, so it moves at the company's midnight, not the browser's.
  const cutoff = homeCutoff(company!.wins_home_days, companyToday(company!.time_zone));
  const [view, setView] = useState<View>("recent");
  const inView = (win: Win) => (cutoff === null ? true : view === "recent" ? win.won_on >= cutoff : win.won_on < cutoff);
  const state = useAsync(async () => {
    const range = cutoff === null ? undefined : view === "recent" ? { wonOnOrAfter: cutoff } : { wonBefore: cutoff };
    const [wins, projects] = await Promise.all([listWins(companyId, range), withProjects ? listProjects(companyId) : Promise.resolve([] as Project[])]);
    return { wins, projects };
  }, [companyId, cutoff, view]);
  // A win created or re-dated here may belong to the other view; only this view's wins show.
  const shown = state.data ? state.data.wins.filter(inView) : [];

  const replace = (next: Win) => state.setData((prev) => (prev ? { ...prev, wins: prev.wins.map((w) => (w.id === next.id ? next : w)) } : prev));

  // Each response carries the whole win, so a title left by a click on the project pulldown put
  // two writes in flight that could land the wrong way round and show the older one. Writes for one
  // win queue behind each other. True when the change landed, false once the page shows why not.
  const saveChains = useRef(new Map<string, Promise<unknown>>());
  async function save(win: Win, patch: WinPatch): Promise<boolean> {
    setError("");
    const chained = (saveChains.current.get(win.id) ?? Promise.resolve()).catch(() => undefined).then(async () => replace(await updateWin(win.id, patch)));
    saveChains.current.set(win.id, chained);
    try {
      await chained;
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  async function archive() {
    if (!archiving) return;
    setBusy(true);
    setError("");
    try {
      await archiveWin(archiving.id);
      const gone = archiving.id;
      state.setData((prev) => (prev ? { ...prev, wins: prev.wins.filter((w) => w.id !== gone) } : prev));
      setArchiving(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Recording a win follows the wins_post capability; editing and archiving one stay with admins.
  const canPost = can("wins_post");
  const newWin = canPost ? <Button size="sm" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> New win</Button> : null;

  return (
    <>
      <PageHeader eyebrow={company!.name} title="Wins" description="Wins the team records by hand, newest first." actions={newWin} />
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {error && !archiving ? <Notice tone="error" className="mb-4">{error}</Notice> : null}

      {cutoff !== null ? <ViewTabs view={view} onChange={setView} /> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : !state.data ? null : shown.length === 0 ? (
        cutoff !== null && view === "archive" ? (
          <p className="px-1 py-4 text-sm text-ink-2">No older wins yet.</p>
        ) : (
          <EmptyState
            eyebrow="Wins"
            title="No wins yet"
            body={canPost ? "Record a win. It shows here and on Home." : "Wins your team records show here."}
          />
        )
      ) : (
        <Section padded={false}>
          <ul className="divide-y divide-line">
            {shown.map((win) =>
              isAdmin ? (
                <EditableRow
                  key={win.id}
                  win={win}
                  projects={state.data!.projects}
                  withProjects={withProjects}
                  onSave={(patch) => save(win, patch)}
                  onArchive={() => setArchiving(win)}
                />
              ) : (
                <ReadOnlyRow key={win.id} win={win} projects={state.data!.projects} />
              ),
            )}
          </ul>
        </Section>
      )}

      {creating ? (
        <NewWinDialog
          companyId={companyId}
          timeZone={company!.time_zone}
          projects={state.data?.projects ?? []}
          withProjects={withProjects}
          onClose={() => setCreating(false)}
          onCreated={(win) => {
            state.setData((prev) => (prev ? { ...prev, wins: [...prev.wins, win].sort(newestFirst) } : prev));
            setCreating(false);
          }}
        />
      ) : null}

      {archiving ? (
        <ConfirmDialog
          title="Remove this win?"
          body="It leaves the Wins page and Home for everyone. It is kept in the record, not deleted."
          confirmLabel="Remove"
          tone="primary"
          busy={busy}
          error={error}
          onConfirm={() => void archive()}
          onCancel={() => {
            setArchiving(null);
            setError("");
          }}
        />
      ) : null}
    </>
  );
}
