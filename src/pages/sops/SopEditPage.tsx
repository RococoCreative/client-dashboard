// Write or revise an SOP: the body in the editor, the title, category, tags, summary, status and a
// change note. Saving an existing document appends a new version when its body changed; the old
// text stays in history. A version from before the editor (Markdown) opens converted, and saves as
// an editor version. Only owners, admins and Rococo reach this page (AdminOnly), and the database
// holds the same rule.
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/ui/Button.tsx";
import Field from "../../components/ui/Field.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import CategoryPicker from "../../components/sops/CategoryPicker.tsx";
import SopEditor from "../../components/sops/SopEditor.tsx";
import TagInput from "../../components/sops/TagInput.tsx";
import { inputClass, selectClass, textareaClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { addSopVersion, createSop, getCurrentSopVersion, getSop, listSops, updateSop } from "../../services/sops.ts";
import { createSopCategory, listSopCategories } from "../../services/sopCategories.ts";
import { errorMessage } from "../../lib/errors.ts";
import { assertInCompany } from "../../lib/tenancy.ts";
import { findCategoryByName, nextSortOrder, type CategoryChoice } from "../../lib/sops/categories.ts";
import { htmlToDoc, versionDoc } from "../../lib/sops/doc.ts";
import { tagsInUse } from "../../lib/sops/tags.ts";
import { SOP_STATUS_LABELS, keysOf, type Sop, type SopCategory, type SopDocJson, type SopStatus, type SopVersion } from "../../types/database.ts";

const TEMPLATE_HTML = `<h2>Purpose</h2><p>Why this procedure exists and when it applies.</p>
<h2>Steps</h2><ol><li><p>First step</p></li><li><p>Second step</p></li><li><p>Third step</p></li></ol>
<h2>Checks</h2><ul><li><p>What done looks like</p></li><li><p>Who signs off</p></li></ul>`;

type Loaded = { sop: Sop | null; version: SopVersion | null; categories: SopCategory[]; tagSuggestions: string[] };

// The form owns its fields from the moment it mounts, seeded from the loaded document (or the
// template for a new one), so there is no hydration step to keep in sync.
function SopForm({ loaded }: { loaded: Loaded }) {
  const { company } = useHub();
  const navigate = useNavigate();
  const companyId = company!.id;
  const existing = loaded.sop;
  const isNew = existing === null;

  const initialDoc = useMemo(() => (existing ? versionDoc(loaded.version) : htmlToDoc(TEMPLATE_HTML)), [existing, loaded.version]);
  const initialJson = useMemo(() => JSON.stringify(initialDoc), [initialDoc]);
  const doc = useRef<SopDocJson>(initialDoc);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [category, setCategory] = useState<CategoryChoice>(existing?.category_id ? { kind: "existing", id: existing.category_id } : { kind: "none" });
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [status, setStatus] = useState<SopStatus>(existing?.status ?? "draft");
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A starter or a typed name becomes a real category only now, on save.
  async function resolveCategory(): Promise<string | null> {
    if (category.kind === "none") return null;
    if (category.kind === "existing") return category.id;
    const name = category.name.trim();
    if (!name) throw new Error("Name the new category, or pick one from the list.");
    const found = findCategoryByName(loaded.categories, name);
    if (found) return found.id;
    return (await createSopCategory(companyId, name, nextSortOrder(loaded.categories))).id;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Give the SOP a title.");
    setBusy(true);
    setError("");
    try {
      const category_id = await resolveCategory();
      const fields = { title: title.trim(), category_id, summary: summary.trim() || null, status, tags };
      if (!existing) {
        const sop = await createSop({ company_id: companyId, ...fields, body: { json: doc.current }, change_note: changeNote.trim() || "First version" });
        navigate(`/sops/${sop.id}`);
        return;
      }
      await updateSop(existing.id, fields);
      const changed = JSON.stringify(doc.current) !== initialJson || !loaded.version?.body_json;
      if (changed || changeNote.trim()) {
        await addSopVersion(existing.id, existing.company_id, { json: doc.current }, changeNote.trim() || "Updated");
      }
      navigate(`/sops/${existing.id}`);
    } catch (err) {
      setError(err instanceof Error && err.message.startsWith("Name the new category") ? err.message : errorMessage(err));
      setBusy(false);
    }
  }

  const backTo = isNew ? "/resources/sops" : `/sops/${existing.id}`;
  return (
    <form onSubmit={handleSubmit}>
      <PageHeader
        backTo={backTo}
        backLabel={isNew ? "SOP library" : "Back to SOP"}
        eyebrow="SOP library"
        title={isNew ? "New SOP" : `Edit: ${existing.title}`}
        description={isNew ? "Write the procedure. Publish when it is ready for the team." : "Saving adds a new version; the current text stays in history."}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => navigate(backTo)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving..." : isNew ? "Create SOP" : "Save version"}</Button>
          </>
        }
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Section eyebrow="Content" title="Procedure">
            <Field label="Title" htmlFor="sop-title">
              <input id="sop-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name the procedure" className={inputClass} autoFocus={isNew} />
            </Field>
            <div className="mt-4">
              <SopEditor initial={initialDoc} onChange={(next) => (doc.current = next)} />
            </div>
          </Section>
        </div>
        <div className="space-y-6">
          <Section eyebrow="Details" title="Document">
            <div className="space-y-4">
              <CategoryPicker id="sop-category" categories={loaded.categories} currentId={existing?.category_id ?? null} value={category} onChange={setCategory} />
              <TagInput id="sop-tags" tags={tags} onChange={setTags} suggestions={loaded.tagSuggestions} />
              <Field label="Status" htmlFor="sop-status" hint={status === "published" ? "Visible to everyone in the company." : "Visible to admins only."}>
                <select id="sop-status" value={status} onChange={(e) => setStatus(e.target.value as SopStatus)} className={selectClass}>
                  {keysOf(SOP_STATUS_LABELS).map((s) => (
                    <option key={s} value={s}>{SOP_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Summary" htmlFor="sop-summary" hint="One line shown in the library list.">
                <textarea id="sop-summary" value={summary} onChange={(e) => setSummary(e.target.value)} className={`${textareaClass} min-h-[64px]`} rows={2} />
              </Field>
              <Field label={isNew ? "First version note" : "What changed"} htmlFor="sop-change-note">
                <input id="sop-change-note" type="text" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder={isNew ? "First version" : "What changed in this version"} className={inputClass} />
              </Field>
            </div>
          </Section>
        </div>
      </div>
    </form>
  );
}

export default function SopEditPage() {
  const { sopId } = useParams();
  const { company } = useHub();
  const companyId = company!.id;
  const state = useAsync(async (): Promise<Loaded> => {
    const [categories, all] = await Promise.all([listSopCategories(companyId), listSops(companyId)]);
    const tagSuggestions = tagsInUse(all);
    if (!sopId) return { sop: null, version: null, categories, tagSuggestions };
    const [sop, version] = await Promise.all([getSop(sopId), getCurrentSopVersion(sopId)]);
    // Saving here appends an immutable sop_versions row to whatever this id resolves to, and
    // getSop filters on the id alone. A Rococo admin can read all three companies, so a stale
    // or pasted URL would otherwise open another tenant's document in an editable form under
    // this company's branding and write a version into it.
    assertInCompany(sop, companyId, "SOP");
    return { sop, version, categories, tagSuggestions };
  }, [sopId, companyId]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;
  return <SopForm key={sopId ?? "new"} loaded={state.data} />;
}
