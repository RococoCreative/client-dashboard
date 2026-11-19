// Who reports to this person, on their profile: their direct reports and everyone below them, as a
// tree, so a manager opening their own profile (or an admin opening a manager's) sees the team the
// reporting lines add up to. Built from the people the viewer can see, which the database has
// already narrowed, so it never names anyone the viewer may not open. Shown for anyone ranked
// manager or above, and for anyone at all with reports, because an employee with reports is a
// setup mistake worth seeing: they do not see those people until they are a manager.
import { Link } from "react-router-dom";
import Avatar from "../ui/Avatar.tsx";
import Badge from "../ui/Badge.tsx";
import Section from "../ui/Section.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listDivisions } from "../../services/divisions.ts";
import { displayName } from "../../lib/format.ts";
import { divisionLabel, hasAccount, isLeadRole } from "../../lib/people.ts";
import { ROLE_LABELS, type CompanyDivision, type Profile } from "../../types/database.ts";

// The same depth limit the database's chain walk has, so a loop saved before 0033 can never spin.
const MAX_DEPTH = 50;

type Node = { person: Profile; reports: Node[] };

// Active people under `rootId`, nearest first, each with the people under them. Inactive people
// are left out of the tree and counted instead, so a past employee never reads as current team.
function buildTree(people: readonly Profile[], rootId: string): { nodes: Node[]; inactive: number } {
  const byManager = new Map<string, Profile[]>();
  for (const p of people) {
    if (!p.reports_to || p.reports_to === p.id) continue;
    const list = byManager.get(p.reports_to) ?? [];
    list.push(p);
    byManager.set(p.reports_to, list);
  }
  const seen = new Set<string>([rootId]);
  let inactive = 0;
  const walk = (managerId: string, depth: number): Node[] => {
    if (depth > MAX_DEPTH) return [];
    const reports = (byManager.get(managerId) ?? [])
      .filter((p) => !seen.has(p.id))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
    const nodes: Node[] = [];
    for (const person of reports) {
      seen.add(person.id);
      if (!person.is_active) {
        inactive += 1;
        continue;
      }
      nodes.push({ person, reports: walk(person.id, depth + 1) });
    }
    return nodes;
  };
  const nodes = walk(rootId, 1);
  return { nodes, inactive };
}

function countAll(nodes: readonly Node[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countAll(n.reports), 0);
}

function TeamRow({ node, divisions, depth }: { node: Node; divisions: readonly CompanyDivision[]; depth: number }) {
  const { person, reports } = node;
  const below = countAll(reports);
  return (
    <li>
      <div className="flex items-center gap-3 border-b border-line py-2" style={{ paddingLeft: `${Math.min(depth, 6) * 20}px` }}>
        <Avatar person={person} size={24} />
        <div className="min-w-0 flex-1">
          <Link to={`/people/${person.id}`} className="text-sm font-medium text-ink hover:text-link">
            {displayName(person)}
          </Link>
          <p className="truncate text-[12px] text-ink-3">
            {[person.title ?? ROLE_LABELS[person.role], divisions.length > 0 ? divisionLabel(person.division_ids, divisions) : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {below > 0 ? <span className="text-[12px] text-ink-3 tnum">{below} below</span> : null}
          {hasAccount(person) ? null : <Badge tone="warning">Not signed in yet</Badge>}
        </div>
      </div>
      {reports.length > 0 ? (
        <ul aria-label={`Reports to ${displayName(person)}`}>
          {reports.map((child) => (
            <TeamRow key={child.person.id} node={child} divisions={divisions} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function PersonTeam({
  companyId,
  person,
  people,
  self,
  isAdmin,
}: {
  companyId: string;
  person: Profile;
  people: readonly Profile[];
  // The viewer is this person: the copy speaks to them.
  self: boolean;
  isAdmin: boolean;
}) {
  const divisionsState = useAsync(() => listDivisions(companyId), [companyId]);
  const divisions = divisionsState.data ?? [];
  const { nodes, inactive } = buildTree(people, person.id);
  const lead = isLeadRole(person.role);
  if (!lead && nodes.length === 0) return null;

  const first = displayName(person).split(" ")[0];
  const total = countAll(nodes);
  const direct = nodes.length;
  const title = self ? "Who reports to you" : `Who reports to ${first}`;
  const description =
    total === 0
      ? undefined
      : `${direct} direct ${direct === 1 ? "report" : "reports"}${total > direct ? `, ${total} in all` : ""}.${inactive > 0 ? ` ${inactive} inactive not shown.` : ""}`;

  let empty: string;
  if (self) empty = "No one reports to you yet. An admin sets Reports to on each person.";
  else if (isAdmin) empty = `No one reports to ${first} yet. Set Reports to on each person they manage.`;
  else empty = `No one you can see reports to ${first}.`;

  return (
    <Section eyebrow="Team" title={title} description={description}>
      {!lead && nodes.length > 0 ? (
        <p className="mb-3 text-[12px] text-warning">
          {first} is an employee, so they do not see these people. Make them a manager to give them this team.
        </p>
      ) : null}
      {nodes.length === 0 ? (
        <p className="text-sm text-ink-2">{empty}</p>
      ) : (
        <ul aria-label={title} className="-mt-2">
          {nodes.map((node) => (
            <TeamRow key={node.person.id} node={node} divisions={divisions} depth={0} />
          ))}
        </ul>
      )}
    </Section>
  );
}
