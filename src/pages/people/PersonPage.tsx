// One person, for an admin or a manager, as six short tabs, each at its own address: Overview (who
// they are, their current GSR at their rhythm, their next tasks, who reports to them, their latest
// score), GSR and goals, Scorecard (role scorecard, projects, KPIs, financial figures), Tasks,
// Reviews (ratings, deliverables, review history) and, for an admin, Setup (their details and GSR
// rhythm, hub role, divisions and view access, compensation, and the account actions).
// `/people/:profileId` is Overview, so every older link to a person still lands. A tab the viewer
// does not get, or one that does not exist, lands on Overview too.
//
// An admin runs the record. A manager reads it for the people they lead or may see: no Setup, no
// pay and no financial figures, which the page never asks for on their behalf; ratings read only.
// Everything is read by the active company, so a person the database does not show the viewer
// (another division, another company, a stale id after the switcher moved) reads as no access
// rather than leaking a record.
//
// The page loads the person once and each tab reads what was loaded, so switching tabs never loads
// them again. Profile writes go out one at a time in the order they were made, so an older answer
// never lands over a newer one, and an answer for a person or company the page has since left is
// dropped. A rating and its note on the same criterion share a queue for the same reason.
import { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import Badge from "../../components/ui/Badge.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import PersonTasks from "../../components/tasks/PersonTasks.tsx";
import PersonOverview from "../../components/people/person/PersonOverview.tsx";
import PersonGsrGoals from "../../components/people/person/PersonGsrGoals.tsx";
import PersonScorecardTab from "../../components/people/person/PersonScorecardTab.tsx";
import PersonReviews from "../../components/people/person/PersonReviews.tsx";
import PersonSetup from "../../components/people/person/PersonSetup.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCriteria, listCycleOmissions, listCycles, listEmployeeReviews, listGoals, listImpactScores, listPillars, listScoresForReviews, upsertImpactScore } from "../../services/gsr.ts";
import { listDirectory } from "../../services/directory.ts";
import { listCompanyProfiles, updateProfile, type ProfilePatch } from "../../services/profiles.ts";
import { listCompensation, listEmployeeFinancials, listEmployeeKpis } from "../../services/employees.ts";
import { listJobRoles } from "../../services/jobRoles.ts";
import { hasModule } from "../../lib/modules.ts";
import { omittedCycleIdsFor } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate } from "../../lib/format.ts";
import { formatTenure, hasAccount, ledBy } from "../../lib/people.ts";
import { ROLE_LABELS, type Goal, type ImpactScore, type Profile } from "../../types/database.ts";
import { personTabsFor, reportsTo, type PersonRecord, type PersonTabProps } from "./personTabs.ts";

// The key a write belongs to: the person and the company the page showed when it was made.
const keyOf = (companyId: string, profileId: string) => `${companyId}:${profileId}`;

export default function PersonPage() {
  const { profileId = "", tab } = useParams();
  const { company, profile: me, isAdmin, isRococo, can, refreshProfile } = useHub();
  // Pay is its own permission: an admin the company has not given it never requests compensation.
  const canSeePay = isAdmin && can("pay");
  const companyId = company!.id;
  const year = new Date().getFullYear();
  const [error, setError] = useState("");
  // Where the page is now, so a write that lands after the person or company changed is dropped
  // instead of being painted onto another record (D14).
  const pageKey = keyOf(companyId, profileId);
  const keyRef = useRef(pageKey);
  useEffect(() => {
    keyRef.current = pageKey;
  }, [pageKey]);
  // Profile writes, one after another in the order they were made (D5).
  const profileQueue = useRef<Promise<unknown>>(Promise.resolve());
  // Ratings and notes, one queue per person and criterion, with what the latest click and note
  // want, read when each write runs (B9).
  const impactQueues = useRef(new Map<string, Promise<unknown>>());
  const impactWanted = useRef(new Map<string, { rating: number | null; note: string | null }>());

  const state = useAsync<PersonRecord>(async () => {
    const [people, directory, reviews, cycles, pillars, criteria, impact, kpis, compensation, financials, jobRoles, goals, omissions] = await Promise.all([
      listCompanyProfiles(companyId),
      // Names for whoever the viewer cannot see, such as the manager of someone in their view.
      // Only a name, so a failed read leaves a fallback rather than an error.
      listDirectory(companyId).catch(() => []),
      listEmployeeReviews(companyId, profileId),
      listCycles(companyId),
      listPillars(companyId),
      listCriteria(companyId),
      listImpactScores(companyId, profileId),
      listEmployeeKpis(companyId, profileId, year),
      // Pay and financial figures are an admin's alone; the database returns a manager nothing,
      // so a manager's page does not ask.
      canSeePay ? listCompensation(companyId, profileId) : Promise.resolve([]),
      isAdmin ? listEmployeeFinancials(companyId, profileId, year) : Promise.resolve([]),
      // Retired roles too, so a person still in one shows it rather than a blank.
      listJobRoles(companyId, true),
      // Their goals, for where this quarter's GSRs stand when the company scores them.
      listGoals(companyId, profileId),
      // The months they are omitted from never count toward that (0034).
      listCycleOmissions(companyId),
    ]);
    const scores = await listScoresForReviews(reviews.map((r) => r.id));
    return { people, directory, person: people.find((p) => p.id === profileId) ?? null, reviews, cycles, pillars, criteria, impact, scores, kpis, compensation, financials, jobRoles, goals, omittedCycleIds: omittedCycleIdsFor(omissions, reviews, profileId) };
  }, [companyId, profileId, year, isAdmin, canSeePay]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;
  const data = state.data;
  const { person } = data;
  // A Rococo admin reads every row, so a missing person is not in this company. Anyone else may
  // simply not be shown them, and the page says that instead of guessing why.
  if (!person) return <Notice tone="error">{isRococo ? "That person is not in this company." : "You do not have access to this person."}</Notice>;

  const tabs = personTabsFor({ personId: person.id, isAdmin, tasksOn: hasModule(company, "tasks"), rococoPerson: person.is_rococo_admin });
  const current = tab === undefined ? "overview" : tab;
  if (tab !== undefined && (tab === "overview" || !tabs.some((t) => t.key === tab))) return <Navigate to={`/people/${person.id}`} replace />;

  const personId = person.id;
  const writeKey = pageKey;
  const impactByCriterion = new Map(data.impact.map((i) => [i.criterion_id, i]));

  // Writes one criterion's rating and note through its queue. Each write sends what the latest
  // click and note want when it runs, so a note saved after a new rating never puts the old
  // rating back.
  function writeImpact(criterionId: string, change: { rating?: number; note?: string | null }): Promise<boolean> {
    const key = `${personId}:${criterionId}`;
    const stored = impactByCriterion.get(criterionId);
    const base = impactWanted.current.get(key) ?? { rating: stored?.rating ?? null, note: stored?.note ?? null };
    impactWanted.current.set(key, { ...base, ...change });
    const run = (impactQueues.current.get(key) ?? Promise.resolve()).then(async () => {
      const want = impactWanted.current.get(key);
      if (!want || want.rating === null) return false;
      try {
        const saved: ImpactScore = await upsertImpactScore({ employee_id: personId, criterion_id: criterionId, rating: want.rating, note: want.note, set_by: me.id });
        // Nothing newer waiting, so the next click starts from what the database now holds.
        if (impactQueues.current.get(key) === run) impactWanted.current.delete(key);
        if (keyRef.current !== writeKey) return true;
        setError("");
        state.setData((prev) =>
          prev && prev.person?.id === personId
            ? { ...prev, impact: prev.impact.some((i) => i.id === saved.id) ? prev.impact.map((i) => (i.id === saved.id ? saved : i)) : [...prev.impact, saved] }
            : prev,
        );
        return true;
      } catch (err) {
        // The next write starts again from what the database holds.
        impactWanted.current.delete(key);
        if (keyRef.current === writeKey) setError(errorMessage(err));
        return false;
      }
    });
    impactQueues.current.set(key, run);
    return run;
  }

  // Saves profile fields through the page's queue and reports whether they landed, so a field that
  // did not save says so and keeps what was typed.
  function patch(patchValue: ProfilePatch): Promise<boolean> {
    const run = profileQueue.current.then(async () => {
      let next: Profile;
      try {
        next = await updateProfile(personId, patchValue);
      } catch (err) {
        if (keyRef.current === writeKey) setError(errorMessage(err));
        return false;
      }
      if (keyRef.current !== writeKey) return true;
      setError("");
      state.setData((prev) => (prev && prev.person?.id === next.id ? { ...prev, person: next, people: prev.people.map((p) => (p.id === next.id ? next : p)) } : prev));
      // HubContext holds the sign-in snapshot of who you are, and the sidebar footer renders it
      // from a layout route that never remounts. Editing your own name or title here otherwise
      // left the old one in the corner of every screen until the next sign-in. The save has
      // landed either way, so a refresh that fails is not reported as a failed save (D15).
      if (next.id === me.id) await refreshProfile().catch(() => undefined);
      return true;
    });
    profileQueue.current = run;
    return run;
  }

  const tabProps: PersonTabProps = {
    companyId,
    data,
    person,
    update: (change) => state.setData((prev) => (prev && prev.person?.id === personId ? change(prev) : prev)),
    onError: setError,
  };
  const tenure = formatTenure(person.hire_date);
  const manager = reportsTo(data, person);

  // The Tasks tab: the whole list, with Add task for whoever may assign this person work.
  function tasksTab() {
    const isLeader = isAdmin || ledBy(me, data.people).some((p) => p.id === personId);
    const goalById = new Map<string, Goal>(data.goals.map((g) => [g.id, g]));
    const goalLabel = (goalId: string): string | null => {
      const goal = goalById.get(goalId);
      const cycle = goal?.cycle_id ? data.cycles.find((c) => c.id === goal.cycle_id) : undefined;
      return cycle ? `${cycle.name} GSR` : null;
    };
    return <PersonTasks companyId={companyId} person={person!} canAdd={isLeader} viewerProfileId={me.id} goalLabel={goalLabel} backTo={`/people/${person!.id}/tasks`} />;
  }

  return (
    <>
      <PageHeader
        backTo="/people"
        backLabel="People"
        eyebrow={person.title ?? ROLE_LABELS[person.role]}
        title={displayName(person)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="[overflow-wrap:anywhere]">{person.email}</span>
            {!hasAccount(person) ? (
              <Badge tone="warning">Not signed in yet</Badge>
            ) : (
              <Badge tone={person.is_active ? "success" : "neutral"}>{person.is_active ? "Active" : "Inactive"}</Badge>
            )}
            {person.hire_date ? <span className="text-ink-3">Hired {formatDate(person.hire_date)}{tenure ? ` · ${tenure}` : ""}</span> : null}
            {manager.name ? <span className="text-ink-3">Reports to {manager.name}</span> : null}
          </span>
        }
      />
      <Tabs items={tabs} label="Person" />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {current === "overview" ? <PersonOverview {...tabProps} patch={patch} /> : null}
      {current === "gsr" ? <PersonGsrGoals {...tabProps} /> : null}
      {current === "scorecard" ? <PersonScorecardTab {...tabProps} /> : null}
      {current === "tasks" ? tasksTab() : null}
      {current === "reviews" ? <PersonReviews {...tabProps} writeImpact={writeImpact} /> : null}
      {current === "setup" ? <PersonSetup {...tabProps} patch={patch} /> : null}
    </>
  );
}
