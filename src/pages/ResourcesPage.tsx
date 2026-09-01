// The resource library: links, files, templates, videos, documents, found by search and
// tags. Everyone browses; admins add, edit, and remove.
import { useMemo, useState, type FormEvent } from "react";
import { ExternalLink, FileText, Link2, Pencil, Plus, Search, Trash2, Video } from "lucide-react";
import Badge from "../components/ui/Badge.tsx";
import Button from "../components/ui/Button.tsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.tsx";
import EmptyState from "../components/ui/EmptyState.tsx";
import Field from "../components/ui/Field.tsx";
import IconButton from "../components/ui/IconButton.tsx";
import Modal from "../components/ui/Modal.tsx";
import Notice from "../components/ui/Notice.tsx";
import PageHeader from "../components/ui/PageHeader.tsx";
import { SkeletonCard } from "../components/ui/Skeleton.tsx";
import { inputClass, selectClass, textareaClass } from "../components/ui/forms.ts";
import { useHub } from "../context/HubContext.tsx";
import { useAsync } from "../hooks/useAsync.ts";
import { createResource, deleteResource, listResources, parseTags, updateResource } from "../services/resources.ts";
import { buildObjectPath, getSignedUrl, removeFile, uploadFile } from "../services/storage.ts";
import { errorMessage } from "../lib/errors.ts";
import { RESOURCE_KIND_LABELS, keysOf, type Resource, type ResourceKind } from "../types/database.ts";

function KindIcon({ kind }: { kind: ResourceKind }) {
  const Icon = kind === "video" ? Video : kind === "link" ? Link2 : FileText;
  return <Icon size={15} className="text-accent" aria-hidden />;
}

function ResourceDialog({ companyId, resource, onClose, onSaved }: { companyId: string; resource: Resource | null; onClose: () => void; onSaved: (r: Resource) => void }) {
  const [title, setTitle] = useState(resource?.title ?? "");
  const [kind, setKind] = useState<ResourceKind>(resource?.kind ?? "link");
  const [description, setDescription] = useState(resource?.description ?? "");
  const [url, setUrl] = useState(resource?.url ?? "");
  const [tags, setTags] = useState(resource?.tags.join(", ") ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wantsFile = kind === "file" || kind === "template" || kind === "doc";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Give it a title.");
    const hasUrl = url.trim().length > 0;
    if (!hasUrl && !file && !resource?.file_path) return setError(wantsFile ? "Choose a file or paste a link." : "Paste the link.");
    setBusy(true);
    setError("");
    try {
      let file_path = resource?.file_path ?? null;
      let file_name = resource?.file_name ?? null;
      if (file) {
        const path = buildObjectPath(companyId, "resources", null, file.name);
        await uploadFile(path, file);
        if (resource?.file_path) await removeFile(resource.file_path).catch(() => undefined);
        file_path = path;
        file_name = file.name;
      }
      const payload = { title: title.trim(), kind, description: description.trim() || null, url: hasUrl ? url.trim() : null, file_path, file_name, tags: parseTags(tags) };
      onSaved(resource ? await updateResource(resource.id, payload) : await createResource({ company_id: companyId, ...payload }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="resource-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="resource-title" className="font-display text-lg text-heading">{resource ? "Edit resource" : "Add resource"}</h2>
        <div className="mt-5 space-y-4">
          <Field label="Title" htmlFor="res-title">
            <input id="res-title" type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Kind" htmlFor="res-kind">
            <select id="res-kind" value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)} className={selectClass}>
              {keysOf(RESOURCE_KIND_LABELS).map((k) => (
                <option key={k} value={k}>{RESOURCE_KIND_LABELS[k]}</option>
              ))}
            </select>
          </Field>
          <Field label={wantsFile ? "Link (optional if you upload a file)" : "Link"} htmlFor="res-url">
            <input id="res-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={inputClass} />
          </Field>
          {wantsFile ? (
            <Field label="File" htmlFor="res-file" hint={resource?.file_name ? `Current: ${resource.file_name}. Choosing a new file replaces it.` : "Up to 50 MB."}>
              <input id="res-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-[12px] file:text-ink`} />
            </Field>
          ) : null}
          <Field label="Description (optional)" htmlFor="res-description">
            <textarea id="res-description" value={description} onChange={(e) => setDescription(e.target.value)} className={`${textareaClass} min-h-[64px]`} rows={2} />
          </Field>
          <Field label="Tags" htmlFor="res-tags" hint="Comma separated. Tags power the filter chips.">
            <input id="res-tags" type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="onboarding, safety, forms" className={inputClass} />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : resource ? "Save" : "Add resource"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ResourcesPage() {
  const { company, isAdmin } = useHub();
  const companyId = company!.id;
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ resource: Resource | null } | null>(null);
  const [deleting, setDeleting] = useState<Resource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = useAsync(() => listResources(companyId), [companyId]);

  const resources = state.data ?? [];
  const allTags = useMemo(() => [...new Set(resources.flatMap((r) => r.tags))].sort(), [resources]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources.filter((r) => {
      if (tag && !r.tags.includes(tag)) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q) || r.tags.some((t) => t.includes(q));
    });
  }, [resources, query, tag]);

  async function open(resource: Resource) {
    setError("");
    try {
      if (resource.url) {
        window.open(resource.url, "_blank", "noopener");
      } else if (resource.file_path) {
        window.open(await getSignedUrl(resource.file_path), "_blank", "noopener");
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteResource(deleting.id);
      if (deleting.file_path) await removeFile(deleting.file_path).catch(() => undefined);
      state.setData((prev) => (prev ? prev.filter((r) => r.id !== deleting.id) : prev));
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={company!.name}
        title="Resources"
        description="Links, files, templates, and videos the team reaches for. Tag things so they stay findable."
        actions={isAdmin ? <Button size="sm" onClick={() => setDialog({ resource: null })}><Plus size={14} aria-hidden /> Add resource</Button> : null}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search resources" aria-label="Search resources" className={`${inputClass} mt-0 pl-8`} />
        </div>
        {allTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setTag(null)} className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-150 ${tag === null ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}>All</button>
            {allTags.map((t) => (
              <button key={t} type="button" onClick={() => setTag(tag === t ? null : t)} className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-150 ${tag === t ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}>{t}</button>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {!state.data && !state.error ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          eyebrow="Resources"
          title={resources.length > 0 ? "Nothing matches" : "No resources yet"}
          body={resources.length > 0 ? "Try another search or tag." : isAdmin ? "Add the links, templates, and files people keep asking for." : "Your admins have not added any resources yet."}
          action={isAdmin && resources.length === 0 ? <Button onClick={() => setDialog({ resource: null })}>Add resource</Button> : undefined}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((resource) => (
            <li key={resource.id} className="flex flex-col rounded-lg border border-line bg-surface p-4 transition-colors duration-150 hover:border-line-strong">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KindIcon kind={resource.kind} />
                  <Badge>{RESOURCE_KIND_LABELS[resource.kind]}</Badge>
                </div>
                {isAdmin ? (
                  <div className="flex items-center">
                    <IconButton label="Edit resource" onClick={() => setDialog({ resource })}><Pencil size={13} aria-hidden /></IconButton>
                    <IconButton label="Delete resource" onClick={() => setDeleting(resource)}><Trash2 size={13} aria-hidden /></IconButton>
                  </div>
                ) : null}
              </div>
              <button type="button" onClick={() => void open(resource)} className="mt-3 text-left">
                <span className="block text-sm font-medium text-ink hover:text-accent">{resource.title}</span>
              </button>
              {resource.description ? <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-ink-2">{resource.description}</p> : null}
              {resource.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {resource.tags.map((t) => (
                    <button key={t} type="button" aria-label={`Filter by tag ${t}`} onClick={() => setTag(t)} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink">{t}</button>
                  ))}
                </div>
              ) : null}
              <div className="mt-auto pt-3">
                <Button variant="secondary" size="sm" onClick={() => void open(resource)}>
                  <ExternalLink size={13} aria-hidden /> {resource.url ? "Open" : "Download"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog ? (
        <ResourceDialog
          companyId={companyId}
          resource={dialog.resource}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            state.setData((prev) => {
              const list = prev ?? [];
              return list.some((r) => r.id === saved.id) ? list.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...list];
            });
            setDialog(null);
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog title={`Delete "${deleting.title}"?`} body={deleting.file_path ? "The file is removed from storage as well." : "The link is removed from the library."} confirmLabel="Delete resource" busy={busy} onConfirm={() => void handleDelete()} onCancel={() => setDeleting(null)} />
      ) : null}
    </>
  );
}
