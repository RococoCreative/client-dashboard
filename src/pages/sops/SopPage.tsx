// One SOP: the current version in the editor's schema with Find in this SOP, who created and last
// updated it, its category and tags, its attachments, and the version history (any version can be
// read and compared with the current one; none can be edited; an admin restores an older one as a
// new version). Admins publish, archive, edit (which appends a version), attach files, and delete
// from here.
import { useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Archive, Download, Eye, EyeOff, Paperclip, Pencil, Trash2, Upload } from "lucide-react";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import IconLink from "../../components/ui/IconLink.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import SopDocument from "../../components/sops/SopDocument.tsx";
import VersionHistory from "../../components/sops/VersionHistory.tsx";
import SignoffCard from "../../components/sops/SignoffCard.tsx";
import SopAssignments from "../../components/sops/SopAssignments.tsx";
import { SOP_STATUS_TONE } from "../../components/status.ts";
import { metaClass, secondaryClass } from "../../components/ui/type.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { assertInCompany } from "../../lib/tenancy.ts";
import { openSignedUrl } from "../../lib/newTab.ts";
import { addSopAttachment, deleteSop, getSop, listSopAttachments, listSopVersions, removeSopAttachment, restoreSopVersion, updateSop } from "../../services/sops.ts";
import { listSopCategories } from "../../services/sopCategories.ts";
import { listPersonSopSignoffs, listSopSignoffs } from "../../services/sopSignoffs.ts";
import { listTasks, listTasksForSop } from "../../services/tasks.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { hasModule } from "../../lib/modules.ts";
import { buildObjectPath, formatBytes, getSignedUrl, removeFile, uploadFile } from "../../services/storage.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatDate, pluralize } from "../../lib/format.ts";
import { versionDoc } from "../../lib/sops/doc.ts";
import { SOP_STATUS_LABELS, type SopAttachment, type SopStatus, type SopVersion } from "../../types/database.ts";

// Whether the database answered a write with a refusal (a Postgres or PostgREST error code), so
// the row is known not to have been written. A dropped connection comes back with no code: the
// write may have landed, and nobody can say.
function refused(err: unknown): boolean {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.length > 0;
}

export default function SopPage() {
  const { sopId = "" } = useParams();
  const { company, isAdmin, profile } = useHub();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const companyId = company!.id;
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  // The delete dialog reports only its own failure, inside the dialog, rather than sharing the
  // page's notice and opening on an upload or status change that failed earlier.
  const [deleteError, setDeleteError] = useState("");
  // Removing an attachment deletes the stored file too, so it is confirmed like the SOP itself.
  const [removingAttachment, setRemovingAttachment] = useState<SopAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const state = useAsync(async () => {
    const [sop, versions, attachments, categories] = await Promise.all([getSop(sopId), listSopVersions(sopId), listSopAttachments(sopId), listSopCategories(companyId)]);
    // Publish, archive and delete are live on this page, so it must be this company's SOP.
    assertInCompany(sop, companyId, "SOP");
    return { sop, versions, attachments, categories };
  }, [sopId, companyId]);

  // Who has signed it off and who it is assigned to: the reader's own, and for admins everyone's.
  // Loaded beside the document, so the SOP never waits on it.
  const member = profile.company_id === companyId;
  const withTasks = hasModule(company!, "tasks");
  const standing = useAsync(async () => {
    const [mine, everyone, tasks, people] = await Promise.all([
      member ? listPersonSopSignoffs(companyId, profile.id) : Promise.resolve([]),
      isAdmin ? listSopSignoffs(sopId) : Promise.resolve([]),
      withTasks ? (isAdmin ? listTasksForSop(companyId, sopId) : listTasks(companyId, { assigneeId: profile.id })) : Promise.resolve([]),
      isAdmin ? listCompanyProfiles(companyId) : Promise.resolve([]),
    ]);
    return { mine: mine.filter((x) => x.sop_id === sopId), everyone, tasks: tasks.filter((t) => t.sop_id === sopId), people };
  }, [sopId, companyId, profile.id, member, isAdmin, withTasks]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;

  const { sop, versions, attachments, categories } = state.data;
  const categoryName = categories.find((c) => c.id === sop.category_id)?.name ?? "Uncategorized";
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

  // The row goes first and its attachment rows cascade with it; the stored files are removed
  // after, best effort. The other way round, a refused or dropped delete left the SOP in the
  // library with attachments pointing at files that no longer exist. A file left behind by a
  // failed removal is only unused storage.
  // Restoring saves the old text as the newest version; the list and the SOP read back after.
  async function handleRestore(version: SopVersion) {
    await restoreSopVersion(version);
    const [nextSop, nextVersions] = await Promise.all([getSop(sop.id), listSopVersions(sop.id)]);
    setSelectedVersion(null);
    state.setData((prev) => (prev ? { ...prev, sop: nextSop, versions: nextVersions } : prev));
  }

  async function handleDelete() {
    setBusy(true);
    setDeleteError("");
    try {
      await deleteSop(sop.id);
    } catch (err) {
      setDeleteError(errorMessage(err));
      setBusy(false);
      return;
    }
    await Promise.all(attachments.map((a) => removeFile(a.file_path).catch(() => undefined)));
    navigate("/resources/sops");
  }

  // Upload, then the row that points at it: two writes. When the database refuses the row, the
  // uploaded file is one nobody points at, so it goes again. When the connection dropped the row
  // may have landed, so the file stays: a spare file is only unused storage, an attachment
  // pointing at nothing is broken for everyone.
  async function handleUpload(file: File) {
    setBusy(true);
    setError("");
    try {
      const path = buildObjectPath(sop.company_id, "sops", sop.id, file.name);
      await uploadFile(path, file);
      let attachment: SopAttachment;
      try {
        attachment = await addSopAttachment({
          sop_id: sop.id,
          company_id: sop.company_id,
          file_name: file.name,
          file_path: path,
          content_type: file.type || null,
          size_bytes: file.size,
        });
      } catch (err) {
        if (refused(err)) await removeFile(path).catch(() => undefined);
        throw err;
      }
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
      await openSignedUrl(() => getSignedUrl(attachment.file_path));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function deleteAttachment() {
    if (!removingAttachment) return;
    setBusy(true);
    setAttachmentError("");
    try {
      const attachment = removingAttachment;
      await removeSopAttachment(attachment.id);
      await removeFile(attachment.file_path).catch(() => undefined);
      state.setData((prev) => (prev ? { ...prev, attachments: prev.attachments.filter((a) => a.id !== attachment.id) } : prev));
      setRemovingAttachment(null);
    } catch (err) {
      setAttachmentError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        backTo="/resources/sops"
        backLabel="SOP library"
        eyebrow={categoryName}
        title={sop.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {isAdmin ? <Badge tone={SOP_STATUS_TONE[sop.status]}>{SOP_STATUS_LABELS[sop.status]}</Badge> : null}
            <span className="tnum">Version {sop.current_version}</span>
            <span className="text-ink-3">
              Last updated{sop.updated_by_name ? ` by ${sop.updated_by_name}` : ""} on {formatDate(sop.updated_at, "long")}
            </span>
            <span className="text-ink-3">
              Created{sop.created_by_name ? ` by ${sop.created_by_name}` : ""} on {formatDate(sop.created_at, "long")}
            </span>
          </span>
        }
        actions={
          isAdmin ? (
            <>
              <IconLink to={`/sops/${sop.id}/edit`} label="Edit SOP">
                <Pencil size={15} aria-hidden />
              </IconLink>
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
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {sop.summary ? <p className={`mb-3 max-w-3xl ${secondaryClass}`}>{sop.summary}</p> : null}
      {sop.tags.length ? (
        <ul className="mb-6 flex flex-wrap gap-1.5" aria-label="Tags">
          {sop.tags.map((tag) => (
            <li key={tag}>
              <Link to={`/resources/sops?tag=${encodeURIComponent(tag)}`} className="inline-flex rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink">
                {tag}
              </Link>
            </li>
          ))}
        </ul>
      ) : <div className="mb-6" />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section
            eyebrow={shown && shown.version !== sop.current_version ? `Viewing version ${shown.version}` : "Current version"}
            title="Procedure"
            actions={shown && shown.version !== sop.current_version ? <Button variant="ghost" size="sm" onClick={() => setSelectedVersion(null)}>Back to current</Button> : null}
          >
            {shown ? (
              shown.body_json || shown.body_md?.trim() ? (
                <SopDocument key={shown.id} doc={versionDoc(shown)} initialQuery={params.get("q") ?? ""} />
              ) : (
                <p className="text-sm text-ink-3">This version has no text.</p>
              )
            ) : (
              <p className="text-sm text-ink-3">No content yet.</p>
            )}
          </Section>
        </div>
        <div className="space-y-6">
          {member && sop.status === "published" && standing.data ? (
            <SignoffCard
              sop={sop}
              profileId={profile.id}
              signoffs={standing.data.mine}
              openTasks={standing.data.tasks.filter((t) => t.assignee_id === profile.id && t.completed_at === null)}
              onSigned={(signoff) =>
                standing.setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        mine: [signoff, ...prev.mine],
                        everyone: isAdmin ? [signoff, ...prev.everyone] : prev.everyone,
                        tasks: prev.tasks.map((t) => (t.assignee_id === profile.id && t.completed_at === null && t.assigned_at <= signoff.signed_at ? { ...t, completed_at: signoff.signed_at } : t)),
                      }
                    : prev,
                )
              }
            />
          ) : null}
          {isAdmin && standing.data ? (
            <SopAssignments
              sop={sop}
              canAssign={withTasks}
              people={standing.data.people}
              signoffs={standing.data.everyone}
              tasks={standing.data.tasks}
              viewerId={profile.id}
              onAssigned={(made) => standing.setData((prev) => (prev ? { ...prev, tasks: [...made, ...prev.tasks] } : prev))}
            />
          ) : null}
          {standing.error ? <Notice tone="error">{standing.error}</Notice> : null}
          <Section
            eyebrow="Files"
            title={pluralize(attachments.length, "attachment")}
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
              <p className={metaClass}>No files attached.</p>
            ) : (
              <ul className="divide-y divide-line">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <Button variant="row" onClick={() => void openAttachment(a)} title={a.file_name}>
                      <Paperclip size={14} className="shrink-0 text-ink-3" aria-hidden />
                      <span className="truncate">{a.file_name}</span>
                      <span className={`shrink-0 ${metaClass}`}>{formatBytes(a.size_bytes)}</span>
                    </Button>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton label={`Download ${a.file_name}`} onClick={() => void openAttachment(a)}><Download size={15} aria-hidden /></IconButton>
                      {isAdmin ? (
                        <Button variant="ghost" size="sm" aria-label={`Remove ${a.file_name}`} onClick={() => setRemovingAttachment(a)}>Remove</Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <VersionHistory
            versions={versions}
            currentVersion={sop.current_version}
            shownVersion={selectedVersion}
            canRestore={isAdmin}
            onShow={setSelectedVersion}
            onRestore={handleRestore}
          />
        </div>
      </div>

      {deleting ? (
        <ConfirmDialog title={`Delete "${sop.title}"?`} body="Every version and attachment is deleted with it. Archive instead to keep it out of the way but on record." confirmLabel="Delete SOP" busy={busy} error={deleteError} onConfirm={() => void handleDelete()} onCancel={() => { setDeleting(false); setDeleteError(""); }} />
      ) : null}
      {removingAttachment ? (
        <ConfirmDialog
          title={`Remove "${removingAttachment.file_name}"?`}
          body="The file is deleted from storage as well, so the link in this SOP stops working for everyone."
          confirmLabel="Remove attachment"
          busy={busy}
          error={attachmentError}
          onConfirm={() => void deleteAttachment()}
          onCancel={() => { setRemovingAttachment(null); setAttachmentError(""); }}
        />
      ) : null}
    </>
  );
}
