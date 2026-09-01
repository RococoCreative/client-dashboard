// One SOP: the current text rendered from Markdown, its attachments, and the version
// history (any version can be read; none can be edited). Admins publish, archive, edit
// (which appends a version), attach files, and delete from here.
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import { Archive, Download, Eye, EyeOff, Paperclip, Pencil, Trash2, Upload } from "lucide-react";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { SOP_STATUS_TONE } from "../../components/status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { addSopAttachment, deleteSop, getSop, listSopAttachments, listSopVersions, removeSopAttachment, updateSop } from "../../services/sops.ts";
import { buildObjectPath, formatBytes, getSignedUrl, removeFile, uploadFile } from "../../services/storage.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatDateTime } from "../../lib/format.ts";
import { SOP_CATEGORY_LABELS, SOP_STATUS_LABELS, type SopAttachment, type SopStatus } from "../../types/database.ts";

export default function SopPage() {
  const { sopId = "" } = useParams();
  const { company, isAdmin } = useHub();
  const navigate = useNavigate();
  const companyId = company!.id;
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const state = useAsync(async () => {
    const [sop, versions, attachments] = await Promise.all([getSop(sopId), listSopVersions(sopId), listSopAttachments(sopId)]);
    return { sop, versions, attachments };
  }, [sopId, companyId]);

  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;

  const { sop, versions, attachments } = state.data;
  const current = versions[0] ?? null;
  const shown = selectedVersion === null ? current : (versions.find((v) => v.version === selectedVersion) ?? current);

  async function setStatus(status: SopStatus) {
    setBusy(true);
    setError("");
    try {
      const next = await updateSop(sop.id, { status });
      state.setData((prev) => (prev ? { ...prev, sop: next } : prev));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await Promise.all(attachments.map((a) => removeFile(a.file_path).catch(() => undefined)));
      await deleteSop(sop.id);
      navigate("/sops");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      setDeleting(false);
    }
  }

  async function handleUpload(file: File) {
    setBusy(true);
    setError("");
    try {
      const path = buildObjectPath(sop.company_id, "sops", sop.id, file.name);
      await uploadFile(path, file);
      const attachment = await addSopAttachment({
        sop_id: sop.id,
        company_id: sop.company_id,
        file_name: file.name,
        file_path: path,
        content_type: file.type || null,
        size_bytes: file.size,
      });
      state.setData((prev) => (prev ? { ...prev, attachments: [...prev.attachments, attachment] } : prev));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function openAttachment(attachment: SopAttachment) {
    setError("");
    try {
      const url = await getSignedUrl(attachment.file_path);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function deleteAttachment(attachment: SopAttachment) {
    setError("");
    try {
      await removeSopAttachment(attachment.id);
      await removeFile(attachment.file_path).catch(() => undefined);
      state.setData((prev) => (prev ? { ...prev, attachments: prev.attachments.filter((a) => a.id !== attachment.id) } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        backTo="/sops"
        backLabel="SOP library"
        eyebrow={SOP_CATEGORY_LABELS[sop.category]}
        title={sop.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {isAdmin ? <Badge tone={SOP_STATUS_TONE[sop.status]}>{SOP_STATUS_LABELS[sop.status]}</Badge> : null}
            <span className="tnum">Version {sop.current_version}</span>
            <span className="text-ink-3">Updated {formatDateTime(sop.updated_at)}</span>
          </span>
        }
        actions={
          isAdmin ? (
            <>
              <Link to={`/sops/${sop.id}/edit`}><Button variant="secondary" size="sm"><Pencil size={14} aria-hidden /> Edit</Button></Link>
              {sop.status === "published" ? (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void setStatus("draft")}><EyeOff size={14} aria-hidden /> Unpublish</Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => void setStatus("published")}><Eye size={14} aria-hidden /> Publish</Button>
              )}
              {sop.status !== "archived" ? (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void setStatus("archived")}><Archive size={14} aria-hidden /> Archive</Button>
              ) : null}
              <Button variant="danger" size="sm" onClick={() => setDeleting(true)}><Trash2 size={14} aria-hidden /> Delete</Button>
            </>
          ) : null
        }
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {sop.summary ? <p className="mb-6 max-w-3xl text-sm leading-relaxed text-ink-2">{sop.summary}</p> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section
            eyebrow={shown && shown.version !== sop.current_version ? `Viewing version ${shown.version}` : "Current version"}
            title="Procedure"
            actions={shown && shown.version !== sop.current_version ? <Button variant="ghost" size="sm" onClick={() => setSelectedVersion(null)}>Back to current</Button> : null}
          >
            {shown ? (
              shown.body_md.trim() ? (
                <div className="prose prose-sm max-w-none"><Markdown>{shown.body_md}</Markdown></div>
              ) : (
                <p className="text-sm text-ink-3">This version has no text.</p>
              )
            ) : (
              <p className="text-sm text-ink-3">No content yet.</p>
            )}
          </Section>
        </div>
        <div className="space-y-6">
          <Section
            eyebrow="Files"
            title={`${attachments.length} ${attachments.length === 1 ? "attachment" : "attachments"}`}
            actions={
              isAdmin ? (
                <>
                  <input ref={fileInput} type="file" className="hidden" aria-label="Attach file" onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleUpload(file); }} />
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14} aria-hidden /> Attach</Button>
                </>
              ) : null
            }
          >
            {attachments.length === 0 ? (
              <p className="text-sm text-ink-3">No files attached.</p>
            ) : (
              <ul className="divide-y divide-line">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <button type="button" onClick={() => void openAttachment(a)} className="flex min-w-0 items-center gap-2 text-left text-sm text-ink hover:text-accent">
                      <Paperclip size={14} className="shrink-0 text-ink-3" aria-hidden />
                      <span className="truncate">{a.file_name}</span>
                      <span className="shrink-0 text-[11px] text-ink-3">{formatBytes(a.size_bytes)}</span>
                    </button>
                    <div className="flex shrink-0 items-center">
                      <IconButton label="Download" onClick={() => void openAttachment(a)}><Download size={14} aria-hidden /></IconButton>
                      {isAdmin ? <IconButton label="Remove attachment" onClick={() => void deleteAttachment(a)}><Trash2 size={14} aria-hidden /></IconButton> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section eyebrow="History" title={`${versions.length} ${versions.length === 1 ? "version" : "versions"}`} padded={false}>
            <ul className="divide-y divide-line">
              {versions.map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => setSelectedVersion(v.version === sop.current_version ? null : v.version)} className={`flex w-full items-start justify-between gap-3 px-5 py-3 text-left transition-colors duration-150 hover:bg-surface-2/60 ${shown?.version === v.version ? "bg-surface-2/60" : ""}`}>
                    <span className="min-w-0">
                      <span className="tnum block text-sm text-ink">Version {v.version}{v.version === sop.current_version ? " (current)" : ""}</span>
                      <span className="block truncate text-[12px] text-ink-2">{v.change_note ?? "No change note"}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-3">{formatDateTime(v.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      {deleting ? (
        <ConfirmDialog title={`Delete "${sop.title}"?`} body="Every version and attachment is deleted with it. Archive instead to keep it out of the way but on record." confirmLabel="Delete SOP" busy={busy} onConfirm={() => void handleDelete()} onCancel={() => setDeleting(false)} />
      ) : null}
    </>
  );
}
