// Auth gate + router. Order matters and is deliberate:
//   1. Unconfigured Supabase renders a setup notice (nullable-client pattern): the app must
//      never crash or lock up because env vars are missing.
//   2. Session loading, then the sign-in screen.
//   3. The profile decides the world: deactivated accounts stop here; a first-time person
//      gives their name; someone nobody has placed yet gets a calm holding screen; then the
//      company sets the theme and the pages mount. Rococo admins start with no company on
//      the portfolio (Rococo theme) and step into a company for this session only.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./services/supabase.ts";
import { getMyProfile } from "./services/profiles.ts";
import { getCompany, listCompanies } from "./services/companies.ts";
import { signOut } from "./services/auth.ts";
import { useSession } from "./hooks/useSession.ts";
import { HubContext, useHub, type HubValue } from "./context/HubContext.tsx";
import { applyTheme } from "./lib/theme.ts";
import { readLoginHint } from "./lib/loginHint.ts";
import Login from "./components/Login.tsx";
import Onboarding from "./components/Onboarding.tsx";
import AppLayout from "./components/AppLayout.tsx";
import CenteredCard from "./components/CenteredCard.tsx";
import Button from "./components/ui/Button.tsx";
import Spinner from "./components/ui/Spinner.tsx";
import DashboardPage from "./pages/DashboardPage.tsx";
import GsrCyclesPage from "./pages/gsr/GsrCyclesPage.tsx";
import CyclePage from "./pages/gsr/CyclePage.tsx";
import ReviewPage from "./pages/gsr/ReviewPage.tsx";
import GsrSettingsPage from "./pages/gsr/GsrSettingsPage.tsx";
import CompanyGoalsPage from "./pages/gsr/CompanyGoalsPage.tsx";
import MyGsrPage from "./pages/gsr/MyGsrPage.tsx";
import MyGoalsPage from "./pages/gsr/MyGoalsPage.tsx";
import PeoplePage from "./pages/people/PeoplePage.tsx";
import PersonPage from "./pages/people/PersonPage.tsx";
import SopListPage from "./pages/sops/SopListPage.tsx";
import SopPage from "./pages/sops/SopPage.tsx";
import SopEditPage from "./pages/sops/SopEditPage.tsx";
import ResourcesPage from "./pages/ResourcesPage.tsx";
import FinancialsPage from "./pages/FinancialsPage.tsx";
import MarketingPage from "./pages/MarketingPage.tsx";
import CompanySettingsPage from "./pages/CompanySettingsPage.tsx";
import PortfolioPage from "./pages/rococo/PortfolioPage.tsx";
import CompaniesPage from "./pages/rococo/CompaniesPage.tsx";
import UsersPage from "./pages/rococo/UsersPage.tsx";
import type { Company, Profile } from "./types/database.ts";

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

// Redirect that keeps the query string (the demo harness carries its persona there).
function RedirectTo({ path }: { path: string }) {
  const location = useLocation();
  return <Navigate to={{ pathname: path, search: location.search }} replace />;
}

// Company pages need an active company. A Rococo admin without one belongs on the portfolio.
function WithCompany({ children }: { children: ReactNode }) {
  const { company } = useHub();
  return company ? <>{children}</> : <RedirectTo path="/rococo" />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { company, isAdmin } = useHub();
  if (!company) return <RedirectTo path="/rococo" />;
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
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

  if (!profile.is_rococo_admin && !profile.company_id) {
    const hint = readLoginHint();
    return (
      <HoldingScreen
        eyebrow="Almost in"
        title="Your account is ready"
        body={
          <>
            {profile.email} is signed in but not yet placed with a company.{" "}
            {hint ? `Ask a ${hint} admin` : "Ask your company admin"} to send you an invitation, then sign in again
            and you are in.
          </>
        }
      />
    );
  }

  if (!companies) {
    if (companiesError) {
      return (
        <CenteredCard>
          <p className="eyebrow">Connection</p>
          <h1 className="mt-3 font-display text-3xl tracking-display text-heading">Could not load your company</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">Check your signal and try again.</p>
          <Button className="mt-6" onClick={() => setRetryTick((t) => t + 1)}>
            Try again
          </Button>
        </CenteredCard>
      );
    }
    return <FullScreenLoading label="Loading your company" />;
  }

  if (!profile.full_name) {
    return <Onboarding profile={profile} companyName={company?.name ?? null} onDone={refreshProfile} />;
  }

  const isRococo = profile.is_rococo_admin;
  const isAdmin = isRococo || (profile.role === "admin" && profile.company_id !== null && profile.company_id === company?.id);

  const value: HubValue = {
    session,
    profile,
    company,
    companies,
    isRococo,
    isAdmin,
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
            <Route path="gsr" element={<WithCompany>{isAdmin ? <GsrCyclesPage /> : <Navigate to="/my" replace />}</WithCompany>} />
            <Route path="gsr/settings" element={<AdminOnly><GsrSettingsPage /></AdminOnly>} />
            <Route path="gsr/company-goals" element={<AdminOnly><CompanyGoalsPage /></AdminOnly>} />
            <Route path="gsr/cycles/:cycleId" element={<AdminOnly><CyclePage /></AdminOnly>} />
            <Route path="gsr/reviews/:reviewId" element={<WithCompany><ReviewPage /></WithCompany>} />
            <Route path="my" element={isRococo ? <Navigate to="/" replace /> : <WithCompany><MyGsrPage /></WithCompany>} />
            <Route path="my/goals" element={isRococo ? <Navigate to="/" replace /> : <WithCompany><MyGoalsPage /></WithCompany>} />
            <Route path="people" element={<AdminOnly><PeoplePage /></AdminOnly>} />
            <Route path="people/:profileId" element={<AdminOnly><PersonPage /></AdminOnly>} />
            <Route path="sops" element={<WithCompany><SopListPage /></WithCompany>} />
            <Route path="sops/new" element={<AdminOnly><SopEditPage /></AdminOnly>} />
            <Route path="sops/:sopId" element={<WithCompany><SopPage /></WithCompany>} />
            <Route path="sops/:sopId/edit" element={<AdminOnly><SopEditPage /></AdminOnly>} />
            <Route path="resources" element={<WithCompany><ResourcesPage /></WithCompany>} />
            <Route path="financials" element={<AdminOnly><FinancialsPage /></AdminOnly>} />
            <Route path="marketing" element={<AdminOnly><MarketingPage /></AdminOnly>} />
            <Route path="settings" element={<AdminOnly><CompanySettingsPage /></AdminOnly>} />
            <Route path="rococo" element={<RococoOnly><PortfolioPage /></RococoOnly>} />
            <Route path="rococo/companies" element={<RococoOnly><CompaniesPage /></RococoOnly>} />
            <Route path="rococo/people" element={<RococoOnly><UsersPage /></RococoOnly>} />
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
