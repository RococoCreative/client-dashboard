// One review cycle: the team table. Everyone in the cycle and their review status; on a scored
// cycle their pillar scores and overall, with the team average on top; on a GSR period (a Goal
// Setting Review, kind 'gsr', at any rhythm) the GSR score locked in, where the company scores its
// GSRs. A GSR period covers only the people on its rhythm (0046). Which
// columns a cycle carries, and who the cycle covers, are decided in lib/gsr/cycles.ts. Reviews
// are created on demand (or all at once) so an admin can start anyone with one click. An admin
// also chooses who is in the cycle: a person omitted from it leaves its progress, its team score
// and its Start all, and sits in a list of their own until they are added back (0034).
// A cycle cascades to every person's reviews and goals, so only a full-scope admin (an owner, a
// Rococo admin, or an admin who sees every division) edits, closes, reopens or deletes one (0038);
// any admin starts reviews and chooses who is in it. A closed cycle starts nothing (0039), and
// closing one asks first, with how many reviews in it are not complete.
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Lock, Pencil, Trash2, Unlock, UserMinus, UserPlus, UsersRound } from "lucide-react";
import Avatar from "../../components/ui/Avatar.tsx";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import Field from "../../components/ui/Field.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import Modal from "../../components/ui/Modal.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import Stat from "../../components/ui/Stat.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { edgeCellsClass, inputClass, tableClass, tdClass, textareaClass, thClass } from "../../components/ui/forms.ts";
import { REVIEW_STATUS_TONE } from "../../components/status.ts";
import { bandClass } from "../../components/ui/bandClass.ts";
import { tapTargetClass } from "../../components/ui/tap.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { assertInCompany } from "../../lib/tenancy.ts";
import {
  addBackToCycle,
  deleteCycle,
  ensureReview,
  getCycle,
  listCycleOmissions,
  listCycleReviews,
  listCycles,
  listPillars,
  listScoresForReviews,
  omitFromCycle,
  updateCycle,
} from "../../services/gsr.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { averageScore } from "../../lib/gsr/scoring.ts";
import { scoreOfRecord } from "../../lib/gsr/history.ts";
import {
  CADENCE_LABELS,
  SECTION_HOME,
  SECTION_LABEL,
  cycleColumns,
  cycleOmitted,
  cycleRoster,
  overlapMessage,
  gsrPeriodCopy,
  overlappingCycle,
  periodEnd,
  periodStart,
  reviewPath,
  sectionOf,
} from "../../lib/gsr/cycles.ts";
import { monthLocked } from "../../lib/gsr/goals.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate, formatPeriod, parseDate, pluralize } from "../../lib/format.ts";
import { hasAccount, hasFullScope } from "../../lib/people.ts";
import { listDirectory } from "../../services/directory.ts";
import { REVIEW_STATUS_LABELS, type Cadence, type CycleOmission, type Profile, type ReviewCycle } from "../../types/database.ts";

// Below md the team table stacks into compact, even rows: the name with the status badge on its
// line, then, for a row with at least one score, each score with its label beside it (the column's
// name from data-label) two to a line, then the row's actions. A row with no scores shows no score
// line at all. It is the same table underneath, with explicit table roles, the column headers kept
// for screen readers and each cell's data-label, so a screen reader still reads rows and columns.
const STACKED_SCORE =
  "max-md:flex max-md:items-start max-md:justify-between max-md:gap-2 max-md:border-b-0 max-md:!px-0 max-md:py-1 max-md:text-left " +
  "max-md:before:min-w-0 max-md:before:text-[12.5px] max-md:before:text-ink-3 max-md:before:content-[attr(data-label)]";
// A score cell on a row with no scores: the table keeps it from md, a phone leaves it out.
const STACKED_NO_SCORE = "max-md:hidden";

// A GSR period is canonical (0046), here as in the New GSR period form: the start snaps to the
// first day of the period of its rhythm that holds the picked day, and the end follows it. A
// review keeps the dates the admin types.
function periodOf(cadence: Cadence, date: string): { start: string; end: string } {
  const start = periodStart(cadence, parseDate(date) ?? new Date());
  return { start, end: periodEnd(cadence, start) ?? start };
}

function EditCycleDialog({ cycle, onClose, onSaved }: { cycle: ReviewCycle; onClose: () => void; onSaved: (c: ReviewCycle) => void }) {
  const gsrPeriod = cycle.kind === "gsr";
  const [name, setName] = useState(cycle.name);
  const [start, setStart] = useState(() => (gsrPeriod ? periodOf(cycle.cadence, cycle.period_start).start : cycle.period_start));
  const [end, setEnd] = useState(() => (gsrPeriod ? periodOf(cycle.cadence, cycle.period_start).end : cycle.period_end));
  const [theme, setTheme] = useState(cycle.theme ?? "");
  const [themeDescription, setThemeDescription] = useState(cycle.theme_description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Give the cycle a name.");
    if (end < start) return setError("The end date must be on or after the start date.");
    setBusy(true);
    setError("");
    try {
      // Read fresh, the way the New cycle form does, so the check sees every cycle as it is now.
      const existing = overlappingCycle(await listCycles(cycle.company_id), { id: cycle.id, kind: cycle.kind, cadence: cycle.cadence, period_start: start, period_end: end });
      if (existing) {
        setError(overlapMessage(existing));
        setBusy(false);
        return;
      }
      const next = await updateCycle(cycle.id, {
        name: name.trim(),
        period_start: start,
        period_end: end,
        theme: theme.trim() || null,
        theme_description: themeDescription.trim() || null,
      });
      onSaved(next);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="edit-cycle-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="edit-cycle-title" className="font-display text-lg text-heading">Edit cycle</h2>
        <div className="mt-5 space-y-4">
          <Field label="Name" htmlFor="edit-cycle-name">
            <input id="edit-cycle-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="edit-cycle-start">
              <input
                id="edit-cycle-start"
                type="date"
                value={start}
                onChange={(e) => {
                  if (!gsrPeriod) return setStart(e.target.value);
                  const month = periodOf(cycle.cadence, e.target.value);
                  setStart(month.start);
                  setEnd(month.end);
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Ends" htmlFor="edit-cycle-end">
              <input id="edit-cycle-end" type="date" value={end} min={start} disabled={gsrPeriod} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <Field label="Theme (optional)" htmlFor="edit-cycle-theme">
            <input id="edit-cycle-theme" type="text" value={theme} onChange={(e) => setTheme(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Theme description" htmlFor="edit-cycle-theme-description">
            <textarea id="edit-cycle-theme-description" value={themeDescription} onChange={(e) => setThemeDescription(e.target.value)} className={textareaClass} rows={3} />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// Omitting one person from this cycle, with an optional reason. It deletes nothing: a review
// already started is set aside as it is, and comes back if they are added back.
function OmitDialog({
  cycle,
  companyId,
  person,
  hasReview,
  onClose,
  onSaved,
}: {
  cycle: ReviewCycle;
  companyId: string;
  person: Profile;
  hasReview: boolean;
  onClose: () => void;
  onSaved: (omission: CycleOmission) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const gsrPeriod = sectionOf(cycle) === "gsr";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await omitFromCycle({ cycle_id: cycle.id, employee_id: person.id, company_id: companyId, reason: reason.trim() || null }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="omit-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="omit-title" className="font-display text-lg text-heading">Omit {displayName(person)} from {cycle.name}?</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          {`They stop counting toward this cycle's progress and team score${gsrPeriod ? `, and are not asked for ${gsrPeriodCopy(cycle.cadence).possessive} GSR` : ""}. `}
          {hasReview ? "Their review is set aside as it is, and comes back if you add them back." : "You can add them back while the cycle is open."}
        </p>
        <div className="mt-5">
          <Field label="Reason (optional)" htmlFor="omit-reason">
            <input id="omit-reason" type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="On leave, started mid-period, no GSRs in this role" />
          </Field>
        </div>
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Omit from this cycle"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function CyclePage() {
  const { cycleId = "" } = useParams();
  const { company, profile } = useHub();
  const navigate = useNavigate();
  const companyId = company!.id;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [omitting, setOmitting] = useState<Profile | null>(null);
  // Closing a cycle asks first; this is the dialog's own failure line.
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  // Start all carries on past one person's failure; what did not start is listed here.
  const [startFailures, setStartFailures] = useState<{ tried: number; lines: string[] } | null>(null);

  const state = useAsync(async () => {
    const [cycle, reviews, pillars, people, omissions, directory] = await Promise.all([
      getCycle(cycleId),
      listCycleReviews(cycleId),
      listPillars(companyId),
      listCompanyProfiles(companyId),
      listCycleOmissions(companyId),
      // Names who omitted someone, who may be an admin this viewer cannot open.
      listDirectory(companyId),
    ]);
    // The roster below belongs to the active company, so the cycle has to as well. Otherwise
    // starting reviews here pairs this company's people with another company's cycle.
    assertInCompany(cycle, companyId, "review cycle");
    const scores = await listScoresForReviews(reviews.map((r) => r.id));
    return { cycle, reviews, pillars, people, scores, omissions, directory };
  }, [cycleId, companyId]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;

  const { cycle, reviews, pillars, people, scores, omissions, directory } = state.data;
  const canRunCycle = hasFullScope(profile);
  // A scored cycle carries pillar columns, an overall and a team score; a month carries none of
  // them, only the GSR score locked in on it where the company scores its GSRs.
  const columns = cycleColumns(cycle, pillars);
  const gsr = sectionOf(cycle) === "gsr";
  // Everyone active on the roster, whether or not they have signed in yet, less anyone omitted
  // from this cycle. A company sets its reviews up before anyone has an account, which is exactly
  // the state it is in on the day it starts, so a cycle covers the whole team unless an admin
  // says otherwise. The row says who cannot see theirs yet. Someone deactivated since, or omitted
  // since, keeps their row when their review here was signed off (cycleRoster).
  const team = cycleRoster(people, reviews, cycle, omissions);
  const open = cycle.status === "open";
  const omitted = cycleOmitted(people, reviews, cycle, omissions).map((person) => ({
    person,
    omission: omissions.find((o) => o.cycle_id === cycle.id && o.employee_id === person.id)!,
    review: reviews.find((r) => r.employee_id === person.id) ?? null,
  }));
  const rows = team.map((person) => {
    const review = reviews.find((r) => r.employee_id === person.id) ?? null;
    const own = review ? scores.filter((s) => s.review_id === review.id) : [];
    // A review has a score of record once it is signed off, with the pillars it was signed off
    // with; until then its ratings live on the person and its rows are not the whole picture. A
    // month never has one: its number is the GSR score locked in on it.
    const result = review ? scoreOfRecord(review, cycle, pillars, own) : null;
    // Whether the row has any number to show; a phone leaves the score line off a row without one.
    const scored =
      (columns.pillarScores && result !== null && (result.overall !== null || result.pillars.some((p) => p.score !== null))) ||
      (columns.gsrScore && review !== null && monthLocked(review));
    return { person, review, result, scored };
  });
  // Counted over the same rows the table shows, so the fraction on top and the list below
  // never disagree about who is in this cycle.
  const complete = rows.filter((r) => r.review?.status === "complete").length;
  const teamAverage = averageScore(rows.map((r) => r.result?.overall ?? null));
  const missing = rows.filter((r) => !r.review);
  const notComplete = rows.length - complete;

  async function openReview(personId: string) {
    setBusy(true);
    setActionError("");
    try {
      const review = await ensureReview(cycle.id, companyId, personId);
      navigate(reviewPath(review.id, cycle));
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  }

  // One person's failure (a race with someone else opening theirs, a refusal) never stops the
  // rest: everyone else is started, the page reloads to show what landed, and whoever did not
  // start is named with the reason.
  async function startAll() {
    if (busy) return;
    setBusy(true);
    setActionError("");
    setStartFailures(null);
    const failures: string[] = [];
    for (const row of missing) {
      try {
        await ensureReview(cycle.id, companyId, row.person.id);
      } catch (err) {
        failures.push(`${displayName(row.person)}: ${errorMessage(err)}`);
      }
    }
    setStartFailures(failures.length > 0 ? { tried: missing.length, lines: failures } : null);
    state.reload();
    setBusy(false);
  }

  async function addBack(personId: string) {
    setBusy(true);
    setActionError("");
    try {
      await addBackToCycle(cycle.id, personId);
      state.setData((prev) => (prev ? { ...prev, omissions: prev.omissions.filter((o) => !(o.cycle_id === cycle.id && o.employee_id === personId)) } : prev));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "open" | "closed") {
    setBusy(true);
    setActionError("");
    setCloseError("");
    try {
      const next = await updateCycle(cycle.id, { status });
      state.setData((prev) => (prev ? { ...prev, cycle: next } : prev));
      setClosing(false);
    } catch (err) {
      if (status === "closed") setCloseError(errorMessage(err));
      else setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteCycle(cycle.id);
      navigate(SECTION_HOME[sectionOf(cycle)]);
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        backTo={SECTION_HOME[sectionOf(cycle)]}
        backLabel={SECTION_LABEL[sectionOf(cycle)]}
        eyebrow={`${CADENCE_LABELS[cycle.cadence]}${gsr ? " GSR" : ""} · ${formatPeriod(cycle.period_start, cycle.period_end)}`}
        title={cycle.name}
        description={cycle.theme ? `Theme: ${cycle.theme}${cycle.theme_description ? `. ${cycle.theme_description}` : ""}` : undefined}
        actions={
          canRunCycle ? (
            <>
              {/* The name, dates and theme read in the header above; the pencil opens them as one form. */}
              <IconButton label="Edit cycle" onClick={() => setEditing(true)}>
                <Pencil size={15} aria-hidden />
              </IconButton>
              {open ? (
                <Button variant="secondary" size="sm" onClick={() => { setCloseError(""); setClosing(true); }} disabled={busy}>
                  <Lock size={14} aria-hidden /> Close cycle
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void setStatus("open")} disabled={busy}>
                  <Unlock size={14} aria-hidden /> Reopen
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={() => setDeleting(true)}><Trash2 size={14} aria-hidden /> Delete</Button>
            </>
          ) : (
            <p className="max-w-xs text-right text-[12.5px] leading-snug text-ink-3">
              Only an owner or an admin who sees every division can edit, close or delete a cycle.
            </p>
          )
        }
      />

      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {actionError ? <Notice tone="error" className="mb-4">{actionError}</Notice> : null}
      {startFailures ? (
        <Notice tone="error" className="mb-4">
          {`${pluralize(startFailures.lines.length, gsr ? "GSR" : "review")} of ${startFailures.tried} did not start${startFailures.lines.length < startFailures.tried ? "; the rest did" : ""}. `}
          {startFailures.lines.join(" ")}
        </Notice>
      ) : null}
      {!open ? (
        <Notice tone="info" className="mb-4">
          {`${cycle.name} is closed, so nothing new starts in it and its ${gsr ? "GSRs" : "reviews"} stay as they are. ${canRunCycle ? "Reopen the cycle" : "An owner or an admin who sees every division can reopen it"} to start or change one.`}
        </Notice>
      ) : null}

      <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${columns.pillarScores ? "sm:grid-cols-3" : ""}`}>
        <Stat label="People" value={team.length} hint={omitted.length > 0 ? `${omitted.length} omitted from this cycle` : undefined} />
        <Stat
          label={gsr ? "GSRs complete" : "Reviews complete"}
          value={`${complete}/${team.length}`}
          hint={missing.length > 0 ? `${missing.length} not started` : gsr ? "Everyone has a GSR" : "Everyone has a review"}
        />
        {columns.pillarScores ? (
          <Stat label="Team score" value={<span className={bandClass(teamAverage)}>{teamAverage ?? "-"}</span>} hint="Average of scored reviews" />
        ) : null}
      </div>

      <Section
        className="mt-6"
        eyebrow="Team"
        title="Reviews"
        actions={
          missing.length > 0 && open ? (
            <Button size="sm" onClick={() => void startAll()} disabled={busy}>
              <UsersRound size={14} aria-hidden /> Start all {missing.length} reviews
            </Button>
          ) : null
        }
        padded={false}
      >
        {team.length === 0 && omitted.length > 0 ? (
          <p className="p-4 text-sm text-ink-2 sm:p-6">Everyone is omitted from this cycle. Add someone back below.</p>
        ) : team.length === 0 ? (
          // An account is never a precondition: the roster is what a cycle covers, and people are
          // added to it with or without an invitation.
          <p className="p-4 text-sm text-ink-2 sm:p-6">
            Nobody on the roster yet. Add the team in <Link to="/people" className="text-link hover:underline">People</Link> and their {gsr ? "GSRs" : "reviews"} appear here.
          </p>
        ) : (
          <div className="relative md:overflow-x-auto">
            <table role="table" className={`${tableClass} max-md:block`}>
              <thead role="rowgroup" className="max-md:sr-only">
                <tr role="row" className={edgeCellsClass}>
                  <th role="columnheader" className={thClass}>Person</th>
                  <th role="columnheader" className={thClass}>Status</th>
                  {columns.pillarScores ? (
                    <>
                      {pillars.map((p) => (
                        <th key={p.id} role="columnheader" className={`${thClass} text-right`}>{p.name}</th>
                      ))}
                      <th role="columnheader" className={`${thClass} text-right`}>Overall</th>
                    </>
                  ) : null}
                  {columns.gsrScore ? <th role="columnheader" className={`${thClass} text-right`}>GSR score</th> : null}
                  <th role="columnheader" className={thClass}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody role="rowgroup" className="max-md:block">
                {rows.map(({ person, review, result, scored }) => (
                  <tr key={person.id} role="row" className={`${edgeCellsClass} hover:bg-surface-2/60 max-md:grid max-md:grid-cols-2 max-md:gap-x-6 max-md:relative max-md:border-b max-md:border-line max-md:px-4 max-md:py-2.5 max-md:last:border-b-0`}>
                    <td role="cell" className={`${tdClass} max-md:col-span-full max-md:block max-md:border-b-0 max-md:!p-0 max-md:!pr-28`}>
                      <div className="flex items-center gap-3">
                        <Avatar person={person} size={28} />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{displayName(person)}</p>
                          <p className="truncate text-[12px] text-ink-3">
                            {person.title ?? person.email}
                            {hasAccount(person) ? "" : " · not signed in yet"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td role="cell" data-label="Status" className={`${tdClass} max-md:absolute max-md:top-2.5 max-md:right-4 max-md:flex max-md:h-[38px] max-md:items-center max-md:border-b-0 max-md:!p-0`}>
                      <Badge tone={review ? REVIEW_STATUS_TONE[review.status] : "neutral"}>
                        {review ? REVIEW_STATUS_LABELS[review.status] : "Not started"}
                      </Badge>
                    </td>
                    {columns.pillarScores ? (
                      <>
                        {pillars.map((p) => {
                          const pillar = result?.pillars.find((x) => x.pillarId === p.id);
                          return (
                            <td key={p.id} role="cell" data-label={p.name} className={`${tdClass} tnum text-right text-ink-2 ${scored ? STACKED_SCORE : STACKED_NO_SCORE}`}>
                              {pillar?.score === null || pillar?.score === undefined ? "-" : Math.round(pillar.score)}
                            </td>
                          );
                        })}
                        <td role="cell" data-label="Overall" className={`${tdClass} tnum text-right font-medium ${bandClass(result?.overall ?? null)} ${scored ? STACKED_SCORE : STACKED_NO_SCORE}`}>
                          {result ? result.overall : "-"}
                        </td>
                      </>
                    ) : null}
                    {columns.gsrScore ? (
                      <td role="cell" data-label="GSR score" className={`${tdClass} tnum text-right ${scored ? STACKED_SCORE : STACKED_NO_SCORE}`}>
                        {review && monthLocked(review) ? (
                          <span className="font-medium text-ink">{review.gsr_score}%</span>
                        ) : (
                          <span className="text-[12px] text-ink-3">{review ? "Not locked in" : "-"}</span>
                        )}
                      </td>
                    ) : null}
                    <td role="cell" className={`${tdClass} text-right max-md:col-span-full max-md:block max-md:border-b-0 max-md:!p-0`}>
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap max-md:justify-start">
                        {review ? (
                          <Link to={reviewPath(review.id, cycle)} className={`text-[13px] text-link hover:underline ${tapTargetClass}`}>Open</Link>
                        ) : open ? (
                          <Button variant="link" onClick={() => void openReview(person.id)} disabled={busy}>
                            Start review
                          </Button>
                        ) : (
                          <span className="text-[12px] text-ink-3">Cycle closed</span>
                        )}
                        {open && review?.status !== "complete" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setOmitting(person)}
                            disabled={busy}
                            aria-label={`Omit ${displayName(person)} from this cycle`}
                          >
                            <UserMinus size={13} aria-hidden /> Omit
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {omitted.length > 0 ? (
        <Section
          className="mt-6"
          eyebrow="Omitted"
          title="Not in this cycle"
          description="They do not count toward this cycle's progress or team score. Anything already started is kept as it is."
          padded={false}
        >
          <ul className="divide-y divide-line">
            {omitted.map(({ person, omission, review }) => {
              const by = omission.omitted_by ? (directory.find((d) => d.id === omission.omitted_by)?.full_name?.trim() || null) : null;
              return (
                <li key={person.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar person={person} size={28} />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{displayName(person)}</p>
                      <p className="truncate text-[12px] text-ink-3">
                        {`Omitted ${formatDate(omission.created_at)}${by ? ` by ${by}` : ""}${omission.reason ? ` · ${omission.reason}` : ""}${review ? ` · review set aside, ${REVIEW_STATUS_LABELS[review.status].toLowerCase()}` : ""}`}
                      </p>
                    </div>
                  </div>
                  {open ? (
                    <Button size="sm" variant="secondary" onClick={() => void addBack(person.id)} disabled={busy} aria-label={`Add ${displayName(person)} back to this cycle`}>
                      <UserPlus size={14} aria-hidden /> Add back
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {omitting ? (
        <OmitDialog
          cycle={cycle}
          companyId={companyId}
          person={omitting}
          hasReview={reviews.some((r) => r.employee_id === omitting.id)}
          onClose={() => setOmitting(null)}
          onSaved={(omission) => {
            setOmitting(null);
            state.setData((prev) => (prev ? { ...prev, omissions: [...prev.omissions, omission] } : prev));
          }}
        />
      ) : null}
      {editing ? (
        <EditCycleDialog
          cycle={cycle}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false);
            state.setData((prev) => (prev ? { ...prev, cycle: next } : prev));
          }}
        />
      ) : null}
      {closing ? (
        <ConfirmDialog
          title={`Close ${cycle.name}?`}
          body={
            notComplete > 0
              ? `${notComplete} of ${pluralize(rows.length, gsr ? "GSR" : "review")} in it ${notComplete === 1 ? "is" : "are"} not complete. Closing keeps them as they are: nothing can be started, marked complete or changed until the cycle is reopened${gsr ? `, and a ${gsrPeriodCopy(cycle.cadence).noun} that is not locked in does not count toward a scored review` : ""}.`
              : `Every ${gsr ? "GSR" : "review"} in it is complete. Closing keeps them as they are until the cycle is reopened.`
          }
          confirmLabel="Close cycle"
          tone="primary"
          busy={busy}
          error={closeError}
          onConfirm={() => void setStatus("closed")}
          onCancel={() => { setClosing(false); setCloseError(""); }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete "${cycle.name}"?`}
          body="This deletes the cycle, every review and score in it, and the goals filed into it. Closing the cycle keeps the history; deleting does not."
          confirmLabel="Delete cycle"
          busy={busy}
          error={actionError}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(false)}
        />
      ) : null}
    </>
  );
}
