// Companies tab of the Rococo portfolio: each company's name, theme, logo, and the sign-in
// domains that decide who can self-serve an account. Convenience over RLS, which already
// lets Rococo admins do all of this.
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import Badge from "../../components/ui/Badge.tsx";
import BlurInput from "../../components/ui/BlurInput.tsx";
import Button from "../../components/ui/Button.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import Modal from "../../components/ui/Modal.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { inputClass, labelClass, selectClass } from "../../components/ui/forms.ts";
import NewCompanyDialog from "../../components/rococo/NewCompanyDialog.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { addCompanyDomain, deleteCompany, listAllDomains, listCompanies, removeCompanyDomain, updateCompany } from "../../services/companies.ts";
import { listAllProfiles } from "../../services/profiles.ts";
import { THEMES, THEME_KEYS } from "../../lib/theme.ts";
import { normalizeDomain } from "../../lib/email.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import type { Company, ThemeKey } from "../../types/database.ts";
import { PORTFOLIO_TABS } from "./PortfolioPage.tsx";

export default function CompaniesPage() {
  const { refreshCompanies } = useHub();
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
      state.setData((prev) => (prev ? { ...prev, companies: prev.companies.filter((c) => c.id !== deleting.id) } : prev));
      setDeleting(null);
      setConfirmText("");
      await refreshCompanies();
    });
    setBusy(false);
  }

  const companies = state.data?.companies ?? [];
  const domains = state.data?.domains ?? [];
  const profiles = state.data?.profiles ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Rococo Creative"
        title="Companies"
        description="Name, theme, logo, and the sign-in domains that decide who can create an account without an invitation."
        actions={<Button size="sm" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> New company</Button>}
      />
      <Tabs items={PORTFOLIO_TABS} />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="space-y-4">
          {companies.map((company) => {
            const ownDomains = domains.filter((d) => d.company_id === company.id);
            const members = profiles.filter((p) => p.company_id === company.id);
            return (
              <Section
                key={company.id}
                eyebrow={company.slug}
                title={company.name}
                description={pluralize(members.length, "person", "people")}
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
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void addDomain(company);
                        }}
                        className="flex items-center gap-1.5"
                      >
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
      )}

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
              This deletes every review, goal, SOP, resource, financial period, campaign, and invitation for {deleting.name}. Its people stay as accounts with no company. There is no undo. Type <b>{deleting.slug}</b> to confirm.
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
