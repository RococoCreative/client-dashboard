// One goal of a Goal Setting Review, editable in place: its title, kind, agreed completion,
// description, action steps, notes and, where the company runs tasks, the tasks behind it. Its own
// file so a monthly GSR (GoalSettingPanel) and a GSR on demand (GsrGoalsPanel) edit a goal with the
// same part. Every change saves on its own, queued so the writes land in the order they were made.
import { useRef } from "react";
import { ArrowRight, Lock } from "lucide-react";
import ActionSteps from "./ActionSteps.tsx";
import GoalNotes from "./GoalNotes.tsx";
import GoalTasks from "./GoalTasks.tsx";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ProgressSlider from "../ui/ProgressSlider.tsx";
import { inputClass, selectClass, textareaClass } from "../ui/forms.ts";
import { updateGoal } from "../../services/gsr.ts";
import { FOCUS_KINDS, GOAL_KIND_ORDER, progressPatch, stepsTaken } from "../../lib/gsr/goals.ts";
import { errorMessage } from "../../lib/errors.ts";
import { GOAL_KIND_LABELS, type Goal, type GoalKind, type GoalNote, type Profile, type TaskWithSteps } from "../../types/database.ts";
import { eyebrowLabelClass as eyebrowClass } from "../ui/type.ts";

type GoalPatch = Parameters<typeof updateGoal>[1];
export type NotesUpdate = (update: (notes: GoalNote[]) => GoalNote[]) => void;
export type TasksUpdate = (update: (tasks: TaskWithSteps[]) => TaskWithSteps[]) => void;
// What a goal needs to list its tasks: the linked ones on the page, the profiles for the task form,
// who is looking, and how to update the page's list. Absent where the company does not run tasks.
export type TaskLinks = { tasks: TaskWithSteps[]; people: Profile[]; viewerProfileId: string; onTasks: TasksUpdate };
// Where a goal stands in a scored month: one of the mandatory GSRs, or a stretch goal.
export type Standing = "mandatory" | "stretch";

// One of this month's goals: title, kind, agreed completion, description, steps, notes.
export default function GoalEditor({
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
          <Button variant="danger" size="sm" aria-label={`Delete ${goal.title}`} onClick={onDelete}>
            Delete
          </Button>
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
