// The division editors on a person's Setup tab: which divisions they work in, and, for an owner or
// Rococo, what an admin or a manager may view beyond where they work. Split out of PersonSetup so
// that file keeps the details fields. The pending-list hook sits here with them: it keeps two quick
// ticks building on each other while writes are in flight.
import { useRef, useState } from "react";
import { checkboxClass, helpClass, labelClass } from "../../ui/forms.ts";
import { displayName } from "../../../lib/format.ts";
import { canSetDivisionAccess, canViewDivision, divisionLabel } from "../../../lib/people.ts";
import type { ProfilePatch } from "../../../services/profiles.ts";
import type { CompanyDivision, Profile } from "../../../types/database.ts";

type Patch = (patch: ProfilePatch) => Promise<boolean>;

// Ids in the company's division order, with anything not one of its divisions kept at the end, so a
// write never drops an id the viewer was not shown.
function inDivisionOrder(ids: readonly string[], divisions: readonly CompanyDivision[]): string[] {
  const known = divisions.map((d) => d.id).filter((id) => ids.includes(id));
  return [...known, ...ids.filter((id) => !known.includes(id))];
}

// Toggles one id in a list kept in the company's division order.
function toggled(ids: readonly string[], id: string, on: boolean, divisions: readonly CompanyDivision[]): string[] {
  return inDivisionOrder(on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id), divisions);
}

// A list being saved: what the boxes show while writes are in flight, so two quick ticks build on
// each other, and the stored value again once every write has settled.
function usePendingList(stored: readonly string[]) {
  const [pending, setPending] = useState<string[] | null>(null);
  const inflight = useRef(0);
  async function save(next: string[], write: () => Promise<boolean>) {
    setPending(next);
    inflight.current += 1;
    try {
      await write();
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setPending(null);
    }
  }
  return { value: pending ?? [...stored], save };
}

// What a manager or an admin may see beyond where they work, set by an owner or Rococo only: every
// division, chosen divisions, or none. Kept apart from membership on purpose, and from the
// dashboard split toggle below it, which only changes the figures they see.
function ViewAccessFields({ person, divisions, onPatch }: { person: Profile; divisions: CompanyDivision[]; onPatch: Patch }) {
  const [choosing, setChoosing] = useState(false);
  const [pendingAll, setPendingAll] = useState<boolean | null>(null);
  const ids = usePendingList(person.view_division_ids);
  const all = pendingAll ?? person.view_all_divisions;
  const mode = all ? "all" : ids.value.length > 0 || choosing ? "chosen" : "none";
  const first = displayName(person).split(" ")[0];
  const group = `view-access-${person.id}`;

  async function setAll(next: boolean, extra: ProfilePatch = {}) {
    setPendingAll(next);
    try {
      await onPatch({ view_all_divisions: next, ...extra });
    } finally {
      setPendingAll(null);
    }
  }

  function pick(next: "all" | "chosen" | "none") {
    if (next === mode) return;
    setChoosing(next === "chosen");
    if (next === "all") void setAll(true);
    else if (next === "chosen") {
      if (all) void setAll(false);
    }
    else void ids.save([], () => setAll(false, { view_division_ids: [] }).then(() => true));
  }

  return (
    <fieldset className="space-y-1.5">
      <legend className={labelClass}>Can view</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(
          [
            ["all", "All divisions"],
            ["chosen", "Chosen divisions"],
            ["none", "None"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline-flex items-center gap-1.5 text-[13px] text-ink">
            <input type="radio" name={group} value={value} checked={mode === value} onChange={() => pick(value)} />
            {label}
          </label>
        ))}
      </div>
      {mode === "chosen" ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {divisions.map((d) => (
            <label key={d.id} className="inline-flex items-center gap-1.5 text-[13px] text-ink">
              <input
                type="checkbox"
                className={checkboxClass}
                aria-label={`Can view ${d.name}`}
                checked={ids.value.includes(d.id)}
                onChange={(e) => {
                  const next = toggled(ids.value, d.id, e.target.checked, divisions);
                  void ids.save(next, () => onPatch({ view_division_ids: next }));
                }}
              />
              {d.name}
            </label>
          ))}
        </div>
      ) : null}
      <p className={helpClass}>
        Whose records {first} may open, apart from where they work. They always see the people who report to them and the people below those.{" "}
        {person.role === "admin" ? "As an admin they also see everyone not placed in a division." : "As a manager they see only employees in these divisions."}{" "}
        A role change made by anyone but an owner or Rococo clears this.
      </p>
    </fieldset>
  );
}

// The divisions a person works in, then, for an owner or Rococo, what an admin or a manager may see
// and whether they see the division split. An admin places people only in divisions they can view;
// any other division a person is in shows, ticked and locked.
export default function DivisionFields({ person, me, divisions, onPatch }: { person: Profile; me: Profile; divisions: CompanyDivision[]; onPatch: Patch }) {
  const membership = usePendingList(person.division_ids);
  const current = membership.value;
  const owner = person.role === "owner";
  const leadsPeople = person.role === "admin" || person.role === "manager";
  const setsAccess = canSetDivisionAccess(me);
  const locked = divisions.filter((d) => !canViewDivision(me, d.id));
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className={labelClass}>Divisions</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {divisions.map((d) => {
            const canPlace = canViewDivision(me, d.id);
            return (
              <label key={d.id} className={`inline-flex items-center gap-1.5 text-[13px] ${canPlace ? "text-ink" : "text-ink-3"}`}>
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={current.includes(d.id)}
                  disabled={!canPlace}
                  onChange={(e) => {
                    const next = toggled(current, d.id, e.target.checked, divisions);
                    void membership.save(next, () => onPatch({ division_ids: next }));
                  }}
                />
                {d.name}
              </label>
            );
          })}
        </div>
        <p className={helpClass}>
          Works in: {divisionLabel(current, divisions)}.{divisions.length === 2 ? " Tick both for Both." : ""}
          {locked.length > 0 ? ` ${locked.map((d) => d.name).join(", ")} is outside the divisions you can view, so it stays as it is.` : ""}
        </p>
      </fieldset>
      {leadsPeople && setsAccess ? (
        <ViewAccessFields person={person} divisions={divisions} onPatch={onPatch} />
      ) : leadsPeople ? (
        <p className={helpClass}>
          Can view {person.view_all_divisions ? "all divisions" : person.view_division_ids.length > 0 ? divisionLabel(person.view_division_ids, divisions) : "no divisions beyond their own team"}. Only an owner or Rococo can change that.
        </p>
      ) : null}
      {setsAccess ? (
        <div>
          <label className="flex items-start gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              className={`${checkboxClass} mt-0.5`}
              checked={owner || person.can_view_divisions}
              disabled={owner}
              onChange={(e) => void onPatch({ can_view_divisions: e.target.checked })}
            />
            <span>Can view divisions</span>
          </label>
          <p className={helpClass}>
            {owner
              ? "Owners always see the split."
              : "The division split on the dashboard and the Scorecards report: each division next to the combined company. It changes the figures they see, not whose records they can open."}
          </p>
        </div>
      ) : person.can_view_divisions ? (
        <p className={helpClass}>Sees the division split on the dashboard. Only an owner or Rococo can change that.</p>
      ) : null}
    </div>
  );
}
