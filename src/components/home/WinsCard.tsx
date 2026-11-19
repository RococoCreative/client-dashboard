// The Home card with the five most recent wins that are not archived, and a way into the Wins
// page. Only a company with the wins module mounts it. When the company sets how many days a win
// stays on Home, a win older than that (by the company's own day) is left off and lives in the
// Wins page archive; with no setting there is no age cut-off.
import { Link } from "react-router-dom";
import Badge from "../ui/Badge.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { tapTargetClass } from "../ui/tap.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { formatDate } from "../../lib/format.ts";
import { companyToday, homeCutoff } from "../../lib/wins.ts";
import { listWins } from "../../services/wins.ts";
import { WIN_SOURCE_LABELS, type Company } from "../../types/database.ts";

export default function WinsCard({ company }: { company: Company }) {
  const companyId = company.id;
  const cutoff = homeCutoff(company.wins_home_days, companyToday(company.time_zone));
  const state = useAsync(() => listWins(companyId, cutoff ? { limit: 5, wonOnOrAfter: cutoff } : { limit: 5 }), [companyId, cutoff]);

  return (
    <Section
      eyebrow="Wins"
      title="Recent wins"
      padded={false}
      actions={<Link to="/wins" className={`text-[13px] font-medium text-link hover:underline ${tapTargetClass}`}>All wins</Link>}
    >
      {state.error && !state.data ? (
        <div className="p-4 sm:p-6"><Notice tone="error">{state.error}</Notice></div>
      ) : !state.data ? (
        <div className="p-4 sm:p-6"><SkeletonRows rows={3} /></div>
      ) : state.data.length === 0 ? (
        <p className="px-4 sm:px-6 py-4 text-sm text-ink-2">{cutoff ? "No recent wins." : "No wins recorded yet."}</p>
      ) : (
        <ul className="divide-y divide-line">
          {state.data.map((win) => (
            <li key={win.id} className="flex items-start justify-between gap-3 px-4 sm:px-6 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{win.title}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-2">{formatDate(win.won_on)}</p>
              </div>
              <Badge tone="neutral" className="mt-0.5">{WIN_SOURCE_LABELS[win.source_type]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
