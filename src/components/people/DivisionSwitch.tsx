// The Combined / per-division switch, for the people allowed to see the split (canSeeDivisions:
// an owner, Rococo, or someone given the view). The choices are the company's own divisions, so
// every company gets the same control and only its rows differ. Everyone else never sees it and
// reads the combined picture.
import Chip from "../ui/Chip.tsx";
import { COMBINED } from "../scorecards/compare.ts";
import type { CompanyDivision } from "../../types/database.ts";

export default function DivisionSwitch({
  divisions,
  value,
  onChange,
}: {
  divisions: readonly CompanyDivision[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div role="group" aria-label="Division" className="flex flex-wrap items-center gap-1.5">
      <Chip active={value === COMBINED} onClick={() => onChange(COMBINED)}>
        Combined
      </Chip>
      {divisions.map((d) => (
        <Chip key={d.id} active={value === d.id} onClick={() => onChange(d.id)}>
          {d.name}
        </Chip>
      ))}
    </div>
  );
}
