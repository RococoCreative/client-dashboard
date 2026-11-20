// The goals of one GSR on demand: the same goals a monthly GSR sets, held by the GSR itself
// (goals.review_id, 0047) rather than by a month. The focus topic of the month the GSR began in sits
// above them, read from the company's focus topic calendar, with the way to set the person's #1 GSR
// from it. The role's goals are offered in one click. Goals read the focus topic's GSR first, then
// role, professional and personal (rankGoals). Where the company scores its GSRs, the goals add up
// against the company's number of mandatory goals (requiredAndStretch, monthTotal, scoreMonth: the
// one rule every company shares). The editor, the focus topic card and the add form are the monthly
// GSR's own parts. Every change saves on its own; the page decides who may edit (canEdit), and a
// done GSR is read only until it is reopened, which the database holds to as well.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import AddGoalForm from "../AddGoalForm.tsx";
import FocusTopicCard from "../FocusTopicCard.tsx";
import GoalEditor, { type NotesUpdate, type Standing, type TaskLinks } from "../GoalEditor.tsx";
import Button from "../../ui/Button.tsx";
import ConfirmDialog from "../../ui/ConfirmDialog.tsx";
import Section from "../../ui/Section.tsx";
import { eyebrowLabelClass } from "../../ui/type.ts";
import { useHub } from "../../../context/HubContext.tsx";
import { createGoal, deleteGoal } from "../../../services/gsr.ts";
import { goalLockedFor, monthTotal, rankGoals, requiredAndStretch, scoreMonth } from "../../../lib/gsr/goals.ts";
import { gsrGoals, isOpen } from "../../../lib/gsr/onDemand.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { pluralize } from "../../../lib/format.ts";
import type { FocusTopic, Goal, GoalKind, GoalNote, Gsr, JobRoleGoal } from "../../../types/database.ts";

// "August 2026", for the month a GSR began in.
function monthName(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function GsrGoalsPanel({
  gsr,
  goals,
  notes,
  names,
  roleGoals,
  required,
  topic,
  canEdit,
  taskLinks,
  onGoals,
  onNotes,
  onError,
}: {
  gsr: Gsr;
  // The person's goals; the panel shows this GSR's own.
  goals: Goal[];
  // The person's goal notes the reader may see; each goal shows its own.
  notes: GoalNote[];
  // Full names by profile id, from the company directory, to name who wrote each note.
  names: ReadonlyMap<string, string>;
  // The goals the person's job role brings into every GSR, offered until each is filed here.
  roleGoals: JobRoleGoal[];
  // How many goals a GSR requires, from the company's active Monthly GSRs pillar; null for a company
  // that does not score its GSRs, which then sees none of the counting.
  required: number | null;
  // The focus topic of the month the GSR began in, or null when that month has none.
  topic: FocusTopic | null;
  canEdit: boolean;
  // The tasks linked to this GSR's goals, for a company that runs tasks; null where it does not.
  taskLinks: TaskLinks | null;
  onGoals: (update: (goals: Goal[]) => Goal[]) => void;
  onNotes: NotesUpdate;
  // A failure line for the page; an empty one clears it once something saves.
  onError: (message: string) => void;
}) {
  const { profile, isAdmin } = useHub();
  const isOwn = gsr.employee_id === profile.id;
  const whose = isOwn ? "your" : "their";
  const own = gsrGoals(goals, gsr.id);
  const ordered = rankGoals(own);
  const focusGoal = ordered.find((g) => g.is_focus) ?? null;
  const notesFor = (goal: Goal) => notes.filter((n) => n.goal_id === goal.id);
  const split = required ? requiredAndStretch(own, required) : null;
  const standing = (goal: Goal): Standing | null => (split ? (split.required.includes(goal) ? "mandatory" : "stretch") : null);
  const total = required ? monthTotal(own, required) : null;
  // A role goal is filed once a goal with its title is on this GSR, whoever typed it.
  const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const pendingRoleGoals = roleGoals.filter((template) => !own.some((g) => sameTitle(g.title, template.title)));

  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);
  // A refused delete is said inside the dialog, not on the page behind the scrim.
  const [deleteError, setDeleteError] = useState("");
  const [seeding, setSeeding] = useState(false);

  const upsert = (goal: Goal) => onGoals((list) => (list.some((g) => g.id === goal.id) ? list.map((g) => (g.id === goal.id ? goal : g)) : [...list, goal]));
  const touched = () => onError("");

  // Everything set here belongs to this GSR, never to a cycle.
  async function add(title: string, kind: GoalKind = "professional", isFocus = false) {
    try {
      upsert(
        await createGoal({
          company_id: gsr.company_id,
          employee_id: gsr.employee_id,
          title,
          kind,
          is_focus: isFocus,
          description: null,
          scope: "cycle",
          cycle_id: null,
          review_id: gsr.id,
          year: null,
          sort_order: own.length + 1,
        }),
      );
      touched();
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  // The role's goals land one at a time, in their template order, as goals of kind 'role'. Guarded
  // against a double click filing them twice.
  async function addRoleGoals() {
    if (seeding) return;
    setSeeding(true);
    try {
      let order = own.length + 1;
      for (const template of pendingRoleGoals) {
        upsert(
          await createGoal({
            company_id: gsr.company_id,
            employee_id: gsr.employee_id,
            title: template.title,
            kind: "role",
            description: template.description,
            scope: "cycle",
            cycle_id: null,
            review_id: gsr.id,
            year: null,
            sort_order: order++,
          }),
        );
      }
      touched();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSeeding(false);
    }
  }

  async function removeGoal() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError("");
    try {
      const id = deleting.id;
      await deleteGoal(id);
      onGoals((list) => list.filter((g) => g.id !== id));
      setDeleting(null);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      eyebrow="Goals"
      title="Goals for this GSR"
      description={
        isOwn && !isAdmin
          ? "Fill these in before you meet: the goals you want, the steps to get there, and notes as you go. You and your manager agree each goal's completion, and 100 marks it complete. Action steps are your checkpoints and do not count toward the score."
          : "Set together in the GSR. Agreed completion is the number for each goal, and 100 marks it complete; action steps are checkpoints along the way and do not count toward the score."
      }
    >
      {!isOpen(gsr) ? (
        <p className="mb-4 rounded-md border border-line bg-surface-2/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
          <span className="font-medium text-ink">This GSR is done.</span> Its goals and notes are on record as they were until it is reopened.
        </p>
      ) : split && total && required ? (
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-2">
          <span className={`tnum font-medium ${split.missing > 0 ? "text-warning" : "text-ink"}`}>
            {required - split.missing} of {pluralize(required, "mandatory GSR")} set · {total.total}% of {total.cap}% so far, a score of {scoreMonth(own, required)}%
          </span>
          . Every goal adds its completion, up to 100% for each mandatory GSR: the focus topic's GSR is #1, then role and professional goals, and a stretch goal adds to the total without ever lowering it. The score counts once this GSR is marked done, which locks it in.
          {topic && !focusGoal ? " The #1 GSR comes from the focus topic: set it from the card below." : ""}
        </p>
      ) : null}
      {topic ? (
        <FocusTopicCard
          cycle={{ theme: topic.theme, theme_description: topic.description }}
          focusGoal={focusGoal}
          canEdit={canEdit}
          isOwn={isOwn}
          onAdd={(title, kind) => void add(title, kind, true)}
          placeholder={`What will ${isOwn ? "you" : "they"} do on this topic?`}
          setLabel={`Set ${whose} GSR based on this focus topic`}
        />
      ) : canEdit && isAdmin ? (
        <p className="mb-4 rounded-lg border border-dashed border-line-strong px-4 py-3 text-[12.5px] text-ink-2">
          No focus topic for {monthName(gsr.started_on)} yet. Plan the year in{" "}
          <Link to="/gsr/setup" className="text-link hover:underline">GSRs, Setup</Link>.
        </p>
      ) : null}
      {canEdit && pendingRoleGoals.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3">
          <div className="min-w-0">
            <p className={eyebrowLabelClass}>Role goals</p>
            <p className="mt-0.5 text-sm text-ink">{pendingRoleGoals.map((g) => g.title).join(" · ")}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-2">{pluralize(pendingRoleGoals.length, "goal")} {whose} job role brings into every GSR, not filed for this one yet.</p>
          </div>
          <Button variant="secondary" size="sm" disabled={seeding} onClick={() => void addRoleGoals()}>
            <Plus size={13} aria-hidden /> Add role goals
          </Button>
        </div>
      ) : null}
      {own.length === 0 ? <p className="text-sm text-ink-2">{canEdit ? "No goals yet. Add the first one below." : "No goals set for this GSR."}</p> : null}
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
            carriedFrom={goal.carried_from_goal_id ? "an earlier GSR" : null}
            onChange={upsert}
            onNotes={onNotes}
            onDelete={() => setDeleting(goal)}
            onError={onError}
            onTouched={touched}
          />
        ))}
      </ul>
      {canEdit ? (
        <div className={own.length > 0 ? "mt-4" : "mt-3"}>
          <AddGoalForm placeholder="Add a goal for this GSR" onAdd={(title) => void add(title)} />
        </div>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          body="The goal, its action steps and its notes are removed from this GSR. Leave it below 100 instead to keep the miss on record."
          confirmLabel="Delete goal"
          busy={busy}
          error={deleteError}
          onConfirm={() => void removeGoal()}
          onCancel={() => {
            setDeleting(null);
            setDeleteError("");
          }}
        />
      ) : null}
    </Section>
  );
}
