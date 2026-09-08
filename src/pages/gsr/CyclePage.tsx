// One review cycle: the team table. Every active person, their review status, and their
// score, with the team average on top. Reviews are created on demand (or all at once) so
// an admin can start scoring anyone with one click.
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Lock, Pencil, Trash2, Unlock, UsersRound } from "lucide-react";
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
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { inputClass, tableClass, tdClass, textareaClass, thClass } from "../../components/ui/forms.ts";
import { REVIEW_STATUS_TONE } from "../../components/status.ts";
import { bandClass } from "../../components/ui/bandClass.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import {
  deleteCycle,
  ensureReview,
  getCycle,
  listCycleReviews,
  listPillars,
  listScoresForReviews,
  updateCycle,
} from "../../services/gsr.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { averageScore, computeReviewScore } from "../../lib/gsr/scoring.ts";
import { CADENCE_LABELS } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatPeriod } from "../../lib/format.ts";
import { REVIEW_STATUS_LABELS, type ReviewCycle } from "../../types/database.ts";

function EditCycleDialog({ cycle, onClose, onSaved }: { cycle: ReviewCycle; onClose: () => void; onSaved: (c: ReviewCycle) => void }) {
  const [name, setName] = useState(cycle.name);
  const [start, setStart] = useState(cycle.period_start);
  const [end, setEnd] = useState(cycle.period_end);
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
              <input id="edit-cycle-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Ends" htmlFor="edit-cycle-end">
              <input id="edit-cycle-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
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

export default function CyclePage() {
  const { cycleId = "" } = useParams();
  const { company } = useHub();
  const navigate = useNavigate();
  const companyId = company!.id;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const state = useAsync(async () => {
    const [cycle, reviews, pillars, people] = await Promise.all([
      getCycle(cycleId),
      listCycleReviews(cycleId),
      listPillars(companyId),
      listCompanyProfiles(companyId),
    ]);
    const scores = await listScoresForReviews(reviews.map((r) => r.id));
    return { cycle, reviews, pillars, people, scores };
  }, [cycleId, companyId]);

  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;

  const { cycle, reviews, pillars, people, scores } = state.data;
  const team = people.filter((p) => p.is_active);
  const rows = team.map((person) => {
    const review = reviews.find((r) => r.employee_id === person.id) ?? null;
    const own = review ? scores.filter((s) => s.review_id === review.id) : [];
    const result = review && own.length > 0 ? computeReviewScore(pillars, own) : null;
    return { person, review, result };
  });
  const complete = reviews.filter((r) => r.status === "complete").length;
  const teamAverage = averageScore(rows.map((r) => r.result?.overall ?? null));
  const missing = rows.filter((r) => !r.review);

  async function openReview(personId: string) {
    setBusy(true);
    setActionError("");
    try {
      const review = await ensureReview(cycle.id, companyId, personId);
      navigate(`/gsr/reviews/${review.id}`);
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
      navigate("/gsr");
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        backTo="/gsr"
        backLabel="Review cycles"
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

      {actionError ? <Notice tone="error" className="mb-4">{actionError}</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="People" value={team.length} />
        <Stat label="Reviews complete" value={`${complete}/${reviews.length}`} hint={missing.length > 0 ? `${missing.length} not started` : "Everyone has a review"} />
        <Stat label="Team score" value={<span className={bandClass(teamAverage)}>{teamAverage ?? "-"}</span>} hint="Average of scored reviews" />
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
        {team.length === 0 ? (
          <p className="p-5 text-sm text-ink-2">
            No active people in this company yet. <Link to="/people" className="text-accent hover:underline">Invite the team</Link> first.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>Person</th>
                  <th className={thClass}>Status</th>
                  {pillars.map((p) => (
                    <th key={p.id} className={`${thClass} text-right`}>{p.name}</th>
                  ))}
                  <th className={`${thClass} text-right`}>Overall</th>
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
                          <p className="truncate text-[12px] text-ink-3">{person.title ?? person.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className={tdClass}>
                      <Badge tone={review ? REVIEW_STATUS_TONE[review.status] : "neutral"}>
                        {review ? REVIEW_STATUS_LABELS[review.status] : "Not started"}
                      </Badge>
                    </td>
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
                    <td className={`${tdClass} text-right`}>
                      {review ? (
                        <Link to={`/gsr/reviews/${review.id}`} className="text-[13px] text-accent hover:underline">Open</Link>
                      ) : (
                        <button type="button" onClick={() => void openReview(person.id)} disabled={busy} className="text-[13px] text-accent hover:underline disabled:opacity-50">
                          Start review
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

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
          body="Every review and score in this cycle is deleted with it. Closing the cycle keeps the history; deleting does not."
          confirmLabel="Delete cycle"
          busy={busy}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(false)}
        />
      ) : null}
    </>
  );
}
