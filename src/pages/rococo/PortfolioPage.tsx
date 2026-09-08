// Rococo's home: the portfolio. Every company in the hub as a card carrying the signals to
// read before a client call (people, review cycle, library, financials, marketing) and the
// things that need a Rococo hand. Rococo admins land here with no company active; opening a
// company from a card switches the whole hub to that company's branding and nav.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Plus } from "lucide-react";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Stat from "../../components/ui/Stat.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { SkeletonCard } from "../../components/ui/Skeleton.tsx";
import NewCompanyDialog from "../../components/rococo/NewCompanyDialog.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listAllDomains } from "../../services/companies.ts";
import { listInvitations } from "../../services/invitations.ts";
import { listCompanyReviews, listCycles, listPillars, listScoresForReviews } from "../../services/gsr.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listSops } from "../../services/sops.ts";
import { listSnapshots } from "../../services/financials.ts";
import { listCampaigns } from "../../services/marketing.ts";
import { averageScore, computeReviewScore, weightTotal } from "../../lib/gsr/scoring.ts";
import { currentCycle } from "../../lib/gsr/cycles.ts";
import { deriveSnapshot, periodLabel } from "../../lib/financials.ts";
import { THEMES } from "../../lib/theme.ts";
import { formatDate, formatMoney, formatNumber, formatPercent, pluralize } from "../../lib/format.ts";
import type { Company, CompanyDomain, FinancialSnapshot, ReviewCycle } from "../../types/database.ts";
import { PORTFOLIO_TABS } from "./portfolioTabs.ts";

interface CompanySummary {
  company: Company;
  domains: string[];
  people: number;
  admins: number;
  cycle: ReviewCycle | null;
  reviewsComplete: number;
  reviewsTotal: number;
  teamScore: number | null;
  pillarTotal: number;
  publishedSops: number;
  lastSopUpdate: string | null;
  latestSnapshot: FinancialSnapshot | null;
  liveCampaigns: number;
  liveBudget: number;
  liveSpend: number;
  pendingInvites: number;
  alerts: string[];
}

async function summarize(company: Company, domains: CompanyDomain[]): Promise<CompanySummary> {
  const [people, cycles, reviews, pillars, sops, snapshots, campaigns, invitations] = await Promise.all([
    listCompanyProfiles(company.id),
    listCycles(company.id),
    listCompanyReviews(company.id),
    listPillars(company.id),
    listSops(company.id),
    listSnapshots(company.id),
    listCampaigns(company.id),
    listInvitations(company.id),
  ]);
  const active = people.filter((p) => p.is_active);
  const admins = active.filter((p) => p.role === "admin");
  const cycle = currentCycle(cycles);
  const cycleReviews = cycle ? reviews.filter((r) => r.cycle_id === cycle.id) : [];
  const scores = cycleReviews.length > 0 ? await listScoresForReviews(cycleReviews.map((r) => r.id)) : [];
  const teamScore = averageScore(
    cycleReviews.map((r) => {
      const own = scores.filter((s) => s.review_id === r.id);
      return own.length > 0 ? computeReviewScore(pillars, own).overall : null;
    }),
  );
  const published = sops.filter((s) => s.status === "published");
  const lastSop = [...sops].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] ?? null;
  const months = snapshots.filter((s) => s.period_type === "month").sort((a, b) => b.period_start.localeCompare(a.period_start));
  const latestSnapshot = months[0] ?? snapshots[0] ?? null;
  const live = campaigns.filter((c) => c.status === "active" || c.status === "paused");
  const pending = invitations.filter((i) => !i.accepted_at);
  const ownDomains = domains.filter((d) => d.company_id === company.id).map((d) => d.domain);
  const pillarTotal = weightTotal(pillars);

  const alerts: string[] = [];
  if (admins.length === 0) alerts.push("No admin yet");
  if (ownDomains.length === 0) alerts.push("No sign-in domain");
  if (!cycle) alerts.push("No open review cycle");
  if (pillars.length === 0) alerts.push("No GSR pillars");
  else if (pillarTotal !== 100) alerts.push(`Pillar weights total ${formatNumber(pillarTotal)}%`);
  if (pending.length > 0) alerts.push(pluralize(pending.length, "invitation pending", "invitations pending"));
  if (published.length === 0) alerts.push("No published SOPs");
  if (!latestSnapshot) alerts.push("No financials yet");

  return {
    company,
    domains: ownDomains,
    people: active.length,
    admins: admins.length,
    cycle,
    reviewsComplete: cycleReviews.filter((r) => r.status === "complete").length,
    reviewsTotal: active.length,
    teamScore,
    pillarTotal,
    publishedSops: published.length,
    lastSopUpdate: lastSop?.updated_at ?? null,
    latestSnapshot,
    liveCampaigns: live.length,
    liveBudget: live.reduce((sum, c) => sum + (c.budget ?? 0), 0),
    liveSpend: live.reduce((sum, c) => sum + (c.actual_spend ?? 0), 0),
    pendingInvites: pending.length,
    alerts,
  };
}

function Signal({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-label text-ink-3">{label}</dt>
      <dd className="tnum mt-0.5 text-sm font-medium text-ink">{value}</dd>
      {hint ? <dd className="truncate text-[12px] text-ink-2">{hint}</dd> : null}
    </div>
  );
}

function CompanyCard({ summary, onEnter }: { summary: CompanySummary; onEnter: (path: string) => void }) {
  const { company, cycle, latestSnapshot } = summary;
  const theme = THEMES[company.theme_key];
  const derived = latestSnapshot ? deriveSnapshot(latestSnapshot) : null;
  return (
    <li className="rounded-lg border border-line bg-surface p-5 shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* The tenant's own accent as a swatch: data about their theme, not our styling. */}
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: theme.accent }} aria-hidden />
          <div className="min-w-0">
            <h2 className="font-display text-xl text-heading">{company.name}</h2>
            <p className="truncate text-[12px] text-ink-3">
              {company.slug} · {summary.domains.length > 0 ? summary.domains.join(", ") : "invitation only"} · {theme.label} theme
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => onEnter("/")}>
          Open hub <ArrowRight size={14} aria-hidden />
        </Button>
      </header>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Signal label="People" value={String(summary.people)} hint={pluralize(summary.admins, "admin")} />
        <Signal
          label="Review cycle"
          value={cycle ? `${summary.reviewsComplete}/${summary.reviewsTotal} complete` : "None open"}
          hint={cycle ? `${cycle.name}${summary.teamScore !== null ? ` · team ${summary.teamScore}` : ""}` : undefined}
        />
        <Signal label="SOP library" value={pluralize(summary.publishedSops, "published SOP")} hint={summary.lastSopUpdate ? `Updated ${formatDate(summary.lastSopUpdate)}` : "Nothing yet"} />
        <Signal
          label="Financials"
          value={latestSnapshot ? formatMoney(latestSnapshot.revenue, true) : "-"}
          hint={latestSnapshot && derived ? `${periodLabel(latestSnapshot.period_type, latestSnapshot.period_start)} · ${formatPercent(derived.netMargin, 1)} net` : "No periods yet"}
        />
        <Signal
          label="Marketing"
          value={pluralize(summary.liveCampaigns, "live campaign")}
          hint={summary.liveBudget > 0 ? `${formatMoney(summary.liveSpend, true)} of ${formatMoney(summary.liveBudget, true)}` : undefined}
        />
      </dl>

      {summary.alerts.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label={`Needs attention at ${company.name}`}>
          {summary.alerts.map((alert) => (
            <li key={alert}>
              <Badge tone="warning">{alert}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[12px] text-success">Nothing needs your hand.</p>
      )}

      <footer className="mt-4 flex flex-wrap gap-1 border-t border-line pt-3">
        {[
          ["/people", "People"],
          ["/gsr", "Reviews"],
          ["/sops", "SOPs"],
          ["/financials", "Financials"],
          ["/settings", "Settings"],
        ].map(([path, label]) => (
          <Button key={path} variant="ghost" size="sm" onClick={() => onEnter(path)}>
            {label}
          </Button>
        ))}
      </footer>
    </li>
  );
}

export default function PortfolioPage() {
  const { companies, setActiveCompanyId, refreshCompanies } = useHub();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const companyKey = companies.map((c) => c.id).join(",");

  const state = useAsync(async () => {
    const domains = await listAllDomains();
    return Promise.all(companies.map((company) => summarize(company, domains)));
  }, [companyKey]);

  function enter(companyId: string, path: string) {
    setActiveCompanyId(companyId);
    navigate(path);
  }

  const summaries = state.data ?? [];
  const totals = {
    people: summaries.reduce((sum, s) => sum + s.people, 0),
    openCycles: summaries.filter((s) => s.cycle).length,
    pending: summaries.reduce((sum, s) => sum + s.pendingInvites, 0),
    attention: summaries.filter((s) => s.alerts.length > 0).length,
  };

  return (
    <>
      <PageHeader
        eyebrow="Rococo Creative"
        title="Portfolio"
        description="Every company in the hub and what needs your hand. Open a company to see exactly what its admins see."
        actions={<Button size="sm" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> New company</Button>}
      />
      <Tabs items={PORTFOLIO_TABS} />

      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {companies.length === 0 ? (
        <EmptyState eyebrow="Portfolio" title="No companies yet" body="Create the first company, set its theme and sign-in domain, and invite its owner." action={<Button onClick={() => setCreating(true)}>New company</Button>} />
      ) : !state.data && !state.error ? (
        <div className="grid gap-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            <Stat label="Companies" value={companies.length} hint={pluralize(totals.attention, "needs attention", "need attention")} />
            <Stat label="People" value={totals.people} hint="Active accounts across the hub" />
            <Stat label="Open cycles" value={totals.openCycles} hint={`of ${companies.length} companies`} />
            <Stat label="Pending invitations" value={totals.pending} />
          </div>
          <ul className="space-y-4">
            {summaries.map((summary) => (
              <CompanyCard key={summary.company.id} summary={summary} onEnter={(path) => enter(summary.company.id, path)} />
            ))}
          </ul>
        </>
      )}

      {creating ? (
        <NewCompanyDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void refreshCompanies();
          }}
        />
      ) : null}
    </>
  );
}
