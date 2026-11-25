// Resources > SOPs: every standard operating procedure, searchable inside its text, filtered by the
// company's own categories, tags, status (admins), and the reader's own standing (assigned to them,
// not signed off). Filters live in the address. Employees see published documents; admins also see
// drafts and archived ones and can write and import. Each SOP opens at /sops/:id.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FileUp, Plus, Search } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import Chip from "../ui/Chip.tsx";
import EmptyState from "../ui/EmptyState.tsx";
import Notice from "../ui/Notice.tsx";
import PanelHeader from "../ui/PanelHeader.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { compactSelectClass, inputClass, labelClass } from "../ui/forms.ts";
import { eyebrowLabelClass, itemTitleClass, metaClass, secondaryClass } from "../ui/type.ts";
import { tapTargetClass } from "../ui/tap.ts";
import { SOP_STATUS_TONE } from "../status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { hasModule } from "../../lib/modules.ts";
import { listSops } from "../../services/sops.ts";
import { listSopCategories } from "../../services/sopCategories.ts";
import { listPersonSopSignoffs } from "../../services/sopSignoffs.ts";
import { listTasks } from "../../services/tasks.ts";
import { formatDate } from "../../lib/format.ts";
import { searchTerms, snippetFor } from "../../lib/sops/search.ts";
import { tagsInUse } from "../../lib/sops/tags.ts";
import { UNCATEGORIZED, filterSops, readFilters, standingOn, writeFilters, type LibraryFilters, type Standing } from "../../lib/sops/library.ts";
import { SOP_STATUS_LABELS, keysOf, type Sop, type SopCategory } from "../../types/database.ts";

function StandingBadge({ standing, assigned }: { standing: Standing; assigned: boolean }) {
  if (standing.kind === "signed") return <Badge tone="success">Signed off</Badge>;
  if (standing.kind === "outdated") return <Badge tone="warning">Signed v{standing.version}, changed since</Badge>;
  return assigned ? <Badge tone="accent">Assigned to you</Badge> : null;
}

function SopRow({ sop, isAdmin, query, standing, assigned }: { sop: Sop; isAdmin: boolean; query: string; standing: Standing; assigned: boolean }) {
  const snippet = query ? snippetFor(sop.body_text, query) : null;
  const line = snippet ?? sop.summary;
  // Find on the SOP page matches a phrase, and the library matches each word on its own, so the
  // page opens with the first word found, which is sure to be there.
  const findTerm = query ? searchTerms(query)[0] : undefined;
  return (
    <li>
      <Link to={`/sops/${sop.id}${findTerm ? `?q=${encodeURIComponent(findTerm)}` : ""}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6 transition-colors duration-150 hover:bg-surface-2/60">
        <div className="min-w-0 flex-1">
          <p className={`truncate ${itemTitleClass}`} title={sop.title}>{sop.title}</p>
          {line ? <p className={`mt-0.5 line-clamp-2 ${secondaryClass}`}>{line}</p> : null}
          {sop.tags.length ? (
            <p className="mt-1 flex flex-wrap gap-1">
              {sop.tags.map((t) => (
                <span key={t} className="rounded-full border border-line px-1.5 text-[11px] text-ink-3">{t}</span>
              ))}
            </p>
          ) : null}
        </div>
        <div className={`flex flex-wrap items-center gap-3 ${metaClass}`}>
          <StandingBadge standing={standing} assigned={assigned} />
          {isAdmin ? <Badge tone={SOP_STATUS_TONE[sop.status]}>{SOP_STATUS_LABELS[sop.status]}</Badge> : null}
          <span className="tnum">v{sop.current_version}</span>
          <span>{formatDate(sop.updated_at)}{sop.updated_by_name ? ` · ${sop.updated_by_name}` : ""}</span>
        </div>
      </Link>
    </li>
  );
}

function groupByCategory(sops: Sop[], categories: SopCategory[]): Array<{ key: string; name: string; sops: Sop[] }> {
  const groups = categories
    .map((c) => ({ key: c.id, name: c.name, sops: sops.filter((s) => s.category_id === c.id) }))
    .filter((g) => g.sops.length);
  const known = new Set(categories.map((c) => c.id));
  const rest = sops.filter((s) => s.category_id === null || !known.has(s.category_id));
  return rest.length ? [...groups, { key: UNCATEGORIZED, name: "Uncategorized", sops: rest }] : groups;
}

export default function SopsPanel() {
  const { company, isAdmin, profile } = useHub();
  const companyId = company!.id;
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const [typed, setTyped] = useState(filters.q);
  const set = (patch: Partial<LibraryFilters>) => setParams(writeFilters({ ...filters, ...patch }), { replace: true });

  // The search reaches the database a moment after typing stops.
  const committedQ = filters.q;
  useEffect(() => {
    if (typed === committedQ) return;
    const timer = setTimeout(() => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (typed) next.set("q", typed);
        else next.delete("q");
        return next;
      }, { replace: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [typed, committedQ, setParams]);

  const member = profile.company_id === companyId;
  const withTasks = member && hasModule(company!, "tasks");
  const base = useAsync(async () => {
    const [categories, signoffs, tasks] = await Promise.all([
      listSopCategories(companyId),
      member ? listPersonSopSignoffs(companyId, profile.id) : Promise.resolve([]),
      withTasks ? listTasks(companyId, { assigneeId: profile.id }) : Promise.resolve([]),
    ]);
    return { categories, signoffs, assigned: new Set(tasks.map((t) => t.sop_id).filter((id): id is string => id !== null)) };
  }, [companyId, profile.id, member, withTasks]);
  const list = useAsync(() => listSops(companyId, { query: filters.q }), [companyId, filters.q]);
  const all = useAsync(() => listSops(companyId), [companyId]);

  const categories = base.data?.categories ?? [];
  const tags = useMemo(() => tagsInUse(all.data ?? []), [all.data]);
  const shown = useMemo(
    () => (list.data && base.data ? filterSops(list.data, filters, { signoffs: base.data.signoffs, assignedSopIds: base.data.assigned }) : null),
    [list.data, base.data, filters],
  );
  const grouped = !filters.q && filters.sort === "updated" && !filters.cat;
  const anyFilter = Boolean(filters.q || filters.cat || filters.tag || filters.status || filters.show !== "all");
  const error = list.error || base.error;

  return (
    <>
      <PanelHeader
        eyebrow="Everyone reads, admins write"
        title="SOP library"
        description="The company playbook: how we do things, searchable inside every procedure, with every change kept in version history."
        actions={
          isAdmin ? (
            <>
              <Link to="/sops/import"><Button variant="secondary" size="sm"><FileUp size={14} aria-hidden /> Import</Button></Link>
              <Link to="/sops/new"><Button size="sm"><Plus size={14} aria-hidden /> New SOP</Button></Link>
            </>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search titles, tags and text" aria-label="Search SOPs" className={`${inputClass} mt-0 pl-8`} />
        </div>
        <div className="min-w-[150px]">
          <label htmlFor="sop-filter-category" className={labelClass}>Category</label>
          <select id="sop-filter-category" value={filters.cat} onChange={(e) => set({ cat: e.target.value })} className={`${compactSelectClass} mt-1`}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.retired_at ? " (retired)" : ""}</option>
            ))}
            <option value={UNCATEGORIZED}>Uncategorized</option>
          </select>
        </div>
        {isAdmin ? (
          <div className="min-w-[120px]">
            <label htmlFor="sop-filter-status" className={labelClass}>Status</label>
            <select id="sop-filter-status" value={filters.status} onChange={(e) => set({ status: e.target.value as LibraryFilters["status"] })} className={`${compactSelectClass} mt-1`}>
              <option value="">Any status</option>
              {keysOf(SOP_STATUS_LABELS).map((s) => (
                <option key={s} value={s}>{SOP_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
        ) : null}
        {member ? (
          <div className="min-w-[150px]">
            <label htmlFor="sop-filter-show" className={labelClass}>Show</label>
            <select id="sop-filter-show" value={filters.show} onChange={(e) => set({ show: e.target.value as LibraryFilters["show"] })} className={`${compactSelectClass} mt-1`}>
              <option value="all">Every SOP</option>
              {withTasks ? <option value="assigned">Assigned to me</option> : null}
              <option value="unsigned">Not signed off by me</option>
            </select>
          </div>
        ) : null}
        <div className="min-w-[140px]">
          <label htmlFor="sop-filter-sort" className={labelClass}>Sort</label>
          <select id="sop-filter-sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value as LibraryFilters["sort"] })} className={`${compactSelectClass} mt-1`}>
            <option value="updated">Recently updated</option>
            <option value="title">A to Z</option>
          </select>
        </div>
      </div>
      {tags.length ? (
        <div className="mb-5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
          {tags.map((t) => (
            <Chip key={t} size="sm" active={filters.tag.toLowerCase() === t.toLowerCase()} onClick={() => set({ tag: filters.tag.toLowerCase() === t.toLowerCase() ? "" : t })}>{t}</Chip>
          ))}
        </div>
      ) : <div className="mb-5" />}

      {error ? <Notice tone="error">{error}</Notice> : null}
      {!shown && !error ? (
        <SkeletonRows rows={5} />
      ) : !shown ? null : shown.length === 0 ? (
        <EmptyState
          eyebrow="SOPs"
          title={anyFilter ? "Nothing matches" : "No SOPs yet"}
          body={anyFilter ? "Try a different search or clear a filter." : isAdmin ? "Write the first procedure, or import the ones you already have." : "Your admins have not published any procedures yet."}
          action={
            anyFilter ? (
              <button type="button" onClick={() => { setTyped(""); setParams(new URLSearchParams(), { replace: true }); }} className={`text-link text-[13px] font-medium hover:underline ${tapTargetClass}`}>Clear filters</button>
            ) : isAdmin ? (
              <Link to="/sops/import" className={`text-link text-[13px] font-medium hover:underline ${tapTargetClass}`}>Import SOPs</Link>
            ) : undefined
          }
        />
      ) : grouped ? (
        <div className="space-y-6">
          {groupByCategory(shown, categories).map((g) => (
            <section key={g.key}>
              <p className={`mb-2 ${eyebrowLabelClass}`}>{g.name}</p>
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {g.sops.map((sop) => (
                  <SopRow key={sop.id} sop={sop} isAdmin={isAdmin} query="" standing={standingOn(sop, base.data!.signoffs)} assigned={base.data!.assigned.has(sop.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <>
          <p className={`mb-2 ${metaClass}`} aria-live="polite">{shown.length === 1 ? "1 SOP" : `${shown.length} SOPs`}</p>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {shown.map((sop) => (
              <SopRow key={sop.id} sop={sop} isAdmin={isAdmin} query={filters.q} standing={standingOn(sop, base.data!.signoffs)} assigned={base.data!.assigned.has(sop.id)} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
