// Companies tab of the Rococo portfolio: each company's name, theme, logo, and the sign-in
// domains that decide who can self-serve an account. Convenience over RLS, which already
// lets Rococo admins do all of this. Deleting a company also tidies what the database cannot
// reach on its own: the grant each connected provider holds, and the company's stored files.
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
import { disconnectConnection, listConnections } from "../../services/connections.ts";
import { listAllProfiles } from "../../services/profiles.ts";
import { removeCompanyFiles } from "../../services/storage.ts";
import { THEMES, THEME_KEYS } from "../../lib/theme.ts";
import { normalizeDomain } from "../../lib/email.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import type { Company, ThemeKey } from "../../types/database.ts";
import { PORTFOLIO_TABS } from "./portfolioTabs.ts";

// A company already deleted whose stored files did not all go. One entry per company, so a later
// delete never drops an earlier one: nothing else in the app could reach those files again.
type StrandedFiles = { company: Company; reason: string; retrying: boolean };

export default function CompaniesPage() {
  const { refreshCompanies } = useHub();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [newDomain, setNewDomain] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The delete dialog sits over a scrim, so its failure is reported inside it, not on the page.
  const [deleteError, setDeleteError] = useState("");
  // Companies already deleted whose stored files did not all go, kept so each removal can be retried.
  const [strandedFiles, setStrandedFiles] = useState<StrandedFiles[]>([]);

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

  // Stored files are not rows, so nothing cascades to them. They go once the company row is gone,
  // the way an SOP's or a resource's file goes after its row, and a failure is reported with a way
  // to retry rather than swallowed, because no screen would ever show those files again. Each run
  // touches only its own company's entry, so two deletes (or a delete and a retry) never clear
  // each other's notice.
  async function clearFiles(company: Company) {
    const others = (list: StrandedFiles[]) => list.filter((s) => s.company.id !== company.id);
    setStrandedFiles((list) => list.map((s) => (s.company.id === company.id ? { ...s, retrying: true } : s)));
    try {
      await removeCompanyFiles(company.id);
      setStrandedFiles(others);
    } catch (err) {
      const stranded = { company, reason: errorMessage(err), retrying: false };
      setStrandedFiles((list) => (list.some((s) => s.company.id === company.id) ? list.map((s) => (s.company.id === company.id ? stranded : s)) : [...list, stranded]));
    }
  }

  // Modal keeps Tab inside the dialog, but focus can still be put on another company's Delete
  // button under the scrim some other way. While a delete runs that opens nothing, or the running
  // one's failure would be reported under the other company's name.
  function openDelete(company: Company) {
    if (busy) return;
    setDeleteError("");
    setConfirmText("");
    setDeleting(company);
  }

  async function handleDeleteCompany() {
    if (!deleting) return;
    const company = deleting;
    setBusy(true);
    setDeleteError("");
    try {
      // Each connected provider is told to drop its grant first. The connection rows and their
      // tokens cascade away with the company, and after that nothing could ask the provider.
      const connections = await listConnections(company.id);
      for (const connection of connections) {
        if (connection.status !== "not_connected") await disconnectConnection(company.id, connection.provider);
      }
      await deleteCompany(company.id);
    } catch (err) {
      setDeleteError(errorMessage(err));
      setBusy(false);
      return;
    }
    state.setData((prev) => (prev ? { ...prev, companies: prev.companies.filter((c) => c.id !== company.id) } : prev));
    setDeleting(null);
    setConfirmText("");
    setBusy(false);
    await clearFiles(company);
    await run(refreshCompanies);
  }

  // Once the delete has started it cannot be called back (a provider may already be disconnected),
  // so the dialog stays until the outcome is known: Cancel, Escape and the backdrop wait for it.
  function closeDelete() {
    if (busy) return;
    setDeleting(null);
    setConfirmText("");
    setDeleteError("");
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
      {strandedFiles.map(({ company, reason, retrying }) => (
        <Notice key={company.id} tone="error" className="mb-4">
          <p>{company.name} is deleted, but some of its stored files were not removed. {reason}</p>
          <Button variant="secondary" size="sm" className="mt-2" disabled={retrying} aria-label={`Remove the files for ${company.name}`} onClick={() => void clearFiles(company)}>
            {retrying ? "Removing..." : "Remove the files"}
          </Button>
        </Notice>
      ))}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : !state.data ? null : (
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
                actions={<IconButton label={`Delete ${company.name}`} onClick={() => openDelete(company)}><Trash2 size={14} aria-hidden /></IconButton>}
              >
                <div className="grid gap-4 md:grid-cols-12">
                  <div className="md:col-span-4">
                    <label htmlFor={`co-name-${company.id}`} className={labelClass}>Name</label>
                    <BlurInput id={`co-name-${company.id}`} value={company.name} required onSave={(next) => void patchCompany(company, { name: next.trim() })} />
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
                          <IconButton size="sm" label={`Remove ${d.domain}`} onClick={() => void dropDomain(d.domain)}><X size={11} aria-hidden /></IconButton>
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
        <Modal onClose={closeDelete} labelledBy="delete-company-title">
          <div className="p-6">
            <h2 id="delete-company-title" className="font-display text-lg text-heading">Delete {deleting.name}?</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              This deletes everything {deleting.name} holds: review cycles, reviews and scores, goals, pillars and criteria, job roles, deliverable categories, SOPs, resources and their stored files, financial periods, campaigns, invitations and sign-in domains, along with each person's KPIs, compensation, figures, deliverables and ratings there. Any connected accounts are disconnected first.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              The people themselves stay on record, including anyone not signed in yet, listed under No company on the People tab and ready to move. There is no undo. Type <b>{deleting.slug}</b> to confirm.
            </p>
            <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type the identifier to confirm" disabled={busy} className={`${inputClass} mt-4 font-mono`} />
            {deleteError ? <Notice tone="error" className="mt-4">{deleteError}</Notice> : null}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={closeDelete}>Cancel</Button>
              <Button variant="danger-solid" disabled={busy || confirmText !== deleting.slug} onClick={() => void handleDeleteCompany()}>{busy ? "Deleting..." : "Delete company"}</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
