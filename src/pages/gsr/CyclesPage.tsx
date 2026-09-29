// The cycles list behind two sidebar entries: GSRs (monthly Goal Setting Reviews) and Reviews
// (every scored cadence), one component keyed on the section. Progress per cycle, the team score
// where a cycle carries one, the door to settings and company goals on the Reviews side, and the
// new-cycle form offering only the cadences that belong to the section. The period math
// (cadence -> dates -> name) lives in lib/gsr/cycles.ts.
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Settings2, Target } from "lucide-react";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Field from "../../components/ui/Field.tsx";
import Modal from "../../components/ui/Modal.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { inputClass, selectClass, textareaClass } from "../../components/ui/forms.ts";
import { CYCLE_STATUS_TONE } from "../../components/status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { createCycle, listCompanyReviews, listCycles, listPillars, listScoresForReviews } from "../../services/gsr.ts";
import { averageScore, computeReviewScore } from "../../lib/gsr/scoring.ts";
import { CADENCE_LABELS, SECTION_LABEL, cyclePath, defaultCycleName, periodEnd, periodStart, sectionOf, type HubSection } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatPeriod, parseDate, todayIso } from "../../lib/format.ts";
import type { Cadence, ReviewCycle } from "../../types/database.ts";

// The cadences a section files: a GSR is monthly by definition, a review is anything scored.
const SECTION_CADENCES: Record<HubSection, Cadence[]> = {
  gsr: ["monthly"],
  reviews: ["quarterly", "annual", "custom"],
};

function NewCycleDialog({
  companyId,
  section,
  onClose,
  onCreated,
}: {
  companyId: string;
  section: HubSection;
  onClose: () => void;
  onCreated: (cycle: ReviewCycle) => void;
}) {
  const first = SECTION_CADENCES[section][0];
  const [cadence, setCadence] = useState<Cadence>(first);
  const [start, setStart] = useState(() => periodStart(first, new Date()));
  const [end, setEnd] = useState(() => periodEnd(first, periodStart(first, new Date())) ?? todayIso());
  const [name, setName] = useState(() => defaultCycleName(first, periodStart(first, new Date())));
  const [nameTouched, setNameTouched] = useState(false);
  const [theme, setTheme] = useState("");
  const [themeDescription, setThemeDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Cadence, start, and end move together: fixed rhythms compute their own end, and the
  // name follows the period until the admin edits it by hand.
  function applyPeriod(nextCadence: Cadence, nextStart: string, nextEnd: string) {
    const computedEnd = periodEnd(nextCadence, nextStart) ?? nextEnd;
    setCadence(nextCadence);
    setStart(nextStart);
    setEnd(computedEnd);
    if (!nameTouched) setName(defaultCycleName(nextCadence, nextStart, computedEnd));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError("Give the cycle a name.");
      return;
    }
    if (end < start) {
      setError("The end date must be on or after the start date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const cycle = await createCycle({
        company_id: companyId,
        name: name.trim(),
        cadence,
        period_start: start,
        period_end: end,
        theme: theme.trim() || null,
        theme_description: themeDescription.trim() || null,
      });
      onCreated(cycle);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="new-cycle-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="new-cycle-title" className="font-display text-lg text-heading">{section === "gsr" ? "New Goal Setting Review" : "New review cycle"}</h2>
        <p className="mt-1 text-[13px] text-ink-2">{section === "gsr" ? "One GSR per person for the month." : "One review per person for the period. You choose the rhythm."}</p>
        <div className="mt-5 space-y-4">
          <Field label="Cadence" htmlFor="cycle-cadence">
            <select
              id="cycle-cadence"
              value={cadence}
              onChange={(e) => {
                const next = e.target.value as Cadence;
                applyPeriod(next, next === "custom" ? start : periodStart(next, parseDate(start) ?? new Date()), end);
              }}
              className={selectClass}
            >
              {SECTION_CADENCES[section].map((key) => (
                <option key={key} value={key}>{CADENCE_LABELS[key]}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="cycle-start">
              <input
                id="cycle-start"
                type="date"
                value={start}
                onChange={(e) => applyPeriod(cadence, cadence === "custom" ? e.target.value : periodStart(cadence, parseDate(e.target.value) ?? new Date()), end)}
                className={inputClass}
              />
            </Field>
            <Field label="Ends" htmlFor="cycle-end">
              <input
                id="cycle-end"
                type="date"
                value={end}
                min={start}
                disabled={cadence !== "custom"}
                onChange={(e) => applyPeriod(cadence, start, e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Name" htmlFor="cycle-name">
            <input
              id="cycle-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Theme (optional)" htmlFor="cycle-theme" hint="A company-wide focus for the period, like a core value or a process push.">
            <input id="cycle-theme" type="text" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Core value: Integrity" className={inputClass} />
          </Field>
          {theme.trim() ? (
            <Field label="Theme description" htmlFor="cycle-theme-description">
              <textarea id="cycle-theme-description" value={themeDescription} onChange={(e) => setThemeDescription(e.target.value)} className={textareaClass} rows={3} />
            </Field>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Creating..." : "Create cycle"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function CyclesPage({ section }: { section: HubSection }) {
  const { company } = useHub();
  const navigate = useNavigate();
  const companyId = company!.id;
  const [creating, setCreating] = useState(false);
  const gsr = section === "gsr";

  const state = useAsync(async () => {
    const [cycles, reviews, pillars] = await Promise.all([listCycles(companyId), listCompanyReviews(companyId), listPillars(companyId)]);
    const scores = await listScoresForReviews(reviews.map((r) => r.id));
    return { cycles, reviews, pillars, scores };
  }, [companyId]);
  const cycles = (state.data?.cycles ?? []).filter((c) => sectionOf(c.cadence) === section);

  return (
    <>
      <PageHeader
        eyebrow={gsr ? "Monthly" : "Quarterly, annual and custom"}
        title={SECTION_LABEL[section]}
        description={
          gsr
            ? "One month, one meeting per person: last month read back as hit or miss, this month's goals and action steps, the focus topic. Nothing is scored here."
            : "Each cycle creates one review per person. Score the pillars, leave feedback, and watch the team average."
        }
        actions={
          <>
            {gsr ? null : (
              <>
                <Link to="/reviews/company-goals">
                  <Button variant="secondary" size="sm"><Target size={14} aria-hidden /> Company goals</Button>
                </Link>
                <Link to="/reviews/settings">
                  <Button variant="secondary" size="sm"><Settings2 size={14} aria-hidden /> Pillars and weights</Button>
                </Link>
              </>
            )}
            <Button size="sm" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> {gsr ? "New month" : "New cycle"}</Button>
          </>
        }
      />

      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {!state.data && !state.error ? (
        <SkeletonRows rows={4} />
      ) : !state.data ? null : cycles.length === 0 ? (
        <EmptyState
          eyebrow={gsr ? "No months yet" : "No cycles yet"}
          title={gsr ? "Open the first month" : "Start the first review cycle"}
          body={
            gsr
              ? "A Goal Setting Review is one month: the hub opens a GSR for every person and reads last month back the month after."
              : "Pick a cadence (quarterly, annual, or custom dates) and the hub creates a review for every person."
          }
          action={<Button onClick={() => setCreating(true)}>{gsr ? "New month" : "New cycle"}</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {cycles.map((cycle) => {
            const reviews = state.data!.reviews.filter((r) => r.cycle_id === cycle.id);
            const complete = reviews.filter((r) => r.status === "complete").length;
            const team = averageScore(
              reviews.map((r) => {
                const own = state.data!.scores.filter((s) => s.review_id === r.id);
                return own.length > 0 ? computeReviewScore(state.data!.pillars, own).overall : null;
              }),
            );
            return (
              <li key={cycle.id}>
                <Link
                  to={cyclePath(cycle)}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface px-5 py-4 transition-colors duration-150 hover:border-line-strong"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-lg text-heading">{cycle.name}</h2>
                      <Badge tone={CYCLE_STATUS_TONE[cycle.status]}>{cycle.status === "open" ? "Open" : "Closed"}</Badge>
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-2">
                      {formatPeriod(cycle.period_start, cycle.period_end)} · {CADENCE_LABELS[cycle.cadence]}
                      {cycle.theme ? ` · Theme: ${cycle.theme}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-6 text-right">
                    <div>
                      <p className="text-[11px] uppercase tracking-label text-ink-3">Reviews</p>
                      <p className="tnum text-sm text-ink">{complete}/{reviews.length} complete</p>
                    </div>
                    {gsr ? null : (
                      <div>
                        <p className="text-[11px] uppercase tracking-label text-ink-3">Team</p>
                        <p className="tnum text-sm text-ink">{team ?? "-"}</p>
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {creating ? (
        <NewCycleDialog
          companyId={companyId}
          section={section}
          onClose={() => setCreating(false)}
          onCreated={(cycle) => {
            setCreating(false);
            navigate(cyclePath(cycle));
          }}
        />
      ) : null}
    </>
  );
}
