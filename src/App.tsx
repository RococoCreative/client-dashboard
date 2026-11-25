// Auth gate + router. Order matters and is deliberate:
//   1. Unconfigured Supabase renders a setup notice (nullable-client pattern): the app must
//      never crash or lock up because env vars are missing.
//   2. Session loading, then the sign-in screen.
//   3. The profile decides the world: deactivated accounts stop here; a first-time person
//      gives their name; someone nobody has placed yet gets a calm holding screen; then the
//      company sets the theme and the pages mount. Rococo admins start with no company on
//      the portfolio (Rococo theme) and step into a company for this session only.
import SkeletonRows from "./components/ui/SkeletonRows.tsx";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./services/supabase.ts";
import { getMyProfile } from "./services/profiles.ts";
import { getCompany, listCompanies } from "./services/companies.ts";
import { loadCapabilities } from "./services/capabilities.ts";
import { signOut } from "./services/auth.ts";
import { useSession } from "./hooks/useSession.ts";
import { HubContext, useHub, type HubValue } from "./context/HubContext.tsx";
import { applyTheme } from "./lib/theme.ts";
import { readLoginHint } from "./lib/loginHint.ts";
import { hasModule, type ModuleKey } from "./lib/modules.ts";
import { isCompanyAdminRole, isLeadRole } from "./lib/people.ts";
import { meets, type CapabilityMap } from "./lib/capabilities.ts";
import Login from "./components/Login.tsx";
import Onboarding from "./components/Onboarding.tsx";
import AppLayout from "./components/AppLayout.tsx";
import CenteredCard from "./components/CenteredCard.tsx";
import Button from "./components/ui/Button.tsx";
import Spinner from "./components/ui/Spinner.tsx";
import DashboardPage from "./pages/DashboardPage.tsx";
import CyclesPage from "./pages/gsr/CyclesPage.tsx";
import GoalsPage from "./pages/gsr/GoalsPage.tsx";
import MyReviewsPage from "./pages/gsr/MyReviewsPage.tsx";
import CyclePage from "./pages/gsr/CyclePage.tsx";
import ReviewPage from "./pages/gsr/ReviewPage.tsx";
import GsrPage from "./pages/gsr/GsrPage.tsx";
import GsrLogPage from "./pages/gsr/GsrLogPage.tsx";
import ScorecardsPage from "./pages/gsr/ScorecardsPage.tsx";
import MyGsrPage from "./pages/gsr/MyGsrPage.tsx";
import MyGoalsPage from "./pages/gsr/MyGoalsPage.tsx";
import PeoplePage from "./pages/people/PeoplePage.tsx";
import PersonPage from "./pages/people/PersonPage.tsx";
import DivisionsPage from "./pages/people/DivisionsPage.tsx";
import RolesPage from "./pages/people/RolesPage.tsx";
import ResourcesPage from "./pages/resources/ResourcesPage.tsx";
import FinancialsPage from "./pages/FinancialsPage.tsx";
import MarketingPage from "./pages/MarketingPage.tsx";
import GsrSetupPage from "./pages/gsr/GsrSetupPage.tsx";
import ReviewsSetupPage from "./pages/gsr/ReviewsSetupPage.tsx";
import SettingsPage from "./pages/settings/SettingsPage.tsx";
import ProductionPage from "./pages/production/ProductionPage.tsx";
import ProductionSetupPage from "./pages/production/ProductionSetupPage.tsx";
import ProjectPage from "./pages/production/ProjectPage.tsx";
import WinsPage from "./pages/WinsPage.tsx";
import SalesFinancePage from "./pages/salesFinance/SalesFinancePage.tsx";
import ControlsPage from "./pages/salesFinance/ControlsPage.tsx";
import PortfolioPage from "./pages/rococo/PortfolioPage.tsx";
import CompaniesPage from "./pages/rococo/CompaniesPage.tsx";
import UsersPage from "./pages/rococo/UsersPage.tsx";
import ActivityPage from "./pages/rococo/ActivityPage.tsx";
import PermissionsPage from "./pages/rococo/PermissionsPage.tsx";
import TasksPage from "./pages/tasks/TasksPage.tsx";
import TaskPage from "./pages/tasks/TaskPage.tsx";
import { GOALS_TABS } from "./pages/gsr/goalsTabs.ts";
import { SETTINGS_TABS, settingsTabsFor, type SettingsTab } from "./pages/settings/settingsTabs.ts";
import type { CapabilityKey, Company, Profile } from "./types/database.ts";

function SetupNotice() {
  return (
    <CenteredCard>
      <p className="eyebrow">Setup</p>
      <h1 className="mt-3 font-display text-3xl tracking-display text-heading">Almost there</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        Supabase is not configured yet. Copy <code>.env.example</code> to <code>.env</code>, fill in{" "}
        <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, and restart the dev server. The
        README walks through the full setup.
      </p>
    </CenteredCard>
  );
}

function FullScreenLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <Spinner label={label} />
    </div>
  );
}

function CompanyLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <CenteredCard>
      <p className="eyebrow">Connection</p>
      <h1 className="mt-3 font-display text-3xl tracking-display text-heading">Could not load your company</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">Check your signal and try again.</p>
      <Button className="mt-6" onClick={onRetry}>
        Try again
      </Button>
    </CenteredCard>
  );
}

function HoldingScreen({ eyebrow, title, body }: { eyebrow: string; title: string; body: ReactNode }) {
  return (
    <CenteredCard>
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-3 font-display text-3xl tracking-display text-heading">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">{body}</p>
      <Button variant="secondary" className="mt-6" onClick={() => void signOut()}>
        Sign out
      </Button>
    </CenteredCard>
  );
}

// How often a company's capabilities are read again when the tab returns to the front.
const CAPABILITY_REFRESH_MS = 30_000;

// Redirect that keeps the query string (the demo harness carries its persona there).
function RedirectTo({ path }: { path: string }) {
  const location = useLocation();
  return <Navigate to={{ pathname: path, search: location.search }} replace />;
}

// Company pages need an active company. A Rococo admin without one belongs on the portfolio.
// The SOP document pages carry the editor, which most visits never need, so they load on demand
// in a chunk of their own.
const SopPage = lazy(() => import("./pages/sops/SopPage.tsx"));
const SopEditPage = lazy(() => import("./pages/sops/SopEditPage.tsx"));

function SopLoad({ children }: { children: ReactNode }) {
  return <Suspense fallback={<SkeletonRows rows={8} />}>{children}</Suspense>;
}

function WithCompany({ children }: { children: ReactNode }) {
  const { company } = useHub();
  return company ? <>{children}</> : <RedirectTo path="/rococo" />;
}

// Settings tabs follow the company's permissions: a tab this person may not open sends them to the
// first one they may, and /settings itself lands there. A person with no tab at all goes Home.
function SettingsTabOnly({ tab, children }: { tab: SettingsTab | null; children: ReactNode }) {
  const { can } = useHub();
  const allowed = settingsTabsFor(can);
  if (tab === null || !allowed.some((t) => t.key === tab)) return allowed.length > 0 ? <RedirectTo path={allowed[0].to} /> : <Navigate to="/" replace />;
  return <>{children}</>;
}

// One GSR's address: a company on demand opens the GSR's own page, a company on periods the review
// in its cycle, exactly as before.
function GsrOrReview() {
  const { company } = useHub();
  return company?.gsr_mode === "on_demand" ? <GsrPage /> : <ReviewPage />;
}

// GSRs' own address: a company on demand opens the GSRs log for anyone who leads people and sends
// everyone else to their own GSR; a company on periods keeps the months for an admin, exactly as
// before.
function GsrHome() {
  const { company, isAdmin, isLead } = useHub();
  if (company?.gsr_mode === "on_demand") return isAdmin || isLead ? <GsrLogPage /> : <RedirectTo path="/my/gsr" />;
  return isAdmin ? <CyclesPage section="gsr" /> : <RedirectTo path="/my/gsr" />;
}

// A month's address. A company on demand has no months, so an old link lands on the GSRs log.
function GsrCycleOrLog() {
  const { company } = useHub();
  return company?.gsr_mode === "on_demand" ? <RedirectTo path="/gsr" /> : <AdminOnly><CyclePage /></AdminOnly>;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { company, isAdmin } = useHub();
  if (!company) return <RedirectTo path="/rococo" />;
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

// Pages for anyone who leads people here: admins, and managers for the people the database lets
// them see. Everyone else lands on Home, the way AdminOnly sends them.
export function LeadOnly({ children }: { children: ReactNode }) {
  const { company, isLead } = useHub();
  if (!company) return <RedirectTo path="/rococo" />;
  return isLead ? <>{children}</> : <Navigate to="/" replace />;
}

// Where the connections Edge Function sends the browser once the provider's sign-in is done, with
// the outcome on the query string. Connecting is a full page load, and a Rococo admin's company is
// session-only state that does not survive one, so the path names the company the connection was
// for. A Rococo admin has that company made active again, from the URL only with nothing stored;
// anyone else is let through only to their own company. The outcome then lands on Settings >
// Connections, which shows it and takes it off the address.
function ConnectionReturn() {
  const { companyId } = useParams();
  const { companies, company, isRococo, setActiveCompanyId } = useHub();
  const target = companies.find((c) => c.id === companyId) ?? null;
  const stepIn = isRococo && target !== null && company?.id !== target.id;
  useEffect(() => {
    if (stepIn && target) setActiveCompanyId(target.id);
  }, [stepIn, target, setActiveCompanyId]);
  if (!target) return <Navigate to={isRococo ? "/rococo" : "/"} replace />;
  if (stepIn) return null;
  return <RedirectTo path="/settings/connections" />;
}

// A module's pages exist only for a company that has the module on. Typing the URL elsewhere
// lands on Home, the way AdminOnly does for employees.
export function ModuleOnly({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { company } = useHub();
  if (!company) return <RedirectTo path="/rococo" />;
  return hasModule(company, module) ? <>{children}</> : <Navigate to="/" replace />;
}

// A page that exists only while a company setting is on (the manual Financials page). Off, a typed
// URL lands on Home, the same answer the sidebar gives by hiding the item.
export function SettingOnly({ setting, children }: { setting: "manual_financials"; children: ReactNode }) {
  const { company } = useHub();
  if (!company) return <RedirectTo path="/rococo" />;
  return company[setting] ? <>{children}</> : <Navigate to="/" replace />;
}

// A page that needs a capability the company has set for the person's role. Anyone without it
// lands on Home, the way AdminOnly does, so a typed URL gets the same answer the sidebar gives.
export function CapabilityOnly({ capability, children }: { capability: CapabilityKey; children: ReactNode }) {
  const { company, can } = useHub();
  if (!company) return <RedirectTo path="/rococo" />;
  return can(capability) ? <>{children}</> : <Navigate to="/" replace />;
}

// One task's page, keyed on the task id, so moving from one task to another starts the page and
// its checklist fresh instead of carrying the last task's notices and drafts across.
export function TaskRoute() {
  const { taskId } = useParams();
  return <TaskPage key={taskId} />;
}

function RococoOnly({ children }: { children: ReactNode }) {
  const { isRococo } = useHub();
  return isRococo ? <>{children}</> : <Navigate to="/" replace />;
}

// Everything past the sign-in: profile, companies, the active company, and the router. App
// keys this on the user, so signing out (or in as someone else) starts from empty state.
function SignedIn({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  // A transient profile-fetch failure (flaky site wifi, token refresh mid-flight) must NOT
  // read as "you are not assigned"; failures keep any profile we had and offer a retry.
  const [profileError, setProfileError] = useState(false);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companiesError, setCompaniesError] = useState(false);
  // Session-only: a Rococo admin always signs in to the portfolio, never to a remembered company.
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let active = true;
    getMyProfile()
      .then((p) => {
        if (!active) return;
        setProfile(p);
        setProfileError(false);
        setProfileLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setProfileError(true);
        setProfileLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [session, retryTick]);

  const profileId = profile?.id ?? null;
  const profileCompanyId = profile?.company_id ?? null;
  const profileIsRococo = profile?.is_rococo_admin ?? false;

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    const load: Promise<Company[]> = profileIsRococo
      ? listCompanies()
      : profileCompanyId
        ? getCompany(profileCompanyId).then((c) => [c])
        : Promise.resolve([]);
    load
      .then((list) => {
        if (!active) return;
        setCompanies(list);
        setCompaniesError(false);
      })
      .catch(() => {
        if (active) setCompaniesError(true);
      });
    return () => {
      active = false;
    };
  }, [profileId, profileCompanyId, profileIsRococo, retryTick]);

  const company = useMemo<Company | null>(() => {
    if (!companies) return null;
    if (profileIsRococo) return companies.find((c) => c.id === activeCompanyId) ?? null;
    return companies[0] ?? null;
  }, [companies, activeCompanyId, profileIsRococo]);

  // A company's capabilities, loaded once per active company and tagged with the company they
  // belong to. A map for another company is never read (see the gate below), and a failure is
  // remembered by company and attempt, so neither can carry across a switch for even one render. The
  // portfolio has no company and loads nothing.
  const companyId = company?.id ?? null;
  const [capabilities, setCapabilities] = useState<{ companyId: string; map: CapabilityMap } | null>(null);
  // A failure belongs to one company and one attempt, so a retry or a switch clears it by itself.
  const [capabilitiesFailed, setCapabilitiesFailed] = useState<{ companyId: string; attempt: number } | null>(null);
  useEffect(() => {
    if (!companyId) return;
    let active = true;
    loadCapabilities(companyId)
      .then((map) => {
        if (!active) return;
        setCapabilities({ companyId, map });
        setCapabilitiesFailed(null);
      })
      .catch(() => {
        if (active) setCapabilitiesFailed({ companyId, attempt: retryTick });
      });
    return () => {
      active = false;
    };
  }, [companyId, retryTick]);

  // A change a Rococo admin makes on the Permissions page is stored at once, but a person who has the
  // hub open only holds the map they loaded. When the tab comes back (visible again, or the window
  // focused) the active company's map is read again, at most once every 30 seconds. The current map
  // stays on screen while it runs, a failure changes nothing, and the company tag plus the cleanup
  // flag keep a late answer from landing on another company.
  useEffect(() => {
    if (!companyId) return;
    const id = companyId;
    let active = true;
    let inFlight = false;
    let lastAttempt = Date.now();
    function refresh() {
      if (document.visibilityState !== "visible" || inFlight) return;
      if (Date.now() - lastAttempt < CAPABILITY_REFRESH_MS) return;
      lastAttempt = Date.now();
      inFlight = true;
      loadCapabilities(id)
        .then((map) => {
          if (active) setCapabilities({ companyId: id, map });
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    }
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [companyId]);

  // Theme before the shell mounts: onboarding wears the company's theme when there is one.
  // Once AppLayout mounts it owns the theme, because the portfolio is Rococo-branded
  // regardless of the active company.
  useEffect(() => {
    if (profile && profile.full_name) return;
    applyTheme(company?.theme_key ?? "rococo");
  }, [profile, company?.theme_key]);

  const refreshProfile = useCallback(async () => {
    const next = await getMyProfile();
    setProfile(next);
  }, []);

  const refreshCompanies = useCallback(async () => {
    if (!profile) return;
    const list = profile.is_rococo_admin
      ? await listCompanies()
      : profile.company_id
        ? [await getCompany(profile.company_id)]
        : [];
    setCompanies(list);
  }, [profile]);

  if (!profileLoaded) return <FullScreenLoading label="Loading your workspace" />;

  if (!profile) {
    return (
      <CenteredCard>
        <p className="eyebrow">Connection</p>
        <h1 className="mt-3 font-display text-3xl tracking-display text-heading">Could not load your workspace</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          {profileError
            ? "The connection dropped while loading your account. Check your signal and try again."
            : "Your account exists but has no profile yet. Sign out and back in; if that does not fix it, ask Rococo Creative."}
        </p>
        <div className="mt-6 flex gap-2">
          <Button
            onClick={() => {
              setProfileLoaded(false);
              setRetryTick((t) => t + 1);
            }}
          >
            Try again
          </Button>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </CenteredCard>
    );
  }

  if (!profile.is_active) {
    return (
      <HoldingScreen
        eyebrow="Account"
        title="This account is inactive"
        body={`${profile.email} has been deactivated. If that is a mistake, ask your company admin to reactivate it.`}
      />
    );
  }

  // An invitation is read once, when the account is created (handle_new_user), so it cannot
  // place an account that already exists: someone whose company was deleted, or who was set to
  // No company. Only a Rococo admin can, from Users, so that is who the screen points to.
  if (!profile.is_rococo_admin && !profile.company_id) {
    const hint = readLoginHint();
    return (
      <HoldingScreen
        eyebrow="Almost in"
        title="Your account is ready"
        body={
          <>
            {profile.email} is signed in but not yet placed with a company. Rococo Creative places an account
            like this one by hand, so {hint ? `ask a ${hint} admin` : "ask your company admin"} to have Rococo
            Creative add you. Once that is done, reload this page and you are in.
          </>
        }
      />
    );
  }

  if (!companies) {
    if (companiesError) {
      return <CompanyLoadError onRetry={() => setRetryTick((t) => t + 1)} />;
    }
    return <FullScreenLoading label="Loading your company" />;
  }

  if (!profile.full_name) {
    return <Onboarding profile={profile} companyName={company?.name ?? null} onDone={refreshProfile} />;
  }

  // The app does not render in a company until that company's capabilities are in: a power that
  // has not loaded is never granted, and nothing is shown on the strength of another company's map.
  if (companyId && capabilitiesFailed?.companyId === companyId && capabilitiesFailed.attempt === retryTick) {
    return <CompanyLoadError onRetry={() => setRetryTick((t) => t + 1)} />;
  }
  if (companyId && capabilities?.companyId !== companyId) return <FullScreenLoading label="Loading your company" />;
  const capabilityMap = companyId ? capabilities?.map : undefined;

  const isRococo = profile.is_rococo_admin;
  const inCompany = profile.company_id !== null && profile.company_id === company?.id;
  const isAdmin = isRococo || (isCompanyAdminRole(profile.role) && inCompany);
  const isLead = isRococo || (isLeadRole(profile.role) && inCompany);

  // A company member qualifies only inside their own company, the same test isAdmin uses. On the
  // portfolio there is no company, so only a Rococo admin passes.
  const can = (capability: CapabilityKey) =>
    isRococo ? !companyId || meets(profile.role, true, capabilityMap?.[capability]) : inCompany && meets(profile.role, false, capabilityMap?.[capability]);

  const value: HubValue = {
    session,
    profile,
    company,
    companies,
    isRococo,
    isAdmin,
    isLead,
    can,
    setActiveCompanyId,
    refreshProfile,
    refreshCompanies,
  };

  return (
    <HubContext value={value}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={company ? <DashboardPage /> : <RedirectTo path="/rococo" />} />
            <Route path="wins" element={<ModuleOnly module="wins"><WinsPage /></ModuleOnly>} />
            {/* Tasks: Mine for everyone, Everyone for leads (a manager's Team: the database narrows
                it to the people they may see). Everyone is declared before a task's own address so
                it never reads as a task id. */}
            <Route path="tasks" element={<ModuleOnly module="tasks"><TasksPage tab="mine" /></ModuleOnly>} />
            <Route path="tasks/everyone" element={<LeadOnly><ModuleOnly module="tasks"><TasksPage tab="everyone" /></ModuleOnly></LeadOnly>} />
            <Route path="tasks/:taskId" element={<ModuleOnly module="tasks"><TaskRoute /></ModuleOnly>} />
            {/* Two sections keyed on cadence: Monthly GSRs (monthly) and Reviews (every scored
                cadence). A cycle and a review are reachable under either prefix so old links keep
                working; new links come from lib/gsr/cycles.ts and land in the section that owns them. */}
            <Route path="gsr" element={<WithCompany><GsrHome /></WithCompany>} />
            <Route path="reviews" element={<WithCompany>{isAdmin ? <CyclesPage section="reviews" /> : <RedirectTo path="/my/reviews" />}</WithCompany>} />
            <Route path="gsr/setup" element={<AdminOnly><GsrSetupPage /></AdminOnly>} />
            <Route path="reviews/setup" element={<AdminOnly><ReviewsSetupPage /></AdminOnly>} />
            {/* Goals: one page, a route per tab, landing on Company. Employees keep My Goals. */}
            <Route path="goals" element={<WithCompany>{isAdmin ? <RedirectTo path="/goals/company" /> : <RedirectTo path="/my/goals" />}</WithCompany>} />
            {GOALS_TABS.map((t) => (
              <Route key={t.key} path={t.to.slice(1)} element={<AdminOnly><GoalsPage tab={t.key} /></AdminOnly>} />
            ))}
            {/* Leadership's scorecard report sits with the Reviews pages, at its own path so the sidebar
                marks one item for it, not Reviews as well. */}
            <Route path="scorecards" element={<AdminOnly><ScorecardsPage /></AdminOnly>} />
            {/* Where these used to live. Old bookmarks and links land on the tab that holds them now. */}
            <Route path="settings/roles" element={<RedirectTo path="/people/roles" />} />
            <Route path="goals/roles" element={<RedirectTo path="/people/roles" />} />
            <Route path="goals/focus" element={<RedirectTo path="/gsr/setup" />} />
            <Route path="reviews/settings" element={<RedirectTo path="/reviews/setup" />} />
            <Route path="gsr/settings" element={<RedirectTo path="/reviews/setup" />} />
            <Route path="settings/reviews" element={<RedirectTo path="/reviews/setup" />} />
            <Route path="settings/production" element={<RedirectTo path="/production/setup" />} />
            <Route path="reviews/company-goals" element={<RedirectTo path="/goals/company" />} />
            <Route path="gsr/company-goals" element={<RedirectTo path="/goals/company" />} />
            <Route path="gsr/cycles/:cycleId" element={<GsrCycleOrLog />} />
            <Route path="reviews/cycles/:cycleId" element={<AdminOnly><CyclePage /></AdminOnly>} />
            <Route path="gsr/reviews/:reviewId" element={<WithCompany><GsrOrReview /></WithCompany>} />
            <Route path="reviews/:reviewId" element={<WithCompany><ReviewPage /></WithCompany>} />
            <Route path="my" element={isRococo ? <Navigate to="/" replace /> : <RedirectTo path="/my/gsr" />} />
            <Route path="my/gsr" element={isRococo ? <Navigate to="/" replace /> : <WithCompany><MyGsrPage /></WithCompany>} />
            <Route path="my/reviews" element={isRococo ? <Navigate to="/" replace /> : <WithCompany><MyReviewsPage /></WithCompany>} />
            <Route path="my/goals" element={isRococo ? <Navigate to="/" replace /> : <WithCompany><MyGoalsPage /></WithCompany>} />
            <Route path="people" element={<LeadOnly><PeoplePage /></LeadOnly>} />
            <Route path="people/roles" element={<AdminOnly><RolesPage /></AdminOnly>} />
            <Route path="people/roles/:roleId" element={<AdminOnly><RolesPage /></AdminOnly>} />
            <Route path="people/divisions" element={<AdminOnly><DivisionsPage /></AdminOnly>} />
            {/* A person: Overview at their own address, each other tab one segment below it. One
                route with an optional segment, so moving between tabs keeps the page and its load. */}
            <Route path="people/:profileId/:tab?" element={<LeadOnly><PersonPage /></LeadOnly>} />
            <Route path="production" element={<ModuleOnly module="production"><CapabilityOnly capability="production_view"><ProductionPage /></CapabilityOnly></ModuleOnly>} />
            <Route path="production/setup" element={<AdminOnly><ModuleOnly module="production"><ProductionSetupPage /></ModuleOnly></AdminOnly>} />
            <Route path="production/projects/:projectId" element={<ModuleOnly module="production"><CapabilityOnly capability="production_view"><ProjectPage /></CapabilityOnly></ModuleOnly>} />
            {/* Resources: one page, a route per tab, landing on the SOP library. An SOP itself
                keeps its own address under /sops. */}
            <Route path="resources" element={<WithCompany><RedirectTo path="/resources/sops" /></WithCompany>} />
            <Route path="resources/sops" element={<WithCompany><ResourcesPage tab="sops" /></WithCompany>} />
            <Route path="resources/files" element={<WithCompany><ResourcesPage tab="files" /></WithCompany>} />
            <Route path="resources/links" element={<WithCompany><ResourcesPage tab="links" /></WithCompany>} />
            <Route path="resources/setup" element={<AdminOnly><ResourcesPage tab="setup" /></AdminOnly>} />
            <Route path="sops" element={<WithCompany><RedirectTo path="/resources/sops" /></WithCompany>} />
            <Route path="sops/new" element={<AdminOnly><SopLoad><SopEditPage /></SopLoad></AdminOnly>} />
            <Route path="sops/:sopId" element={<WithCompany><SopLoad><SopPage /></SopLoad></WithCompany>} />
            <Route path="sops/:sopId/edit" element={<AdminOnly><SopLoad><SopEditPage /></SopLoad></AdminOnly>} />
            <Route path="financials" element={<AdminOnly><SettingOnly setting="manual_financials"><FinancialsPage /></SettingOnly></AdminOnly>} />
            <Route path="marketing" element={<AdminOnly><MarketingPage /></AdminOnly>} />
            <Route path="sales-finance" element={<AdminOnly><ModuleOnly module="data_sources"><SalesFinancePage /></ModuleOnly></AdminOnly>} />
            <Route path="sales-finance/controls" element={<AdminOnly><ModuleOnly module="data_sources"><ControlsPage /></ModuleOnly></AdminOnly>} />
            {/* Settings: one page, a route per tab, landing on the first tab the person may open. The connection return path
                has one more segment, so it never reads as the Connections tab. */}
            <Route path="settings" element={<AdminOnly><SettingsTabOnly tab={null}>{null}</SettingsTabOnly></AdminOnly>} />
            {SETTINGS_TABS.map((t) => (
              <Route key={t.key} path={t.to.slice(1)} element={<AdminOnly><SettingsTabOnly tab={t.key}><SettingsPage tab={t.key} /></SettingsTabOnly></AdminOnly>} />
            ))}
            {/* One data source on the Connections tab, behind exactly the tab's own gates. Two segments past
                connections, so it never reads as the connection return path. */}
            <Route path="settings/connections/sources/:sourceId" element={<AdminOnly><SettingsTabOnly tab="connections"><SettingsPage tab="connections" /></SettingsTabOnly></AdminOnly>} />
            <Route path="settings/connections/:companyId" element={<ConnectionReturn />} />
            <Route path="rococo" element={<RococoOnly><PortfolioPage /></RococoOnly>} />
            <Route path="rococo/companies" element={<RococoOnly><CompaniesPage /></RococoOnly>} />
            <Route path="rococo/people" element={<RococoOnly><UsersPage /></RococoOnly>} />
            <Route path="rococo/permissions" element={<RococoOnly><PermissionsPage /></RococoOnly>} />
            <Route path="rococo/activity" element={<RococoOnly><ActivityPage /></RococoOnly>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </HubContext>
  );
}

export default function App() {
  const { session, loading } = useSession();

  // Signed out is Rococo-branded; the login screen takes over from there.
  useEffect(() => {
    if (!loading && !session) applyTheme("rococo");
  }, [loading, session]);

  if (!isSupabaseConfigured) return <SetupNotice />;
  if (loading) return <FullScreenLoading label="Signing you in" />;
  if (!session) return <Login />;
  return <SignedIn key={session.user.id} session={session} />;
}
