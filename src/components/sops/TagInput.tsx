// An SOP's tags: type one and press Enter or a comma to add it, remove one with its x. Tags the
// company already uses are suggested. The database tidies them as well (0053); this keeps the
// screen honest about what will be saved: trimmed, no repeats in any case, at most 20 of 40.
import { useId, useState } from "react";
import { X } from "lucide-react";
import Field from "../ui/Field.tsx";
import { inputClass } from "../ui/forms.ts";
import { MAX_TAGS, addTag } from "../../lib/sops/tags.ts";

export default function TagInput({ id, tags, onChange, suggestions = [] }: { id: string; tags: string[]; onChange: (tags: string[]) => void; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const commit = (value: string) => {
    onChange(addTag(tags, value));
    setDraft("");
  };

  return (
    <Field label="Tags" htmlFor={id} hint="Press Enter or a comma after each. Up to 20.">
      {tags.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Tags on this SOP">
          {tags.map((tag) => (
            <li key={tag} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2.5 pr-1 text-[12px] text-ink-2">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-line hover:text-ink tap:h-11 tap:w-11"
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        id={id}
        value={draft}
        list={listId}
        onChange={(e) => {
          const value = e.target.value;
          if (value.includes(",")) {
            let next = tags;
            for (const part of value.split(",").slice(0, -1)) next = addTag(next, part);
            onChange(next);
            setDraft(value.split(",").pop() ?? "");
            return;
          }
          setDraft(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={tags.length >= MAX_TAGS ? "Tag limit reached" : "Add a tag"}
        disabled={tags.length >= MAX_TAGS}
        className={inputClass}
      />
      <datalist id={listId}>
        {suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </Field>
  );
}
