// The audit log as a list, newest first, shared by the Rococo Activity tab (every company, or one
// the filter picks) and a company's own Settings > Activity tab (that company only). A company id
// reads that company's events and nothing else; leaving it out reads every company, which only a
// Rococo admin can do in the database, so the company tab always passes its own id.
//
// The two views read differently. Rococo's keeps its raw wording, a Company column and every
// company's people. The company view is for the company's own people: plain words, the person a
// row is about by name, no Company column, and only that company's people, job roles, divisions
// and permission rows, each read by company id.
import { useState } from "react";
import Badge from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import EmptyState from "../ui/EmptyState.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { tableClass, tdClass, thClass } from "../ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { auditNames, describeAuditEvent, describeAuditEventPlain, type AuditNames } from "../../lib/audit.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDateTime } from "../../lib/format.ts";
import { listAuditEvents } from "../../services/audit.ts";
import { listCompanyCapabilities } from "../../services/capabilities.ts";
import { listCompanies } from "../../services/companies.ts";
import { listDivisions } from "../../services/divisions.ts";
import { listJobRoles } from "../../services/jobRoles.ts";
import { listAllProfiles, listCompanyProfiles } from "../../services/profiles.ts";
import {
  AUDIT_ACTOR_KIND_LABELS,
  type AuditEvent,
  type Company,
  type CompanyCapability,
  type CompanyDivision,
  type JobRole,
  type Profile,
} from "../../types/database.ts";

const PAGE_SIZE = 100;

// Rows fetched by "Load more", tied to the first page they continue. A new first page (a filter
// change, or the page refreshing when the tab comes back) leaves them behind rather than gluing
// older rows under a different list.
interface MorePages {
  after: AuditEvent[];
  events: AuditEvent[];
  lastPageSize: number;
}

function EventRow({ event, companies, profiles }: { event: AuditEvent; companies: Company[]; profiles: Profile[] }) {
  const company = event.company_id ? companies.find((c) => c.id === event.company_id) : undefined;
  const actor = event.actor_profile_id ? profiles.find((p) => p.id === event.actor_profile_id) : undefined;
  const companyName = company?.name ?? "-";
  const actorName = actor ? displayName(actor) : "-";
  const kind = AUDIT_ACTOR_KIND_LABELS[event.actor_kind];
  // On a phone the Company and By columns fold into a line under the change, so the change itself
  // stays on screen instead of behind a sideways scroll.
  return (
    <tr className="hover:bg-surface-2/60">
      <td className={`${tdClass} align-top text-[12.5px] text-ink-2 sm:whitespace-nowrap`}>{formatDateTime(event.created_at)}</td>
      <td className={`${tdClass} hidden whitespace-nowrap align-top sm:table-cell`}>{companyName}</td>
      <td className={`${tdClass} break-words align-top`}>
        {describeAuditEvent(event)}
        <p className="mt-1 text-[12px] text-ink-3 sm:hidden">{`${companyName} · ${actorName} · ${kind}`}</p>
      </td>
      <td className={`${tdClass} hidden align-top sm:table-cell`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="whitespace-nowrap">{actorName}</span>
          <Badge tone="neutral">{kind}</Badge>
        </div>
      </td>
    </tr>
  );
}

function CompanyEventRow({ event, names }: { event: AuditEvent; names: AuditNames }) {
  const actorName = event.actor_profile_id ? names.people.get(event.actor_profile_id) : undefined;
  // Rococo staff are not on the company's roster, so a Rococo change reads as Rococo.
  const by = actorName ?? (event.actor_kind === "rococo" ? "Rococo" : event.actor_kind === "system" ? "System" : "Someone");
  return (
    <tr className="hover:bg-surface-2/60">
      <td className={`${tdClass} align-top text-[12.5px] text-ink-2 sm:whitespace-nowrap`}>{formatDateTime(event.created_at)}</td>
      <td className={`${tdClass} break-words align-top`}>
        {describeAuditEventPlain(event, names)}
        <p className="mt-1 text-[12px] text-ink-3 sm:hidden">{by}</p>
      </td>
      <td className={`${tdClass} hidden whitespace-nowrap align-top sm:table-cell`}>{by}</td>
    </tr>
  );
}

// What each view loads beside the events. The company view's lookups only put names to ids: if
// one cannot be read (a role the company lets read the log but not the job roles, say), its ids
// read as "someone" or "none" and the log still shows.
interface Lookups {
  companies: Company[];
  profiles: Profile[];
  jobRoles: JobRole[];
  divisions: CompanyDivision[];
  capabilityRows: CompanyCapability[];
}

function loadLookups(view: "rococo" | "company", companyId: string | undefined): Promise<Lookups> {
  if (view === "company" && companyId) {
    const orNone = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    return Promise.all([
      orNone(listCompanyProfiles(companyId)),
      orNone(listJobRoles(companyId, true)),
      orNone(listDivisions(companyId)),
      orNone(listCompanyCapabilities(companyId)),
    ]).then(([profiles, jobRoles, divisions, capabilityRows]) => ({ companies: [], profiles, jobRoles, divisions, capabilityRows }));
  }
  return Promise.all([listCompanies(), listAllProfiles()]).then(([companies, profiles]) => ({
    companies,
    profiles,
    jobRoles: [],
    divisions: [],
    capabilityRows: [],
  }));
}

export default function ActivityList({ companyId, view = "rococo" }: { companyId: string | null | undefined; view?: "rococo" | "company" }) {
  const { companies: hubCompanies } = useHub();
  const scope = companyId || undefined;
  const companyView = view === "company" && !!scope;
  const [more, setMore] = useState<MorePages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const state = useAsync(
    () => Promise.all([listAuditEvents({ companyId: scope, limit: PAGE_SIZE }), loadLookups(view, scope)]),
    [scope, view],
  );

  const firstPage = state.data?.[0] ?? null;
  const extra = more && firstPage && more.after === firstPage ? more : null;
  const events = firstPage ? [...firstPage, ...(extra?.events ?? [])] : [];
  const lastPageSize = extra ? extra.lastPageSize : (firstPage?.length ?? 0);
  const lookups = state.data?.[1];
  // The hub already lists every company for a Rococo admin, so the Rococo filter keeps its options
  // while a new one loads.
  const companies = lookups && !companyView ? lookups.companies : hubCompanies;
  const profiles = lookups?.profiles ?? [];
  // A few hundred rows at most, so the names are simply rebuilt with each render.
  const names = auditNames({
    people: lookups?.profiles,
    jobRoles: lookups?.jobRoles,
    divisions: lookups?.divisions,
    companies: hubCompanies,
    capabilityRows: lookups?.capabilityRows,
    events,
  });

  async function loadMore() {
    if (!firstPage || events.length === 0) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const oldest = events[events.length - 1];
      const next = await listAuditEvents({ companyId: scope, before: { created_at: oldest.created_at, id: oldest.id }, limit: PAGE_SIZE });
      setMore({ after: firstPage, events: [...(extra?.events ?? []), ...next], lastPageSize: next.length });
    } catch (err) {
      setMoreError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={8} />
      ) : !state.data ? null : events.length === 0 ? (
        <EmptyState eyebrow="Activity" title="Nothing recorded yet" body="Role, access and setup changes appear here from now on." />
      ) : (
        <>
          <Section padded={false}>
            <div className="relative overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>When</th>
                    {companyView ? null : <th className={`${thClass} hidden sm:table-cell`}>Company</th>}
                    <th className={thClass}>Change</th>
                    <th className={`${thClass} hidden sm:table-cell`}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) =>
                    companyView ? (
                      <CompanyEventRow key={event.id} event={event} names={names} />
                    ) : (
                      <EventRow key={event.id} event={event} companies={companies} profiles={profiles} />
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </Section>
          {moreError ? <Notice tone="error" className="mt-4">{moreError}</Notice> : null}
          {lastPageSize === PAGE_SIZE ? (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
