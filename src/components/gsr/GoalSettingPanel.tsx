// The Goal Setting Review for a monthly cycle. The manager and the person set this month's
// goals together, live: each with action steps and a progress slider where 100 is complete.
// Last month's goals read back as hit or miss with a one-click carry forward, the person's
// yearly goals sit alongside, and the review names the month's focus topics. Every change
// saves on its own; a closed cycle is read-only.
import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Plus, Trash2, X } from "lucide-react";
import ActionSteps from "./ActionSteps.tsx";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import ProgressSlider from "../ui/ProgressSlider.tsx";
import Section from "../ui/Section.tsx";
import { inputClass, selectClass, textareaClass } from "../ui/forms.ts";
import { GOAL_OUTCOME_TONE } from "../status.ts";
import { createGoal, deleteGoal, updateGoal, updateReview } from "../../services/gsr.ts";
import { carryForward, goalOutcome, hitCount, parseTopics, progressPatch, splitGoals, stepsTaken } from "../../lib/gsr/goals.ts";
import { cycleSettled, cycleYear } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import { GOAL_KIND_LABELS, keysOf, type Goal, type GoalKind, type Review, type ReviewCycle } from "../../types/database.ts";

const eyebrowClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";

type GoalPatch = Parameters<typeof updateGoal>[1];

// One editable goal: title, kind, progress, description, steps, notes. Used for this month's
// goals and for the yearly ones.
function GoalEditor({
  goal,
  canEdit,
  canTick,
  carriedFrom,
  onChange,
  onDelete,
  onError,
  onTouched,
}: {
  goal: Goal;
  canEdit: boolean;
  canTick: boolean;
  carriedFrom: string | null;
  onChange: (goal: Goal) => void;
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
                {keysOf(GOAL_KIND_LABELS).map((k) => (
                  <option key={k} value={k}>{GOAL_KIND_LABELS[k]}</option>
                ))}
              </select>
            ) : (
              <span>{GOAL_KIND_LABELS[goal.kind]}</span>
            )}
            {carriedFrom ? (
              <Badge tone="warning">
                <ArrowRight size={11} aria-hidden /> Carried from {carriedFrom}
              </Badge>
            ) : null}
            {total > 0 ? <span>{done}/{total} steps done</span> : null}
          </div>
        </div>
        {canEdit ? (
          <IconButton label={`Delete ${goal.title}`} onClick={onDelete}>
            <Trash2 size={14} aria-hidden />
          </IconButton>
        ) : null}
      </div>

      <ProgressSlider className="mt-3" label={`Progress for ${goal.title}`} value={goal.progress} disabled={!canTick} onCommit={(next) => void save(progressPatch(next, goal.status))} />

      {canEdit ? (
        <BlurInput multiline rows={1} value={goal.description ?? ""} placeholder="What does success look like?" ariaLabel={`Description for ${goal.title}`} onSave={(next) => void save({ description: next.trim() || null })} className={`${textareaClass} mt-3 min-h-[36px] text-[13px]`} />
      ) : goal.description ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{goal.description}</p>
      ) : null}

      <div className="mt-3">
        <p className={eyebrowClass}>Action steps</p>
        <ActionSteps steps={goal.action_steps} canTick={canTick} canEdit={canEdit} onChange={(steps) => void save({ action_steps: steps })} />
      </div>

      {canEdit ? (
        <div className="mt-3">
          <p className={eyebrowClass}>Notes</p>
          <BlurInput multiline rows={1} value={goal.progress_notes ?? ""} placeholder="Where things stand" ariaLabel={`Notes for ${goal.title}`} onSave={(next) => void save({ progress_notes: next.trim() || null })} className={`${textareaClass} mt-1.5 min-h-[36px] text-[13px]`} />
        </div>
      ) : goal.progress_notes ? (
        <div className="mt-3">
          <p className={eyebrowClass}>Notes</p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-2">{goal.progress_notes}</p>
        </div>
      ) : null}
    </li>
  );
}

// Last month's goal, read-only: how it landed and which steps were taken.
function LastMonthGoal({ goal, settled, carriedTitle, canCarry, onCarry }: { goal: Goal; settled: boolean; carriedTitle: string | null; canCarry: boolean; onCarry: () => void }) {
  const outcome = goalOutcome(goal, settled);
  const { done, total } = stepsTaken(goal);
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{goal.title}</p>
          <p className="mt-0.5 text-[12px] text-ink-3">
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
      {goal.progress_notes ? <p className="mt-2 text-[12.5px] text-ink-2">{goal.progress_notes}</p> : null}
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
  goals,
  isAdmin,
  isOwn,
  onGoals,
  onReview,
  onError,
  onTouched,
}: {
  review: Review;
  cycle: ReviewCycle;
  previousCycle: ReviewCycle | null;
  goals: Goal[];
  isAdmin: boolean;
  isOwn: boolean;
  onGoals: (update: (goals: Goal[]) => Goal[]) => void;
  onReview: (review: Review) => void;
  onError: (message: string) => void;
  onTouched: () => void;
}) {
  const open = cycle.status === "open";
  const canEdit = isAdmin && open;
  // The person ticks steps and moves progress on their own goals; the manager does everything.
  const canTick = (isAdmin || isOwn) && open;
  const year = cycleYear(cycle);
  const { thisCycle, lastCycle, yearly } = splitGoals(goals, { cycleId: cycle.id, previousCycleId: previousCycle?.id ?? null, year });
  const lastSettled = previousCycle ? cycleSettled(previousCycle) : true;
  const summary = hitCount(lastCycle, lastSettled);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState("");

  const upsert = (goal: Goal) => onGoals((list) => (list.some((g) => g.id === goal.id) ? list.map((g) => (g.id === goal.id ? goal : g)) : [...list, goal]));
  const carriedTitle = (source: Goal) => thisCycle.find((g) => g.carried_from_goal_id === source.id)?.title ?? null;

  async function add(scope: "cycle" | "year", title: string) {
    try {
      const created = await createGoal({
        company_id: review.company_id,
        employee_id: review.employee_id,
        title,
        kind: "professional",
        scope,
        cycle_id: scope === "cycle" ? cycle.id : null,
        year: scope === "year" ? year : null,
        sort_order: (scope === "cycle" ? thisCycle : yearly).length + 1,
      });
      upsert(created);
      onTouched();
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function carry(goal: Goal) {
    try {
      upsert(await createGoal(carryForward(goal, cycle.id, thisCycle.length + 1)));
      onTouched();
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function removeGoal() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteGoal(deleting.id);
      const id = deleting.id;
      onGoals((list) => list.filter((g) => g.id !== id));
      setDeleting(null);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveTopics(next: string[]) {
    try {
      onReview(await updateReview(review.id, { focus_topics: next }));
      onTouched();
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  function addTopics(event: FormEvent) {
    event.preventDefault();
    const next = parseTopics(topic, review.focus_topics);
    setTopic("");
    if (next.length !== review.focus_topics.length) void saveTopics(next);
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
                <LastMonthGoal key={goal.id} goal={goal} settled={lastSettled} carriedTitle={carriedTitle(goal)} canCarry={canEdit} onCarry={() => void carry(goal)} />
              ))}
            </ul>
          )}
        </Section>

        <Section eyebrow={String(year)} title="Yearly goals" description="The year's goals for this person, with where each one stands.">
          {yearly.length === 0 ? <p className="text-sm text-ink-2">No yearly goals set for {year} yet.</p> : null}
          <ul className="space-y-3">
            {yearly.map((goal) => (
              <GoalEditor key={goal.id} goal={goal} canEdit={canEdit} canTick={canTick} carriedFrom={null} onChange={upsert} onDelete={() => setDeleting(goal)} onError={onError} onTouched={onTouched} />
            ))}
          </ul>
          {canEdit ? (
            <div className={yearly.length > 0 ? "mt-4" : "mt-3"}>
              <AddGoalForm placeholder={`Add a goal for ${year}`} onAdd={(title) => void add("year", title)} />
            </div>
          ) : null}
        </Section>
      </div>

      <div className="space-y-6 lg:col-span-2">
        <Section eyebrow="This month" title="Focus topics" description="What this month is about for this person.">
          <div className="flex flex-wrap items-center gap-2">
            {review.focus_topics.length === 0 && !canEdit ? <span className="text-sm text-ink-3">None named.</span> : null}
            {review.focus_topics.map((t) => (
              <Badge key={t} tone="accent" className={canEdit ? "pr-1" : ""}>
                {t}
                {canEdit ? (
                  <button type="button" aria-label={`Remove topic ${t}`} onClick={() => void saveTopics(review.focus_topics.filter((x) => x !== t))} className="ml-0.5 rounded-full p-0.5 hover:bg-accent/20">
                    <X size={11} aria-hidden />
                  </button>
                ) : null}
              </Badge>
            ))}
          </div>
          {canEdit ? (
            <form onSubmit={addTopics} className="mt-3 flex gap-2">
              <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Add a focus topic" aria-label="Add a focus topic" className={`${inputClass} mt-0 flex-1`} />
              <Button type="submit" variant="secondary" disabled={!topic.trim()}>
                <Plus size={14} aria-hidden /> Add
              </Button>
            </form>
          ) : null}
        </Section>

        <Section
          eyebrow={cycle.name}
          title="Goals for this month"
          description="Set together in the review. Progress is live; 100 marks a goal complete, and next month reads it back as a hit."
        >
          {thisCycle.length === 0 ? (
            <p className="text-sm text-ink-2">{canEdit ? "No goals yet. Add the first one below, or carry one forward from last month." : "No goals set for this month yet."}</p>
          ) : null}
          <ul className="space-y-3">
            {thisCycle.map((goal) => (
              <GoalEditor
                key={goal.id}
                goal={goal}
                canEdit={canEdit}
                canTick={canTick}
                carriedFrom={goal.carried_from_goal_id && previousCycle ? previousCycle.name : null}
                onChange={upsert}
                onDelete={() => setDeleting(goal)}
                onError={onError}
                onTouched={onTouched}
              />
            ))}
          </ul>
          {canEdit ? (
            <div className={thisCycle.length > 0 ? "mt-4" : "mt-3"}>
              <AddGoalForm placeholder="Add a goal for this month" onAdd={(title) => void add("cycle", title)} />
            </div>
          ) : null}
        </Section>
      </div>

      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          body="The goal and its action steps are removed from this review. Leave it below 100 instead to keep the miss on record."
          confirmLabel="Delete goal"
          busy={busy}
          onConfirm={() => void removeGoal()}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
