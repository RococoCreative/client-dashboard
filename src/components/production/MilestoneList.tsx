// One project's milestones and letters, in order. Admins edit each item in place (every field
// saves on its own), move it up or down, and archive it; everyone else reads the same list.
// There is no status: an item is done when it has a completed-on date.
import { useState } from "react";
import { Archive, ArrowDown, ArrowUp } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import { inputClass, labelClass, selectClass } from "../ui/forms.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate } from "../../lib/format.ts";
import { isComplete, moveMilestone, sortMilestones } from "../../lib/milestones.ts";
import { archiveMilestone, reorderMilestones, updateMilestone, type MilestonePatch } from "../../services/projects.ts";
import { MILESTONE_KIND_LABELS, keysOf, type MilestoneKind, type Profile, type ProjectMilestone } from "../../types/database.ts";


function Badges({ milestone }: { milestone: ProjectMilestone }) {
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1.5">
      {milestone.kind === "letter" ? <Badge tone="neutral">Letter</Badge> : null}
      {isComplete(milestone) ? <Badge tone="success">Done {formatDate(milestone.completed_on)}</Badge> : <Badge tone="neutral">Open</Badge>}
    </span>
  );
}

function ReadOnlyRow({ milestone, people }: { milestone: ProjectMilestone; people: Profile[] }) {
  const owner = people.find((p) => p.id === milestone.responsible_profile_id);
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-0 text-sm font-medium text-ink">{milestone.title}</span>
        <Badges milestone={milestone} />
      </div>
      <p className="mt-1 text-[12.5px] text-ink-2">
        {milestone.target_date ? `Target ${formatDate(milestone.target_date)}` : "No target date"}
        <span className="px-1.5 text-ink-3" aria-hidden>·</span>
        {owner ? displayName(owner) : "No one assigned"}
      </p>
      {milestone.description ? <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{milestone.description}</p> : null}
    </li>
  );
}

function EditableRow({
  milestone,
  people,
  first,
  last,
  busy,
  onSave,
  onMove,
  onArchive,
}: {
  milestone: ProjectMilestone;
  people: Profile[];
  first: boolean;
  last: boolean;
  busy: boolean;
  onSave: (patch: MilestonePatch) => void;
  onMove: (direction: "up" | "down") => void;
  onArchive: () => void;
}) {
  const { id, title } = milestone;
  const active = people.filter((p) => p.is_active || p.id === milestone.responsible_profile_id);
  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <BlurInput value={title} required ariaLabel={`Title of ${title}`} onSave={(next) => onSave({ title: next.trim() })} className={`${inputClass} font-medium`} />
        </div>
        <div className="mt-2 flex shrink-0 items-center">
          <IconButton label={`Move ${title} up`} disabled={first || busy} onClick={() => onMove("up")}><ArrowUp size={14} aria-hidden /></IconButton>
          <IconButton label={`Move ${title} down`} disabled={last || busy} onClick={() => onMove("down")}><ArrowDown size={14} aria-hidden /></IconButton>
          <IconButton label={`Archive ${title}`} disabled={busy} onClick={onArchive}><Archive size={14} aria-hidden /></IconButton>
        </div>
      </div>
      <div className="mt-2"><Badges milestone={milestone} /></div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
        <div>
          <label htmlFor={`${id}-kind`} className={labelClass}>Kind</label>
          <select id={`${id}-kind`} aria-label={`Kind of ${title}`} value={milestone.kind} onChange={(e) => onSave({ kind: e.target.value as MilestoneKind })} className={selectClass}>
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
          <select id={`${id}-owner`} aria-label={`Responsible for ${title}`} value={milestone.responsible_profile_id ?? ""} onChange={(e) => onSave({ responsible_profile_id: e.target.value || null })} className={selectClass}>
            <option value="">No one</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>{displayName(p)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-done`} className={labelClass}>Completed on</label>
          <BlurInput id={`${id}-done`} type="date" value={milestone.completed_on ?? ""} ariaLabel={`Completed on for ${title}`} onSave={(next) => onSave({ completed_on: next || null })} className={inputClass} />
        </div>
      </div>
      <div className="mt-2">
        <BlurInput multiline rows={2} value={milestone.description ?? ""} ariaLabel={`Notes for ${title}`} placeholder="Notes" onSave={(next) => onSave({ description: next.trim() || null })} className={`${inputClass} leading-relaxed`} />
      </div>
    </li>
  );
}

export default function MilestoneList({
  milestones,
  people,
  canEdit,
  onChanged,
}: {
  milestones: ProjectMilestone[];
  people: Profile[];
  canEdit: boolean;
  onChanged: (next: ProjectMilestone[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [archiving, setArchiving] = useState<ProjectMilestone | null>(null);
  const ordered = sortMilestones(milestones);

  async function save(milestone: ProjectMilestone, patch: MilestonePatch) {
    setError("");
    try {
      const next = await updateMilestone(milestone.id, patch);
      onChanged(milestones.map((m) => (m.id === next.id ? next : m)));
    } catch (err) {
      setError(errorMessage(err));
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
      setArchiving(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && !archiving ? <Notice tone="error" className="mx-5 mt-4">{error}</Notice> : null}
      {ordered.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-2">No milestones or letters yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {ordered.map((milestone, i) =>
            canEdit ? (
              <EditableRow
                key={milestone.id}
                milestone={milestone}
                people={people}
                first={i === 0}
                last={i === ordered.length - 1}
                busy={busy}
                onSave={(patch) => void save(milestone, patch)}
                onMove={(direction) => void move(milestone, direction)}
                onArchive={() => setArchiving(milestone)}
              />
            ) : (
              <ReadOnlyRow key={milestone.id} milestone={milestone} people={people} />
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
