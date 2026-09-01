// The SOP library: every standard operating procedure, grouped by category, searchable.
// Employees see published documents; admins also see drafts and archived ones and can add.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { inputClass } from "../../components/ui/forms.ts";
import { SOP_STATUS_TONE } from "../../components/status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listSops } from "../../services/sops.ts";
import { formatDate } from "../../lib/format.ts";
import { SOP_CATEGORY_LABELS, SOP_STATUS_LABELS, keysOf, type SopCategory } from "../../types/database.ts";

export default function SopListPage() {
  const { company, isAdmin } = useHub();
  const companyId = company!.id;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SopCategory | "all">("all");
  const state = useAsync(() => listSops(companyId), [companyId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (state.data ?? []).filter((sop) => {
      if (category !== "all" && sop.category !== category) return false;
      if (!q) return true;
      return sop.title.toLowerCase().includes(q) || (sop.summary ?? "").toLowerCase().includes(q);
    });
  }, [state.data, query, category]);

  const categories = keysOf(SOP_CATEGORY_LABELS);

  return (
    <>
      <PageHeader
        eyebrow={company!.name}
        title="SOP library"
        description="The company playbook: how we do things, by category, with every change kept in version history."
        actions={isAdmin ? <Link to="/sops/new"><Button size="sm"><Plus size={14} aria-hidden /> New SOP</Button></Link> : null}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search SOPs" aria-label="Search SOPs" className={`${inputClass} mt-0 pl-8`} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", ...categories] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-150 ${category === key ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}
            >
              {key === "all" ? "All" : SOP_CATEGORY_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? (
        <SkeletonRows rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          eyebrow="SOPs"
          title={state.data && state.data.length > 0 ? "Nothing matches" : "No SOPs yet"}
          body={state.data && state.data.length > 0 ? "Try a different search or category." : isAdmin ? "Write the first procedure. Safety, process, client, admin, or field." : "Your admins have not published any procedures yet."}
          action={isAdmin && (state.data?.length ?? 0) === 0 ? <Link to="/sops/new"><Button>New SOP</Button></Link> : undefined}
        />
      ) : (
        <div className="space-y-6">
          {categories
            .filter((c) => filtered.some((s) => s.category === c))
            .map((c) => (
              <section key={c}>
                <p className="eyebrow mb-2">{SOP_CATEGORY_LABELS[c]}</p>
                <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                  {filtered
                    .filter((s) => s.category === c)
                    .map((sop) => (
                      <li key={sop.id}>
                        <Link to={`/sops/${sop.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-surface-2/60">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{sop.title}</p>
                            {sop.summary ? <p className="mt-0.5 truncate text-[13px] text-ink-2">{sop.summary}</p> : null}
                          </div>
                          <div className="flex items-center gap-3 text-[12px] text-ink-3">
                            {isAdmin ? <Badge tone={SOP_STATUS_TONE[sop.status]}>{SOP_STATUS_LABELS[sop.status]}</Badge> : null}
                            <span className="tnum">v{sop.current_version}</span>
                            <span>{formatDate(sop.updated_at)}</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </>
  );
}
