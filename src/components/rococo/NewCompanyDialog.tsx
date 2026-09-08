// Create a company: name, a permanent lowercase identifier, and the theme it wears. Used
// from the portfolio and the Companies tab.
import { useState, type FormEvent } from "react";
import Button from "../ui/Button.tsx";
import Field from "../ui/Field.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import { inputClass, selectClass } from "../ui/forms.ts";
import { createCompany } from "../../services/companies.ts";
import { THEMES, THEME_KEYS } from "../../lib/theme.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { Company, ThemeKey } from "../../types/database.ts";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function NewCompanyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (company: Company) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [theme, setTheme] = useState<ThemeKey>("rococo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Name the company.");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return setError("The identifier can only use lowercase letters, numbers, and hyphens.");
    setBusy(true);
    setError("");
    try {
      onCreated(await createCompany({ name: name.trim(), slug, theme_key: theme }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="new-company-title">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="new-company-title" className="font-display text-lg text-heading">New company</h2>
        <div className="mt-5 space-y-4">
          <Field label="Name" htmlFor="nc-name">
            <input
              id="nc-name"
              type="text"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Identifier" htmlFor="nc-slug" hint="Short, lowercase, permanent.">
            <input
              id="nc-slug"
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field label="Theme" htmlFor="nc-theme">
            <select id="nc-theme" value={theme} onChange={(e) => setTheme(e.target.value as ThemeKey)} className={selectClass}>
              {THEME_KEYS.map((k) => (
                <option key={k} value={k}>{THEMES[k].label}</option>
              ))}
            </select>
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Creating..." : "Create company"}</Button>
        </div>
      </form>
    </Modal>
  );
}
