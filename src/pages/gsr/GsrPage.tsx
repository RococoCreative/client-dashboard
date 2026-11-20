// One GSR on demand: a person's Goal Setting Review that stands on its own, with no cycle, in a
// company whose gsr_mode is on demand (0047). It carries what a monthly GSR carries, from the same
// parts: the opening discussion, the goals (ranked, mandatory and stretch counted, the role's goals
// in one click, notes, tasks on goals), the focus topic of the month it began in, the role
// scorecard for that month and project notes.
//
// The person's last GSR, whatever its state and however long ago, reads back beside the goals
// (LastGsrPanel), so the meeting talks it through while it sets this one, and can mark it done there.
//
// It stays open while the work happens. Someone who leads the person, or an admin, marks it done,
// which locks its score (scoreMonth over its own goals, against the company's number of mandatory
// goals); "Mark done" is the page's one primary action. Nobody marks their own GSR done or reopens
// it, whatever their role: the person sees a quiet line instead, and the database refuses it too.
// A done GSR is read only until the same people reopen it. An admin may delete it, from the foot
// of the page, away from the everyday controls; never their own once it is done.
//
// Arriving from a start that found two GSRs open already (useStartGsr, router state atLimit), the
// page says so once: which GSR to close first, where to do it, or, for the person themself, that
// their manager does it. Arriving from a start that landed on today's GSR, already done (router
// state doneToday), it says a new one can be started tomorrow. The state is taken off the address
// as it is read, so a reload, a later visit or a Back to it does not say it again.
//
// A company on periods never reaches this page: the route renders ReviewPage there. The GSR is
// loaded by its id and checked against the active company, so a Rococo admin who switches company
// in the sidebar is told it is not here rather than shown another tenant's GSR.
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import GsrGoalsPanel from "../../components/gsr/onDemand/GsrGoalsPanel.tsx";
import LastGsrPanel from "../../components/gsr/onDemand/LastGsrPanel.tsx";
import MarkGsrDone from "../../components/gsr/onDemand/MarkGsrDone.tsx";
import ReviewPerformance from "../../components/gsr/ReviewPerformance.tsx";
import ReviewProjects from "../../components/gsr/ReviewProjects.tsx";
import SupportDiscussionCard from "../../components/gsr/SupportDiscussionCard.tsx";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import Notice from "../../components/ui/Notice.tsx";
import { tapTargetClass } from "../../components/ui/tap.ts";
import PageHeader from "../../components/ui/PageHeader.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { hasModule } from "../../lib/modules.ts";
import { ledBy } from "../../lib/people.ts";
import { assertInCompany } from "../../lib/tenancy.ts";
import { monthOf } from "../../lib/scorecard.ts";
import { gsrGoals, isOpen, previousGsr } from "../../lib/gsr/onDemand.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate } from "../../lib/format.ts";
import { listGoalNotes, listGoals, listPillars, updateReview } from "../../services/gsr.ts";
import { deleteGsr, getGsr, listPersonGsrs, reopenGsr } from "../../services/gsrOnDemand.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listDirectory } from "../../services/directory.ts";
import { listFocusTopics } from "../../services/focusTopics.ts";
import { listJobRoleGoals, listJobRoles } from "../../services/jobRoles.ts";
import { listMetricEntries, listRoleMetrics } from "../../services/scorecards.ts";
import { listProjectAssignments } from "../../services/projectAssignments.ts";
import { listProjects } from "../../services/projects.ts";
import { listReviewProjectNotes } from "../../services/reviewProjectNotes.ts";
import { listTasksForGoals } from "../../services/tasks.ts";
import type { Gsr, TaskWithSteps } from "../../types/database.ts";
import type { ProjectNotesWording } from "../../components/gsr/ReviewProjects.tsx";

// The project notes' lines on a GSR, which is marked done rather than signed off.
const GSR_PROJECT_WORDING: ProjectNotesWording = {
  signedOff: "The note on each project, as it was when this GSR was marked done.",
  writer: "A note on each project the person is assigned to, written in the GSR. The person reads them on their own GSR.",
  own: "Your manager's note on each of your projects from this GSR.",
  other: "The note on each project from this GSR.",
};

// What a start can leave for the page to say once (useStartGsr's router state).
type ArrivalNotice = "atLimit" | "doneToday";

// The notice for a GSR opened at the limit: the other open GSR is the one to close first. It is
// closed right here when the Last GSR panel is showing it; otherwise the notice links to it. The
// person themself hears only that their manager closes it, since they never close their own.
function LimitNotice({ gsr, personGsrs, last, personName, isOwn }: { gsr: Gsr; personGsrs: Gsr[]; last: Gsr | null; personName: string; isOwn: boolean }) {
  const earlier = personGsrs.filter((g) => g.id !== gsr.id && isOpen(g)).sort((a, b) => a.started_on.localeCompare(b.started_on) || a.created_at.localeCompare(b.created_at))[0];
  if (!earlier) return null;
  if (isOwn) return <Notice className="mb-4">You already have two GSRs open. Your manager marks the earlier one done first.</Notice>;
  const said = `${personName.split(" ")[0]} already has two GSRs open. Mark the earlier one done first.`;
  if (earlier.id === last?.id) return <Notice className="mb-4">{`${said} You can do it here, in Last GSR.`}</Notice>;
  return (
    <Notice className="mb-4">
      {`${said} `}
      <Link to={`/gsr/reviews/${earlier.id}`} className={`font-medium underline ${tapTargetClass}`}>Open the GSR from {formatDate(earlier.started_on)}</Link>
    </Notice>
  );
}

export default function GsrPage() {
  const { reviewId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivedWith = location.state as { atLimit?: boolean; doneToday?: boolean } | null;
  const arrived: ArrivalNotice | null = arrivedWith?.atLimit === true ? "atLimit" : arrivedWith?.doneToday === true ? "doneToday" : null;
  // The notice a start left, kept for its GSR once the address's state is cleared, and only while
  // that GSR is open here: following the notice's link to another GSR drops it, so pressing Back
  // to this one (the page stays mounted) does not bring it back.
  const [notice, setNotice] = useState<{ for: string; kind: ArrivalNotice } | null>(arrived ? { for: reviewId, kind: arrived } : null);
  if (arrived && (notice?.for !== reviewId || notice.kind !== arrived)) setNotice({ for: reviewId, kind: arrived });
  else if (!arrived && notice && notice.for !== reviewId) setNotice(null);
  useEffect(() => {
    if (arrived) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [arrived, location.pathname, location.search, navigate]);
  const { company, profile, isAdmin } = useHub();
  const companyId = company!.id;
  const tasksOn = hasModule(company, "tasks");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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

  const { gsr, personGsrs, people, goals, notes, directory, pillars, topic, assignments, projects, projectNotes, metrics, roleGoals, entries, goalTasks, month } = state.data;
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
  const canWork = isAdmin || isOwn || leads;
  const canEdit = canWork && open;
  // As on a monthly GSR: the opening discussion is the person's and an admin's, the scorecard and
  // project notes an admin's.
  const canDiscuss = (isAdmin || isOwn) && open;
  const canEnter = isAdmin && open;
  const canDelete = isAdmin && (open || !isOwn);
  const required = pillars.find((p) => p.scoring_type === "gsr_goals" && p.is_active)?.required_goals ?? null;
  const markedBy = gsr.reviewer_id ? (names.get(gsr.reviewer_id) ?? (gsr.reviewer_id === profile.id && profile.is_rococo_admin ? "Rococo" : "someone no longer listed")) : null;
  // The GSR before this one, however long ago and whatever its state.
  const last = previousGsr(personGsrs, gsr);
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
            {/* A stored score always shows; who marked it done only when that is known (a GSR
                carried over from a past month may have no reviewer). */}
            {!open && (gsr.gsr_score !== null || markedBy) ? (
              <span className="tnum text-ink-3">{[gsr.gsr_score !== null ? `${gsr.gsr_score}%` : null, markedBy ? `Marked done by ${markedBy}` : null].filter(Boolean).join(" · ")}</span>
            ) : null}
          </span>
        }
        actions={
          canClose ? (
            open ? (
              <MarkGsrDone
                gsr={gsr}
                required={required}
                disabled={busy}
                onBusy={setBusy}
                onGoals={(fresh) => setData((prev) => ({ ...prev, goals: fresh }))}
                onDone={(next) => setData((prev) => ({ ...prev, gsr: next }))}
                onError={setError}
              />
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

      {notice?.for === gsr.id && notice.kind === "atLimit" ? <LimitNotice gsr={gsr} personGsrs={personGsrs} last={last} personName={personName} isOwn={isOwn} /> : null}
      {notice?.for === gsr.id && notice.kind === "doneToday" ? (
        <Notice className="mb-4">
          {isOwn ? "Your GSR for today is already done. A new one can be started tomorrow." : `${personName.split(" ")[0]}'s GSR for today is already done. A new one can be started tomorrow.`}
        </Notice>
      ) : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}

      <div className="mb-6">
        <SupportDiscussionCard value={gsr.support_discussion} canWrite={canDiscuss} isOwn={isOwn} signedOff={!open} onSave={saveDiscussion} signedOffLine="As it was discussed when this GSR was marked done." />
      </div>

      {/* The last GSR beside the goals, as last month sits beside a monthly GSR's; stacked above them
          on a narrow screen. */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-1">
          <LastGsrPanel
            current={gsr}
            last={last}
            goals={goals}
            notes={notes}
            names={names}
            required={required}
            canClose={canClose}
            canEdit={canWork}
            onGoals={(update) => setData((prev) => ({ ...prev, goals: update(prev.goals) }))}
            onClosed={(next) => setData((prev) => ({ ...prev, personGsrs: prev.personGsrs.map((g) => (g.id === next.id ? next : g)) }))}
            onError={setError}
          />
        </div>
        <div className="min-w-0 lg:col-span-2">
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
          wording={GSR_PROJECT_WORDING}
          onNotes={(update) => setData((prev) => ({ ...prev, projectNotes: update(prev.projectNotes) }))}
        />
      </div>

      {/* Deleting is rare and takes the goals with it, so it sits at the foot, worded, away from the
          everyday controls. An admin's alone, as for every review, and never on their own GSR once
          it is done: a score someone else locked stays (the database refuses it too). */}
      {canDelete ? (
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-[12.5px] text-ink-3">Deleting a GSR removes it and its goals for good.</p>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => { setDialogError(""); setDeleting(true); }}>
            Delete GSR
          </Button>
        </div>
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
