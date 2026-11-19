// The Goal Setting Review for one GSR period: a week, two weeks, a month or a quarter, at the
// person's rhythm (0046). The manager and the person set the period's goals together, live: each
// with an agreed completion where 100 is complete, action steps as checkpoints along the way, and a
// dated notes log to discuss in the meeting. Only the completion says how a goal landed; steps and
// notes are there to get it there. Copy reads in the period's own words ("Goals for this week").
// The person works their own period the same way the manager does, so they can fill it in
// before the meeting and the meeting starts from their draft. A manager works the period of
// someone they lead the same way, goals and notes, while it is open (0038), and locks and reopens
// it as an admin does (0046); ratings and sign-off of scored reviews stay with an admin. Where the
// company runs tasks, each goal lists the tasks behind it (GoalTasks), which never move its
// completion.
// The focus topic sits at the top with its explanation, for reference: the month's topic, or for
// another rhythm the topic of the month the period starts in. The person's #1 GSR comes from it:
// their own words, set as a role or professional goal. The goals their job role brings are offered
// the same way, one click to file. Goals read the focus topic's GSR first, then role, professional
// and personal. Where the company scores its GSRs, the period adds up the completion of all its
// goals against its mandatory ones, and marking it complete locks the score in and the period
// with it. The last period's goals read back as hit or miss with a "why" and a one-click carry
// forward. Yearly goals are not here: they live on the profile and on the quarterly and annual
// reviews, because a Goal Setting Review is the period and nothing else. Every change saves on its
// own; a closed or complete period is read-only except for the why, which is written in the next.
// Employees add and own their goals for the month. A goal someone else set for them (goalLockedFor)
// keeps what it is: its title, description and kind read only and it cannot be deleted, while its
// agreed completion, action steps and notes stay theirs to work, as the database allows (0035).
// That rule binds only the goal's own person (0039): their manager edits it like any other.
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Lock, Plus, Trash2 } from "lucide-react";
import ActionSteps from "./ActionSteps.tsx";
import GoalNotes from "./GoalNotes.tsx";
import GoalTasks from "./GoalTasks.tsx";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import ProgressSlider from "../ui/ProgressSlider.tsx";
import Section from "../ui/Section.tsx";
import { inputClass, selectClass, textareaClass } from "../ui/forms.ts";
import { GOAL_OUTCOME_TONE } from "../status.ts";
import { createGoal, deleteGoal, updateGoal } from "../../services/gsr.ts";
import { GOAL_KIND_ORDER, carryForward, goalLockedFor, goalOutcome, hitCount, monthFrozen, monthLocked, monthTotal, progressPatch, rankGoals, requiredAndStretch, scoreMonth, splitGoals, stepsTaken } from "../../lib/gsr/goals.ts";
import { cyclePath, cycleSettled, cycleYear, gsrPeriodCopy, upperFirst, type GsrPeriodCopy } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatDate, pluralize } from "../../lib/format.ts";
import { GOAL_KIND_LABELS, type Goal, type GoalKind, type GoalNote, type JobRoleGoal, type Profile, type Review, type ReviewCycle, type TaskWithSteps } from "../../types/database.ts";

const eyebrowClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";

type GoalPatch = Parameters<typeof updateGoal>[1];
type NotesUpdate = (update: (notes: GoalNote[]) => GoalNote[]) => void;
type TasksUpdate = (update: (tasks: TaskWithSteps[]) => TaskWithSteps[]) => void;
// What a goal needs to list its tasks: the linked ones on the page, the profiles for the task form,
// who is looking, and how to update the page's list. Absent where the company does not run tasks.
type TaskLinks = { tasks: TaskWithSteps[]; people: Profile[]; viewerProfileId: string; onTasks: TasksUpdate };
// Where a goal stands in a scored month: one of the mandatory GSRs, or a stretch goal.
type Standing = "mandatory" | "stretch";

// The focus topic's GSR is a working goal, never a personal one.
const FOCUS_KINDS: GoalKind[] = ["role", "professional"];

// One of this month's goals: title, kind, agreed completion, description, steps, notes.
function GoalEditor({
  goal,
  notes,
  names,
  taskLinks,
  standing,
  canEdit,
  canTick,
  setForThem,
  carriedFrom,
  onChange,
  onNotes,
  onDelete,
  onError,
  onTouched,
}: {
  goal: Goal;
  notes: GoalNote[];
  names: ReadonlyMap<string, string>;
  taskLinks: TaskLinks | null;
  // For a company that scores its GSRs, whether the goal is mandatory or a stretch goal; null
  // where nothing is scored.
  standing: Standing | null;
  canEdit: boolean;
  canTick: boolean;
  // Set for the person by someone else and read by that person: what the goal is stays as set.
  setForThem: boolean;
  carriedFrom: string | null;
  onChange: (goal: Goal) => void;
  onNotes: NotesUpdate;
  onDelete: () => void;
  onError: (message: string) => void;
  onTouched: () => void;
}) {
  // Title, kind, completion, description and steps all write this one goals row, and each answer
  // carries the whole row. Queued, the writes land in the order they were made, so a slow
  // completion save cannot come back after a tick and put the old steps back on screen.
  // Each save resolves whether it landed, so a field or the slider that failed goes back to what
  // is stored and says so.
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  function save(patch: GoalPatch): Promise<boolean> {
    const run = saveChain.current
      .catch(() => undefined)
      .then(async () => {
        onChange(await updateGoal(goal.id, patch));
        onTouched();
      });
    saveChain.current = run;
    return run.then(
      () => true,
      (err: unknown) => {
        onError(errorMessage(err));
        return false;
      },
    );
  }
  const { done, total } = stepsTaken(goal);
  // Title, kind, description and delete. Completion, steps and notes follow canEdit and canTick.
  const canDefine = canEdit && !setForThem;

  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {canDefine ? (
            <BlurInput value={goal.title} required ariaLabel={`Title for ${goal.title}`} onSave={(next) => save({ title: next.trim() })} className={`${inputClass} mt-0 font-medium`} />
          ) : (
            <h3 className="text-sm font-medium text-ink">{goal.title}</h3>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            {canDefine ? (
              <select value={goal.kind} aria-label={`Kind for ${goal.title}`} onChange={(e) => void save({ kind: e.target.value as GoalKind })} className={`${selectClass} mt-0 w-auto py-0.5 text-[12px]`}>
                {(goal.is_focus ? FOCUS_KINDS : GOAL_KIND_ORDER).map((k) => (
                  <option key={k} value={k}>{GOAL_KIND_LABELS[k]}</option>
                ))}
              </select>
            ) : (
              <span>{GOAL_KIND_LABELS[goal.kind]}</span>
            )}
            {goal.is_focus ? <Badge tone="accent">{standing ? "#1 · Focus topic GSR" : "Focus topic GSR"}</Badge> : null}
            {carriedFrom ? (
              <Badge tone="warning">
                <ArrowRight size={11} aria-hidden /> Carried from {carriedFrom}
              </Badge>
            ) : null}
            {standing === "mandatory" && !goal.is_focus ? <Badge tone="info">Mandatory</Badge> : standing === "stretch" ? <Badge>Stretch</Badge> : null}
            {setForThem ? (
              <span className="inline-flex items-center gap-1">
                <Lock size={11} aria-hidden />
                Set by your manager
              </span>
            ) : null}
          </div>
        </div>
        {canDefine ? (
          <IconButton label={`Delete ${goal.title}`} onClick={onDelete}>
            <Trash2 size={14} aria-hidden />
          </IconButton>
        ) : null}
      </div>

      {/* The completion is the one figure that says how the goal landed. Either side moves it; the
          manager has the last word, because only an admin locks the month in. Steps below are
          checkpoints on the way and move nothing. */}
      <div className="mt-3">
        <p className={eyebrowClass}>Agreed completion</p>
        <ProgressSlider className="mt-1" label={`Agreed completion for ${goal.title}`} value={goal.progress} disabled={!canTick} onCommit={(next) => save(progressPatch(next, goal.status))} />
      </div>

      {canDefine ? (
        <BlurInput multiline rows={1} value={goal.description ?? ""} placeholder="What does success look like?" ariaLabel={`Description for ${goal.title}`} onSave={(next) => save({ description: next.trim() || null })} className={`${textareaClass} mt-3 min-h-[36px] text-[13px]`} />
      ) : goal.description ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{goal.description}</p>
      ) : null}

      <div className="mt-3">
        <p className={`${eyebrowClass} flex items-baseline gap-2`}>
          Action steps
          {total > 0 ? <span className="tnum text-[12px] normal-case tracking-normal text-ink-3">{done} of {total} done</span> : null}
        </p>
        <ActionSteps steps={goal.action_steps} canTick={canTick} canEdit={canEdit} onChange={(steps) => save({ action_steps: steps })} />
      </div>

      {canEdit || notes.length > 0 ? (
        <div className="mt-3">
          <p className={eyebrowClass}>Notes</p>
          <GoalNotes goal={goal} notes={notes} names={names} canWrite={canEdit} onNotes={onNotes} onError={onError} onSaved={onTouched} />
        </div>
      ) : null}

      {taskLinks ? (
        <GoalTasks
          goal={goal}
          tasks={taskLinks.tasks.filter((t) => t.goal_id === goal.id)}
          people={taskLinks.people}
          canEdit={canEdit}
          viewerProfileId={taskLinks.viewerProfileId}
          onTasks={taskLinks.onTasks}
          onError={onError}
          onSaved={onTouched}
        />
      ) : null}
    </li>
  );
}

// Last month's goal, read-only: how it landed, which steps were taken, and its notes.
function LastMonthGoal({
  goal,
  notes,
  names,
  taskLinks,
  settled,
  carriedTitle,
  canCarry,
  canNote,
  copy,
  onCarry,
  onNote,
  onNotes,
  onError,
}: {
  goal: Goal;
  notes: GoalNote[];
  names: ReadonlyMap<string, string>;
  taskLinks: TaskLinks | null;
  settled: boolean;
  carriedTitle: string | null;
  canCarry: boolean;
  canNote: boolean;
  // How the period reads, from the rhythm ("Carry into this week").
  copy: GsrPeriodCopy;
  onCarry: () => void;
  onNote: (note: string | null) => Promise<boolean>;
  onNotes: NotesUpdate;
  onError: (message: string) => void;
}) {
  const outcome = goalOutcome(goal, settled);
  const { done, total } = stepsTaken(goal);
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{goal.title}</p>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {goal.is_focus ? "Focus topic GSR · " : ""}
            {GOAL_KIND_LABELS[goal.kind]}
            {total > 0 ? ` · ${done}/${total} steps taken` : " · No steps recorded"}
          </p>
        </div>
        <Badge tone={GOAL_OUTCOME_TONE[outcome]}>
          {outcome === "hit" ? <Check size={11} aria-hidden /> : null}
          {outcome === "hit" ? "Hit" : outcome === "miss" ? `Missed at ${goal.progress}%` : `${goal.progress}% so far`}
        </Badge>
      </div>
      {goal.action_steps.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {goal.action_steps.map((step, i) => (
            <li key={i} className={`flex items-start gap-2 text-[12.5px] ${step.done ? "text-ink-2" : "text-ink-3"}`}>
              <span className="mt-0.5 w-3 shrink-0">{step.done ? <Check size={12} aria-hidden /> : <span aria-hidden>·</span>}</span>
              <span className={step.done ? "" : "italic"}>{step.text}{step.done ? "" : " (not taken)"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {notes.length > 0 ? (
        <div className="mt-2">
          <p className={eyebrowClass}>Notes</p>
          <GoalNotes goal={goal} notes={notes} names={names} canWrite={false} onNotes={onNotes} onError={onError} />
        </div>
      ) : null}
      {/* Last month's tasks read only: its goals are on record, and so is the work behind them. */}
      {taskLinks ? (
        <GoalTasks
          goal={goal}
          tasks={taskLinks.tasks.filter((t) => t.goal_id === goal.id)}
          people={taskLinks.people}
          canEdit={false}
          viewerProfileId={taskLinks.viewerProfileId}
          onTasks={taskLinks.onTasks}
          onError={onError}
        />
      ) : null}
      {canNote ? (
        <div className="mt-2">
          <p className={eyebrowClass}>Why</p>
          <BlurInput multiline rows={1} value={goal.outcome_note ?? ""} placeholder={outcome === "hit" ? "What made it land" : "What got in the way"} ariaLabel={`Why for ${goal.title}`} onSave={(next) => onNote(next.trim() || null)} className={`${textareaClass} mt-1 min-h-[36px] text-[13px]`} />
        </div>
      ) : goal.outcome_note ? (
        <div className="mt-2">
          <p className={eyebrowClass}>Why</p>
          <p className="mt-0.5 text-[12.5px] text-ink-2">{goal.outcome_note}</p>
        </div>
      ) : null}
      {outcome !== "hit" ? (
        <div className="mt-2">
          {carriedTitle ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-ink-3">
              <ArrowRight size={12} aria-hidden /> Carried into {copy.this}
            </span>
          ) : canCarry ? (
            <Button variant="secondary" size="sm" aria-label={`Carry ${goal.title} into ${copy.this}`} onClick={onCarry}>
              <ArrowRight size={13} aria-hidden /> Carry into {copy.this}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// The month's focus topic and what it means, always on the month and there for reference, with the
// way to set the person's #1 GSR from it. Their words make the goal, as a role or professional
// goal; the explanation stays here rather than being copied into a goal titled after the topic.
function FocusTopicCard({
  cycle,
  focusGoal,
  canEdit,
  isOwn,
  copy,
  onAdd,
}: {
  cycle: ReviewCycle;
  focusGoal: Goal | null;
  canEdit: boolean;
  isOwn: boolean;
  copy: GsrPeriodCopy;
  onAdd: (title: string, kind: GoalKind) => void;
}) {
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<GoalKind>("professional");
  const whose = isOwn ? "your" : "their";
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle("");
    setComposing(false);
    onAdd(text, kind);
  }
  return (
    <div className="mb-4 rounded-lg border border-dashed border-line-strong px-4 py-3">
      <p className={eyebrowClass}>Focus topic</p>
      <p className="mt-0.5 text-sm font-medium text-ink">{cycle.theme}</p>
      {cycle.theme_description ? <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{cycle.theme_description}</p> : null}
      {focusGoal ? (
        <p className="mt-2 text-[12.5px] text-ink-3">
          {isOwn ? "Your" : "Their"} #1 GSR for this topic: <span className="text-ink">{focusGoal.title}</span>
        </p>
      ) : !canEdit ? null : composing ? (
        <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
          <input type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder={`What will ${isOwn ? "you" : "they"} do ${copy.this} on this topic?`} aria-label="GSR for this focus topic" className={`${inputClass} mt-0 min-w-0 flex-1`} />
          <select value={kind} aria-label="Kind for the focus topic GSR" onChange={(e) => setKind(e.target.value as GoalKind)} className={`${selectClass} mt-0 w-auto`}>
            {FOCUS_KINDS.map((k) => (
              <option key={k} value={k}>{GOAL_KIND_LABELS[k]}</option>
            ))}
          </select>
          <Button type="submit" variant="secondary" disabled={!title.trim()}>
            <Plus size={14} aria-hidden /> Add
          </Button>
          <Button variant="ghost" onClick={() => { setComposing(false); setTitle(""); }}>Cancel</Button>
        </form>
      ) : (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setComposing(true)}>
          <Plus size={13} aria-hidden /> Set {whose} {copy.adjective} GSR based on this focus topic
        </Button>
      )}
    </div>
  );
}

function AddGoalForm({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle("");
    onAdd(text);
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${inputClass} mt-0 flex-1`} />
      <Button type="submit" variant="secondary" disabled={!title.trim()}>
        <Plus size={14} aria-hidden /> Add
      </Button>
    </form>
  );
}

export default function GoalSettingPanel({
  review,
  cycle,
  previousCycle,
  cycles,
  goals,
  notes,
  names,
  roleGoals = [],
  gsrRequired = null,
  isAdmin,
  isOwn,
  isLeader = false,
  omitted = false,
  taskLinks = null,
  onGoals,
  onNotes,
  onError,
  onTouched,
}: {
  review: Review;
  cycle: ReviewCycle;
  previousCycle: ReviewCycle | null;
  // Every cycle this company has, so a carried goal can name the cycle it actually came from
  // rather than whichever one happens to be the previous one now.
  cycles: ReviewCycle[];
  goals: Goal[];
  // The person's goal notes the reader may see, every goal's; each goal shows its own.
  notes: GoalNote[];
  // Full names by profile id, from the company directory, to name who wrote each note.
  names: ReadonlyMap<string, string>;
  // The goals the person's job role brings into every month, set once in Settings. Offered
  // here until each is filed for this month; the template itself is never edited from a review.
  roleGoals?: JobRoleGoal[];
  // How many goals a month requires, from the company's Monthly GSRs pillar; null for a company
  // that does not score its GSRs, which then sees none of the counting.
  gsrRequired?: number | null;
  isAdmin: boolean;
  isOwn: boolean;
  // The viewer leads the person (their manager, up the chain): they work the month's goals and
  // notes as an admin does while it is open (0038), and nothing an admin keeps.
  isLeader?: boolean;
  // The person is omitted from this month (0034): the month is set aside as it is, read only,
  // until an admin adds them back. The database freezes it too.
  omitted?: boolean;
  // The tasks linked to this month's and last month's goals, for a company that runs tasks;
  // null where it does not, and the goals show no tasks.
  taskLinks?: TaskLinks | null;
  onGoals: (update: (goals: Goal[]) => Goal[]) => void;
  onNotes: NotesUpdate;
  onError: (message: string) => void;
  // Something on the month saved: the page clears an older failure line and moves the review on.
  onTouched: () => void;
}) {
  const open = cycle.status === "open";
  // A month an admin has marked complete with its score is locked in for this person (0023).
  const locked = monthLocked(review);
  // Marked complete, scored or not: its goals and notes stay as they were until it is reopened
  // (0039). A company with no Monthly GSRs pillar locks no score, and the month still freezes.
  const frozen = monthFrozen(review);
  // The admin, the person and their manager all work an open month in full: set goals, steps,
  // completion, notes, the why on last month. RLS is what keeps it to the people each may write
  // for (0013, 0038), and the database freezes a closed, complete or omitted month; this only
  // decides what the page offers.
  const canWork = isAdmin || isOwn || isLeader;
  const canEdit = canWork && open && !frozen && !omitted;
  const year = cycleYear(cycle);
  const { thisCycle, lastCycle } = splitGoals(goals, { cycleId: cycle.id, previousCycleId: previousCycle?.id ?? null, year });
  const lastSettled = previousCycle ? cycleSettled(previousCycle) : true;

  // Where a carried goal came from is a property of the link, not of "the previous cycle".
  // Reading it off previousCycle named the wrong month whenever a skipped month was created later
  // and slid in between. Deleting a cycle deletes its goals with it (goals.cycle_id is ON DELETE
  // CASCADE since 0029), so a carried goal can outlive its source, and carried_from_goal_id then
  // points at nothing. The source goal is only in `goals` when it belongs to this person, which it
  // always does, and the neutral wording covers the case where the source goal or its cycle is gone.
  const carriedFromName = (goal: Goal): string | null => {
    if (!goal.carried_from_goal_id) return null;
    const source = goals.find((g) => g.id === goal.carried_from_goal_id);
    const sourceCycle = source?.cycle_id ? cycles.find((c) => c.id === source.cycle_id) : null;
    return sourceCycle?.name ?? "an earlier cycle";
  };
  const summary = hitCount(lastCycle, lastSettled);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);
  // A refused delete (a closed cycle freezes its goals) has to be said inside the dialog, not
  // on the page behind the scrim.
  const [error, setError] = useState("");
  const [carrying, setCarrying] = useState("");
  const [seeding, setSeeding] = useState(false);
  // A role goal is filed once a goal with its title is on this month's list, whoever typed it.
  const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const pendingRoleGoals = roleGoals.filter((template) => !thisCycle.some((g) => sameTitle(g.title, template.title)));
  // The focus topic's GSR first, then role, professional and personal (lib/gsr/goals.ts).
  const ordered = rankGoals(thisCycle);
  const focusGoal = ordered.find((g) => g.is_focus) ?? null;
  const notesFor = (goal: Goal) => notes.filter((n) => n.goal_id === goal.id);
  // How the month adds up, for a company that scores its GSRs (lib/gsr/goals.ts).
  const split = gsrRequired ? requiredAndStretch(thisCycle, gsrRequired) : null;
  const standing = (goal: Goal): Standing | null => (split ? (split.required.includes(goal) ? "mandatory" : "stretch") : null);
  const month = gsrRequired ? monthTotal(thisCycle, gsrRequired) : null;

  const upsert = (goal: Goal) => onGoals((list) => (list.some((g) => g.id === goal.id) ? list.map((g) => (g.id === goal.id ? goal : g)) : [...list, goal]));
  const carriedTitle = (source: Goal) => thisCycle.find((g) => g.carried_from_goal_id === source.id)?.title ?? null;

  // Everything set here belongs to this month. Yearly goals are set on the profile and read on
  // the quarterly and annual reviews; a Goal Setting Review is the month and nothing else.
  async function add(title: string, kind: GoalKind = "professional", isFocus = false) {
    try {
      const created = await createGoal({
        company_id: review.company_id,
        employee_id: review.employee_id,
        title,
        kind,
        is_focus: isFocus,
        description: null,
        scope: "cycle",
        cycle_id: cycle.id,
        year: null,
        sort_order: thisCycle.length + 1,
      });
      upsert(created);
      onTouched();
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  // The role's goals land one at a time, in their template order, as goals of kind 'role' that
  // the meeting then owns like any other. Guarded the same way carrying is.
  async function addRoleGoals() {
    if (seeding) return;
    setSeeding(true);
    try {
      let order = thisCycle.length + 1;
      for (const template of pendingRoleGoals) {
        const created = await createGoal({
          company_id: review.company_id,
          employee_id: review.employee_id,
          title: template.title,
          kind: "role",
          description: template.description,
          scope: "cycle",
          cycle_id: cycle.id,
          year: null,
          sort_order: order++,
        });
        upsert(created);
      }
      onTouched();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSeeding(false);
    }
  }

  // Carrying is one click, and the label only changes once the round trip lands, so without a
  // guard a double click files the same goal twice for an admin to delete again.
  async function carry(goal: Goal) {
    if (carrying) return;
    setCarrying(goal.id);
    try {
      upsert(await createGoal(carryForward(goal, cycle.id, thisCycle.length + 1)));
      onTouched();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setCarrying("");
    }
  }

  async function removeGoal() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await deleteGoal(deleting.id);
      const id = deleting.id;
      onGoals((list) => list.filter((g) => g.id !== id));
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(goal: Goal, note: string | null): Promise<boolean> {
    try {
      upsert(await updateGoal(goal.id, { outcome_note: note }));
      onTouched();
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    }
  }

  // Said to whoever is reading: an admin reopens the review themselves; anyone else is told an
  // admin can, never "your manager", because the reader may be the manager.
  // A leader locks and reopens a GSR as an admin does (0046), so they are told the same.
  const reopenLine = isAdmin || isLeader ? "reopen the review to change them." : "an admin can reopen the review to change them.";
  // The period's words, from its rhythm: "this week", "last month", "these two weeks".
  const copy = gsrPeriodCopy(cycle.cadence);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-1">
        <Section
          eyebrow={previousCycle ? previousCycle.name : upperFirst(copy.last)}
          title={`${upperFirst(copy.last)} at a glance`}
          description={previousCycle && lastCycle.length > 0 ? `${summary.hit} of ${pluralize(summary.total, "goal")} hit` : undefined}
        >
          {!previousCycle ? (
            <p className="text-sm text-ink-2">No earlier {copy.noun} yet. The goals set here are read back next {copy.noun} as hit or miss.</p>
          ) : lastCycle.length === 0 ? (
            <p className="text-sm text-ink-2">No goals were set for {previousCycle.name}.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lastCycle.map((goal) => (
                <LastMonthGoal key={goal.id} goal={goal} notes={notesFor(goal)} names={names} taskLinks={taskLinks} settled={lastSettled} carriedTitle={carriedTitle(goal)} canCarry={canEdit} canNote={canWork} copy={copy} onCarry={() => void carry(goal)} onNote={(note) => saveNote(goal, note)} onNotes={onNotes} onError={onError} />
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="space-y-6 lg:col-span-2">
        <Section
          eyebrow={cycle.name}
          title={`Goals for ${copy.this}`}
          description={
            isOwn && !isAdmin
              ? `Fill these in before the meeting: the goals you want ${copy.this}, the steps to get there, and notes as you go. You and your manager agree each goal's completion in the review, and 100 marks it complete. Action steps are your checkpoints and do not count toward the score.`
              : `Set together in the review. Agreed completion is the number for each goal, and 100 marks it complete; action steps are checkpoints along the way and do not count toward the score. Next ${copy.noun} reads each goal back as a hit or a miss.`
          }
        >
          {!open && !frozen ? (
            <p className="mb-4 rounded-md border border-line bg-surface-2/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
              {cycle.name} is closed, so its goals and notes stay as they are.
            </p>
          ) : null}
          {locked ? (
            <p className="mb-4 rounded-md border border-line bg-surface-2/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
              <span className="tnum font-medium text-ink">Locked in at {review.gsr_score}%</span>
              {review.completed_at ? ` on ${formatDate(review.completed_at)}` : ""}. The {copy.noun}'s goals and notes are on record; {reopenLine}
            </p>
          ) : frozen ? (
            <p className="mb-4 rounded-md border border-line bg-surface-2/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
              <span className="font-medium text-ink">Marked complete</span>
              {review.completed_at ? ` on ${formatDate(review.completed_at)}` : ""}. The {copy.noun}'s goals and notes are on record as they were; {reopenLine}
            </p>
          ) : split && month && gsrRequired ? (
            <p className="mb-4 text-[12.5px] leading-relaxed text-ink-2">
              <span className={`tnum font-medium ${split.missing > 0 ? "text-warning" : "text-ink"}`}>
                {gsrRequired - split.missing} of {pluralize(gsrRequired, "mandatory GSR")} set · {month.total}% of {month.cap}% so far, a {copy.noun} score of {scoreMonth(thisCycle, gsrRequired)}%
              </span>
              . Every goal adds its completion, up to 100% for each mandatory GSR: the focus topic's GSR is #1, then role and professional goals, and a stretch goal adds to the total without ever lowering it. The score counts once an admin or a manager over them marks the {copy.noun} complete, which locks it in.
              {cycle.theme && !focusGoal ? " The #1 GSR comes from the focus topic: set it from the card below." : ""}
            </p>
          ) : null}
          {cycle.theme ? (
            <FocusTopicCard cycle={cycle} focusGoal={focusGoal} canEdit={canEdit} isOwn={isOwn} copy={copy} onAdd={(title, kind) => void add(title, kind, true)} />
          ) : canEdit && isAdmin ? (
            <p className="mb-4 rounded-lg border border-dashed border-line-strong px-4 py-3 text-[12.5px] text-ink-2">
              No focus topic for {cycle.name} yet.{" "}
              <Link to={cyclePath(cycle)} className="text-link hover:underline">Set one on the {copy.noun}</Link>, or plan the year in{" "}
              <Link to="/goals/focus" className="text-link hover:underline">Goals, Monthly focus</Link>.
            </p>
          ) : null}
          {canEdit && pendingRoleGoals.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3">
              <div className="min-w-0">
                <p className={eyebrowClass}>Role goals</p>
                <p className="mt-0.5 text-sm text-ink">{pendingRoleGoals.map((g) => g.title).join(" · ")}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-2">{pluralize(pendingRoleGoals.length, "goal")} {isOwn ? "your" : "their"} job role brings into every {copy.noun}, not filed for {cycle.name} yet.</p>
              </div>
              <Button variant="secondary" size="sm" disabled={seeding} onClick={() => void addRoleGoals()}>
                <Plus size={13} aria-hidden /> Add role goals
              </Button>
            </div>
          ) : null}
          {thisCycle.length === 0 ? (
            <p className="text-sm text-ink-2">{canEdit ? `No goals yet. Add the first one below, or carry one forward from ${copy.last}.` : `No goals set for ${copy.this} yet.`}</p>
          ) : null}
          <ul className="space-y-3">
            {ordered.map((goal) => (
              <GoalEditor
                key={goal.id}
                goal={goal}
                notes={notesFor(goal)}
                names={names}
                taskLinks={taskLinks}
                standing={standing(goal)}
                canEdit={canEdit}
                canTick={canEdit}
                setForThem={isOwn && goalLockedFor(goal, isAdmin)}
                carriedFrom={carriedFromName(goal)}
                onChange={upsert}
                onNotes={onNotes}
                onDelete={() => setDeleting(goal)}
                onError={onError}
                onTouched={onTouched}
              />
            ))}
          </ul>
          {canEdit ? (
            <div className={thisCycle.length > 0 ? "mt-4" : "mt-3"}>
              <AddGoalForm placeholder={`Add a goal for ${copy.this}`} onAdd={(title) => void add(title)} />
            </div>
          ) : null}
        </Section>
      </div>

      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          body="The goal, its action steps and its notes are removed from this review. Leave it below 100 instead to keep the miss on record."
          confirmLabel="Delete goal"
          busy={busy}
          error={error}
          onConfirm={() => void removeGoal()}
          onCancel={() => { setDeleting(null); setError(""); }}
        />
      ) : null}
    </div>
  );
}
