// The company's divisions, for an admin in Company Settings: the parts it splits into for
// reporting, such as two regions or two offices. Each is a company row (rule 12), added, renamed
// on blur and removed here; a person's divisions are set on their person page. Divisions decide
// who sees whom (0038), so only a full-scope admin (an owner, Rococo, or an admin who sees every
// division) changes them; any other admin reads the list. A division someone still works in
// cannot be removed: the database refuses, and the dialog shows its answer. A person in two
// divisions counts in each.
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { inputClass } from "../ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { createDivision, deleteDivision, listDivisions, updateDivision } from "../../services/divisions.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import { hasFullScope } from "../../lib/people.ts";
import type { CompanyDivision } from "../../types/database.ts";

export default function DivisionsPanel({ companyId }: { companyId: string }) {
  const { profile } = useHub();
  const canChange = hasFullScope(profile);
  const state = useAsync(async () => {
    const [divisions, people] = await Promise.all([listDivisions(companyId), listCompanyProfiles(companyId)]);
    return { divisions, people };
  }, [companyId]);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<CompanyDivision | null>(null);
  const [busy, setBusy] = useState(false);
  // The dialog reports only its own failure, so its error is cleared whenever it opens. A delete
  // already sent cannot be called back, so the dialog waits for the answer.
  const [dialogError, setDialogError] = useState("");

  const divisions = [...(state.data?.divisions ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const memberCount = (id: string) => (state.data?.people ?? []).filter((p) => p.division_ids.includes(id)).length;

  function setDivisions(fn: (list: CompanyDivision[]) => CompanyDivision[]) {
    state.setData((prev) => (prev ? { ...prev, divisions: fn(prev.divisions) } : prev));
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = name.trim();
    if (!text || adding) return;
    setAdding(true);
    setError("");
    try {
      const sortOrder = divisions.reduce((max, d) => Math.max(max, d.sort_order), 0) + 1;
      const created = await createDivision({ company_id: companyId, name: text, sort_order: sortOrder });
      setDivisions((list) => [...list, created]);
      setName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  // Returns whether it saved, so the name box keeps the draft and says "Not saved" when it did not.
  async function rename(division: CompanyDivision, next: string): Promise<boolean> {
    setError("");
    try {
      const saved = await updateDivision(division.id, { name: next.trim() });
      setDivisions((list) => list.map((d) => (d.id === saved.id ? saved : d)));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  function openRemove(division: CompanyDivision) {
    if (busy) return;
    setDialogError("");
    setRemoving(division);
  }

  function closeRemove() {
    if (busy) return;
    setRemoving(null);
    setDialogError("");
  }

  async function remove() {
    if (!removing) return;
    const id = removing.id;
    setBusy(true);
    setDialogError("");
    try {
      await deleteDivision(id);
      state.setData((prev) =>
        prev
          ? {
              divisions: prev.divisions.filter((d) => d.id !== id),
              people: prev.people.map((p) => (p.view_division_ids.includes(id) ? { ...p, view_division_ids: p.view_division_ids.filter((v) => v !== id) } : p)),
            }
          : prev,
      );
      setRemoving(null);
    } catch (err) {
      setDialogError(errorMessage(err, "The division was not removed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const removingCount = removing ? memberCount(removing.id) : 0;

  return (
    <Section
      eyebrow="People"
      title="Divisions"
      description="The parts the company splits into, such as regions or offices. Set each person's divisions on their page; someone can work in more than one. With no divisions, the hub shows the company as one."
    >
      {!canChange ? (
        <p className="mb-3 text-[13px] text-ink-3">Divisions decide who sees whom, so only an owner, Rococo, or an admin who sees every division adds, renames or removes one.</p>
      ) : null}
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={2} /> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.data ? (
        <>
          {divisions.length === 0 ? (
            <p className="text-sm text-ink-2">No divisions yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {divisions.map((division) => (
                <li key={division.id} className="flex items-center gap-3 py-2 first:pt-0">
                  <div className="min-w-0 flex-1">
                    {canChange ? (
                      <BlurInput
                        value={division.name}
                        required
                        ariaLabel={`Division name ${division.name}`}
                        onSave={(next) => rename(division, next)}
                        className={`${inputClass} mt-0 text-[13px]`}
                      />
                    ) : (
                      <p className="truncate text-[13px] text-ink">{division.name}</p>
                    )}
                  </div>
                  <span className="tnum shrink-0 text-[12px] text-ink-3">{pluralize(memberCount(division.id), "person", "people")}</span>
                  {canChange ? (
                    <IconButton label={`Remove ${division.name}`} onClick={() => openRemove(division)}>
                      <Trash2 size={14} aria-hidden />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canChange ? (
            <form onSubmit={(e) => void add(e)} className={`flex gap-2 ${divisions.length === 0 ? "mt-3" : "mt-3 border-t border-line pt-3"}`}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New division"
                aria-label="New division"
                className={`${inputClass} mt-0 flex-1 text-[13px]`}
              />
              <Button type="submit" variant="secondary" disabled={!name.trim() || adding}>
                <Plus size={14} aria-hidden /> Add division
              </Button>
            </form>
          ) : null}
        </>
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={`Remove "${removing.name}"?`}
          body={
            removingCount === 0
              ? "Nobody works in it, so nothing else changes. Anyone who could see it no longer has that view."
              : `${pluralize(removingCount, "person still works", "people still work")} in it. A division someone works in stays until they are moved out on their pages.`
          }
          confirmLabel="Remove division"
          busy={busy}
          error={dialogError}
          onConfirm={() => void remove()}
          onCancel={closeRemove}
        />
      ) : null}
    </Section>
  );
}
