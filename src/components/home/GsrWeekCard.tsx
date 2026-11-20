// An admin's GSRs this week on Home, in a company whose GSRs are on demand, in place of the GSR month
// card and the GSRs complete tile a company on periods reads: this week's headline (done, average,
// in progress), up to five people overdue a GSR by their rhythm, most overdue first, and the GSRs
// log for the rest. "This week" is the company's week. Who is counted and how is gsrStanding, the
// one the log reads, over the same three reads, so the card and the log never disagree for the same
// viewer. Everyone is listed whether or not they have signed in yet.
import { Link } from "react-router-dom";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { tapTargetClass } from "../ui/tap.ts";
import { metaClass, secondaryClass } from "../ui/type.ts";
import DueBadge from "../gsr/onDemand/DueBadge.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { countedFor, gsrHeadline, gsrPeopleFor, gsrStanding, mostOverdue, notListedLine } from "../../lib/gsr/gsrStanding.ts";
import { windowRange } from "../../lib/gsr/onDemand.ts";
import { displayName, formatDate, formatPeriod } from "../../lib/format.ts";
import { companyToday } from "../../lib/wins.ts";
import { listGsrsForLog, listLastGsrDates } from "../../services/gsrOnDemand.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";

const SHOWN = 5;

export default function GsrWeekCard({ companyId }: { companyId: string }) {
  const { company, profile, isAdmin } = useHub();
  const today = companyToday(company!.time_zone);
  const range = windowRange("week", today);
  const state = useAsync(async () => {
    const [gsrs, lastDates, people] = await Promise.all([listGsrsForLog(companyId, range), listLastGsrDates(companyId), listCompanyProfiles(companyId)]);
    return { gsrs, lastDates, people };
  }, [companyId, range.from, range.to]);

  const body = () => {
    if (state.error && !state.data) return <Notice tone="error">This week's GSRs did not load. {state.error}</Notice>;
    if (!state.data) return <SkeletonRows rows={3} />;
    const { gsrs, lastDates, people } = state.data;
    const listed = gsrPeopleFor(profile, isAdmin, people);
    const { figures, rows, notListed } = gsrStanding(listed, gsrs, lastDates, range, today, countedFor(isAdmin, listed, null));
    const notListedNote = notListedLine(notListed);
    const overdue = mostOverdue(rows);
    const more = overdue.length - SHOWN;
    return (
      <>
        <p data-testid="gsr-week-headline" className="tnum font-display text-[18px] leading-snug text-heading">{gsrHeadline(figures)}</p>
        <p className={`mt-0.5 ${metaClass}`}>{formatPeriod(range.from, range.to)}</p>
        {notListedNote ? <p data-testid="gsr-week-not-listed" className={`mt-0.5 ${metaClass}`}>{notListedNote}</p> : null}
        {overdue.length === 0 ? (
          <p className={`mt-4 ${secondaryClass}`}>Nobody is overdue a GSR.</p>
        ) : (
          <>
            <ul aria-label="Overdue" className="mt-3 divide-y divide-line border-t border-line">
              {overdue.slice(0, SHOWN).map((row) => (
                <li key={row.person.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link to={`/people/${row.person.id}/gsr`} className={`truncate text-sm text-ink hover:text-link ${tapTargetClass}`}>
                      {displayName(row.person)}
                    </Link>
                    <p className={`truncate ${metaClass}`}>{row.last ? `Last GSR ${formatDate(row.last)}` : "No GSR yet"}</p>
                  </div>
                  <DueBadge state={row.due} />
                </li>
              ))}
            </ul>
            {more > 0 ? <p className={`mt-2 ${metaClass}`}>{`${more} more overdue.`}</p> : null}
          </>
        )}
      </>
    );
  };

  return (
    <Section
      eyebrow="GSRs"
      title="GSRs this week"
      actions={
        <Link to="/gsr">
          <Button variant="ghost" size="sm">All GSRs</Button>
        </Link>
      }
    >
      {body()}
    </Section>
  );
}
