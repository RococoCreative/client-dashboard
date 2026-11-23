// Settings, for a company admin: one page, one tab per area, each tab its own route.
//   Company: name, logo and time zone, plus the theme and sign-in domains, which Rococo manages
//     (they decide who can sign in), so they read only here.
//   Connections: the catalog of outside tools, each card showing the company's own connection,
//     links or request for it, and, with the module, its data sources, which past three each have
//     an address under /settings/connections/sources.
//   Activity: this company's own change log, for whoever the company lets read it.
// Company and Activity show only to people the company's permissions allow. Below the tabs, a
// signpost card lists where the rest of setup moved, so it shows whichever tab an admin lands on.
// What shows is the company's data and modules (rule 12), never its name.
import { useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import Button from "../../components/ui/Button.tsx";
import Field from "../../components/ui/Field.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import ConnectionsCatalog from "../../components/settings/ConnectionsCatalog.tsx";
import DataSourcesPanel from "../../components/settings/DataSourcesPanel.tsx";
import { inputClass } from "../../components/ui/forms.ts";
import { bodyClass, eyebrowLabelClass, secondaryClass } from "../../components/ui/type.ts";
import MovedCard from "../../components/settings/MovedCard.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCompanyDomains, updateCompany } from "../../services/companies.ts";
import { THEMES } from "../../lib/theme.ts";
import { hasModule } from "../../lib/modules.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { Company } from "../../types/database.ts";
import ActivityList from "../../components/audit/ActivityList.tsx";
import { settingsTabsFor, type SettingsTab } from "./settingsTabs.ts";

// The named zones the browser knows, offered as suggestions; the database has the final say.
function timeZones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
}

const DESCRIPTIONS: Record<SettingsTab, string> = {
  company: "How the company appears in the hub and who can sign in.",
  connections: "The company's own accounts in outside systems, and the sources the hub reads from them.",
  activity: "Changes to roles, access and settings for this company.",
};

// A value as it reads before anyone edits it: its label, then the value.
function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className={eyebrowLabelClass}>{label}</dt>
      <dd className={`mt-1 ${bodyClass} [overflow-wrap:anywhere]`}>{children}</dd>
    </div>
  );
}

function CompanyTab({ company }: { company: Company }) {
  const { refreshCompanies, isRococo } = useHub();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(company.name);
  const [logoUrl, setLogoUrl] = useState(company.logo_url ?? "");
  const [timeZone, setTimeZone] = useState(company.time_zone);
  const [zones] = useState(timeZones);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const domains = useAsync(() => listCompanyDomains(company.id), [company.id]);
  const ownDomains = domains.data ?? [];

  // Edit starts from what is saved. Cancel is the only way a draft is dropped, and it is a choice.
  function startEditing() {
    setName(company.name);
    setLogoUrl(company.logo_url ?? "");
    setTimeZone(company.time_zone);
    setError("");
    setSaved(false);
    setEditing(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("The company needs a name.");
    if (!timeZone.trim()) return setError("Choose a time zone.");
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const zone = timeZone.trim();
      await updateCompany(company.id, { name: name.trim(), logo_url: logoUrl.trim() || null, ...(zone !== company.time_zone ? { time_zone: zone } : {}) });
      await refreshCompanies();
      setSaved(true);
      setEditing(false);
    } catch (err) {
      // A failed save stays in the form with the draft intact, so it never reads as done.
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const theme = THEMES[company.theme_key];

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      {editing ? (
        <form onSubmit={handleSubmit} className="lg:col-span-2">
          <Section
            eyebrow="Identity"
            title="Company"
            actions={
              <>
                <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Cancel</Button>
                <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
              </>
            }
          >
            <div className="space-y-4">
              <Field label="Name" htmlFor="company-name">
                <input id="company-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Logo URL" htmlFor="company-logo" hint="A hosted PNG or SVG with a transparent background. Shown in the sidebar and on the sign-in screen.">
                <input id="company-logo" type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://" className={inputClass} />
              </Field>
              {logoUrl.trim() ? <img src={logoUrl.trim()} alt="Logo preview" className="h-10 w-auto max-w-[220px] rounded bg-surface-2 p-1 object-contain" /> : null}
              <Field label="Time zone" htmlFor="company-time-zone" hint="Used for due dates on repeating tasks.">
                <input id="company-time-zone" type="text" list="company-time-zones" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="America/New_York" autoComplete="off" spellCheck={false} className={inputClass} />
                <datalist id="company-time-zones">
                  {zones.map((zone) => <option key={zone} value={zone} />)}
                </datalist>
              </Field>
              {error ? <Notice tone="error">{error}</Notice> : null}
            </div>
          </Section>
        </form>
      ) : (
        <Section eyebrow="Identity" title="Company" actions={<Button type="button" variant="secondary" size="sm" onClick={startEditing}>Edit</Button>} className="lg:col-span-2">
          <dl className="space-y-4">
            <Value label="Name">{company.name}</Value>
            <Value label="Logo">
              {company.logo_url ? <img src={company.logo_url} alt={`${company.name} logo`} className="h-10 w-auto max-w-[220px] rounded bg-surface-2 p-1 object-contain" /> : <span className="text-ink-3">No logo yet.</span>}
            </Value>
            <Value label="Time zone">
              {company.time_zone}
              <span className={`block ${secondaryClass}`}>Used for due dates on repeating tasks.</span>
            </Value>
          </dl>
          {saved ? <div className="mt-4"><Notice tone="success">Saved.</Notice></div> : null}
        </Section>
      )}
      <Section eyebrow="Managed by Rococo" title="Theme and sign-in">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-label text-ink-3">Theme</dt>
            <dd className="mt-0.5 text-ink">{theme.label} <span className="text-ink-3">({theme.mode})</span></dd>
            <dd className="text-[12px] text-ink-2">{theme.description}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-label text-ink-3">Sign-in domains</dt>
            <dd className="mt-0.5 break-words text-ink">
              {domains.error ? "Could not load." : ownDomains.length === 0 ? "None. People join by invitation." : ownDomains.map((d) => d.domain).join(", ")}
            </dd>
            <dd className="text-[12px] text-ink-2">Anyone with an email on these domains can sign in without an invitation.</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-label text-ink-3">Hub identifier</dt>
            <dd className="mt-0.5 font-mono text-[12px] text-ink">{company.slug}</dd>
          </div>
        </dl>
        {!isRococo ? <p className="mt-4 text-[12px] text-ink-3">To change the theme or domains, ask Rococo Creative.</p> : null}
      </Section>
    </div>
  );
}

// Data sources run the full width below the connections, so once they are a list the list and the
// open source have room to sit side by side. A source's address at a company without the module
// goes back to the tab itself.
function ConnectionsTab({ company }: { company: Company }) {
  const dataSources = hasModule(company, "data_sources");
  const { sourceId } = useParams();
  if (sourceId && !dataSources) return <Navigate to="/settings/connections" replace />;
  return (
    <div className="space-y-6">
      <ConnectionsCatalog company={company} />
      {dataSources ? <DataSourcesPanel companyId={company.id} companyTimeZone={company.time_zone} /> : null}
    </div>
  );
}

export default function SettingsPage({ tab }: { tab: SettingsTab }) {
  const { company, can } = useHub();
  const current = company!;
  return (
    <>
      <PageHeader eyebrow={current.name} title="Settings" description={DESCRIPTIONS[tab]} />
      <Tabs items={settingsTabsFor(can)} label="Settings" />
      {/* Mounted for anyone who can open the Company tab and hidden on the other tabs, so a half-typed
          edit is still there when they come back. Someone without the capability never gets the panel. */}
      {can("company_settings") ? <div hidden={tab !== "company"}><CompanyTab key={current.id} company={current} /></div> : null}
      {tab === "connections" ? <ConnectionsTab company={current} /> : null}
      {tab === "activity" ? <ActivityList key={current.id} companyId={current.id} view="company" /> : null}
      <div className="mt-6">
        <MovedCard company={current} />
      </div>
    </>
  );
}
