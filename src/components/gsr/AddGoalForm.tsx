// The one-line form that adds a goal to a Goal Setting Review by its title. Its own file so a
// monthly GSR (GoalSettingPanel) and a GSR on demand (GsrGoalsPanel) add a goal the same way.
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import Button from "../ui/Button.tsx";
import { inputClass } from "../ui/forms.ts";

export default function AddGoalForm({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => void }) {
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
