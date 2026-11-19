// People tab of the Rococo portfolio: everyone on every company's roster, signed in or not,
// with company assignment, role, Rococo access, and active flag. Filter by company or search
// by name and email. A person who has never signed in is marked, never left out. A person's
// company and role read as text until the row's pencil opens them, one row at a time; the Rococo
// and Active switches stay live.
import { useMemo, useRef, useState } from "react";
import { Pencil, Search } from "lucide-react";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { checkboxClass, checkboxHitClass, inputClass, selectClass, tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import { metaClass, secondaryClass } from "../../components/ui/type.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listAllProfiles, updateProfile } from "../../services/profiles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, pluralize } from "../../lib/format.ts";
import { grantableRoles, hasAccount } from "../../lib/people.ts";
import { ROLE_LABELS, type Profile, type Role } from "../../types/database.ts";
import { PORTFOLIO_TABS } from "./portfolioTabs.ts";

// A company or role shown as text in a row: the secondary size with the ink in place of the
// secondary ink, swapped rather than stacked.
const CELL_TEXT = secondaryClass.replace(/(^|\s)text-ink-2(?=\s|$)/, "$1text-ink");

export default function UsersPage() {
  const { profile: me, companies } = useHub();
  const [companyFilter, setCompanyFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  // The one person whose company and role are open for editing.
  const [openId, setOpenId] = useState<string | null>(null);
  const state = useAsync(() => listAllProfiles(), []);

  const profiles = useMemo(() => state.data ?? [], [state.data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter((p) => {
      if (companyFilter === "none" && p.company_id !== null) return false;
      if (companyFilter !== "all" && companyFilter !== "none" && p.company_id !== companyFilter) return false;
      if (!q) return true;
      return p.email.toLowerCase().includes(q) || (p.full_name ?? "").toLowerCase().includes(q) || (p.title ?? "").toLowerCase().includes(q);
    });
  }, [profiles, companyFilter, query]);

  // Each response carries the whole profile, so a role picked straight after a company put two
  // writes in flight that could land the wrong way round and show the older row. Writes for one
  // person queue behind each other.
  const saveChains = useRef(new Map<string, Promise<unknown>>());
  async function patch(person: Profile, patchValue: Parameters<typeof updateProfile>[1]) {
    setError("");
    const chained = (saveChains.current.get(person.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const next = await updateProfile(person.id, patchValue);
      state.setData((prev) => (prev ? prev.map((p) => (p.id === next.id ? next : p)) : prev));
    });
    saveChains.current.set(person.id, chained);
    try {
      await chained;
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const companyName = (id: string | null) => (id ? (companies.find((c) => c.id === id)?.name ?? "Unknown") : "No company");

  return (
    <>
      <PageHeader eyebrow="Rococo Creative" title="People" description="Everyone in the hub, signed in or not. Move people between companies, set roles, grant Rococo access, or deactivate." />
      <Tabs items={PORTFOLIO_TABS} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" aria-label="Search people" className={`${inputClass} mt-0 pl-8`} />
        </div>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} aria-label="Filter by company" className={`${selectClass} mt-0 !w-auto max-w-full`}>
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
      ) : !state.data ? null : (
        <Section eyebrow="Everyone" title={pluralize(filtered.length, "user")} padded={false}>
          <div className="relative overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>User</th>
                  <th className={thClass}>Company</th>
                  <th className={thClass}>Role</th>
                  <th className={thClass}>Rococo</th>
                  <th className={thClass}>Active</th>
                  <th className={thClass}><span className="sr-only">Edit</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((person) => {
                  const self = person.id === me.id;
                  const editing = openId === person.id;
                  return (
                    <tr key={person.id} className={`hover:bg-surface-2/60 ${person.is_active ? "" : "opacity-60"}`}>
                      <td className={tdClass}>
                        <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                          {displayName(person)}{self ? " (you)" : ""}
                          {hasAccount(person) ? null : <Badge tone="warning">Not signed in yet</Badge>}
                        </p>
                        <p className={metaClass}>{person.email}{person.title ? ` · ${person.title}` : ""}</p>
                      </td>
                      <td className={tdClass}>
                        {editing ? (
                          <select value={person.company_id ?? ""} aria-label={`Company for ${person.email}`} onChange={(e) => void patch(person, { company_id: e.target.value || null })} className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}>
                            <option value="">{companyName(null)}</option>
                            {companies.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={CELL_TEXT}>{companyName(person.company_id)}</span>
                        )}
                      </td>
                      <td className={tdClass}>
                        {editing ? (
                          <select value={person.role} aria-label={`Role for ${person.email}`} onChange={(e) => void patch(person, { role: e.target.value as Role })} className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}>
                            {grantableRoles(me).map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={CELL_TEXT}>{ROLE_LABELS[person.role]}</span>
                        )}
                      </td>
                      <td className={tdClass}>
                        <label className={checkboxHitClass}><input type="checkbox" checked={person.is_rococo_admin} disabled={self} aria-label={`Rococo admin: ${person.email}`} onChange={(e) => void patch(person, { is_rococo_admin: e.target.checked })} className={checkboxClass} /></label>
                      </td>
                      <td className={tdClass}>
                        <label className={checkboxHitClass}><input type="checkbox" checked={person.is_active} disabled={self} aria-label={`Active: ${person.email}`} onChange={(e) => void patch(person, { is_active: e.target.checked })} className={checkboxClass} /></label>
                      </td>
                      <td className={`${tdClass} text-right`}>
                        {editing ? (
                          <Button variant="secondary" size="sm" onClick={() => setOpenId(null)}>Done</Button>
                        ) : (
                          <IconButton label={`Edit ${person.email}`} onClick={() => setOpenId(person.id)}>
                            <Pencil size={15} aria-hidden />
                          </IconButton>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td className={`${tdClass} text-ink-3`} colSpan={6}>Nobody matches.</td>
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
