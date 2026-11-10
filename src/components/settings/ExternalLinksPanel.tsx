// The company's links to its own outside tools, for an admin in Company Settings: what each link
// is called, where it goes, the section it shows in, who sees it, and whether it is a public share
// view that may be embedded. Links are rows the company keeps (rule 12). The checks here only save
// a round trip with a plain message; the database checks are the real guard, and who sees a link
// is enforced by RLS on its audience, never by a screen. Every change saves on its own.
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import Field from "../ui/Field.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { checkboxClass, helpClass, inputClass, labelClass, selectClass } from "../ui/forms.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import { NAV_GROUP_LABELS } from "../../lib/navigation.ts";
import { createExternalLink, deleteExternalLink, listExternalLinks, updateExternalLink, type ExternalLinkPatch } from "../../services/externalLinks.ts";
import { LINK_AUDIENCE_LABELS, LINK_PROVIDER_LABELS, keysOf, type ExternalLink, type LinkAudience, type LinkNavGroup, type LinkProvider } from "../../types/database.ts";

const LINK_GROUPS: readonly LinkNavGroup[] = ["home", "sales_finance", "production", "people_hr"];
const HTTPS_ONLY = "Links must start with https://.";
const NEEDS_LABEL = "The link needs a label.";
const NEEDS_EMBED = "Add the share view's embed link first.";
const cellInput = `${inputClass} mt-1 py-1.5 text-[13px]`;
const cellSelect = `${selectClass} mt-1 py-1.5 text-[13px]`;

function isHttps(url: string): boolean {
  return /^https:\/\//.test(url.trim());
}

function byOrder(a: ExternalLink, b: ExternalLink): number {
  return a.sort_order - b.sort_order || a.label.localeCompare(b.label);
}

// A small caption over a control whose accessible name comes from its own aria-label.
function Caption({ children }: { children: string }) {
  return <span className={labelClass} aria-hidden>{children}</span>;
}

function LinkRow({
  link,
  onSaved,
  onError,
  onRemove,
}: {
  link: ExternalLink;
  onSaved: (link: ExternalLink) => void;
  onError: (message: string) => void;
  onRemove: () => void;
}) {
  async function save(patch: ExternalLinkPatch) {
    try {
      onSaved(await updateExternalLink(link.id, patch));
      onError("");
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  function saveUrl(next: string) {
    if (!isHttps(next)) return onError(HTTPS_ONLY);
    void save({ url: next.trim() });
  }

  function saveEmbedUrl(next: string) {
    const value = next.trim();
    if (!value) return void save({ embed_url: null, embed_is_public: false });
    if (!isHttps(value)) return onError(HTTPS_ONLY);
    void save({ embed_url: value });
  }

  function saveOrder(next: string) {
    const value = Number.parseInt(next, 10);
    if (Number.isFinite(value)) void save({ sort_order: value });
  }

  function toggleEmbed(on: boolean) {
    if (on && !link.embed_url) return onError(NEEDS_EMBED);
    void save({ embed_is_public: on });
  }

  const noEmbed = !link.embed_url;
  return (
    <li className="rounded-md border border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Caption>Label</Caption>
          <BlurInput value={link.label} required ariaLabel={`Label for ${link.label}`} onSave={(next) => void save({ label: next.trim() })} className={`${cellInput} font-medium`} />
        </label>
        <label className="block">
          <Caption>Link</Caption>
          <BlurInput value={link.url} required ariaLabel={`Link for ${link.label}`} onSave={saveUrl} className={cellInput} />
        </label>
        <label className="block">
          <Caption>What it is for</Caption>
          <BlurInput value={link.destination_note ?? ""} ariaLabel={`What ${link.label} is for`} onSave={(next) => void save({ destination_note: next.trim() || null })} className={cellInput} />
        </label>
        <label className="block">
          <Caption>Embed link</Caption>
          <BlurInput value={link.embed_url ?? ""} placeholder="https://" ariaLabel={`Embed link for ${link.label}`} onSave={saveEmbedUrl} className={cellInput} />
        </label>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block">
          <Caption>Section</Caption>
          <select value={link.nav_group} aria-label={`Section for ${link.label}`} onChange={(e) => void save({ nav_group: e.target.value as LinkNavGroup })} className={cellSelect}>
            {LINK_GROUPS.map((group) => <option key={group} value={group}>{NAV_GROUP_LABELS[group]}</option>)}
          </select>
        </label>
        <label className="block">
          <Caption>Who sees it</Caption>
          <select value={link.audience} aria-label={`Who sees ${link.label}`} onChange={(e) => void save({ audience: e.target.value as LinkAudience })} className={cellSelect}>
            {keysOf(LINK_AUDIENCE_LABELS).map((audience) => <option key={audience} value={audience}>{LINK_AUDIENCE_LABELS[audience]}</option>)}
          </select>
        </label>
        <label className="block">
          <Caption>Tool</Caption>
          <select value={link.provider} aria-label={`Tool for ${link.label}`} onChange={(e) => void save({ provider: e.target.value as LinkProvider })} className={cellSelect}>
            {keysOf(LINK_PROVIDER_LABELS).map((provider) => <option key={provider} value={provider}>{LINK_PROVIDER_LABELS[provider]}</option>)}
          </select>
        </label>
        <label className="block">
          <Caption>Order</Caption>
          <BlurInput type="number" value={String(link.sort_order)} required ariaLabel={`Order for ${link.label}`} onSave={saveOrder} className={`${cellInput} tnum`} />
        </label>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          {/* aria-disabled rather than disabled, so a click explains why instead of doing nothing. */}
          <label className={`flex items-center gap-2 text-[13px] text-ink ${noEmbed ? "opacity-60" : ""}`}>
            <input
              type="checkbox"
              className={checkboxClass}
              checked={link.embed_is_public}
              aria-disabled={noEmbed}
              aria-label={`Show as a public embed for ${link.label}`}
              onChange={(e) => toggleEmbed(e.target.checked)}
            />
            <span>Show as a public embed</span>
          </label>
          <p className={`${helpClass} mt-1`}>Only for a view the board owner has shared publicly. Anyone with that link can see what it shows, including data hidden from the view.</p>
        </div>
        <IconButton label={`Remove ${link.label}`} onClick={onRemove}>
          <Trash2 size={14} aria-hidden />
        </IconButton>
      </div>
    </li>
  );
}

function AddLinkForm({ onAdd }: { onAdd: (draft: { label: string; url: string; nav_group: LinkNavGroup; audience: LinkAudience; provider: LinkProvider }) => Promise<boolean> }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [navGroup, setNavGroup] = useState<LinkNavGroup>("home");
  const [audience, setAudience] = useState<LinkAudience>("everyone");
  const [provider, setProvider] = useState<LinkProvider>("other");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const added = await onAdd({ label, url, nav_group: navGroup, audience, provider });
    setBusy(false);
    if (added) {
      setLabel("");
      setUrl("");
    }
  }

  return (
    <form onSubmit={submit} aria-label="Add a link" className="mt-4 border-t border-line pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label" htmlFor="new-link-label">
          <input id="new-link-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={cellInput} />
        </Field>
        <Field label="Link" htmlFor="new-link-url">
          <input id="new-link-url" type="text" inputMode="url" value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} className={cellInput} />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
        <Field label="Section" htmlFor="new-link-section">
          <select id="new-link-section" value={navGroup} onChange={(e) => setNavGroup(e.target.value as LinkNavGroup)} className={cellSelect}>
            {LINK_GROUPS.map((group) => <option key={group} value={group}>{NAV_GROUP_LABELS[group]}</option>)}
          </select>
        </Field>
        <Field label="Who sees it" htmlFor="new-link-audience">
          <select id="new-link-audience" value={audience} onChange={(e) => setAudience(e.target.value as LinkAudience)} className={cellSelect}>
            {keysOf(LINK_AUDIENCE_LABELS).map((a) => <option key={a} value={a}>{LINK_AUDIENCE_LABELS[a]}</option>)}
          </select>
        </Field>
        <Field label="Tool" htmlFor="new-link-provider">
          <select id="new-link-provider" value={provider} onChange={(e) => setProvider(e.target.value as LinkProvider)} className={cellSelect}>
            {keysOf(LINK_PROVIDER_LABELS).map((p) => <option key={p} value={p}>{LINK_PROVIDER_LABELS[p]}</option>)}
          </select>
        </Field>
        <Button type="submit" variant="secondary" disabled={busy}>
          <Plus size={14} aria-hidden /> Add link
        </Button>
      </div>
    </form>
  );
}

export default function ExternalLinksPanel({ companyId }: { companyId: string }) {
  const state = useAsync(() => listExternalLinks(companyId), [companyId]);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<ExternalLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const links = state.data ?? [];

  async function add(draft: { label: string; url: string; nav_group: LinkNavGroup; audience: LinkAudience; provider: LinkProvider }): Promise<boolean> {
    const label = draft.label.trim();
    const problem = !label ? NEEDS_LABEL : !isHttps(draft.url) ? HTTPS_ONLY : "";
    if (problem) {
      setError(problem);
      return false;
    }
    const highest = Math.max(0, ...links.filter((l) => l.nav_group === draft.nav_group).map((l) => l.sort_order));
    try {
      const created = await createExternalLink({ company_id: companyId, ...draft, label, url: draft.url.trim(), sort_order: highest + 1 });
      state.setData((prev) => (prev ? [...prev, created] : [created]));
      setError("");
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setDialogError("");
    try {
      const id = removing.id;
      await deleteExternalLink(id);
      state.setData((prev) => (prev ? prev.filter((l) => l.id !== id) : prev));
      setRemoving(null);
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const groups = LINK_GROUPS.map((group) => ({ group, links: links.filter((l) => l.nav_group === group).sort(byOrder) })).filter((g) => g.links.length > 0);

  return (
    <Section
      eyebrow="Shortcuts"
      title="External links"
      description="Links to the company's own outside tools, such as Monday boards, shown in the section you choose. People still sign in to those tools themselves."
    >
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={3} /> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.data ? (
        <>
          {groups.length === 0 ? (
            <p className="text-sm text-ink-2">No links yet. Add one below and choose the section it shows in.</p>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.group}>
                  <p className="eyebrow">{NAV_GROUP_LABELS[g.group]}</p>
                  <ul className="mt-2 space-y-2">
                    {g.links.map((link) => (
                      <LinkRow
                        key={link.id}
                        link={link}
                        onSaved={(next) => state.setData((prev) => (prev ? prev.map((l) => (l.id === next.id ? next : l)) : prev))}
                        onError={setError}
                        onRemove={() => {
                          setDialogError("");
                          setRemoving(link);
                        }}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <AddLinkForm onAdd={add} />
        </>
      ) : null}
      {removing ? (
        <ConfirmDialog
          title="Remove this link?"
          body="People will no longer see it in the hub. The page it points to is not affected."
          confirmLabel="Remove"
          tone="danger"
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </Section>
  );
}
