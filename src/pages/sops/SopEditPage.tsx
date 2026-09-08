// Write or revise an SOP. Markdown body, a change note, and the document details. Saving an
// existing document appends a new version; the old text stays in history.
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/ui/Button.tsx";
import Field from "../../components/ui/Field.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { inputClass, selectClass, textareaClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { addSopVersion, createSop, getCurrentSopVersion, getSop, updateSop } from "../../services/sops.ts";
import { errorMessage } from "../../lib/errors.ts";
import { SOP_CATEGORY_LABELS, SOP_STATUS_LABELS, keysOf, type SopCategory, type SopStatus } from "../../types/database.ts";

const TEMPLATE = `## Purpose

Why this procedure exists and when it applies.

## Steps

1. First step
2. Second step
3. Third step

## Checks

- What done looks like
- Who signs off
`;

type ExistingSop = { sop: Awaited<ReturnType<typeof getSop>>; version: Awaited<ReturnType<typeof getCurrentSopVersion>> };

// The form owns its fields from the moment it mounts, seeded from the loaded document (or
// the template for a new one), so there is no hydration step to keep in sync.
function SopForm({ existing }: { existing: ExistingSop | null }) {
  const { company } = useHub();
  const navigate = useNavigate();
  const companyId = company!.id;
  const isNew = existing === null;
  const sopId = existing?.sop.id;

  const [title, setTitle] = useState(existing?.sop.title ?? "");
  const [category, setCategory] = useState<SopCategory>(existing?.sop.category ?? "process");
  const [summary, setSummary] = useState(existing?.sop.summary ?? "");
  const [status, setStatus] = useState<SopStatus>(existing?.sop.status ?? "draft");
  const [body, setBody] = useState(existing ? (existing.version?.body_md ?? "") : TEMPLATE);
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Give the SOP a title.");
    setBusy(true);
    setError("");
    try {
      if (!existing) {
        const sop = await createSop({ company_id: companyId, title: title.trim(), category, summary: summary.trim() || null, status, body_md: body, change_note: changeNote.trim() || "First version" });
        navigate(`/sops/${sop.id}`);
        return;
      }
      const sop = existing.sop;
      await updateSop(sop.id, { title: title.trim(), category, summary: summary.trim() || null, status });
      const previous = existing.version?.body_md ?? "";
      if (body !== previous || changeNote.trim()) {
        await addSopVersion(sop.id, sop.company_id, body, changeNote.trim() || "Updated");
      }
      navigate(`/sops/${sop.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <PageHeader
        backTo={isNew ? "/sops" : `/sops/${sopId}`}
        backLabel={isNew ? "SOP library" : "Back to SOP"}
        eyebrow="SOP library"
        title={isNew ? "New SOP" : `Edit: ${existing?.sop.title ?? ""}`}
        description={isNew ? "Write it in Markdown. Publish when it is ready for the team." : "Saving adds a new version; the current text stays in history."}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => navigate(isNew ? "/sops" : `/sops/${sopId}`)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving..." : isNew ? "Create SOP" : "Save version"}</Button>
          </>
        }
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section eyebrow="Content" title="Procedure">
            <Field label="Title" htmlFor="sop-title">
              <input id="sop-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Jobsite safety walk" className={inputClass} autoFocus={isNew} />
            </Field>
            <Field label="Body (Markdown)" htmlFor="sop-body" className="mt-4" hint="Headings with ##, numbered steps, bullet lists, and links all render.">
              <textarea id="sop-body" value={body} onChange={(e) => setBody(e.target.value)} className={`${textareaClass} min-h-[420px] font-mono text-[13px]`} spellCheck />
            </Field>
          </Section>
        </div>
        <div className="space-y-6">
          <Section eyebrow="Details" title="Document">
            <div className="space-y-4">
              <Field label="Category" htmlFor="sop-category">
                <select id="sop-category" value={category} onChange={(e) => setCategory(e.target.value as SopCategory)} className={selectClass}>
                  {keysOf(SOP_CATEGORY_LABELS).map((c) => (
                    <option key={c} value={c}>{SOP_CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </Field>
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
                <input id="sop-change-note" type="text" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder={isNew ? "First version" : "Added the lockout step"} className={inputClass} />
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
  const existing = useAsync(async (): Promise<ExistingSop | null> => {
    if (!sopId) return null;
    const [sop, version] = await Promise.all([getSop(sopId), getCurrentSopVersion(sopId)]);
    return { sop, version };
  }, [sopId]);

  if (sopId && existing.error) return <Notice tone="error">{existing.error}</Notice>;
  if (sopId && !existing.data) return <SkeletonRows rows={8} />;
  return <SopForm key={sopId ?? "new"} existing={existing.data} />;
}
