// The SOP library's most recent changes, a line each with its version, date and who changed it, for both
// Home layouts. Each title opens the SOP; under a finger the whole row is its target.
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { tapStretchClass } from "../ui/tap.ts";
import { formatDate } from "../../lib/format.ts";
import type { Sop } from "../../types/database.ts";

export default function RecentSops({ sops }: { sops: Sop[] }) {
  if (sops.length === 0) {
    return <p className="text-sm text-ink-2">No SOPs yet.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {sops.map((sop) => (
        <li key={sop.id} className="relative flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <Link to={`/sops/${sop.id}`} className={`block truncate text-sm text-ink hover:text-link ${tapStretchClass}`}>
              {sop.title}
            </Link>
            <p className="text-[12px] text-ink-3">
              v{sop.current_version} · {formatDate(sop.updated_at)}{sop.updated_by_name ? ` · ${sop.updated_by_name}` : ""}
            </p>
          </div>
          <ArrowRight size={14} className="shrink-0 text-ink-3" aria-hidden />
        </li>
      ))}
    </ul>
  );
}
