// Settings, for a company admin: one page, one tab per area, each tab its own route.
//   Company: name, logo and time zone, plus the theme and sign-in domains, which Rococo manages
//     (they decide who can sign in), so they read only here.
//   Roles: the company's job roles (dashboard modules and scorecard metrics) and its divisions.
//   Reviews: pillars, weights and criteria, the Monthly GSRs rule, and deliverable categories.
//   Connections: the company's own connections to outside systems and, with the module, its data
//     sources. Links to outside tools live in Resources > Links, which this tab points to.
// What shows is the company's data and modules (rule 12), never its name.
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Button from "../../components/ui/Button.tsx";
import Field from "../../components/ui/Field.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import ConnectionsPanel from "../../components/settings/ConnectionsPanel.tsx";
import DataSourcesPanel from "../../components/settings/DataSourcesPanel.tsx";
import DeliverableCategoriesPanel from "../../components/settings/DeliverableCategoriesPanel.tsx";
import DivisionsPanel from "../../components/settings/DivisionsPanel.tsx";
import JobRolesPanel from "../../components/settings/JobRolesPanel.tsx";
import PillarsPanel from "../../components/settings/PillarsPanel.tsx";
import { inputClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCompanyDomains, updateCompany } from "../../services/companies.ts";
import { THEMES } from "../../lib/theme.ts";
import { hasModule } from "../../lib/modules.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { Company, ConnectionProvider } from "../../types/database.ts";
import { SETTINGS_TABS, type SettingsTab } from "./settingsTabs.ts";

// A company with data sources also connects its own Google account for them.
const GOOGLE_ROW_PROVIDERS: ConnectionProvider[] = ["gohighlevel", "quickbooks", "google_sheets"];

// The named zones the browser knows, offered as suggestions; the database has the final say.
function timeZones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
}

const DESCRIPTIONS: Record<SettingsTab, string> = {
  company: "How the company appears in the hub and who can sign in.",
  roles: "The jobs people do here, what each role sees and is scored on, and the divisions the company reports by.",
  reviews: "How people are reviewed: the pillars and their weights, the criteria rated, the Monthly GSRs rule, and the categories deliverables are filed under.",
  connections: "The company's own accounts in outside systems, and the sources the hub reads from them.",
};

function CompanyTab({ company }: { company: Company }) {
  const { refreshCompanies, isRococo } = useHub();
  const [name, setName] = useState(company.name);
  const [logoUrl, setLogoUrl] = useState(company.logo_url ?? "");
  const [timeZone, setTimeZone] = useState(company.time_zone);
  const [zones] = useState(timeZones);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const domains = useAsync(() => listCompanyDomains(company.id), [company.id]);
  const ownDomains = domains.data ?? [];

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
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const theme = THEMES[company.theme_key];

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <form onSubmit={handleSubmit} className="lg:col-span-2">
        <Section eyebrow="Identity" title="Company" actions={<Button type="submit" size="sm" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>}>
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
            {saved ? <Notice tone="success">Saved.</Notice> : null}
          </div>
        </Section>
      </form>
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

function ConnectionsTab({ company }: { company: Company }) {
  const dataSources = hasModule(company, "data_sources");
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <ConnectionsPanel companyId={company.id} providers={dataSources ? GOOGLE_ROW_PROVIDERS : undefined} />
        {dataSources ? <DataSourcesPanel companyId={company.id} /> : null}
      </div>
      {hasModule(company, "external_links") ? (
        <Section eyebrow="Where the work lives" title="Links to outside tools">
          <p className="text-sm text-ink-2">
            The links people follow from the hub to the programs they work in, such as Monday boards, are kept in Resources, where everyone finds them. Admins add and order them there.
          </p>
          <Link to="/resources/links" className="mt-4 inline-block">
            <Button variant="secondary" size="sm">Open Links</Button>
          </Link>
        </Section>
      ) : null}
    </div>
  );
}

export default function SettingsPage({ tab }: { tab: SettingsTab }) {
  const { company } = useHub();
  const current = company!;
  return (
    <>
      <PageHeader eyebrow={current.name} title="Settings" description={DESCRIPTIONS[tab]} />
      <Tabs items={SETTINGS_TABS} label="Settings" />
      {tab === "company" ? <CompanyTab company={current} /> : null}
      {tab === "roles" ? (
        <div className="space-y-6">
          <JobRolesPanel companyId={current.id} />
          <DivisionsPanel companyId={current.id} />
        </div>
      ) : null}
      {tab === "reviews" ? (
        <div className="space-y-6">
          <PillarsPanel />
          <DeliverableCategoriesPanel companyId={current.id} />
        </div>
      ) : null}
      {tab === "connections" ? <ConnectionsTab company={current} /> : null}
    </>
  );
}
