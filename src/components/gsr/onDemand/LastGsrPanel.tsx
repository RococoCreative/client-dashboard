// The person's last GSR, read back on the page of the new one, so the two people in the meeting can
// talk it through while they set the new one. It is the GSR before this one (previousGsr), whatever
// its state and however long ago, and everyone who may open this page sees it: its start date,
// whether it is in progress or done (with the day and the score it locked), each goal with its
// completion, and the goals' notes read only, as the notes the viewer may read already are.
//
// While it is still open its goals' completion is worked here by anyone who may work it on its own
// page, and those who may close it (never the person themself) mark it done with the same confirm
// the GSR's own page uses (MarkGsrDone). A goal it left under 100 carries forward into the new GSR
// while the new one is open, once: a goal already carried reads "Carried forward", judged from the
// goals on record (carried_from_goal_id), as the monthly page reads it.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import GoalNotes from "../GoalNotes.tsx";
import MarkGsrDone from "./MarkGsrDone.tsx";
import Badge from "../../ui/Badge.tsx";
import Button from "../../ui/Button.tsx";
import ProgressSlider from "../../ui/ProgressSlider.tsx";
import Section from "../../ui/Section.tsx";
import { tapTargetClass } from "../../ui/tap.ts";
import { eyebrowLabelClass } from "../../ui/type.ts";
import { GOAL_OUTCOME_TONE } from "../../status.ts";
import { createGoal, updateGoal } from "../../../services/gsr.ts";
import { goalOutcome, progressPatch, rankGoals } from "../../../lib/gsr/goals.ts";
import { carryForwardToGsr, gsrGoals, isOpen } from "../../../lib/gsr/onDemand.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { formatDate } from "../../../lib/format.ts";
import { GOAL_KIND_LABELS, type Goal, type GoalNote, type Gsr } from "../../../types/database.ts";

// The notes here are read only, so nothing ever updates them from this panel.
const keepNotes = () => undefined;

// One goal of the last GSR: its completion, worked here while that GSR is open, its notes, and the
// way to carry it forward.
function LastGoal({
  goal,
  notes,
  names,
  settled,
  canTick,
  carried,
  canCarry,
  carrying,
  onTick,
  onCarry,
  onError,
}: {
  goal: Goal;
  notes: GoalNote[];
  names: ReadonlyMap<string, string>;
  settled: boolean;
  canTick: boolean;
  carried: boolean;
  canCarry: boolean;
  carrying: boolean;
  onTick: (progress: number) => Promise<boolean>;
  onCarry: () => void;
  onError: (message: string) => void;
}) {
  const outcome = goalOutcome(goal, settled);
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{goal.title}</p>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {goal.is_focus ? "Focus topic GSR · " : ""}
            {GOAL_KIND_LABELS[goal.kind]}
          </p>
        </div>
        {canTick ? null : (
          <Badge tone={GOAL_OUTCOME_TONE[outcome]}>
            {outcome === "hit" ? <Check size={11} aria-hidden /> : null}
            {outcome === "hit" ? "Complete" : outcome === "miss" ? `Missed at ${goal.progress}%` : `${goal.progress}% so far`}
          </Badge>
        )}
      </div>
      {canTick ? <ProgressSlider className="mt-2" label={`Agreed completion for ${goal.title} on the last GSR`} value={goal.progress} onCommit={onTick} /> : null}
      {notes.length > 0 ? (
        <div className="mt-2">
          <p className={eyebrowLabelClass}>Notes</p>
          <GoalNotes goal={goal} notes={notes} names={names} canWrite={false} onNotes={keepNotes} onError={onError} />
        </div>
      ) : null}
      {goal.progress < 100 ? (
        carried ? (
          <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-ink-3">
            <ArrowRight size={12} aria-hidden /> Carried forward
          </p>
        ) : canCarry ? (
          <div className="mt-2">
            <Button variant="secondary" size="sm" disabled={carrying} aria-label={`Carry forward ${goal.title}`} onClick={onCarry}>
              <ArrowRight size={13} aria-hidden /> Carry forward
            </Button>
          </div>
        ) : null
      ) : null}
    </li>
  );
}

export default function LastGsrPanel({
  current,
  last,
  goals,
  notes,
  names,
  required,
  canClose,
  canEdit,
  onGoals,
  onClosed,
  onError,
}: {
  // The GSR on the page.
  current: Gsr;
  // The one before it (previousGsr), or null on a person's first.
  last: Gsr | null;
  // The person's goals, every GSR's; the panel reads the last GSR's and what was carried into this one.
  goals: Goal[];
  // The person's goal notes the viewer may read; each goal shows its own.
  notes: GoalNote[];
  names: ReadonlyMap<string, string>;
  required: number | null;
  // The viewer may mark this person's GSRs done: someone who leads them or an admin, never the person.
  canClose: boolean;
  // The viewer may work this person's GSRs' goals: the person, those who lead them and admins. The
  // panel holds each GSR to its own state: the last one's completion while it is open, a carry while
  // the one on the page is.
  canEdit: boolean;
  onGoals: (update: (goals: Goal[]) => Goal[]) => void;
  onClosed: (next: Gsr) => void;
  onError: (message: string) => void;
}) {
  const [carrying, setCarrying] = useState("");

  if (!last) {
    return (
      <Section title="Last GSR">
        <p className="text-sm text-ink-2">No earlier GSR yet.</p>
      </Section>
    );
  }

  const lastId = last.id;
  const open = isOpen(last);
  const ordered = rankGoals(gsrGoals(goals, lastId));
  const here = gsrGoals(goals, current.id);
  const canTick = canEdit && open;
  const canCarry = canEdit && isOpen(current);
  const upsert = (goal: Goal) => onGoals((list) => (list.some((g) => g.id === goal.id) ? list.map((g) => (g.id === goal.id ? goal : g)) : [...list, goal]));

  async function tick(goal: Goal, progress: number): Promise<boolean> {
    try {
      upsert(await updateGoal(goal.id, progressPatch(progress, goal.status)));
      onError("");
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    }
  }

  // One click, guarded so a double click never files the same goal twice.
  async function carry(goal: Goal) {
    if (carrying) return;
    setCarrying(goal.id);
    try {
      upsert(await createGoal(carryForwardToGsr(goal, current.id, here.length + 1)));
      onError("");
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setCarrying("");
    }
  }

  return (
    <Section
      title="Last GSR"
      description={`Started ${formatDate(last.started_on)}`}
      actions={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={open ? "info" : "success"}>{open ? "In progress" : `Done ${formatDate(last.done_on)}`}</Badge>
          {!open && last.gsr_score !== null ? <span className="tnum text-[12.5px] text-ink-3">{last.gsr_score}%</span> : null}
        </span>
      }
    >
      {ordered.length === 0 ? (
        <p className="text-sm text-ink-2">No goals were set for this GSR.</p>
      ) : (
        <ul className="divide-y divide-line">
          {ordered.map((goal) => (
            <LastGoal
              key={goal.id}
              goal={goal}
              notes={notes.filter((n) => n.goal_id === goal.id)}
              names={names}
              settled={!open}
              canTick={canTick}
              carried={here.some((g) => g.carried_from_goal_id === goal.id)}
              canCarry={canCarry}
              carrying={carrying === goal.id}
              onTick={(progress) => tick(goal, progress)}
              onCarry={() => void carry(goal)}
              onError={onError}
            />
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Link to={`/gsr/reviews/${lastId}`} className={`text-[12.5px] text-link hover:underline ${tapTargetClass}`}>
          Open the last GSR
        </Link>
        {canClose && open ? (
          <MarkGsrDone
            gsr={last}
            required={required}
            variant="secondary"
            onGoals={(fresh) => onGoals((list) => [...list.filter((g) => g.review_id !== lastId), ...gsrGoals(fresh, lastId)])}
            onDone={onClosed}
            onError={onError}
          />
        ) : null}
      </div>
    </Section>
  );
}
