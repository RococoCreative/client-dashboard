// A person's GSRs on demand, newest first, for My GSR and the person's GSR and goals tab: each one a
// link by the day it began, then In progress or Done with the day it was marked done, its score
// when one is stored, and who marked it done when that is known. The same words and dates as the
// GSR's own page, so the list and the page never disagree. A done one opens read only there.
import { Link } from "react-router-dom";
import Badge from "../../ui/Badge.tsx";
import { tapTargetClass } from "../../ui/tap.ts";
import { isOpen, newestFirst } from "../../../lib/gsr/onDemand.ts";
import { formatDate } from "../../../lib/format.ts";
import type { Gsr } from "../../../types/database.ts";

export default function GsrList({ gsrs, names }: { gsrs: Gsr[]; names: ReadonlyMap<string, string> }) {
  if (gsrs.length === 0) return <p className="text-[13px] text-ink-2">No GSRs yet.</p>;
  return (
    <ul aria-label="GSRs" className="divide-y divide-line">
      {[...gsrs].sort(newestFirst).map((gsr) => {
        const open = isOpen(gsr);
        const markedBy = !open && gsr.reviewer_id ? (names.get(gsr.reviewer_id) ?? null) : null;
        const meta = [!open && gsr.gsr_score !== null ? `${gsr.gsr_score}%` : null, markedBy ? `Marked done by ${markedBy}` : null].filter(Boolean);
        return (
          <li key={gsr.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
            <Link to={`/gsr/reviews/${gsr.id}`} className={`text-sm font-medium text-link hover:underline ${tapTargetClass}`}>
              {formatDate(gsr.started_on)}
            </Link>
            <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
              <Badge tone={open ? "info" : "success"}>{open ? "In progress" : `Done ${formatDate(gsr.done_on)}`}</Badge>
              {meta.map((part) => (
                <span key={part} className={part?.endsWith("%") ? "tnum" : undefined}>{part}</span>
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
