// The company's standard milestones, for an admin in Settings > Production: the milestones and
// letters every new project starts with, in order. The database copies the live rows onto a
// project when it is created (0044), so a change here reaches projects created from now on and
// never the ones that already exist. Rows are renamed in place, marked as a milestone or a letter,
// moved up or down, and removed (archived, not deleted). The list is the company's own rows
// (rule 12): nothing here knows a company by name.
import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { inputClass, selectClass } from "../ui/forms.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import {
  archiveMilestoneTemplate,
  createMilestoneTemplate,
  listMilestoneTemplates,
  reorderMilestoneTemplates,
  updateMilestoneTemplate,
  type MilestoneTemplatePatch,
} from "../../services/milestoneTemplates.ts";
import { MILESTONE_KIND_LABELS, keysOf, type MilestoneKind, type MilestoneTemplate } from "../../types/database.ts";

function byOrder(a: MilestoneTemplate, b: MilestoneTemplate): number {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

function TemplateRow({
  template,
  first,
  last,
  busy,
  onSave,
  onMove,
  onRemove,
}: {
  template: MilestoneTemplate;
  first: boolean;
  last: boolean;
  busy: boolean;
  onSave: (patch: MilestoneTemplatePatch) => Promise<boolean>;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { title } = template;
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0">
      <div className="min-w-[180px] flex-1">
        <BlurInput value={title} required ariaLabel={`Title of ${title}`} onSave={(next) => onSave({ title: next.trim() })} className={`${inputClass} mt-0 text-[13px]`} />
      </div>
      <select aria-label={`Kind of ${title}`} value={template.kind} onChange={(e) => void onSave({ kind: e.target.value as MilestoneKind })} className={`${selectClass} mt-0 w-auto text-[13px]`}>
        {keysOf(MILESTONE_KIND_LABELS).map((k) => (
          <option key={k} value={k}>{MILESTONE_KIND_LABELS[k]}</option>
        ))}
      </select>
      <IconButton label={`Move ${title} up`} disabled={first || busy} onClick={() => onMove(-1)}>
        <ArrowUp size={14} aria-hidden />
      </IconButton>
      <IconButton label={`Move ${title} down`} disabled={last || busy} onClick={() => onMove(1)}>
        <ArrowDown size={14} aria-hidden />
      </IconButton>
      <IconButton label={`Remove ${title}`} disabled={busy} onClick={onRemove}>
        <Trash2 size={14} aria-hidden />
      </IconButton>
    </li>
  );
}

export default function MilestoneTemplatePanel({ companyId }: { companyId: string }) {
  const state = useAsync(() => listMilestoneTemplates(companyId), [companyId]);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  // While a reorder or a removal is writing, the arrows wait: a second move planned from the order
  // on screen would be planned from an order that is about to change.
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<MilestoneTemplate | null>(null);
  const [dialogError, setDialogError] = useState("");

  const templates = [...(state.data ?? [])].sort(byOrder);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (adding) return;
    const next = title.trim();
    if (!next) return setError("Give the milestone a title.");
    setAdding(true);
    setError("");
    try {
      const sortOrder = templates.reduce((max, t) => Math.max(max, t.sort_order), 0) + 1;
      const created = await createMilestoneTemplate(companyId, { title: next, kind: "milestone", sort_order: sortOrder });
      state.setData((prev) => (prev ? [...prev, created] : [created]));
      setTitle("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  // True when the change landed, false once the panel shows why not.
  async function save(template: MilestoneTemplate, patch: MilestoneTemplatePatch): Promise<boolean> {
    setError("");
    try {
      const saved = await updateMilestoneTemplate(template.id, patch);
      state.setData((prev) => (prev ? prev.map((t) => (t.id === saved.id ? saved : t)) : prev));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  // Positions are rewritten from the list as it is shown. The writes are separate, so on a refusal
  // the order the database holds is read back and shown with the error.
  async function move(index: number, direction: -1 | 1) {
    const other = templates[index + direction];
    if (!other || busy) return;
    const ids = templates.map((t) => t.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    setBusy(true);
    setError("");
    try {
      state.setData(await reorderMilestoneTemplates(companyId, ids));
    } catch (err) {
      setError(errorMessage(err));
      state.reload();
    } finally {
      setBusy(false);
    }
  }

  function openRemove(template: MilestoneTemplate) {
    if (busy) return;
    setDialogError("");
    setRemoving(template);
  }

  function closeRemove() {
    if (busy) return;
    setRemoving(null);
    setDialogError("");
  }

  async function remove() {
    if (!removing) return;
    const id = removing.id;
    setBusy(true);
    setDialogError("");
    try {
      await archiveMilestoneTemplate(id);
      state.setData((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
      setRemoving(null);
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      eyebrow="Production"
      title="Standard milestones"
      description="Every new project starts with these. Projects that already exist keep the milestones they have."
    >
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={3} /> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.data ? (
        <>
          {templates.length === 0 ? (
            <p className="text-sm text-ink-2">No standard milestones yet. Add the checkpoints every project should start with.</p>
          ) : (
            <ul className="divide-y divide-line">
              {templates.map((template, index) => (
                <TemplateRow
                  key={template.id}
                  template={template}
                  first={index === 0}
                  last={index === templates.length - 1}
                  busy={busy}
                  onSave={(patch) => save(template, patch)}
                  onMove={(direction) => void move(index, direction)}
                  onRemove={() => openRemove(template)}
                />
              ))}
            </ul>
          )}
          <form onSubmit={add} className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <input
              type="text"
              aria-label="New standard milestone title"
              placeholder="Add a milestone or letter"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`${inputClass} mt-0 min-w-[180px] flex-1 text-[13px]`}
            />
            <Button type="submit" variant="secondary" size="sm" disabled={adding}>Add</Button>
          </form>
        </>
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={`Remove "${removing.title}"?`}
          body="New projects will no longer start with it. Projects that already have it keep it."
          confirmLabel="Remove"
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={closeRemove}
        />
      ) : null}
    </Section>
  );
}
