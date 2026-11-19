// A heavier RBA roster for visual checks of dense screens (npm run demo with ?load=dense):
// 22 people, 17 job roles, 54 role metrics and 35 role goals, including long role names and a
// long unbroken name to test wrapping. Everything here is made up. Tests never set the address
// flag, so this never runs under them.
import type { CompanyBundle } from "./fixtures.ts";
import type { JobRole, JobRoleGoal, MetricKind, Profile, RoleMetric } from "../types/database.ts";

const TARGET = { people: 22, roles: 17, metrics: 54, goals: 35 };
const MODULES = ["tasks", "external_links", "production"];
const STAMP = "2026-01-05T09:00:00Z";

const ROLE_NAMES = [
  "Manager of Administration and Internal Operations",
  "Business Development and Procurement",
  "Estimator",
  "Scheduler",
  "Safety Coordinator",
  "Field Engineer",
  "Purchasing Agent",
  "Lead Carpenter",
  "Client Liaison",
  "Quality Inspector",
  "Warranty Coordinator",
  "Document Controller",
  "Apprentice Foreman",
  "Equipment Manager",
  "Accounts Coordinator",
];

const PEOPLE: Array<[string, string]> = [
  ["Marlowe Fenwick", "Estimator"],
  ["Tessa Orlando", "Scheduler"],
  ["Dev Anand Rao", "Safety Coordinator"],
  ["Imogen Pryce", "Field Engineer"],
  ["Bastian Holt", "Purchasing Agent"],
  ["Wolfeschlegelsteinhausen", "Site Coordinator"],
  ["Ulrika Sandvik", "Lead Carpenter"],
  ["Ottoline Marsh", "Client Liaison"],
  ["Ravi Chandrasekaran", "Quality Inspector"],
  ["Wilhelmina Castellanos", "Warranty Coordinator"],
  ["Pellegrino Abernathy", "Document Controller"],
  ["Niamh Calloway", "Apprentice Foreman"],
  ["Jun Takahashi", "Equipment Manager"],
  ["Odalys Brennan", "Accounts Coordinator"],
  ["Fitzgerald Okonkwo", "Business Development Lead"],
  ["Saoirse Delacroix", "Operations Analyst"],
  ["Lena Voss", "Administrator"],
  ["Cormac Idowu", "Foreman"],
  ["Petra Lindqvist", "Project Coordinator"],
];

const METRIC_NAMES = [
  "Optimization rate", "Schedule adherence", "Change orders documented", "Punch list closed on time",
  "Client journey satisfaction", "Compliance to SOPs", "Daily logs filed", "Safety compliance",
  "Bid accuracy", "Purchase orders on budget", "Rework rate", "Invoices out within five days",
];
const METRIC_KINDS: MetricKind[] = ["percent", "rating", "number"];

const GOAL_TITLES = [
  "Walk every active site once a week", "Close out the month's change orders by the 5th",
  "Run a toolbox talk with every crew", "Finish one training course this quarter",
  "Mentor one newer teammate", "Review every open purchase order on Fridays",
  "Hold a client check-in on each active job", "Keep the shared drive filed by project",
];

export function applyDenseLoad(bundle: CompanyBundle): void {
  const id = (suffix: string) => `${bundle.company.slug}-dense-${suffix}`;
  const base = { company_id: bundle.company.id, created_at: STAMP, updated_at: STAMP };

  bundle.company.modules = [...new Set([...bundle.company.modules, ...MODULES])];

  // Job roles: add the made-up ones until 17 are active.
  const activeRoles = () => bundle.jobRoles.filter((r) => r.is_active);
  const maxSort = Math.max(0, ...bundle.jobRoles.map((r) => r.sort_order));
  const addedRoles: JobRole[] = [];
  for (let i = 0; activeRoles().length < TARGET.roles && i < ROLE_NAMES.length; i++) {
    const role: JobRole = { id: id(`role-${i}`), ...base, name: ROLE_NAMES[i], description: null, dashboard_modules: [], sort_order: maxSort + i + 1, is_active: true };
    bundle.jobRoles.push(role);
    addedRoles.push(role);
  }

  // People: spread across both divisions, three in none, one in both, reporting in a chain.
  const [south, north] = [...bundle.divisions].sort((a, b) => a.sort_order - b.sort_order);
  const anchor = bundle.profiles.find((x) => x.is_active && x.role === "manager") ?? bundle.profiles[0];
  const needed = Math.max(0, TARGET.people - bundle.profiles.filter((x) => x.is_active).length);
  const roleIds = bundle.jobRoles.filter((r) => r.is_active).map((r) => r.id);
  const added: Profile[] = [];
  for (let i = 0; i < needed && i < PEOPLE.length; i++) {
    const [name, title] = PEOPLE[i];
    const divisionIds = i < 3 ? [] : i === 3 ? [south.id, north.id] : i % 2 === 0 ? [south.id] : [north.id];
    // The first few report to the anchor; later ones to a person two or three places before them.
    const reportsTo = i < 3 ? anchor.id : added[i - 3 + (i % 2)]?.id ?? added[0].id;
    added.push({
      id: id(`person-${i}`),
      user_id: i % 3 === 0 ? null : id(`auth-${i}`),
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${bundle.company.slug === "rba" ? "rbaprojects.com" : "example.com"}`,
      full_name: name,
      title,
      company_id: bundle.company.id,
      role: "employee",
      is_rococo_admin: false,
      is_active: true,
      hire_date: "2025-06-02",
      phone: null,
      department: null,
      reports_to: reportsTo,
      job_role_id: roleIds[(i + 1) % roleIds.length] ?? null,
      division_id: divisionIds.length === 1 ? divisionIds[0] : null,
      division_ids: divisionIds,
      can_view_divisions: false,
      view_all_divisions: false,
      view_division_ids: [],
      created_at: STAMP,
      updated_at: STAMP,
    });
  }
  bundle.profiles.push(...added);

  // Role metrics: spread across the added roles until 54 are active.
  const metricRoles = addedRoles.length ? addedRoles : bundle.jobRoles.filter((r) => r.is_active);
  let k = 0;
  while (bundle.roleMetrics.filter((m) => m.is_active).length < TARGET.metrics) {
    const role = metricRoles[k % metricRoles.length];
    const kind = METRIC_KINDS[k % METRIC_KINDS.length];
    const metric: RoleMetric = {
      id: id(`metric-${k}`), ...base, job_role_id: role.id, name: `${METRIC_NAMES[k % METRIC_NAMES.length]}${k >= METRIC_NAMES.length ? ` ${Math.floor(k / METRIC_NAMES.length) + 1}` : ""}`,
      description: null, kind, target: kind === "percent" ? 80 : kind === "rating" ? 4 : k % 2 ? null : 10, scale_max: 5, higher_is_better: true,
      per_project: k % 7 === 0, sort_order: 10 + k, is_active: true,
    };
    bundle.roleMetrics.push(metric);
    k++;
  }

  // Role goals: until 35 are active, cycling kinds.
  const kinds: JobRoleGoal["kind"][] = ["role", "professional", "personal"];
  let g = 0;
  while (bundle.jobRoleGoals.filter((x) => x.is_active).length < TARGET.goals) {
    const role = metricRoles[g % metricRoles.length];
    bundle.jobRoleGoals.push({
      id: id(`rolegoal-${g}`), ...base, job_role_id: role.id, title: GOAL_TITLES[g % GOAL_TITLES.length],
      description: g % 3 === 0 ? "Eyes on quality and safety, in person." : null, kind: kinds[g % kinds.length], sort_order: 10 + g, is_active: true,
    });
    g++;
  }
}
