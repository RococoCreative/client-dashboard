// One project's milestones and letters, in order. Whoever may edit reads each item as text first,
// with its status and completed-on date live on the row and the arrows beside them; the pencil
// opens the title, kind, target, who is responsible and the notes in place (every field saves on
// its own), with Archive beside Done, one item at a time. Everyone else reads the same list.
// Each item is Not started, In progress or Complete (0043); the database keeps the status and the
// completed-on date in step, so after every save the row shows what came back, which is how
// picking Complete shows today's date and clearing the date shows Not started. Who is responsible is
// named from the company directory, which every member reads; the picker offers the profiles the
// viewer may see. Every field save returns whether it landed, so a refused one says "Not saved".
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import EditRow from "../ui/EditRow.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import { inputClass, labelClass, selectClass } from "../ui/forms.ts";
import { itemTitleClass, metaClass, secondaryClass } from "../ui/type.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate } from "../../lib/format.ts";
import { nameFromDirectory } from "../../lib/people.ts";
import { isComplete, moveMilestone, sortMilestones } from "../../lib/milestones.ts";
import { archiveMilestone, listMilestones, reorderMilestones, updateMilestone, type MilestonePatch } from "../../services/projects.ts";
import { MILESTONE_KIND_LABELS, MILESTONE_STATUS_LABELS, keysOf, type DirectoryEntry, type MilestoneKind, type MilestoneStatus, type Profile, type ProjectMilestone } from "../../types/database.ts";

type Directory = ReadonlyMap<string, DirectoryEntry>;

function StatusBadge({ milestone }: { milestone: ProjectMilestone }) {
  if (isComplete(milestone)) {
    return <Badge tone="success">{milestone.completed_on ? `Complete ${formatDate(milestone.completed_on)}` : MILESTONE_STATUS_LABELS.complete}</Badge>;
  }
  return <Badge tone={milestone.status === "in_progress" ? "info" : "neutral"}>{MILESTONE_STATUS_LABELS[milestone.status]}</Badge>;
}

function Badges({ milestone }: { milestone: ProjectMilestone }) {
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1.5">
      {milestone.kind === "letter" ? <Badge tone="neutral">Letter</Badge> : null}
      <StatusBadge milestone={milestone} />
    </span>
  );
}

// The target date and who is responsible, as one line of text.
function Meta({ milestone, directory }: { milestone: ProjectMilestone; directory: Directory }) {
  const owner = nameFromDirectory(directory, milestone.responsible_profile_id, milestone.responsible_profile_id ? "Someone no longer here" : "No one assigned");
  return (
    <p className={`mt-1 ${secondaryClass}`}>
      {milestone.target_date ? `Target ${formatDate(milestone.target_date)}` : "No target date"}
      <span className="px-1.5 text-ink-3" aria-hidden>·</span>
      {owner}
    </p>
  );
}

function ReadOnlyRow({ milestone, directory }: { milestone: ProjectMilestone; directory: Directory }) {
  return (
    <li className="px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={`min-w-0 ${itemTitleClass}`}>{milestone.title}</span>
        <Badges milestone={milestone} />
      </div>
      <Meta milestone={milestone} directory={directory} />
      {milestone.description ? <p className={`mt-1 whitespace-pre-line ${secondaryClass}`}>{milestone.description}</p> : null}
    </li>
  );
}

function EditableRow({
  milestone,
  people,
  directory,
  first,
  last,
  busy,
  editing,
  onEdit,
  onDone,
  onSave,
  onMove,
  onArchive,
}: {
  milestone: ProjectMilestone;
  people: Profile[];
  directory: Directory;
  first: boolean;
  last: boolean;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onSave: (patch: MilestonePatch) => Promise<boolean>;
  onMove: (direction: "up" | "down") => void;
  onArchive: () => void;
}) {
  const { id, title } = milestone;
  const active = people.filter((p) => p.is_active || p.id === milestone.responsible_profile_id);
  // The owner may be someone this viewer cannot pick (out of their divisions); they still show.
  const owner = milestone.responsible_profile_id;
  const hiddenOwner = owner !== null && !active.some((p) => p.id === owner);
  return (
    <EditRow
      as="li"
      className="px-4 py-3 sm:px-6"
      display={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className={`min-w-0 [overflow-wrap:anywhere] ${itemTitleClass}`}>{title}</span>
          <Badges milestone={milestone} />
        </div>
      }
      editLabel={`Edit ${title}`}
      editing={editing}
      onEdit={onEdit}
      onDone={onDone}
      actions={
        <>
          <IconButton label={`Move ${title} up`} disabled={first || busy} onClick={() => onMove("up")}><ArrowUp size={14} aria-hidden /></IconButton>
          <IconButton label={`Move ${title} down`} disabled={last || busy} onClick={() => onMove("down")}><ArrowDown size={14} aria-hidden /></IconButton>
        </>
      }
      after={
        <>
          {editing ? (
            <>
              <div className="mt-2"><Badges milestone={milestone} /></div>
              <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-3">
                <div>
                  <label htmlFor={`${id}-kind`} className={labelClass}>Kind</label>
                  <select id={`${id}-kind`} aria-label={`Kind of ${title}`} value={milestone.kind} onChange={(e) => void onSave({ kind: e.target.value as MilestoneKind })} className={selectClass}>
                    {keysOf(MILESTONE_KIND_LABELS).map((k) => (
                      <option key={k} value={k}>{MILESTONE_KIND_LABELS[k]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${id}-target`} className={labelClass}>Target</label>
                  <BlurInput id={`${id}-target`} type="date" value={milestone.target_date ?? ""} ariaLabel={`Target date for ${title}`} onSave={(next) => onSave({ target_date: next || null })} className={inputClass} />
                </div>
                <div>
                  <label htmlFor={`${id}-owner`} className={labelClass}>Responsible</label>
                  <select id={`${id}-owner`} aria-label={`Responsible for ${title}`} value={milestone.responsible_profile_id ?? ""} onChange={(e) => void onSave({ responsible_profile_id: e.target.value || null })} className={selectClass}>
                    <option value="">No one</option>
                    {hiddenOwner && owner ? <option value={owner}>{nameFromDirectory(directory, owner, "Someone no longer here")}</option> : null}
                    {active.map((p) => (
                      <option key={p.id} value={p.id}>{displayName(p)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-2">
                <BlurInput multiline rows={2} value={milestone.description ?? ""} ariaLabel={`Notes for ${title}`} placeholder="Notes" onSave={(next) => onSave({ description: next.trim() || null })} className={`${inputClass} leading-relaxed`} />
              </div>
            </>
          ) : (
            <>
              <Meta milestone={milestone} directory={directory} />
              {milestone.description ? <p className={`mt-1 whitespace-pre-line ${secondaryClass}`}>{milestone.description}</p> : null}
            </>
          )}
          {/* Status and its date are the everyday work on a milestone, so they stay live on the row. */}
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:max-w-md">
            <div>
              <label htmlFor={`${id}-status`} className={labelClass}>Status</label>
              <select id={`${id}-status`} aria-label={`Status of ${title}`} value={milestone.status} onChange={(e) => void onSave({ status: e.target.value as MilestoneStatus })} className={selectClass}>
                {keysOf(MILESTONE_STATUS_LABELS).map((k) => (
                  <option key={k} value={k}>{MILESTONE_STATUS_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-done`} className={labelClass}>Completed on</label>
              <BlurInput id={`${id}-done`} type="date" value={milestone.completed_on ?? ""} ariaLabel={`Completed on for ${title}`} onSave={(next) => onSave({ completed_on: next || null })} className={inputClass} />
            </div>
          </div>
        </>
      }
      footer={<Button variant="danger" size="sm" aria-label={`Archive ${title}`} disabled={busy} onClick={onArchive}>Archive</Button>}
    >
      <BlurInput value={title} required ariaLabel={`Title of ${title}`} onSave={(next) => onSave({ title: next.trim() })} className={`${inputClass} mt-0 font-medium`} />
    </EditRow>
  );
}

export default function MilestoneList({
  milestones,
  people,
  directory,
  canEdit,
  onChanged,
}: {
  milestones: ProjectMilestone[];
  people: Profile[];
  directory: Directory;
  canEdit: boolean;
  onChanged: (next: ProjectMilestone[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [archiving, setArchiving] = useState<ProjectMilestone | null>(null);
  // One item open at a time.
  const [openId, setOpenId] = useState<string | null>(null);
  const ordered = sortMilestones(milestones);

  async function save(milestone: ProjectMilestone, patch: MilestonePatch): Promise<boolean> {
    setError("");
    try {
      const next = await updateMilestone(milestone.id, patch);
      onChanged(milestones.map((m) => (m.id === next.id ? next : m)));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  async function move(milestone: ProjectMilestone, direction: "up" | "down") {
    setBusy(true);
    setError("");
    try {
      const next = await reorderMilestones(milestone.project_id, moveMilestone(milestones, milestone.id, direction));
      onChanged(next.filter((m) => m.archived_at === null));
    } catch (err) {
      setError(errorMessage(err));
      // A move writes one row at a time, so a failure can land after some rows moved. Read the
      // true order back, so the list on screen is the one the database holds beside the error.
      try {
        onChanged(await listMilestones(milestone.project_id));
      } catch {
        // The error above already says the move did not finish; a reload refreshes the order.
      }
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!archiving) return;
    setBusy(true);
    setError("");
    try {
      await archiveMilestone(archiving.id);
      onChanged(milestones.filter((m) => m.id !== archiving.id));
      setOpenId((open) => (open === archiving.id ? null : open));
      setArchiving(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && !archiving ? <Notice tone="error" className="mx-4 mt-4 sm:mx-6">{error}</Notice> : null}
      {ordered.length === 0 ? (
        <p className={`px-4 py-4 sm:px-6 ${metaClass}`}>No milestones or letters yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {ordered.map((milestone, i) =>
            canEdit ? (
              <EditableRow
                key={milestone.id}
                milestone={milestone}
                people={people}
                directory={directory}
                first={i === 0}
                last={i === ordered.length - 1}
                busy={busy}
                editing={openId === milestone.id}
                onEdit={() => setOpenId(milestone.id)}
                onDone={() => setOpenId(null)}
                onSave={(patch) => save(milestone, patch)}
                onMove={(direction) => void move(milestone, direction)}
                onArchive={() => setArchiving(milestone)}
              />
            ) : (
              <ReadOnlyRow key={milestone.id} milestone={milestone} directory={directory} />
            ),
          )}
        </ul>
      )}
      {archiving ? (
        <ConfirmDialog
          title="Archive this item?"
          body="It leaves the list and the counts. It is kept, not deleted."
          confirmLabel="Archive"
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
