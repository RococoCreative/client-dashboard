// People tab of the Rococo portfolio: every account across every company, with company
// assignment, role, Rococo access, and active flag. Filter by company or search by name
// and email.
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { checkboxClass, inputClass, selectClass, tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listAllProfiles, updateProfile } from "../../services/profiles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, pluralize } from "../../lib/format.ts";
import { ROLE_LABELS, keysOf, type Profile, type Role } from "../../types/database.ts";
import { PORTFOLIO_TABS } from "./PortfolioPage.tsx";

export default function UsersPage() {
  const { profile: me, companies } = useHub();
  const [companyFilter, setCompanyFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const state = useAsync(() => listAllProfiles(), []);

  const profiles = state.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter((p) => {
      if (companyFilter === "none" && p.company_id !== null) return false;
      if (companyFilter !== "all" && companyFilter !== "none" && p.company_id !== companyFilter) return false;
      if (!q) return true;
      return p.email.toLowerCase().includes(q) || (p.full_name ?? "").toLowerCase().includes(q) || (p.title ?? "").toLowerCase().includes(q);
    });
  }, [profiles, companyFilter, query]);

  async function patch(person: Profile, patchValue: Parameters<typeof updateProfile>[1]) {
    setError("");
    try {
      const next = await updateProfile(person.id, patchValue);
      state.setData((prev) => (prev ? prev.map((p) => (p.id === next.id ? next : p)) : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const companyName = (id: string | null) => (id ? (companies.find((c) => c.id === id)?.name ?? "Unknown") : "No company");

  return (
    <>
      <PageHeader eyebrow="Rococo Creative" title="People" description="Every account in the hub. Move people between companies, set roles, grant Rococo access, or deactivate." />
      <Tabs items={PORTFOLIO_TABS} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" aria-label="Search people" className={`${inputClass} mt-0 pl-8`} />
        </div>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} aria-label="Filter by company" className={`${selectClass} mt-0 w-auto`}>
          <option value="all">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value="none">No company</option>
        </select>
      </div>
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={8} />
      ) : (
        <Section eyebrow="Everyone" title={pluralize(filtered.length, "user")} padded={false}>
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
                {filtered.map((person) => {
                  const self = person.id === me.id;
                  return (
                    <tr key={person.id} className={`hover:bg-surface-2/60 ${person.is_active ? "" : "opacity-60"}`}>
                      <td className={tdClass}>
                        <p className="text-sm text-ink">{displayName(person)}{self ? " (you)" : ""}</p>
                        <p className="text-[12px] text-ink-3">{person.email}{person.title ? ` · ${person.title}` : ""}</p>
                      </td>
                      <td className={tdClass}>
                        <select value={person.company_id ?? ""} aria-label={`Company for ${person.email}`} onChange={(e) => void patch(person, { company_id: e.target.value || null })} className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}>
                          <option value="">{companyName(null)}</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className={tdClass}>
                        <select value={person.role} aria-label={`Role for ${person.email}`} onChange={(e) => void patch(person, { role: e.target.value as Role })} className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}>
                          {keysOf(ROLE_LABELS).map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      </td>
                      <td className={tdClass}>
                        <input type="checkbox" checked={person.is_rococo_admin} disabled={self} aria-label={`Rococo admin: ${person.email}`} onChange={(e) => void patch(person, { is_rococo_admin: e.target.checked })} className={checkboxClass} />
                      </td>
                      <td className={tdClass}>
                        <input type="checkbox" checked={person.is_active} disabled={self} aria-label={`Active: ${person.email}`} onChange={(e) => void patch(person, { is_active: e.target.checked })} className={checkboxClass} />
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td className={`${tdClass} text-ink-3`} colSpan={5}>Nobody matches.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
