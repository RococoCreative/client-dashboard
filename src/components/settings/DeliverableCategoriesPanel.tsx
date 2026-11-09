// The company's deliverable categories, for an admin in Company Settings: the groups a person's
// deliverable headings are filed under ("BD & Sales", "Production"). A category is born the first
// time someone files a heading under it on a person page, so without this panel a mistyped one
// would be offered in every pulldown for good. Here it is renamed, put in order, retired (no
// longer offered, its headings left where they are) or deleted (its headings move to
// Uncategorized, as the database does). Categories are company rows (rule 12): nothing here knows
// a company by name.
import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { SkeletonRows } from "../ui/Skeleton.tsx";
import { inputClass } from "../ui/forms.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { deleteDeliverableCategory, listDeliverableCategories, updateDeliverableCategory } from "../../services/deliverables.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { DeliverableCategory } from "../../types/database.ts";

type CategoryPatch = Parameters<typeof updateDeliverableCategory>[1];

export default function DeliverableCategoriesPanel({ companyId }: { companyId: string }) {
  const state = useAsync(() => listDeliverableCategories(companyId), [companyId]);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<DeliverableCategory | null>(null);
  const [busy, setBusy] = useState(false);
  // The delete dialog reports only its own failure, never an inline save's.
  const [dialogError, setDialogError] = useState("");

  const categories = [...(state.data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  function adopt(saved: DeliverableCategory[]) {
    state.setData((prev) => (prev ? prev.map((c) => saved.find((s) => s.id === c.id) ?? c) : prev));
  }

  async function save(category: DeliverableCategory, patch: CategoryPatch) {
    setError("");
    try {
      adopt([await updateDeliverableCategory(category.id, patch)]);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Positions are rewritten from the list as it is shown, so two categories that share a
  // sort_order (both born at the same count) still swap cleanly.
  async function move(index: number, direction: -1 | 1) {
    const other = categories[index + direction];
    if (!other) return;
    const reordered = [...categories];
    reordered[index + direction] = categories[index];
    reordered[index] = other;
    setError("");
    try {
      const changed = reordered.map((c, i) => ({ c, order: i + 1 })).filter(({ c, order }) => c.sort_order !== order);
      adopt(await Promise.all(changed.map(({ c, order }) => updateDeliverableCategory(c.id, { sort_order: order }))));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    setBusy(true);
    setDialogError("");
    try {
      await deleteDeliverableCategory(id);
      state.setData((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      setDeleting(null);
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      eyebrow="People"
      title="Deliverable categories"
      description="The groups a person's deliverable headings are filed under. A category is added the first time someone files a heading under it; correct its name, order or use here. A retired category is no longer offered for new headings, and the headings already in it stay."
    >
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={3} /> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.data ? (
        categories.length === 0 ? (
          <p className="text-sm text-ink-2">No categories yet. One is added the first time a heading is filed under it on a person's deliverables.</p>
        ) : (
          <ul className="divide-y divide-line">
            {categories.map((category, index) => (
              <li key={category.id} className={`flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0 ${category.is_active ? "" : "opacity-70"}`}>
                <div className="min-w-[180px] flex-1">
                  <BlurInput value={category.name} required ariaLabel={`Category name ${category.name}`} onSave={(next) => void save(category, { name: next.trim() })} className={`${inputClass} mt-0 text-[13px]`} />
                </div>
                {category.is_active ? null : <Badge>Retired</Badge>}
                <Button variant="ghost" size="sm" onClick={() => void save(category, { is_active: !category.is_active })}>
                  {category.is_active ? "Retire" : "Restore"}
                </Button>
                <IconButton label={`Move ${category.name} up`} disabled={index === 0} onClick={() => void move(index, -1)}>
                  <ArrowUp size={14} aria-hidden />
                </IconButton>
                <IconButton label={`Move ${category.name} down`} disabled={index === categories.length - 1} onClick={() => void move(index, 1)}>
                  <ArrowDown size={14} aria-hidden />
                </IconButton>
                <IconButton label={`Delete ${category.name}`} onClick={() => setDeleting(category)}>
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          body="Headings filed under it, on everyone's deliverables, move to Uncategorized until someone files them again. They keep their tasks and ratings, so no figure changes. To stop offering it without moving anything, retire it instead."
          confirmLabel="Delete category"
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={() => {
            setDeleting(null);
            setDialogError("");
          }}
        />
      ) : null}
    </Section>
  );
}
