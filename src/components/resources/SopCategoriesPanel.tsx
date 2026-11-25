// Resources > Setup: the SOP library's categories, the company's own (0053). An admin adds one
// (or a starter the company has not named yet), renames it in place, moves it up or down, retires
// it (no longer offered for new SOPs, kept on the ones filed under it) or deletes it (its SOPs
// become Uncategorized and keep everything else). The same rows every company carries; only the
// names differ.
import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import Chip from "../ui/Chip.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import PanelHeader from "../ui/PanelHeader.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { inputClass, labelClass } from "../ui/forms.ts";
import { metaClass } from "../ui/type.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import { SUGGESTED_SOP_CATEGORIES, findCategoryByName, nextSortOrder } from "../../lib/sops/categories.ts";
import { createSopCategory, deleteSopCategory, listSopCategories, updateSopCategory } from "../../services/sopCategories.ts";
import { listSops } from "../../services/sops.ts";
import type { SopCategory } from "../../types/database.ts";

export default function SopCategoriesPanel() {
  const { company } = useHub();
  const companyId = company!.id;
  const state = useAsync(async () => {
    const [categories, sops] = await Promise.all([listSopCategories(companyId), listSops(companyId)]);
    const counts = new Map<string, number>();
    for (const sop of sops) if (sop.category_id) counts.set(sop.category_id, (counts.get(sop.category_id) ?? 0) + 1);
    return { categories, counts };
  }, [companyId]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<SopCategory | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const categories = state.data?.categories ?? [];
  const setCategories = (next: SopCategory[]) => state.setData((prev) => (prev ? { ...prev, categories: next } : prev));

  async function add(value: string, event?: FormEvent) {
    event?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    if (findCategoryByName(categories, trimmed)) return setError(`There is already a category called ${trimmed}.`);
    setBusy(true);
    setError("");
    try {
      const created = await createSopCategory(companyId, trimmed, nextSortOrder(categories));
      setCategories([...categories, created]);
      setName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(category: SopCategory, patch: Partial<Pick<SopCategory, "name" | "sort_order" | "retired_at">>): Promise<void> {
    const updated = await updateSopCategory(category.id, patch);
    setCategories(categories.map((c) => (c.id === updated.id ? updated : c)));
  }

  // Swaps places with the neighbour; renumbers first if two share a place.
  async function move(index: number, direction: -1 | 1) {
    const other = categories[index + direction];
    const here = categories[index];
    if (!other) return;
    setError("");
    try {
      const a = here.sort_order === other.sort_order ? index + 1 : here.sort_order;
      const b = here.sort_order === other.sort_order ? index + 1 + direction : other.sort_order;
      const [first, second] = await Promise.all([updateSopCategory(here.id, { sort_order: b }), updateSopCategory(other.id, { sort_order: a })]);
      setCategories(
        categories
          .map((c) => (c.id === first.id ? first : c.id === second.id ? second : c))
          .sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name)),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError("");
    try {
      await deleteSopCategory(deleting.id);
      setCategories(categories.filter((c) => c.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const starters = SUGGESTED_SOP_CATEGORIES.filter((s) => !findCategoryByName(categories, s));
  return (
    <>
      <PanelHeader eyebrow="Admins only" title="Library setup" description="How the SOP library is organized. Everyone filters by these; only admins change them." />
      <Section eyebrow="Organization" title="SOP categories" description="Each SOP sits in one category, or none. Tags cut across categories and are set on each SOP.">
        {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
        <form onSubmit={(e) => void add(name, e)} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="sop-category-new" className={labelClass}>New category</label>
            <input id="sop-category-new" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name the category" className={inputClass} />
          </div>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>Add category</Button>
        </form>
        {starters.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className={metaClass}>Starters:</span>
            {starters.map((s) => (
              <Chip key={s} size="sm" disabled={busy} onClick={() => void add(s)}>{s}</Chip>
            ))}
          </div>
        ) : null}

        {!state.data && !state.error ? <SkeletonRows rows={4} /> : null}
        {state.error && !state.data ? <Notice tone="error" className="mt-4">{state.error}</Notice> : null}
        {state.data ? (
          categories.length === 0 ? (
            <p className={`mt-4 ${metaClass}`}>No categories yet. Every SOP reads as Uncategorized until one is added.</p>
          ) : (
            <ul className="mt-5 divide-y divide-line rounded-lg border border-line">
              {categories.map((c, i) => {
                const count = state.data!.counts.get(c.id) ?? 0;
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
                    <BlurInput ariaLabel={`Name of ${c.name}`} value={c.name} required onSave={(value) => save(c, { name: value })} className="min-w-[160px] flex-1" />
                    <span className={`w-20 shrink-0 ${metaClass}`}>{pluralize(count, "SOP")}</span>
                    <Button variant="ghost" size="sm" onClick={() => void save(c, { retired_at: c.retired_at ? null : new Date().toISOString() }).catch((err) => setError(errorMessage(err)))}>
                      {c.retired_at ? "Bring back" : "Retire"}
                    </Button>
                    <IconButton label={`Move ${c.name} up`} disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp size={15} aria-hidden /></IconButton>
                    <IconButton label={`Move ${c.name} down`} disabled={i === categories.length - 1} onClick={() => void move(i, 1)}><ArrowDown size={15} aria-hidden /></IconButton>
                    <Button variant="ghost" size="sm" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>Delete</Button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </Section>
      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          body={`${pluralize(state.data?.counts.get(deleting.id) ?? 0, "SOP")} filed under it become Uncategorized, keeping their text, versions and sign-offs. Retire it instead to stop offering it and keep it on those SOPs.`}
          confirmLabel="Delete category"
          busy={busy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => { setDeleting(null); setDeleteError(""); }}
        />
      ) : null}
    </>
  );
}
