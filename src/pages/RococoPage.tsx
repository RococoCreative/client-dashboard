// Rococo admin (god mode): every company, its theme and sign-in domains, and every user
// across companies. Convenience over RLS, which already lets Rococo admins do all of this.
import { useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import Badge from "../components/ui/Badge.tsx";
import BlurInput from "../components/ui/BlurInput.tsx";
import Button from "../components/ui/Button.tsx";
import Field from "../components/ui/Field.tsx";
import IconButton from "../components/ui/IconButton.tsx";
import Modal from "../components/ui/Modal.tsx";
import Notice from "../components/ui/Notice.tsx";
import PageHeader from "../components/ui/PageHeader.tsx";
import Section from "../components/ui/Section.tsx";
import { SkeletonRows } from "../components/ui/Skeleton.tsx";
import { checkboxClass, inputClass, labelClass, selectClass, tableClass, tdClass, thClass } from "../components/ui/forms.ts";
import { useHub } from "../context/HubContext.tsx";
import { useAsync } from "../hooks/useAsync.ts";
import { addCompanyDomain, createCompany, deleteCompany, listAllDomains, listCompanies, removeCompanyDomain, updateCompany } from "../services/companies.ts";
import { listAllProfiles, updateProfile } from "../services/profiles.ts";
import { THEMES, THEME_KEYS } from "../lib/theme.ts";
import { normalizeDomain } from "../lib/email.ts";
import { errorMessage } from "../lib/errors.ts";
import { displayName } from "../lib/format.ts";
import { ROLE_LABELS, keysOf, type Company, type Profile, type Role, type ThemeKey } from "../types/database.ts";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function NewCompanyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Company) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [theme, setTheme] = useState<ThemeKey>("rococo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Name the company.");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return setError("The identifier can only use lowercase letters, numbers, and hyphens.");
    setBusy(true);
    setError("");
    try {
      onCreated(await createCompany({ name: name.trim(), slug, theme_key: theme }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="new-company-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="new-company-title" className="font-display text-lg text-heading">New company</h2>
        <div className="mt-5 space-y-4">
          <Field label="Name" htmlFor="nc-name">
            <input id="nc-name" type="text" value={name} autoFocus onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} className={inputClass} />
          </Field>
          <Field label="Identifier" htmlFor="nc-slug" hint="Short, lowercase, permanent.">
            <input id="nc-slug" type="text" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} className={`${inputClass} font-mono`} />
          </Field>
          <Field label="Theme" htmlFor="nc-theme">
            <select id="nc-theme" value={theme} onChange={(e) => setTheme(e.target.value as ThemeKey)} className={selectClass}>
              {THEME_KEYS.map((k) => (
                <option key={k} value={k}>{THEMES[k].label}</option>
              ))}
            </select>
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Creating..." : "Create company"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function RococoPage() {
  const { profile: me, refreshCompanies } = useHub();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [newDomain, setNewDomain] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const state = useAsync(async () => {
    const [companies, domains, profiles] = await Promise.all([listCompanies(), listAllDomains(), listAllProfiles()]);
    return { companies, domains, profiles };
  }, []);

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;
  const { companies, domains, profiles } = state.data;

  async function patchCompany(company: Company, patch: Parameters<typeof updateCompany>[1]) {
    await run(async () => {
      const next = await updateCompany(company.id, patch);
      state.setData((prev) => (prev ? { ...prev, companies: prev.companies.map((c) => (c.id === next.id ? next : c)) } : prev));
      await refreshCompanies();
    });
  }

  async function addDomain(company: Company) {
    const domain = normalizeDomain(newDomain[company.id] ?? "");
    if (!domain) return setError("Enter a domain like company.com.");
    await run(async () => {
      const created = await addCompanyDomain(company.id, domain);
      state.setData((prev) => (prev ? { ...prev, domains: [...prev.domains, created] } : prev));
      setNewDomain((prev) => ({ ...prev, [company.id]: "" }));
    });
  }

  async function dropDomain(domain: string) {
    await run(async () => {
      await removeCompanyDomain(domain);
      state.setData((prev) => (prev ? { ...prev, domains: prev.domains.filter((d) => d.domain !== domain) } : prev));
    });
  }

  async function handleDeleteCompany() {
    if (!deleting) return;
    setBusy(true);
    await run(async () => {
      await deleteCompany(deleting.id);
      state.setData((prev) => (prev ? { ...prev, companies: prev.companies.filter((c) => c.id !== deleting.id), profiles: prev.profiles.map((p) => (p.company_id === deleting.id ? { ...p, company_id: null } : p)) } : prev));
      setDeleting(null);
      setConfirmText("");
      await refreshCompanies();
    });
    setBusy(false);
  }

  async function patchProfile(person: Profile, patch: Parameters<typeof updateProfile>[1]) {
    await run(async () => {
      const next = await updateProfile(person.id, patch);
      state.setData((prev) => (prev ? { ...prev, profiles: prev.profiles.map((p) => (p.id === next.id ? next : p)) } : prev));
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Rococo Creative"
        title="Rococo admin"
        description="Every company in the hub, who belongs where, and the themes and sign-in domains that decide how people get in."
        actions={<Button size="sm" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> New company</Button>}
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}

      <div className="space-y-4">
        {companies.map((company) => {
          const ownDomains = domains.filter((d) => d.company_id === company.id);
          const members = profiles.filter((p) => p.company_id === company.id);
          return (
            <Section
              key={company.id}
              eyebrow={company.slug}
              title={company.name}
              description={`${members.length} ${members.length === 1 ? "person" : "people"}`}
              actions={<IconButton label={`Delete ${company.name}`} onClick={() => setDeleting(company)}><Trash2 size={14} aria-hidden /></IconButton>}
            >
              <div className="grid gap-4 md:grid-cols-12">
                <div className="md:col-span-4">
                  <label htmlFor={`co-name-${company.id}`} className={labelClass}>Name</label>
                  <BlurInput id={`co-name-${company.id}`} value={company.name} onSave={(next) => next.trim() && void patchCompany(company, { name: next.trim() })} />
                </div>
                <div className="md:col-span-3">
                  <label htmlFor={`co-theme-${company.id}`} className={labelClass}>Theme</label>
                  <select id={`co-theme-${company.id}`} value={company.theme_key} onChange={(e) => void patchCompany(company, { theme_key: e.target.value as ThemeKey })} className={selectClass}>
                    {THEME_KEYS.map((k) => (
                      <option key={k} value={k}>{THEMES[k].label}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-5">
                  <label htmlFor={`co-logo-${company.id}`} className={labelClass}>Logo URL</label>
                  <BlurInput id={`co-logo-${company.id}`} value={company.logo_url ?? ""} placeholder="https://" onSave={(next) => void patchCompany(company, { logo_url: next.trim() || null })} />
                </div>
                <div className="md:col-span-12">
                  <p className={labelClass}>Sign-in domains</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {ownDomains.map((d) => (
                      <Badge key={d.domain} tone="accent" className="pr-1">
                        {d.domain}
                        <button type="button" aria-label={`Remove ${d.domain}`} onClick={() => void dropDomain(d.domain)} className="ml-0.5 rounded-full p-0.5 hover:bg-accent/20"><X size={11} aria-hidden /></button>
                      </Badge>
                    ))}
                    <form onSubmit={(e) => { e.preventDefault(); void addDomain(company); }} className="flex items-center gap-1.5">
                      <input type="text" value={newDomain[company.id] ?? ""} onChange={(e) => setNewDomain((prev) => ({ ...prev, [company.id]: e.target.value }))} placeholder="company.com" aria-label={`Add domain for ${company.name}`} className={`${inputClass} mt-0 w-48 py-1 text-[12.5px]`} />
                      <Button type="submit" variant="secondary" size="sm" disabled={!(newDomain[company.id] ?? "").trim()}><Plus size={12} aria-hidden /> Add</Button>
                    </form>
                  </div>
                  <p className="mt-1.5 text-[12px] text-ink-3">Anyone with an email on these domains can create an account without an invitation.</p>
                </div>
              </div>
            </Section>
          );
        })}
        {companies.length === 0 ? <Notice tone="info">No companies yet. Create the first one.</Notice> : null}
      </div>

      <Section className="mt-8" eyebrow="Everyone" title={`${profiles.length} users`} padded={false}>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thClass}>User</th>
                <th className={thClass}>Company</th>
                <th className={thClass}>Role</th>
                <th className={thClass}>Rococo</th>
                <th className={thClass}>Active</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((person) => {
                const self = person.id === me.id;
                return (
                  <tr key={person.id} className={`hover:bg-surface-2/60 ${person.is_active ? "" : "opacity-60"}`}>
                    <td className={tdClass}>
                      <p className="text-sm text-ink">{displayName(person)}{self ? " (you)" : ""}</p>
                      <p className="text-[12px] text-ink-3">{person.email}{person.title ? ` · ${person.title}` : ""}</p>
                    </td>
                    <td className={tdClass}>
                      <select value={person.company_id ?? ""} aria-label={`Company for ${person.email}`} onChange={(e) => void patchProfile(person, { company_id: e.target.value || null })} className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}>
                        <option value="">No company</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className={tdClass}>
                      <select value={person.role} aria-label={`Role for ${person.email}`} onChange={(e) => void patchProfile(person, { role: e.target.value as Role })} className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}>
                        {keysOf(ROLE_LABELS).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className={tdClass}>
                      <input type="checkbox" checked={person.is_rococo_admin} disabled={self} aria-label={`Rococo admin: ${person.email}`} onChange={(e) => void patchProfile(person, { is_rococo_admin: e.target.checked })} className={checkboxClass} />
                    </td>
                    <td className={tdClass}>
                      <input type="checkbox" checked={person.is_active} disabled={self} aria-label={`Active: ${person.email}`} onChange={(e) => void patchProfile(person, { is_active: e.target.checked })} className={checkboxClass} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {creating ? (
        <NewCompanyDialog
          onClose={() => setCreating(false)}
          onCreated={(company) => {
            state.setData((prev) => (prev ? { ...prev, companies: [...prev.companies, company].sort((a, b) => a.name.localeCompare(b.name)) } : prev));
            setCreating(false);
            void refreshCompanies();
          }}
        />
      ) : null}
      {deleting ? (
        <Modal onClose={() => { setDeleting(null); setConfirmText(""); }} labelledBy="delete-company-title">
          <div className="p-6">
            <h2 id="delete-company-title" className="font-display text-lg text-heading">Delete {deleting.name}?</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              This deletes every review, goal, SOP, resource, and invitation for {deleting.name}. Its people stay as accounts with no company. There is no undo. Type <b>{deleting.slug}</b> to confirm.
            </p>
            <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type the identifier to confirm" className={`${inputClass} mt-4 font-mono`} />
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setDeleting(null); setConfirmText(""); }}>Cancel</Button>
              <Button variant="danger-solid" disabled={busy || confirmText !== deleting.slug} onClick={() => void handleDeleteCompany()}>{busy ? "Deleting..." : "Delete company"}</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
