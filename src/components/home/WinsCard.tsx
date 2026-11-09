// The Home card with the five most recent wins that are not archived, and a way into the Wins
// page. Only a company with the wins module mounts it. Five is the whole rule: there is no age
// cut-off and no other filter.
import { Link } from "react-router-dom";
import Badge from "../ui/Badge.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { SkeletonRows } from "../ui/Skeleton.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { formatDate } from "../../lib/format.ts";
import { listWins } from "../../services/wins.ts";
import { WIN_SOURCE_LABELS } from "../../types/database.ts";

export default function WinsCard({ companyId }: { companyId: string }) {
  const state = useAsync(() => listWins(companyId, { limit: 5 }), [companyId]);

  return (
    <Section
      eyebrow="Wins"
      title="Recent wins"
      padded={false}
      actions={<Link to="/wins" className="text-[13px] font-medium text-accent hover:underline">All wins</Link>}
    >
      {state.error && !state.data ? (
        <div className="p-5"><Notice tone="error">{state.error}</Notice></div>
      ) : !state.data ? (
        <div className="p-5"><SkeletonRows rows={3} /></div>
      ) : state.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-2">No wins recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {state.data.map((win) => (
            <li key={win.id} className="flex items-start justify-between gap-3 px-5 py-2.5">
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
