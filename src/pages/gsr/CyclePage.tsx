// One review cycle: the team table. Everyone in the cycle and their review status; on a scored
// cycle their pillar scores and overall, with the team average on top; on a month (a Goal
// Setting Review) the GSR score an admin locked in, where the company scores its GSRs. Which
// columns a cycle carries, and who the cycle covers, are decided in lib/gsr/cycles.ts. Reviews
// are created on demand (or all at once) so an admin can start anyone with one click. An admin
// also chooses who is in the cycle: a person omitted from it leaves its progress, its team score
// and its Start all, and sits in a list of their own until they are added back (0034).
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Lock, Pencil, Trash2, Unlock, UserMinus, UserPlus, UsersRound } from "lucide-react";
import Avatar from "../../components/ui/Avatar.tsx";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import Field from "../../components/ui/Field.tsx";
import Modal from "../../components/ui/Modal.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import Stat from "../../components/ui/Stat.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { inputClass, tableClass, tdClass, textareaClass, thClass } from "../../components/ui/forms.ts";
import { REVIEW_STATUS_TONE } from "../../components/status.ts";
import { bandClass } from "../../components/ui/bandClass.ts";
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
  overlappingCycle,
  periodEnd,
  periodStart,
  reviewPath,
  sectionOf,
} from "../../lib/gsr/cycles.ts";
import { monthLocked } from "../../lib/gsr/goals.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate, formatPeriod, parseDate } from "../../lib/format.ts";
import { hasAccount } from "../../lib/people.ts";
import { REVIEW_STATUS_LABELS, type CycleOmission, type Profile, type ReviewCycle } from "../../types/database.ts";

// A month is a calendar month, here as in the New month form: the start snaps to the first and
// the end follows it. Other cadences keep the dates the admin types.
function monthOf(date: string): { start: string; end: string } {
  const start = periodStart("monthly", parseDate(date) ?? new Date());
  return { start, end: periodEnd("monthly", start) ?? start };
}

function EditCycleDialog({ cycle, onClose, onSaved }: { cycle: ReviewCycle; onClose: () => void; onSaved: (c: ReviewCycle) => void }) {
  const monthly = cycle.cadence === "monthly";
  const [name, setName] = useState(cycle.name);
  const [start, setStart] = useState(() => (monthly ? monthOf(cycle.period_start).start : cycle.period_start));
  const [end, setEnd] = useState(() => (monthly ? monthOf(cycle.period_start).end : cycle.period_end));
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
      const existing = overlappingCycle(await listCycles(cycle.company_id), { id: cycle.id, cadence: cycle.cadence, period_start: start, period_end: end });
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
                  if (!monthly) return setStart(e.target.value);
                  const month = monthOf(e.target.value);
                  setStart(month.start);
                  setEnd(month.end);
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Ends" htmlFor="edit-cycle-end">
              <input id="edit-cycle-end" type="date" value={end} min={start} disabled={monthly} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
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
  const monthly = sectionOf(cycle.cadence) === "gsr";

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
          {`They stop counting toward this cycle's progress and team score${monthly ? ", and are not asked for this month's GSR" : ""}. `}
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
  const { company } = useHub();
  const navigate = useNavigate();
  const companyId = company!.id;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [omitting, setOmitting] = useState<Profile | null>(null);

  const state = useAsync(async () => {
    const [cycle, reviews, pillars, people, omissions] = await Promise.all([
      getCycle(cycleId),
      listCycleReviews(cycleId),
      listPillars(companyId),
      listCompanyProfiles(companyId),
      listCycleOmissions(companyId),
    ]);
    // The roster below belongs to the active company, so the cycle has to as well. Otherwise
    // starting reviews here pairs this company's people with another company's cycle.
    assertInCompany(cycle, companyId, "review cycle");
    const scores = await listScoresForReviews(reviews.map((r) => r.id));
    return { cycle, reviews, pillars, people, scores, omissions };
  }, [cycleId, companyId]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;

  const { cycle, reviews, pillars, people, scores, omissions } = state.data;
  // A scored cycle carries pillar columns, an overall and a team score; a month carries none of
  // them, only the GSR score locked in on it where the company scores its GSRs.
  const columns = cycleColumns(cycle.cadence, pillars);
  const gsr = sectionOf(cycle.cadence) === "gsr";
  // Everyone active on the roster, whether or not they have signed in yet, less anyone omitted
  // from this cycle. A company sets its reviews up before anyone has an account, which is exactly
  // the state it is in on the day it starts, so a cycle covers the whole team unless an admin
  // says otherwise. The row says who cannot see theirs yet. Someone deactivated since, or omitted
  // since, keeps their row when their review here was signed off (cycleRoster).
  const team = cycleRoster(people, reviews, cycle.id, omissions);
  const open = cycle.status === "open";
  const omitted = cycleOmitted(people, reviews, cycle.id, omissions).map((person) => ({
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
    return { person, review, result };
  });
  // Counted over the same rows the table shows, so the fraction on top and the list below
  // never disagree about who is in this cycle.
  const complete = rows.filter((r) => r.review?.status === "complete").length;
  const teamAverage = averageScore(rows.map((r) => r.result?.overall ?? null));
  const missing = rows.filter((r) => !r.review);

  async function openReview(personId: string) {
    setBusy(true);
    setActionError("");
    try {
      const review = await ensureReview(cycle.id, companyId, personId);
      navigate(reviewPath(review.id, cycle.cadence));
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  }

  async function startAll() {
    setBusy(true);
    setActionError("");
    try {
      for (const row of missing) {
        await ensureReview(cycle.id, companyId, row.person.id);
      }
      state.reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
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

  async function toggleStatus() {
    setBusy(true);
    setActionError("");
    try {
      const next = await updateCycle(cycle.id, { status: cycle.status === "open" ? "closed" : "open" });
      state.setData((prev) => (prev ? { ...prev, cycle: next } : prev));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteCycle(cycle.id);
      navigate(SECTION_HOME[sectionOf(cycle.cadence)]);
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        backTo={SECTION_HOME[sectionOf(cycle.cadence)]}
        backLabel={SECTION_LABEL[sectionOf(cycle.cadence)]}
        eyebrow={`${CADENCE_LABELS[cycle.cadence]} · ${formatPeriod(cycle.period_start, cycle.period_end)}`}
        title={cycle.name}
        description={cycle.theme ? `Theme: ${cycle.theme}${cycle.theme_description ? `. ${cycle.theme_description}` : ""}` : undefined}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}><Pencil size={14} aria-hidden /> Edit</Button>
            <Button variant="secondary" size="sm" onClick={() => void toggleStatus()} disabled={busy}>
              {cycle.status === "open" ? <><Lock size={14} aria-hidden /> Close cycle</> : <><Unlock size={14} aria-hidden /> Reopen</>}
            </Button>
            <Button variant="danger" size="sm" onClick={() => setDeleting(true)}><Trash2 size={14} aria-hidden /> Delete</Button>
          </>
        }
      />

      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {actionError ? <Notice tone="error" className="mb-4">{actionError}</Notice> : null}

      <div className={`grid gap-4 ${columns.pillarScores ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
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
          missing.length > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => void startAll()} disabled={busy}>
              <UsersRound size={14} aria-hidden /> Start all {missing.length} reviews
            </Button>
          ) : null
        }
        padded={false}
      >
        {team.length === 0 && omitted.length > 0 ? (
          <p className="p-5 text-sm text-ink-2">Everyone is omitted from this cycle. Add someone back below.</p>
        ) : team.length === 0 ? (
          // An account is never a precondition: the roster is what a cycle covers, and people are
          // added to it with or without an invitation.
          <p className="p-5 text-sm text-ink-2">
            Nobody on the roster yet. Add the team in <Link to="/people" className="text-accent hover:underline">People</Link> and their {gsr ? "GSRs" : "reviews"} appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>Person</th>
                  <th className={thClass}>Status</th>
                  {columns.pillarScores ? (
                    <>
                      {pillars.map((p) => (
                        <th key={p.id} className={`${thClass} text-right`}>{p.name}</th>
                      ))}
                      <th className={`${thClass} text-right`}>Overall</th>
                    </>
                  ) : null}
                  {columns.gsrScore ? <th className={`${thClass} text-right`}>GSR score</th> : null}
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ person, review, result }) => (
                  <tr key={person.id} className="hover:bg-surface-2/60">
                    <td className={tdClass}>
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
                    <td className={tdClass}>
                      <Badge tone={review ? REVIEW_STATUS_TONE[review.status] : "neutral"}>
                        {review ? REVIEW_STATUS_LABELS[review.status] : "Not started"}
                      </Badge>
                    </td>
                    {columns.pillarScores ? (
                      <>
                        {pillars.map((p) => {
                          const pillar = result?.pillars.find((x) => x.pillarId === p.id);
                          return (
                            <td key={p.id} className={`${tdClass} tnum text-right text-ink-2`}>
                              {pillar?.score === null || pillar?.score === undefined ? "-" : Math.round(pillar.score)}
                            </td>
                          );
                        })}
                        <td className={`${tdClass} tnum text-right font-medium ${bandClass(result?.overall ?? null)}`}>
                          {result ? result.overall : "-"}
                        </td>
                      </>
                    ) : null}
                    {columns.gsrScore ? (
                      <td className={`${tdClass} tnum text-right`}>
                        {review && monthLocked(review) ? (
                          <span className="font-medium text-ink">{review.gsr_score}%</span>
                        ) : (
                          <span className="text-[12px] text-ink-3">{review ? "Not locked in" : "-"}</span>
                        )}
                      </td>
                    ) : null}
                    <td className={`${tdClass} text-right`}>
                      <div className="flex items-center justify-end gap-3">
                        {review ? (
                          <Link to={reviewPath(review.id, cycle.cadence)} className="text-[13px] text-accent hover:underline">Open</Link>
                        ) : (
                          <Button variant="link" onClick={() => void openReview(person.id)} disabled={busy}>
                            Start review
                          </Button>
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
              const by = people.find((p) => p.id === omission.omitted_by);
              return (
                <li key={person.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar person={person} size={28} />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{displayName(person)}</p>
                      <p className="truncate text-[12px] text-ink-3">
                        {`Omitted ${formatDate(omission.created_at)}${by ? ` by ${displayName(by)}` : ""}${omission.reason ? ` · ${omission.reason}` : ""}${review ? ` · review set aside, ${REVIEW_STATUS_LABELS[review.status].toLowerCase()}` : ""}`}
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
