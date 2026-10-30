// The Goal Setting Review for a monthly cycle. The manager and the person set this month's
// goals together, live: each with an agreed completion where 100 is complete, action steps as
// checkpoints along the way, and a dated notes log to discuss in the meeting. Only the completion
// says how a goal landed; steps and notes are there to get it there.
// The person works their own month the same way the manager does, so they can fill it in
// before the meeting and the meeting starts from their draft.
// The month's focus topic sits at the top with its explanation, for reference, and the person's #1
// GSR comes from it: their own words, set as a role or professional goal. The goals their job role
// brings are offered the same way, one click to file. Goals read the focus topic's GSR first, then
// role, professional and personal. Where the company scores its GSRs, the month adds up the
// completion of all its goals against its mandatory ones, and an admin marking the month complete
// locks the score in and the month with it. Last month's goals read back as hit or miss with a
// "why" and a one-click carry forward. Yearly goals are not here: they live on the profile and on
// the quarterly and annual reviews, because a Goal Setting Review is the month and nothing else.
// Every change saves on its own; a closed or locked month is read-only except for the why, which
// is written the month after.
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import ActionSteps from "./ActionSteps.tsx";
import GoalNotes from "./GoalNotes.tsx";
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
import { GOAL_KIND_ORDER, carryForward, goalOutcome, hitCount, monthLocked, monthTotal, progressPatch, rankGoals, requiredAndStretch, scoreMonth, splitGoals, stepsTaken } from "../../lib/gsr/goals.ts";
import { cyclePath, cycleSettled, cycleYear } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatDate, pluralize } from "../../lib/format.ts";
import { GOAL_KIND_LABELS, type Goal, type GoalKind, type GoalNote, type JobRoleGoal, type Profile, type Review, type ReviewCycle } from "../../types/database.ts";

const eyebrowClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";

type GoalPatch = Parameters<typeof updateGoal>[1];
type NotesUpdate = (update: (notes: GoalNote[]) => GoalNote[]) => void;
// Where a goal stands in a scored month: one of the mandatory GSRs, or a stretch goal.
type Standing = "mandatory" | "stretch";

// The focus topic's GSR is a working goal, never a personal one.
const FOCUS_KINDS: GoalKind[] = ["role", "professional"];

// One of this month's goals: title, kind, agreed completion, description, steps, notes.
function GoalEditor({
  goal,
  notes,
  people,
  standing,
  canEdit,
  canTick,
  carriedFrom,
  onChange,
  onNotes,
  onDelete,
  onError,
  onTouched,
}: {
  goal: Goal;
  notes: GoalNote[];
  people: Profile[];
  // For a company that scores its GSRs, whether the goal is mandatory or a stretch goal; null
  // where nothing is scored.
  standing: Standing | null;
  canEdit: boolean;
  canTick: boolean;
  carriedFrom: string | null;
  onChange: (goal: Goal) => void;
  onNotes: NotesUpdate;
  onDelete: () => void;
  onError: (message: string) => void;
  onTouched: () => void;
}) {
  async function save(patch: GoalPatch) {
    try {
      onChange(await updateGoal(goal.id, patch));
      onTouched();
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  const { done, total } = stepsTaken(goal);

  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {canEdit ? (
            <BlurInput value={goal.title} ariaLabel={`Title for ${goal.title}`} onSave={(next) => void save({ title: next.trim() || goal.title })} className={`${inputClass} mt-0 font-medium`} />
          ) : (
            <h3 className="text-sm font-medium text-ink">{goal.title}</h3>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            {canEdit ? (
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
          </div>
        </div>
        {canEdit ? (
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
        <ProgressSlider className="mt-1" label={`Agreed completion for ${goal.title}`} value={goal.progress} disabled={!canTick} onCommit={(next) => void save(progressPatch(next, goal.status))} />
      </div>

      {canEdit ? (
        <BlurInput multiline rows={1} value={goal.description ?? ""} placeholder="What does success look like?" ariaLabel={`Description for ${goal.title}`} onSave={(next) => void save({ description: next.trim() || null })} className={`${textareaClass} mt-3 min-h-[36px] text-[13px]`} />
      ) : goal.description ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{goal.description}</p>
      ) : null}

      <div className="mt-3">
        <p className={`${eyebrowClass} flex items-baseline gap-2`}>
          Action steps
          {total > 0 ? <span className="tnum text-[12px] normal-case tracking-normal text-ink-3">{done} of {total} done</span> : null}
        </p>
        <ActionSteps steps={goal.action_steps} canTick={canTick} canEdit={canEdit} onChange={(steps) => void save({ action_steps: steps })} />
      </div>

      {canEdit || notes.length > 0 ? (
        <div className="mt-3">
          <p className={eyebrowClass}>Notes</p>
          <GoalNotes goal={goal} notes={notes} people={people} canWrite={canEdit} onNotes={onNotes} onError={onError} />
        </div>
      ) : null}
    </li>
  );
}

// Last month's goal, read-only: how it landed, which steps were taken, and its notes.
function LastMonthGoal({
  goal,
  notes,
  people,
  settled,
  carriedTitle,
  canCarry,
  canNote,
  onCarry,
  onNote,
  onNotes,
  onError,
}: {
  goal: Goal;
  notes: GoalNote[];
  people: Profile[];
  settled: boolean;
  carriedTitle: string | null;
  canCarry: boolean;
  canNote: boolean;
  onCarry: () => void;
  onNote: (note: string | null) => void;
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
          <GoalNotes goal={goal} notes={notes} people={people} canWrite={false} onNotes={onNotes} onError={onError} />
        </div>
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
              <ArrowRight size={12} aria-hidden /> Carried into this month
            </span>
          ) : canCarry ? (
            <Button variant="secondary" size="sm" aria-label={`Carry ${goal.title} into this month`} onClick={onCarry}>
              <ArrowRight size={13} aria-hidden /> Carry into this month
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
  onAdd,
}: {
  cycle: ReviewCycle;
  focusGoal: Goal | null;
  canEdit: boolean;
  isOwn: boolean;
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
          <input type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder={`What will ${isOwn ? "you" : "they"} do this month on this topic?`} aria-label="GSR for this focus topic" className={`${inputClass} mt-0 min-w-0 flex-1`} />
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
          <Plus size={13} aria-hidden /> Set {whose} monthly GSR based on this focus topic
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
  people,
  roleGoals = [],
  gsrRequired = null,
  isAdmin,
  isOwn,
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
  // The company's people, to name who wrote each note.
  people: Profile[];
  // The goals the person's job role brings into every month, set once in Settings. Offered
  // here until each is filed for this month; the template itself is never edited from a review.
  roleGoals?: JobRoleGoal[];
  // How many goals a month requires, from the company's Monthly GSRs pillar; null for a company
  // that does not score its GSRs, which then sees none of the counting.
  gsrRequired?: number | null;
  isAdmin: boolean;
  isOwn: boolean;
  onGoals: (update: (goals: Goal[]) => Goal[]) => void;
  onNotes: NotesUpdate;
  onError: (message: string) => void;
  onTouched: () => void;
}) {
  const open = cycle.status === "open";
  // A month an admin has marked complete with its score is locked in for this person (0023).
  const locked = monthLocked(review);
  // The manager and the person both work an open month in full: set goals, steps, completion,
  // notes, the why on last month. RLS is what keeps it to their own (goals are theirs to write
  // since 0013), and the database freezes a closed or locked month; this only decides what the
  // page offers.
  const canEdit = (isAdmin || isOwn) && open && !locked;
  const year = cycleYear(cycle);
  const { thisCycle, lastCycle } = splitGoals(goals, { cycleId: cycle.id, previousCycleId: previousCycle?.id ?? null, year });
  const lastSettled = previousCycle ? cycleSettled(previousCycle) : true;

  // Where a carried goal came from is a property of the link, not of "the previous cycle".
  // Reading it off previousCycle named the wrong month whenever the source cycle was deleted
  // (goals.cycle_id is ON DELETE SET NULL, so the goal outlives its cycle) or whenever a
  // skipped month was created later and slid in between. The source goal is only in `goals`
  // when it belongs to this person, which it always does, and the neutral wording covers the
  // case where the source goal or its cycle is gone.
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

  async function saveNote(goal: Goal, note: string | null) {
    try {
      upsert(await updateGoal(goal.id, { outcome_note: note }));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-1">
        <Section
          eyebrow={previousCycle ? previousCycle.name : "Last month"}
          title="Last month at a glance"
          description={previousCycle && lastCycle.length > 0 ? `${summary.hit} of ${pluralize(summary.total, "goal")} hit` : undefined}
        >
          {!previousCycle ? (
            <p className="text-sm text-ink-2">No earlier month yet. The goals set here are read back next month as hit or miss.</p>
          ) : lastCycle.length === 0 ? (
            <p className="text-sm text-ink-2">No goals were set for {previousCycle.name}.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lastCycle.map((goal) => (
                <LastMonthGoal key={goal.id} goal={goal} notes={notesFor(goal)} people={people} settled={lastSettled} carriedTitle={carriedTitle(goal)} canCarry={canEdit} canNote={isAdmin || isOwn} onCarry={() => void carry(goal)} onNote={(note) => void saveNote(goal, note)} onNotes={onNotes} onError={onError} />
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="space-y-6 lg:col-span-2">
        <Section
          eyebrow={cycle.name}
          title="Goals for this month"
          description={
            isOwn && !isAdmin
              ? "Fill these in before the meeting: the goals you want this month, the steps to get there, and notes as you go. You and your manager agree each goal's completion in the review, and 100 marks it complete. Action steps are your checkpoints and do not count toward the score."
              : "Set together in the review. Agreed completion is the number for each goal, and 100 marks it complete; action steps are checkpoints along the way and do not count toward the score. Next month reads each goal back as a hit or a miss."
          }
        >
          {locked ? (
            <p className="mb-4 rounded-md border border-line bg-surface-2/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
              <span className="tnum font-medium text-ink">Locked in at {review.gsr_score}%</span>
              {review.completed_at ? ` on ${formatDate(review.completed_at)}` : ""}. The month's goals and notes are on record; {isAdmin ? "reopen the review" : "your manager can reopen the review"} to change them.
            </p>
          ) : split && month && gsrRequired ? (
            <p className="mb-4 text-[12.5px] leading-relaxed text-ink-2">
              <span className={`tnum font-medium ${split.missing > 0 ? "text-warning" : "text-ink"}`}>
                {gsrRequired - split.missing} of {pluralize(gsrRequired, "mandatory GSR")} set · {month.total}% of {month.cap}% so far, a month score of {scoreMonth(thisCycle, gsrRequired)}%
              </span>
              . Every goal adds its completion, up to 100% for each mandatory GSR: the focus topic's GSR is #1, then role and professional goals, and a stretch goal adds to the total without ever lowering it. The score counts once an admin marks the month complete, which locks it in.
              {cycle.theme && !focusGoal ? " The #1 GSR comes from the focus topic: set it from the card below." : ""}
            </p>
          ) : null}
          {cycle.theme ? (
            <FocusTopicCard cycle={cycle} focusGoal={focusGoal} canEdit={canEdit} isOwn={isOwn} onAdd={(title, kind) => void add(title, kind, true)} />
          ) : canEdit && isAdmin ? (
            <p className="mb-4 rounded-lg border border-dashed border-line-strong px-4 py-3 text-[12.5px] text-ink-2">
              No focus topic for {cycle.name} yet.{" "}
              <Link to={cyclePath(cycle)} className="text-accent hover:underline">Set one on the month</Link>
            </p>
          ) : null}
          {canEdit && pendingRoleGoals.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3">
              <div className="min-w-0">
                <p className={eyebrowClass}>Role goals</p>
                <p className="mt-0.5 text-sm text-ink">{pendingRoleGoals.map((g) => g.title).join(" · ")}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-2">{pluralize(pendingRoleGoals.length, "goal")} {isOwn ? "your" : "their"} job role brings into every month, not filed for {cycle.name} yet.</p>
              </div>
              <Button variant="secondary" size="sm" disabled={seeding} onClick={() => void addRoleGoals()}>
                <Plus size={13} aria-hidden /> Add role goals
              </Button>
            </div>
          ) : null}
          {thisCycle.length === 0 ? (
            <p className="text-sm text-ink-2">{canEdit ? "No goals yet. Add the first one below, or carry one forward from last month." : "No goals set for this month yet."}</p>
          ) : null}
          <ul className="space-y-3">
            {ordered.map((goal) => (
              <GoalEditor
                key={goal.id}
                goal={goal}
                notes={notesFor(goal)}
                people={people}
                standing={standing(goal)}
                canEdit={canEdit}
                canTick={canEdit}
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
              <AddGoalForm placeholder="Add a goal for this month" onAdd={(title) => void add(title)} />
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
