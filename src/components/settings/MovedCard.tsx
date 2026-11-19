// The signpost at the foot of Settings: setup that used to live here now sits in the module it
// configures, so each row links to where it went. Rows are links only. The card adds no permission,
// every target keeps its own gate. Standard milestones show only for a company with the production
// module, the same rule that shows the Projects tab.
import { Link } from "react-router-dom";
import Section from "../ui/Section.tsx";
import { secondaryClass } from "../ui/type.ts";
import { hasModule } from "../../lib/modules.ts";
import type { Company } from "../../types/database.ts";

export default function MovedCard({ company }: { company: Pick<Company, "modules"> }) {
  const rows = [
    { label: "Job roles and divisions", to: "/people/roles" },
    { label: "Pillars, weights and deliverable categories", to: "/reviews/setup" },
    { label: "Focus topics and the goals a GSR requires", to: "/gsr/setup" },
    ...(hasModule(company, "production") ? [{ label: "Standard milestones", to: "/production/setup" }] : []),
  ];
  return (
    <Section title="Set up elsewhere" description="These settings now live with the part of the hub they shape.">
      <ul className="-mt-4 divide-y divide-line border-b border-line sm:-mt-6">
        {rows.map((row) => (
          <li key={row.to} className="py-3">
            <Link to={row.to} className={`text-link hover:underline [overflow-wrap:anywhere] ${secondaryClass}`}>{row.label}</Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
