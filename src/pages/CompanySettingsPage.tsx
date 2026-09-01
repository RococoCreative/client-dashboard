// Company settings for a company admin: name and logo. Theme, slug, and sign-in domains are
// Rococo's to manage (they affect who can sign in), so they show read-only here.
import { useState, type FormEvent } from "react";
import Button from "../components/ui/Button.tsx";
import Field from "../components/ui/Field.tsx";
import Notice from "../components/ui/Notice.tsx";
import PageHeader from "../components/ui/PageHeader.tsx";
import Section from "../components/ui/Section.tsx";
import { inputClass } from "../components/ui/forms.ts";
import { useHub } from "../context/HubContext.tsx";
import { useAsync } from "../hooks/useAsync.ts";
import { listAllDomains, updateCompany } from "../services/companies.ts";
import { THEMES } from "../lib/theme.ts";
import { errorMessage } from "../lib/errors.ts";

export default function CompanySettingsPage() {
  const { company, refreshCompanies, isRococo } = useHub();
  const [name, setName] = useState(company!.name);
  const [logoUrl, setLogoUrl] = useState(company!.logo_url ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const domains = useAsync(() => listAllDomains(), [company!.id]);
  const ownDomains = (domains.data ?? []).filter((d) => d.company_id === company!.id);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("The company needs a name.");
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await updateCompany(company!.id, { name: name.trim(), logo_url: logoUrl.trim() || null });
      await refreshCompanies();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const theme = THEMES[company!.theme_key];

  return (
    <>
      <PageHeader eyebrow={company!.name} title="Settings" description="How the company appears in the hub." />
      <div className="grid gap-6 lg:grid-cols-3">
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
              {error ? <Notice tone="error">{error}</Notice> : null}
              {saved ? <Notice tone="success">Saved.</Notice> : null}
            </div>
          </Section>
        </form>
        <div className="space-y-6">
          <Section eyebrow="Managed by Rococo" title="Theme and sign-in">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-label text-ink-3">Theme</dt>
                <dd className="mt-0.5 text-ink">{theme.label} <span className="text-ink-3">({theme.mode})</span></dd>
                <dd className="text-[12px] text-ink-2">{theme.description}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-label text-ink-3">Sign-in domains</dt>
                <dd className="mt-0.5 text-ink">
                  {domains.error ? "Could not load." : ownDomains.length === 0 ? "None. People join by invitation." : ownDomains.map((d) => d.domain).join(", ")}
                </dd>
                <dd className="text-[12px] text-ink-2">Anyone with an email on these domains can sign in without an invitation.</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-label text-ink-3">Hub identifier</dt>
                <dd className="mt-0.5 font-mono text-[12px] text-ink">{company!.slug}</dd>
              </div>
            </dl>
            {!isRococo ? <p className="mt-4 text-[12px] text-ink-3">To change the theme or domains, ask Rococo Creative.</p> : null}
          </Section>
        </div>
      </div>
    </>
  );
}
