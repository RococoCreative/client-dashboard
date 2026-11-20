// The focus topic card of a Goal Setting Review: the topic and what it means, there for reference,
// with the way to set the person's #1 GSR from it in their own words. Its own file so a monthly GSR
// (GoalSettingPanel) and a GSR on demand (GsrGoalsPanel) show the topic with the same part.
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import Button from "../ui/Button.tsx";
import { inputClass, selectClass } from "../ui/forms.ts";
import { GOAL_KIND_LABELS, type Goal, type GoalKind, type ReviewCycle } from "../../types/database.ts";
import { eyebrowLabelClass as eyebrowClass } from "../ui/type.ts";

// The focus topic's GSR is a working goal, never a personal one.
const FOCUS_KINDS: GoalKind[] = ["role", "professional"];

// The month's focus topic and what it means, always on the month and there for reference, with the
// way to set the person's #1 GSR from it. Their words make the goal, as a role or professional
// goal; the explanation stays here rather than being copied into a goal titled after the topic.
export default function FocusTopicCard({
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
