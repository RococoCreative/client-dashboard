// One GSR on demand: a person's Goal Setting Review that stands on its own, with no cycle, in a
// company whose gsr_mode is on demand (0047). It carries what a monthly GSR carries, from the same
// parts: the opening discussion, the goals (ranked, mandatory and stretch counted, the role's goals
// in one click, notes, tasks on goals), the focus topic of the month it began in, the role
// scorecard for that month and project notes.
//
// It stays open while the work happens. Someone who leads the person, or an admin, marks it done,
// which locks its score (scoreMonth over its own goals, against the company's number of mandatory
// goals); "Mark done" is the page's one primary action. Nobody marks their own GSR done or reopens
// it, whatever their role: the person sees a quiet line instead, and the database refuses it too.
// A done GSR is read only until the same people reopen it. An admin may delete it, from the foot
// of the page, away from the everyday controls.
//
// A company on periods never reaches this page: the route renders ReviewPage there. The GSR is
// loaded by its id and checked against the active company, so a Rococo admin who switches company
// in the sidebar is told it is not here rather than shown another tenant's GSR.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, RotateCcw } from "lucide-react";
import GsrGoalsPanel from "../../components/gsr/onDemand/GsrGoalsPanel.tsx";
import ReviewPerformance from "../../components/gsr/ReviewPerformance.tsx";
import ReviewProjects from "../../components/gsr/ReviewProjects.tsx";
import SupportDiscussionCard from "../../components/gsr/SupportDiscussionCard.tsx";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { hasModule } from "../../lib/modules.ts";
import { ledBy } from "../../lib/people.ts";
import { assertInCompany } from "../../lib/tenancy.ts";
import { monthOf } from "../../lib/scorecard.ts";
import { monthTotal, scoreMonth } from "../../lib/gsr/goals.ts";
import { gsrGoals, isOpen } from "../../lib/gsr/onDemand.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate } from "../../lib/format.ts";
import { listGoalNotes, listGoals, listPillars, updateReview } from "../../services/gsr.ts";
import { deleteGsr, getGsr, listPersonGsrs, markGsrDone, reopenGsr } from "../../services/gsrOnDemand.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listDirectory } from "../../services/directory.ts";
import { listFocusTopics } from "../../services/focusTopics.ts";
import { listJobRoleGoals, listJobRoles } from "../../services/jobRoles.ts";
import { listMetricEntries, listRoleMetrics } from "../../services/scorecards.ts";
import { listProjectAssignments } from "../../services/projectAssignments.ts";
import { listProjects } from "../../services/projects.ts";
import { listReviewProjectNotes } from "../../services/reviewProjectNotes.ts";
import { listTasksForGoals } from "../../services/tasks.ts";
import type { TaskWithSteps } from "../../types/database.ts";

// What the Mark done dialog shows and writes: the score of the goals as they were read again when it
// opened, or no score where the company does not score its GSRs.
type Closing = { score: number; total: number; cap: number } | { score: null };

export default function GsrPage() {
  const { reviewId = "" } = useParams();
  const navigate = useNavigate();
  const { company, profile, isAdmin } = useHub();
  const companyId = company!.id;
  const tasksOn = hasModule(company, "tasks");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<Closing | null>(null);
  const [deleting, setDeleting] = useState(false);
  // The dialogs' own failure line, so an earlier failure on the page never shows inside one.
  const [dialogError, setDialogError] = useState("");

  const state = useAsync(async () => {
    const gsr = await getGsr(reviewId);
    assertInCompany(gsr, companyId, "GSR");
    const month = monthOf(gsr.started_on);
    const [personGsrs, people, goals, notes, directory, pillars, topics, assignments, projects, projectNotes, metrics] = await Promise.all([
      listPersonGsrs(companyId, gsr.employee_id),
      // The people the viewer may see (RLS): the person, whether the viewer leads them, and the task
      // form's picker. Names of anyone else come from the directory.
      listCompanyProfiles(companyId),
      listGoals(companyId, gsr.employee_id),
      listGoalNotes(companyId, gsr.employee_id),
      listDirectory(companyId),
      listPillars(companyId),
      // The focus topic of the month the GSR began in.
      listFocusTopics(companyId, month, month),
      listProjectAssignments(companyId, { employeeId: gsr.employee_id }),
      listProjects(companyId, { includeArchived: true }),
      listReviewProjectNotes(gsr.id),
      listRoleMetrics(companyId, true),
    ]);
    const person = people.find((p) => p.id === gsr.employee_id) ?? null;
    const roleId = person?.job_role_id ?? null;
    const [roleGoals, entries, goalTasks] = await Promise.all([
      // A retired role stays on their record but brings nothing new, so its goals are offered only
      // while the role is active (listJobRoles returns active roles).
      roleId
        ? Promise.all([listJobRoles(companyId), listJobRoleGoals(companyId, roleId)]).then(([roles, templates]) => (roles.some((r) => r.id === roleId) ? templates : []))
        : Promise.resolve([]),
      metrics.length > 0 ? listMetricEntries(companyId, { employeeId: gsr.employee_id, year: Number(month.slice(0, 4)) }) : Promise.resolve([]),
      tasksOn ? listTasksForGoals(companyId, gsrGoals(goals, gsr.id).map((g) => g.id)) : Promise.resolve<TaskWithSteps[] | null>(null),
    ]);
    return { gsr, personGsrs, people, goals, notes, directory, pillars, topic: topics[0] ?? null, assignments, projects, projectNotes, metrics, roleGoals, entries, goalTasks, month };
  }, [reviewId, companyId, tasksOn]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;

  const { gsr, people, goals, notes, directory, pillars, topic, assignments, projects, projectNotes, metrics, roleGoals, entries, goalTasks, month } = state.data;
  const employee = people.find((p) => p.id === gsr.employee_id) ?? null;
  const names = new Map(directory.map((entry) => [entry.id, entry.full_name?.trim() || "Unnamed"] as const));
  const personName = employee ? displayName(employee) : (names.get(gsr.employee_id) ?? "Person");
  const isOwn = gsr.employee_id === profile.id;
  // The viewer leads the person: their manager, or anyone up the chain above them (lib/people.ts,
  // the same test ReviewPage makes for a monthly GSR).
  const leads = !isOwn && ledBy(profile, people).some((p) => p.id === gsr.employee_id);
  // Marking done and reopening: those who lead the person and admins, never the person themself.
  const canClose = !isOwn && (isAdmin || leads);
  const open = isOpen(gsr);
  // The person, those who lead them and admins work an open GSR's goals; RLS keeps it to them.
  const canEdit = (isAdmin || isOwn || leads) && open;
  // As on a monthly GSR: the opening discussion is the person's and an admin's, the scorecard and
  // project notes an admin's.
  const canDiscuss = (isAdmin || isOwn) && open;
  const canEnter = isAdmin && open;
  const required = pillars.find((p) => p.scoring_type === "gsr_goals" && p.is_active)?.required_goals ?? null;
  const markedBy = gsr.reviewer_id ? (names.get(gsr.reviewer_id) ?? (gsr.reviewer_id === profile.id && profile.is_rococo_admin ? "Rococo" : "someone no longer listed")) : null;
  const back = isOwn ? { to: "/my/gsr", label: "My GSR" } : { to: `/people/${gsr.employee_id}/gsr`, label: personName };

  const setData = (update: (prev: NonNullable<typeof state.data>) => NonNullable<typeof state.data>) => state.setData((prev) => (prev ? update(prev) : prev));

  async function saveDiscussion(next: string | null): Promise<boolean> {
    setError("");
    try {
      const saved = await updateReview(gsr.id, { support_discussion: next });
      setData((prev) => ({ ...prev, gsr: { ...prev.gsr, support_discussion: saved.support_discussion } }));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  // The goals are read again before the dialog opens, so it shows, and Mark done writes, the score
  // of the goals on record now.
  async function startDone() {
    setBusy(true);
    setDialogError("");
    try {
      const fresh = await listGoals(companyId, gsr.employee_id);
      setData((prev) => ({ ...prev, goals: fresh }));
      const own = gsrGoals(fresh, gsr.id);
      setClosing(required ? { ...monthTotal(own, required), score: scoreMonth(own, required) } : { score: null });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function markDone() {
    if (!closing) return;
    setBusy(true);
    setDialogError("");
    try {
      const next = await markGsrDone(gsr.id, closing.score, profile.id);
      setData((prev) => ({ ...prev, gsr: next }));
      setClosing(null);
      setError("");
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    setError("");
    try {
      const next = await reopenGsr(gsr.id);
      setData((prev) => ({ ...prev, gsr: next }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setDialogError("");
    try {
      await deleteGsr(gsr.id);
      navigate(back.to);
    } catch (err) {
      setDialogError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        backTo={back.to}
        backLabel={back.label}
        eyebrow="Goal Setting Review"
        title={`GSR · ${formatDate(gsr.started_on)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-ink">{personName}</span>
            {employee?.title ? <span>{employee.title}</span> : null}
            <Badge tone={open ? "info" : "success"}>{open ? "In progress" : `Done ${formatDate(gsr.done_on)}`}</Badge>
            {!open && markedBy ? (
              <span className="tnum text-ink-3">{gsr.gsr_score !== null ? `${gsr.gsr_score}% · Marked done by ${markedBy}` : `Marked done by ${markedBy}`}</span>
            ) : null}
          </span>
        }
        actions={
          canClose ? (
            open ? (
              <Button size="sm" disabled={busy} onClick={() => void startDone()}>
                <CheckCircle2 size={14} aria-hidden /> Mark done
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void reopen()}>
                <RotateCcw size={14} aria-hidden /> Reopen
              </Button>
            )
          ) : isOwn && open ? (
            <p className="max-w-xs text-[12.5px] leading-snug text-ink-3">Your manager marks this GSR done.</p>
          ) : null
        }
      />

      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}

      <div className="mb-6">
        <SupportDiscussionCard value={gsr.support_discussion} canWrite={canDiscuss} isOwn={isOwn} signedOff={!open} onSave={saveDiscussion} />
      </div>

      {/* Last GSR, the person's previous GSR read back, takes its place here beside the goals. */}

      <div className="mb-6">
        <GsrGoalsPanel
          gsr={gsr}
          goals={goals}
          notes={notes}
          names={names}
          roleGoals={roleGoals}
          required={required}
          topic={topic}
          canEdit={canEdit}
          taskLinks={
            goalTasks
              ? {
                  tasks: goalTasks,
                  people,
                  viewerProfileId: profile.id,
                  onTasks: (update) => setData((prev) => ({ ...prev, goalTasks: update(prev.goalTasks ?? []) })),
                }
              : null
          }
          onGoals={(update) => setData((prev) => ({ ...prev, goals: update(prev.goals) }))}
          onNotes={(update) => setData((prev) => ({ ...prev, notes: update(prev.notes) }))}
          onError={setError}
        />
      </div>

      {/* The role scorecard for the month the GSR began in, for a company that keeps scorecards. */}
      {employee && metrics.length > 0 ? (
        <div className="mb-6">
          <ReviewPerformance
            companyId={companyId}
            employee={employee}
            month={month}
            metrics={metrics}
            entries={entries}
            assignments={assignments}
            projects={projects}
            canEnter={canEnter}
            isOwn={isOwn}
            onEntries={(update) => setData((prev) => ({ ...prev, entries: update(prev.entries) }))}
          />
        </div>
      ) : null}

      <div className="mb-6 empty:hidden">
        <ReviewProjects
          review={gsr}
          assignments={assignments}
          projects={projects}
          notes={projectNotes}
          canWrite={canEnter}
          isOwn={isOwn}
          onNotes={(update) => setData((prev) => ({ ...prev, projectNotes: update(prev.projectNotes) }))}
        />
      </div>

      {/* Deleting is rare and takes the goals with it, so it sits at the foot, worded, away from the
          everyday controls. An admin's alone, as for every review. */}
      {isAdmin ? (
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-[12.5px] text-ink-3">Deleting a GSR removes it and its goals for good.</p>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => { setDialogError(""); setDeleting(true); }}>
            Delete GSR
          </Button>
        </div>
      ) : null}

      {closing ? (
        <ConfirmDialog
          title={closing.score !== null ? `Mark this GSR done at ${closing.score}%?` : "Mark this GSR done?"}
          body={
            closing.score !== null
              ? `Its goals add up to ${closing.total}% of ${closing.cap}%, as they stand now. Marking it done locks that score in, with its goals and notes. Reopen it to change them.`
              : "Marking it done puts its goals and notes on record as they stand now. Reopen it to change them."
          }
          confirmLabel="Mark done"
          tone="primary"
          busy={busy}
          error={dialogError}
          onConfirm={() => void markDone()}
          onCancel={() => setClosing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete this GSR and its goals?"
          body={`${personName}'s GSR from ${formatDate(gsr.started_on)} is removed, with its goals, their steps and notes. This cannot be undone.`}
          confirmLabel="Delete GSR"
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(false)}
        />
      ) : null}
    </>
  );
}
