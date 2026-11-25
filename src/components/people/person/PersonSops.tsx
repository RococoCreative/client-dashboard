// The SOPs a person has signed off, on their Overview: each with the version they signed and when,
// marked when the SOP has changed since. This is how the managers who lead someone, and the admins
// over them, see that a procedure was read and completed (0053). The database decides who reads
// these rows; the section only lists what comes back.
import { Link } from "react-router-dom";
import Badge from "../../ui/Badge.tsx";
import Notice from "../../ui/Notice.tsx";
import Section from "../../ui/Section.tsx";
import SkeletonRows from "../../ui/SkeletonRows.tsx";
import { metaClass } from "../../ui/type.ts";
import { useAsync } from "../../../hooks/useAsync.ts";
import { formatDate, pluralize } from "../../../lib/format.ts";
import { listPersonSopSignoffs } from "../../../services/sopSignoffs.ts";
import { listSops } from "../../../services/sops.ts";
import type { Profile, Sop, SopSignoff } from "../../../types/database.ts";

// Each SOP once, with the person's newest sign-off on it.
function latestPerSop(signoffs: SopSignoff[]): SopSignoff[] {
  const seen = new Map<string, SopSignoff>();
  for (const s of signoffs) {
    const kept = seen.get(s.sop_id);
    if (!kept || s.signed_at > kept.signed_at) seen.set(s.sop_id, s);
  }
  return [...seen.values()].sort((a, b) => (a.signed_at < b.signed_at ? 1 : -1));
}

export default function PersonSops({ companyId, person }: { companyId: string; person: Profile }) {
  const state = useAsync(async () => {
    const [signoffs, sops] = await Promise.all([listPersonSopSignoffs(companyId, person.id), listSops(companyId)]);
    return { signoffs: latestPerSop(signoffs), sops: new Map<string, Sop>(sops.map((s) => [s.id, s])) };
  }, [companyId, person.id]);

  return (
    <Section eyebrow="SOPs" title="SOPs signed off" padded={false}>
      {state.error && !state.data ? <Notice tone="error" className="m-4">{state.error}</Notice> : null}
      {!state.data && !state.error ? <div className="p-4"><SkeletonRows rows={2} /></div> : null}
      {state.data ? (
        state.data.signoffs.length === 0 ? (
          <p className={`px-4 py-4 sm:px-6 ${metaClass}`}>No SOPs signed off yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {state.data.signoffs.map((s) => {
                const sop = state.data!.sops.get(s.sop_id);
                const changed = sop ? s.version < sop.current_version : false;
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
                    {sop ? (
                      <Link to={`/sops/${sop.id}`} className="min-w-0 truncate text-sm text-ink hover:text-link">{sop.title}</Link>
                    ) : (
                      <span className="min-w-0 truncate text-sm text-ink-2">An SOP that is no longer published</span>
                    )}
                    <span className={`flex shrink-0 items-center gap-2 ${metaClass}`}>
                      {changed ? <Badge tone="warning">Changed since</Badge> : null}
                      <span className="tnum">v{s.version}</span>
                      <span>{formatDate(s.signed_at)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className={`border-t border-line px-4 py-2 sm:px-6 ${metaClass}`}>{pluralize(state.data.signoffs.length, "SOP")} signed off</p>
          </>
        )
      ) : null}
    </Section>
  );
}
