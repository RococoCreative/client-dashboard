// Import SOPs a company already has: drop in Word, PDF, text or Markdown files, check what each one
// read as, file them under a category with tags, and create them as drafts. Each file is read in the
// browser (approach A: nothing is sent anywhere to be read) and becomes one SOP whose first version
// notes where it came from, with the original file attached so nothing in it is lost. Admins only
// (AdminOnly), and the database holds the same rule. Drafts are reviewed and published as usual.
import { useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, FileUp, TriangleAlert } from "lucide-react";
import Button from "../../components/ui/Button.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import Spinner from "../../components/ui/Spinner.tsx";
import CategoryPicker from "../../components/sops/CategoryPicker.tsx";
import TagInput from "../../components/sops/TagInput.tsx";
import { checkboxClass, compactInputClass } from "../../components/ui/forms.ts";
import { metaClass, secondaryClass } from "../../components/ui/type.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import { findCategoryByName, nextSortOrder, type CategoryChoice } from "../../lib/sops/categories.ts";
import { docToLines } from "../../lib/sops/doc.ts";
import { IMPORT_ACCEPT, MAX_IMPORT_FILES, readSopFile, type ImportedSop } from "../../lib/sops/importers.ts";
import { tagsInUse } from "../../lib/sops/tags.ts";
import { addSopAttachment, createSop, listSops } from "../../services/sops.ts";
import { createSopCategory, listSopCategories } from "../../services/sopCategories.ts";
import { buildObjectPath, formatBytes, uploadFile } from "../../services/storage.ts";

type Row = {
  key: string;
  file: File;
  reading: boolean;
  read: ImportedSop | null;
  title: string;
  include: boolean;
  result: { sopId: string; title: string; note?: string } | { error: string } | null;
};

let rowCounter = 0;

function RowStatus({ row }: { row: Row }) {
  if (row.result && "sopId" in row.result) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-success">
        <CheckCircle2 size={14} aria-hidden /> Created.{" "}
        <Link to={`/sops/${row.result.sopId}`} className="text-link hover:underline">Open {row.result.title}</Link>
        {row.result.note ? <span className="text-ink-3"> {row.result.note}</span> : null}
      </span>
    );
  }
  if (row.result && "error" in row.result) return <span className="text-[12px] text-danger" role="alert">{row.result.error}</span>;
  if (row.reading) return <span className={`inline-flex items-center gap-1.5 ${metaClass}`}><Spinner size={12} /> Reading</span>;
  if (row.read?.error) return <span className="inline-flex items-center gap-1.5 text-[12px] text-danger"><TriangleAlert size={14} aria-hidden /> {row.read.error}</span>;
  return null;
}

export default function SopImportPage() {
  const { company } = useHub();
  const companyId = company!.id;
  const setup = useAsync(async () => {
    const [categories, sops] = await Promise.all([listSopCategories(companyId), listSops(companyId)]);
    return { categories, tagSuggestions: tagsInUse(sops) };
  }, [companyId]);
  const [rows, setRows] = useState<Row[]>([]);
  const [category, setCategory] = useState<CategoryChoice>({ kind: "none" });
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const patch = (key: string, change: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)));

  async function addFiles(list: FileList | File[]) {
    setError("");
    const files = Array.from(list);
    const room = MAX_IMPORT_FILES - rows.length;
    if (files.length > room) setError(`Up to ${MAX_IMPORT_FILES} files at a time. The first ${Math.max(room, 0)} were added.`);
    const added: Row[] = files.slice(0, Math.max(room, 0)).map((file) => ({ key: `row-${++rowCounter}`, file, reading: true, read: null, title: "", include: true, result: null }));
    setRows((prev) => [...prev, ...added]);
    for (const row of added) {
      const read = await readSopFile(row.file);
      patch(row.key, { reading: false, read, title: read.title, include: !read.error });
    }
  }

  const ready = rows.filter((r) => r.include && r.read && !r.read.error && !r.result);

  // The batch's category, made real once if it is a starter or a new name.
  async function resolveCategory(): Promise<string | null> {
    if (category.kind === "none") return null;
    if (category.kind === "existing") return category.id;
    const name = category.name.trim();
    if (!name) throw new Error("Name the new category, or pick one from the list.");
    const categories = setup.data?.categories ?? [];
    const found = findCategoryByName(categories, name);
    if (found) return found.id;
    const created = await createSopCategory(companyId, name, nextSortOrder(categories));
    setup.setData((prev) => (prev ? { ...prev, categories: [...prev.categories, created] } : prev));
    setCategory({ kind: "existing", id: created.id });
    return created.id;
  }

  // One SOP at a time, each its own success or failure. The attachment comes after the SOP and its
  // failure never takes the SOP back: the text is in, only the copy of the original is missing.
  async function createAll() {
    if (busy || !ready.length) return;
    setBusy(true);
    setError("");
    let categoryId: string | null;
    try {
      categoryId = await resolveCategory();
    } catch (err) {
      setError(err instanceof Error && err.message.startsWith("Name the new category") ? err.message : errorMessage(err));
      setBusy(false);
      return;
    }
    for (const row of ready) {
      const title = row.title.trim() || row.read!.title;
      try {
        const sop = await createSop({
          company_id: companyId,
          title,
          category_id: categoryId,
          status: "draft",
          tags,
          body: { json: row.read!.doc! },
          change_note: `Imported from ${row.file.name}`,
        });
        let note: string | undefined;
        try {
          const path = buildObjectPath(companyId, "sops", sop.id, row.file.name);
          await uploadFile(path, row.file);
          await addSopAttachment({ sop_id: sop.id, company_id: companyId, file_name: row.file.name, file_path: path, content_type: row.file.type || null, size_bytes: row.file.size });
        } catch {
          note = "The original file did not attach; attach it from the SOP.";
        }
        patch(row.key, { result: { sopId: sop.id, title, note } });
      } catch (err) {
        patch(row.key, { result: { error: errorMessage(err) } });
      }
    }
    setBusy(false);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  }

  const done = rows.length > 0 && rows.every((r) => r.result || r.read?.error || !r.include);
  const created = rows.filter((r) => r.result && "sopId" in r.result).length;

  return (
    <>
      <PageHeader
        backTo="/resources/sops"
        backLabel="SOP library"
        eyebrow="SOP library"
        title="Import SOPs"
        description="Bring in the procedures you already have. Each file becomes a draft to review and publish."
        actions={
          <Button size="sm" disabled={busy || !ready.length} onClick={() => void createAll()}>
            {busy ? "Creating..." : `Create ${pluralize(ready.length, "draft")}`}
          </Button>
        }
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {done && created ? (
        <Notice tone="success" className="mb-4">
          {pluralize(created, "draft")} created. <Link to="/resources/sops?status=draft" className="text-link hover:underline">Review drafts in the library</Link>
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Section eyebrow="Files" title={rows.length ? pluralize(rows.length, "file") : "Add files"}>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors duration-150 ${dragging ? "border-accent bg-accent/5" : "border-line-strong"}`}
            >
              <FileUp size={20} className="text-ink-3" aria-hidden />
              <p className="text-sm text-ink">Drop files here, or</p>
              <input
                ref={input}
                id="sop-import-files"
                type="file"
                multiple
                accept={IMPORT_ACCEPT}
                aria-label="Choose files"
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={busy}>Choose files</Button>
              <p className={`max-w-md ${metaClass}`}>
                Word (.docx), PDF, text or Markdown, up to {MAX_IMPORT_FILES} at a time and 20 MB each. From Google Docs, use File, Download, Microsoft Word. Pictures stay in the attached original.
              </p>
            </div>

            {rows.length ? (
              <ul className="mt-4 divide-y divide-line rounded-md border border-line">
                {rows.map((row) => {
                  const ok = row.read && !row.read.error;
                  const preview = ok ? docToLines(row.read!.doc!).slice(0, 2).join(" · ") : "";
                  return (
                    <li key={row.key} className="flex items-start gap-3 px-3 py-3 sm:px-4">
                      <input
                        type="checkbox"
                        aria-label={`Include ${row.file.name}`}
                        checked={row.include}
                        disabled={!ok || Boolean(row.result) || busy}
                        onChange={(e) => patch(row.key, { include: e.target.checked })}
                        className={`${checkboxClass} mt-2`}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className={`truncate ${metaClass}`}>{row.file.name} · {formatBytes(row.file.size)}</p>
                        {ok ? (
                          <input
                            aria-label={`Title for ${row.file.name}`}
                            value={row.title}
                            onChange={(e) => patch(row.key, { title: e.target.value })}
                            disabled={Boolean(row.result) || busy}
                            className={compactInputClass}
                          />
                        ) : null}
                        {preview ? <p className={`line-clamp-1 ${secondaryClass}`}>{preview}</p> : null}
                        {ok && row.read!.notes.length ? <p className={metaClass}>{row.read!.notes.join(" ")}</p> : null}
                        <RowStatus row={row} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Section>
        </div>
        <div className="space-y-6">
          <Section eyebrow="Filing" title="For every file">
            {!setup.data && !setup.error ? (
              <SkeletonRows rows={3} />
            ) : (
              <div className="space-y-4">
                {setup.error ? <Notice tone="error">{setup.error}</Notice> : null}
                <CategoryPicker id="sop-import-category" categories={setup.data?.categories ?? []} currentId={null} value={category} onChange={setCategory} />
                <TagInput id="sop-import-tags" tags={tags} onChange={setTags} suggestions={setup.data?.tagSuggestions ?? []} />
                <p className={metaClass}>Each one is saved as a draft, visible to admins only, with its first version noting the file it came from.</p>
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
