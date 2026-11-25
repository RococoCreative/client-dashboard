// Picks an SOP's category: the company's own, a starter it has not named yet, Uncategorized, or a
// new name typed in. The choice is resolved to a real category only when the SOP is saved.
import { useState } from "react";
import Field from "../ui/Field.tsx";
import { inputClass, selectClass } from "../ui/forms.ts";
import { CUSTOM_CATEGORY, categoryOptions, decodeChoice, encodeChoice, type CategoryChoice } from "../../lib/sops/categories.ts";
import type { SopCategory } from "../../types/database.ts";

export default function CategoryPicker({
  id,
  categories,
  currentId,
  value,
  onChange,
}: {
  id: string;
  categories: SopCategory[];
  currentId: string | null;
  value: CategoryChoice;
  onChange: (choice: CategoryChoice) => void;
}) {
  const options = categoryOptions(categories, currentId);
  const encoded = encodeChoice(value);
  const listed = options.some((o) => o.value === encoded);
  const [typing, setTyping] = useState(!listed);

  return (
    <Field label="Category" htmlFor={id}>
      <select
        id={id}
        value={typing ? CUSTOM_CATEGORY : encoded}
        onChange={(e) => {
          if (e.target.value === CUSTOM_CATEGORY) {
            setTyping(true);
            onChange({ kind: "new", name: "" });
            return;
          }
          setTyping(false);
          onChange(decodeChoice(e.target.value));
        }}
        className={selectClass}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
        <option value={CUSTOM_CATEGORY}>Another category...</option>
      </select>
      {typing ? (
        <input
          aria-label="New category name"
          value={value.kind === "new" ? value.name : ""}
          onChange={(e) => onChange({ kind: "new", name: e.target.value })}
          placeholder="Name the category"
          maxLength={60}
          className={inputClass}
          autoFocus
        />
      ) : null}
    </Field>
  );
}
