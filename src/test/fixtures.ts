// Deterministic sample data for three companies, used by the page tests (vitest) and by the
// browser preview harness. Every name here is fictional. Generated once at module load so
// ids are stable across a run.
import type { Session } from "@supabase/supabase-js";
import type { HubValue } from "../context/HubContext.tsx";
import type {
  Company,
  CompanyDomain,
  CompanyGoal,
  FinancialSnapshot,
  MarketingCampaign,
  Goal,
  GsrCriterion,
  GsrPillar,
  Invitation,
  Profile,
  Resource,
  ResourceKind,
  Review,
  ReviewCycle,
  ReviewScore,
  Role,
  ScoringType,
  Sop,
  SopAttachment,
  SopCategory,
  SopStatus,
  SopVersion,
} from "../types/database.ts";

const NOW = "2026-09-01T12:00:00.000Z";
const EARLIER = "2026-08-04T15:30:00.000Z";

export const COMPANIES: Company[] = [
  { id: "co-kingdom", slug: "kingdom", name: "Kingdom Custom Construction", theme_key: "kingdom", logo_url: null, created_at: NOW, updated_at: NOW },
  { id: "co-klasik", slug: "klasik", name: "Klasik Construction", theme_key: "klasik", logo_url: null, created_at: NOW, updated_at: NOW },
  { id: "co-rba", slug: "rba", name: "RBA Projects", theme_key: "rba", logo_url: null, created_at: NOW, updated_at: NOW },
];

export const DOMAINS: CompanyDomain[] = [
  { domain: "kingdomcustomconstruction.com", company_id: "co-kingdom", created_at: NOW },
  { domain: "beklasik.com", company_id: "co-klasik", created_at: NOW },
  { domain: "rbaprojects.com", company_id: "co-rba", created_at: NOW },
];

interface PersonSpec { name: string; title: string; role: Role }
interface PillarSpec { name: string; weight: number; type: ScoringType; description: string; criteria: string[] }
interface SopSpec { title: string; category: SopCategory; summary: string; status: SopStatus }
interface ResourceSpec { title: string; kind: ResourceKind; tags: string[]; url: string | null }
interface CompanySpec {
  domain: string;
  cadence: ReviewCycle["cadence"];
  people: PersonSpec[];
  pillars: PillarSpec[];
  sops: SopSpec[];
  resources: ResourceSpec[];
  companyGoals: Array<{ name: string; target: string; current: string; hit: boolean }>;
}

const SPECS: Record<string, CompanySpec> = {
  "co-klasik": {
    domain: "beklasik.com",
    cadence: "monthly",
    people: [
      { name: "Jordan Vale", title: "Owner", role: "admin" },
      { name: "Sam Ortega", title: "Production Manager", role: "employee" },
      { name: "Riley Park", title: "Project Manager", role: "employee" },
      { name: "Casey Nguyen", title: "Office Manager", role: "employee" },
    ],
    pillars: [
      { name: "Deliverables", weight: 50, type: "deliverables", description: "Target vs actual on the deliverable groups agreed for the period.", criteria: [] },
      { name: "Brand Impact", weight: 25, type: "rating", description: "How fully the person lives the brand pillars, rated 1 to 5.", criteria: ["DNA", "Identity", "Mission", "Company Vision", "Culture Vision"] },
      { name: "Character & Values", weight: 25, type: "rating", description: "How fully the person lives the core values, rated 1 to 5.", criteria: ["Curiosity", "Integrity", "Competency", "Tenacity", "Community & Entrepreneurship"] },
    ],
    sops: [
      { title: "Jobsite safety walk", category: "safety", summary: "Daily walk before crews start, with the checklist and photo log.", status: "published" },
      { title: "Pre-construction handoff", category: "process", summary: "What sales hands to production and how the kickoff meeting runs.", status: "published" },
      { title: "Client change order", category: "client", summary: "Pricing, approval, and documentation for any scope change.", status: "published" },
      { title: "Weekly invoicing", category: "admin", summary: "Draws, lien waivers, and the Friday send.", status: "draft" },
    ],
    resources: [
      { title: "Change order template", kind: "template", tags: ["client", "forms"], url: "https://example.com/change-order" },
      { title: "Brand and culture deck", kind: "doc", tags: ["culture", "onboarding"], url: "https://example.com/brand" },
      { title: "Punch list walkthrough video", kind: "video", tags: ["field", "quality"], url: "https://example.com/video" },
    ],
    companyGoals: [
      { name: "Closed sales", target: "$10M", current: "$6.4M", hit: false },
      { name: "Gross margin", target: "28%", current: "29.1%", hit: true },
      { name: "Google reviews", target: "40", current: "31", hit: false },
    ],
  },
  "co-kingdom": {
    domain: "kingdomcustomconstruction.com",
    cadence: "monthly",
    people: [
      { name: "Marcus Lee", title: "Owner", role: "admin" },
      { name: "Dana Whitfield", title: "Superintendent", role: "employee" },
      { name: "Theo Brandt", title: "Estimator", role: "employee" },
      { name: "Priya Natarajan", title: "Project Coordinator", role: "employee" },
    ],
    pillars: [
      { name: "Field Execution", weight: 25, type: "rating", description: "Quality and pace of work on site.", criteria: ["Field Execution"] },
      { name: "Safety", weight: 25, type: "rating", description: "Safe practices, near-miss reporting, PPE, housekeeping.", criteria: ["Safety"] },
      { name: "Client Communication", weight: 25, type: "rating", description: "Responsiveness, clarity, and expectation setting.", criteria: ["Client Communication"] },
      { name: "Quality", weight: 25, type: "rating", description: "Finish quality, punch-list discipline, rework avoided.", criteria: ["Quality"] },
    ],
    sops: [
      { title: "Selections approval", category: "client", summary: "How allowances and selections get confirmed before ordering.", status: "published" },
      { title: "Foundation inspection", category: "field", summary: "Hold points and who calls the inspector.", status: "published" },
      { title: "Fall protection", category: "safety", summary: "Anchor points, harness checks, and roof edges.", status: "published" },
    ],
    resources: [
      { title: "Estimating workbook guide", kind: "doc", tags: ["estimating", "pricing"], url: "https://example.com/estimating" },
      { title: "Client welcome packet", kind: "template", tags: ["client", "onboarding"], url: "https://example.com/welcome" },
    ],
    companyGoals: [
      { name: "Homes delivered", target: "6", current: "4", hit: false },
      { name: "Net promoter score", target: "70", current: "74", hit: true },
    ],
  },
  "co-rba": {
    domain: "rbaprojects.com",
    cadence: "quarterly",
    people: [
      { name: "Alex Morgan", title: "Principal", role: "admin" },
      { name: "Jamie Fox", title: "Site Supervisor", role: "employee" },
      { name: "Noor Haddad", title: "Designer", role: "employee" },
    ],
    pillars: [
      { name: "Performance", weight: 40, type: "deliverables", description: "Target vs actual on the deliverables agreed for the period.", criteria: [] },
      { name: "Core Values", weight: 30, type: "rating", description: "How fully the person lives the company values.", criteria: ["Ownership", "Craftsmanship", "Communication"] },
      { name: "Professional Development", weight: 30, type: "rating", description: "Growth against the development plan.", criteria: ["Skills growth", "Leadership"] },
    ],
    sops: [
      { title: "Cottage site access", category: "field", summary: "Barge scheduling and marine access rules for island builds.", status: "published" },
      { title: "Design review gates", category: "process", summary: "The three design sign-offs before permit.", status: "published" },
    ],
    resources: [
      { title: "Muskoka permit checklist", kind: "template", tags: ["permits", "design"], url: "https://example.com/permits" },
    ],
    companyGoals: [
      { name: "Projects under contract", target: "8", current: "7", hit: false },
    ],
  },
};

export interface CompanyBundle {
  company: Company;
  profiles: Profile[];
  pillars: GsrPillar[];
  criteria: GsrCriterion[];
  cycles: ReviewCycle[];
  reviews: Review[];
  scores: ReviewScore[];
  goals: Goal[];
  companyGoals: CompanyGoal[];
  sops: Sop[];
  versions: SopVersion[];
  attachments: SopAttachment[];
  resources: Resource[];
  invitations: Invitation[];
  snapshots: FinancialSnapshot[];
  campaigns: MarketingCampaign[];
}

// Small deterministic generator so every run produces the same numbers.
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function toDateOnlyLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function slugName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, ".");
}

const SOP_BODY = `## Purpose

Keep every crew and client on the same page before work starts.

## Steps

1. Walk the site with the superintendent and note hazards.
2. Confirm the day's scope against the schedule.
3. Photograph anything that does not match the plan.

## Checks

- Checklist signed by the superintendent
- Photos posted to the project album
`;

function build(company: Company): CompanyBundle {
  const spec = SPECS[company.id];
  const p = (suffix: string) => `${company.slug}-${suffix}`;

  const profiles: Profile[] = spec.people.map((person, i) => ({
    id: p(`user-${i + 1}`),
    email: `${slugName(person.name)}@${spec.domain}`,
    full_name: person.name,
    title: person.title,
    company_id: company.id,
    role: person.role,
    is_rococo_admin: false,
    is_active: true,
    created_at: EARLIER,
    updated_at: EARLIER,
  }));

  const pillars: GsrPillar[] = spec.pillars.map((pillar, i) => ({
    id: p(`pillar-${i + 1}`),
    company_id: company.id,
    name: pillar.name,
    description: pillar.description,
    weight: pillar.weight,
    scoring_type: pillar.type,
    rating_scale_max: 5,
    sort_order: i + 1,
    is_active: true,
    created_at: EARLIER,
    updated_at: EARLIER,
  }));

  const criteria: GsrCriterion[] = spec.pillars.flatMap((pillar, i) =>
    pillar.criteria.map((name, j) => ({
      id: p(`criterion-${i + 1}-${j + 1}`),
      pillar_id: pillars[i].id,
      company_id: company.id,
      name,
      description: `${name}: what strong looks like at ${company.name}.`,
      sort_order: j + 1,
      is_active: true,
      created_at: EARLIER,
      updated_at: EARLIER,
    })),
  );

  const quarterly = spec.cadence === "quarterly";
  const cycles: ReviewCycle[] = [
    {
      id: p("cycle-current"),
      company_id: company.id,
      name: quarterly ? "Q3 2026" : "September 2026",
      cadence: spec.cadence,
      period_start: quarterly ? "2026-07-01" : "2026-09-01",
      period_end: quarterly ? "2026-09-30" : "2026-09-30",
      theme: "Core value: Integrity",
      theme_description: "Say what you will do, do what you said, and speak up early when something slips.",
      status: "open",
      created_by: profiles[0].id,
      created_at: NOW,
      updated_at: NOW,
    },
    {
      id: p("cycle-previous"),
      company_id: company.id,
      name: quarterly ? "Q2 2026" : "August 2026",
      cadence: spec.cadence,
      period_start: quarterly ? "2026-04-01" : "2026-08-01",
      period_end: quarterly ? "2026-06-30" : "2026-08-31",
      theme: null,
      theme_description: null,
      status: "closed",
      created_by: profiles[0].id,
      created_at: EARLIER,
      updated_at: EARLIER,
    },
  ];

  const employees = profiles.filter((x) => x.role === "employee");
  const reviews: Review[] = [];
  const scores: ReviewScore[] = [];
  let seed = company.id.length;

  function scoreReview(review: Review, completeness: number) {
    pillars.forEach((pillar, pi) => {
      if (pillar.scoring_type === "deliverables") {
        const count = completeness >= 1 ? 3 : 2;
        for (let k = 0; k < count; k += 1) {
          seed += 1;
          scores.push({
            id: `${review.id}-deliv-${pi}-${k}`,
            review_id: review.id,
            company_id: company.id,
            pillar_id: pillar.id,
            criterion_id: null,
            label: ["Jobs closed on schedule", "Change orders priced in 48h", "Client updates sent weekly"][k] ?? `Deliverable ${k + 1}`,
            rating: null,
            target: 10,
            actual: Math.round(6 + rand(seed) * 6),
            notes: null,
            sort_order: k,
            created_at: NOW,
            updated_at: NOW,
          });
        }
        return;
      }
      const own = criteria.filter((c) => c.pillar_id === pillar.id);
      const limit = Math.max(1, Math.round(own.length * completeness));
      own.slice(0, limit).forEach((criterion, k) => {
        seed += 1;
        scores.push({
          id: `${review.id}-rating-${pi}-${k}`,
          review_id: review.id,
          company_id: company.id,
          pillar_id: pillar.id,
          criterion_id: criterion.id,
          label: null,
          rating: 3 + Math.floor(rand(seed) * 3),
          target: null,
          actual: null,
          notes: k === 0 ? "Consistent through the period." : null,
          sort_order: k,
          created_at: NOW,
          updated_at: NOW,
        });
      });
    });
  }

  employees.forEach((employee, i) => {
    const current: Review = {
      id: p(`review-current-${i + 1}`),
      cycle_id: cycles[0].id,
      company_id: company.id,
      employee_id: employee.id,
      status: i === 0 ? "in_progress" : i === 1 ? "complete" : "not_started",
      previous_status: i === 0 ? "partial" : i === 1 ? "hit" : null,
      manager_feedback: i === 0 ? "Strong month on site. Keep the client updates weekly, even when nothing changed." : i === 1 ? "Exactly what we want from a lead. Take on the mentoring goal next." : null,
      peer_feedback: null,
      client_feedback: i === 1 ? "The Hendersons called to say thanks." : null,
      employee_reflection: i === 0 ? "Communication with the trades improved once we moved the huddle to 6:45." : null,
      reviewer_id: profiles[0].id,
      completed_at: i === 1 ? NOW : null,
      created_at: NOW,
      updated_at: NOW,
    };
    reviews.push(current);
    if (i === 0) scoreReview(current, 0.6);
    if (i === 1) scoreReview(current, 1);

    const previous: Review = {
      ...current,
      id: p(`review-previous-${i + 1}`),
      cycle_id: cycles[1].id,
      status: "complete",
      previous_status: "hit",
      manager_feedback: "Solid period.",
      client_feedback: null,
      employee_reflection: null,
      completed_at: EARLIER,
      created_at: EARLIER,
      updated_at: EARLIER,
    };
    reviews.push(previous);
    scoreReview(previous, 1);
  });

  const goals: Goal[] = employees.length
    ? [
        {
          id: p("goal-1"),
          company_id: company.id,
          employee_id: employees[0].id,
          cycle_id: cycles[0].id,
          kind: "professional",
          title: "Run the weekly client update without prompting",
          description: "Every active client gets a Friday summary: progress, next week, decisions needed.",
          status: "on_track",
          action_steps: [
            { text: "Draft the summary template", done: true },
            { text: "Send three Fridays in a row", done: true },
            { text: "Ask two clients how it landed", done: false },
          ],
          progress_notes: "Two of three done. Third Friday is this week.",
          sort_order: 1,
          created_by: employees[0].id,
          created_at: EARLIER,
          updated_at: NOW,
        },
        {
          id: p("goal-2"),
          company_id: company.id,
          employee_id: employees[0].id,
          cycle_id: null,
          kind: "professional",
          title: "Get the OSHA 30 certification",
          description: null,
          status: "in_progress",
          action_steps: [
            { text: "Register for the course", done: true },
            { text: "Finish modules 1 to 15", done: false },
          ],
          progress_notes: null,
          sort_order: 2,
          created_by: employees[0].id,
          created_at: EARLIER,
          updated_at: EARLIER,
        },
        {
          id: p("goal-3"),
          company_id: company.id,
          employee_id: employees[0].id,
          cycle_id: null,
          kind: "personal",
          title: "Coach the kids' fall soccer season",
          description: null,
          status: "not_started",
          action_steps: [],
          progress_notes: null,
          sort_order: 1,
          created_by: employees[0].id,
          created_at: EARLIER,
          updated_at: EARLIER,
        },
      ]
    : [];

  const companyGoals: CompanyGoal[] = spec.companyGoals.map((goal, i) => ({
    id: p(`company-goal-${i + 1}`),
    company_id: company.id,
    year: 2026,
    name: goal.name,
    target_display: goal.target,
    current_display: goal.current,
    target_numeric: null,
    current_numeric: null,
    is_hit: goal.hit,
    sort_order: i,
    created_at: EARLIER,
    updated_at: NOW,
  }));

  const sops: Sop[] = spec.sops.map((sop, i) => ({
    id: p(`sop-${i + 1}`),
    company_id: company.id,
    title: sop.title,
    category: sop.category,
    summary: sop.summary,
    status: sop.status,
    current_version: i === 0 ? 2 : 1,
    created_by: profiles[0].id,
    updated_by: profiles[0].id,
    created_at: EARLIER,
    updated_at: i === 0 ? NOW : EARLIER,
  }));

  const versions: SopVersion[] = sops.flatMap((sop) => {
    const list: SopVersion[] = [
      { id: `${sop.id}-v1`, sop_id: sop.id, company_id: company.id, version: 1, body_md: SOP_BODY, change_note: "First version", created_by: profiles[0].id, created_at: EARLIER },
    ];
    if (sop.current_version === 2) {
      list.push({ id: `${sop.id}-v2`, sop_id: sop.id, company_id: company.id, version: 2, body_md: `${SOP_BODY}\n## Added this month\n\nThe superintendent now posts the checklist photo to the client album too.\n`, change_note: "Added the client album step", created_by: profiles[0].id, created_at: NOW });
    }
    return list;
  });

  const attachments: SopAttachment[] = sops.length
    ? [{ id: p("attachment-1"), sop_id: sops[0].id, company_id: company.id, file_name: "Safety-walk-checklist.pdf", file_path: `${company.id}/sops/${sops[0].id}/abc-Safety-walk-checklist.pdf`, content_type: "application/pdf", size_bytes: 184320, created_by: profiles[0].id, created_at: NOW }]
    : [];

  const resources: Resource[] = spec.resources.map((resource, i) => ({
    id: p(`resource-${i + 1}`),
    company_id: company.id,
    title: resource.title,
    description: `${resource.title} for the ${company.name} team.`,
    kind: resource.kind,
    url: resource.url,
    file_path: null,
    file_name: null,
    tags: resource.tags,
    created_by: profiles[0].id,
    created_at: EARLIER,
    updated_at: EARLIER,
  }));

  const invitations: Invitation[] = [
    { id: p("invite-1"), company_id: company.id, email: `new.hire@${spec.domain}`, role: "employee", title: "Carpenter", invited_by: profiles[0].id, created_at: NOW, accepted_at: null },
    { id: p("invite-2"), company_id: company.id, email: profiles[1]?.email ?? `someone@${spec.domain}`, role: "employee", title: null, invited_by: profiles[0].id, created_at: EARLIER, accepted_at: EARLIER },
  ];

  // Eight months of 2026 with a gentle upward trend, plus two quarters and last year.
  const base = 300000 + company.id.length * 15000;
  const snapshots: FinancialSnapshot[] = Array.from({ length: 8 }, (_, i) => {
    const month = i + 1;
    const revenue = Math.round(base * (1 + i * 0.045 + rand(seed + i) * 0.05));
    const cogs = Math.round(revenue * (0.62 + rand(seed + 20 + i) * 0.04));
    const opex = Math.round(revenue * 0.21);
    const start = `2026-${String(month).padStart(2, "0")}-01`;
    return {
      id: p(`snapshot-2026-${month}`),
      company_id: company.id,
      period_type: "month",
      period_start: start,
      period_end: toDateOnlyLocal(new Date(2026, month, 0)),
      revenue,
      cogs,
      opex,
      net_profit: null,
      cash_on_hand: Math.round(base * 0.4 + i * 9000),
      notes: i === 7 ? "August close; two draws landed early September." : null,
      source: i < 6 ? "csv" : "manual",
      created_by: profiles[0].id,
      created_at: EARLIER,
      updated_at: NOW,
    };
  });
  snapshots.push(
    { id: p("snapshot-2026-q1"), company_id: company.id, period_type: "quarter", period_start: "2026-01-01", period_end: "2026-03-31", revenue: Math.round(base * 3.1), cogs: Math.round(base * 3.1 * 0.64), opex: Math.round(base * 3.1 * 0.21), net_profit: null, cash_on_hand: null, notes: null, source: "manual", created_by: profiles[0].id, created_at: EARLIER, updated_at: EARLIER },
    { id: p("snapshot-2026-q2"), company_id: company.id, period_type: "quarter", period_start: "2026-04-01", period_end: "2026-06-30", revenue: Math.round(base * 3.4), cogs: Math.round(base * 3.4 * 0.63), opex: Math.round(base * 3.4 * 0.21), net_profit: null, cash_on_hand: null, notes: null, source: "manual", created_by: profiles[0].id, created_at: EARLIER, updated_at: EARLIER },
    { id: p("snapshot-2025"), company_id: company.id, period_type: "year", period_start: "2025-01-01", period_end: "2025-12-31", revenue: Math.round(base * 11.5), cogs: Math.round(base * 11.5 * 0.65), opex: Math.round(base * 11.5 * 0.22), net_profit: Math.round(base * 11.5 * 0.12), cash_on_hand: null, notes: "From the year-end books.", source: "manual", created_by: profiles[0].id, created_at: EARLIER, updated_at: EARLIER },
  );

  const campaigns: MarketingCampaign[] = [
    { id: p("campaign-1"), company_id: company.id, name: "Spring remodel showcase", channel: "Google Ads", status: "active", start_date: "2026-08-01", end_date: "2026-10-31", budget: 12000, actual_spend: 7400, goal: "40 qualified leads", key_metric_label: "Qualified leads", key_metric_value: 27, results: "Cost per lead trending down since the landing page swap.", notes: null, sort_order: 1, created_by: profiles[0].id, created_at: EARLIER, updated_at: NOW },
    { id: p("campaign-2"), company_id: company.id, name: "Referral thank-you program", channel: "Referral program", status: "active", start_date: "2026-06-01", end_date: null, budget: 5000, actual_spend: 2100, goal: "12 referred projects", key_metric_label: "Referred projects", key_metric_value: 6, results: null, notes: "Gift cards go out with the final invoice.", sort_order: 2, created_by: profiles[0].id, created_at: EARLIER, updated_at: EARLIER },
    { id: p("campaign-3"), company_id: company.id, name: "Fall home show booth", channel: "Events", status: "planned", start_date: "2026-10-16", end_date: "2026-10-18", budget: 8500, actual_spend: 0, goal: "150 conversations, 20 consults booked", key_metric_label: "Consults booked", key_metric_value: null, results: null, notes: null, sort_order: 3, created_by: profiles[0].id, created_at: EARLIER, updated_at: EARLIER },
    { id: p("campaign-4"), company_id: company.id, name: "Project photo series", channel: "Social (organic)", status: "complete", start_date: "2026-03-01", end_date: "2026-06-30", budget: 1500, actual_spend: 1650, goal: "Grow followers 25%", key_metric_label: "Follower growth", key_metric_value: 31, results: "Two inbound design-build inquiries traced to the series.", notes: null, sort_order: 4, created_by: profiles[0].id, created_at: EARLIER, updated_at: EARLIER },
  ];

  return { company, profiles, pillars, criteria, cycles, reviews, scores, goals, companyGoals, sops, versions, attachments, resources, invitations, snapshots, campaigns };
}

export const BUNDLES: CompanyBundle[] = COMPANIES.map(build);

export const ROCOCO: Profile = {
  id: "rococo-user-1",
  email: "austin@rocococreative.io",
  full_name: "Austin Rococo",
  title: null,
  company_id: null,
  role: "employee",
  is_rococo_admin: true,
  is_active: true,
  created_at: EARLIER,
  updated_at: EARLIER,
};

export const ALL_PROFILES: Profile[] = [...BUNDLES.flatMap((b) => b.profiles), ROCOCO];

export function bundleFor(companyId: string): CompanyBundle | undefined {
  return BUNDLES.find((b) => b.company.id === companyId);
}

export function fromAll<T>(pick: (bundle: CompanyBundle) => T[]): T[] {
  return BUNDLES.flatMap(pick);
}

export const KLASIK: CompanyBundle = bundleFor("co-klasik")!;

export function fakeSession(profile: Profile): Session {
  return {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: profile.id,
      email: profile.email,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: profile.created_at,
    },
  } as unknown as Session;
}

export type Persona = "admin" | "employee" | "rococo";

export function personaProfile(persona: Persona, bundle: CompanyBundle): Profile {
  if (persona === "rococo") return ROCOCO;
  return persona === "admin" ? bundle.profiles[0] : bundle.profiles[1];
}

export function makeHub(persona: Persona, company: Company = KLASIK.company): HubValue {
  const bundle = bundleFor(company.id) ?? KLASIK;
  const profile = personaProfile(persona, bundle);
  const isRococo = persona === "rococo";
  return {
    session: fakeSession(profile),
    profile,
    company,
    companies: isRococo ? COMPANIES : [company],
    isRococo,
    isAdmin: isRococo || persona === "admin",
    setActiveCompanyId: () => undefined,
    refreshProfile: async () => undefined,
    refreshCompanies: async () => undefined,
  };
}

// The browser preview harness picks a persona and company from the URL
// (?persona=employee&company=kingdom); tests never set these and get the Klasik admin.
export function personaFromLocation(): { profile: Profile; company: Company } {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(search);
  const slug = params.get("company") ?? "klasik";
  const persona = (params.get("persona") ?? "admin") as Persona;
  const company = COMPANIES.find((c) => c.slug === slug) ?? KLASIK.company;
  const bundle = bundleFor(company.id) ?? KLASIK;
  return { profile: personaProfile(persona, bundle), company };
}
