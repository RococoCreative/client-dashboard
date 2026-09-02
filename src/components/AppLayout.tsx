// Signed-in application shell: a quiet sidebar with the company's identity, the nav for the
// person's role, and the account footer. Rococo admins get the portfolio nav when no company
// is active, and inside a company a way back plus the switcher. Collapses to a top bar on
// small screens. The content area remounts when the active company changes so every page
// refetches for the new tenant.
import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CircleDollarSign,
  ClipboardCheck,
  FolderOpen,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Megaphone,
  Settings,
  Target,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Avatar from "./ui/Avatar.tsx";
import IconButton from "./ui/IconButton.tsx";
import { labelClass, selectClass } from "./ui/forms.ts";
import { useHub } from "../context/HubContext.tsx";
import { signOut } from "../services/auth.ts";
import { displayName } from "../lib/format.ts";
import { applyTheme } from "../lib/theme.ts";
import { ROLE_LABELS } from "../types/database.ts";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const ADMIN_NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/gsr", label: "Reviews", icon: ClipboardCheck },
  { to: "/people", label: "People", icon: Users },
  { to: "/sops", label: "SOPs", icon: BookOpen },
  { to: "/resources", label: "Resources", icon: FolderOpen },
  { to: "/financials", label: "Financials", icon: CircleDollarSign },
  { to: "/marketing", label: "Marketing", icon: Megaphone },
  { to: "/my", label: "My GSR", icon: UserRound },
  { to: "/settings", label: "Settings", icon: Settings },
];

const PORTFOLIO_NAV: NavItem[] = [
  { to: "/rococo", label: "Portfolio", icon: LayoutGrid, end: true },
  { to: "/rococo/companies", label: "Companies", icon: Building2 },
  { to: "/rococo/people", label: "People", icon: Users },
];

const EMPLOYEE_NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/my", label: "My GSR", icon: UserRound, end: true },
  { to: "/my/goals", label: "My Goals", icon: Target },
  { to: "/sops", label: "SOPs", icon: BookOpen },
  { to: "/resources", label: "Resources", icon: FolderOpen },
];

function NavEntry({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors duration-150 " +
        (isActive ? "bg-accent/10 font-medium text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink")
      }
    >
      <Icon size={15} aria-hidden />
      <span>{item.label}</span>
    </NavLink>
  );
}

export default function AppLayout() {
  const { profile, company, companies, isRococo, isAdmin, setActiveCompanyId } = useHub();
  const location = useLocation();
  // The portfolio is a place, not a state: a Rococo admin is on it whenever the URL says so
  // or no company is active. That keeps entering a company (state change plus navigation,
  // which React Router commits separately) free of any in-between flicker or bounce.
  const portfolio = isRococo && (company === null || location.pathname.startsWith("/rococo"));
  // Rococo admins have no company of their own, so "My GSR" would be empty for them.
  const nav = portfolio ? PORTFOLIO_NAV : isAdmin ? ADMIN_NAV.filter((item) => !(isRococo && item.to === "/my")) : EMPLOYEE_NAV;

  // The shell owns the theme once signed in: Rococo on the portfolio, the company's inside.
  useEffect(() => {
    applyTheme(portfolio ? "rococo" : company?.theme_key ?? "rococo");
  }, [portfolio, company?.theme_key]);

  return (
    <div className="flex min-h-screen flex-col bg-bg lg:flex-row">
      <aside className="border-b border-line bg-chrome lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <NavLink to="/" className="flex min-w-0 items-center gap-3">
            {company?.logo_url ? (
              <img src={company.logo_url} alt="" className="h-7 w-auto max-w-[120px] shrink-0 object-contain" />
            ) : null}
            <span className="min-w-0">
              <span className="block truncate font-display text-[15px] leading-tight text-heading">
                {portfolio ? "Rococo Creative" : company?.name ?? "Company Hub"}
              </span>
              <span className="eyebrow block text-[9px]">{portfolio ? "Company Hub" : isRococo ? "Rococo view" : "Company Hub"}</span>
            </span>
          </NavLink>
          <IconButton label="Sign out" onClick={() => void signOut()} className="lg:hidden">
            <LogOut size={15} aria-hidden />
          </IconButton>
        </div>

        {isRococo && company && !portfolio ? (
          <div className="border-b border-line px-4 py-3">
            <Link
              to="/rococo"
              onClick={() => setActiveCompanyId(null)}
              className="flex items-center gap-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:text-ink"
            >
              <ArrowLeft size={13} aria-hidden /> Back to portfolio
            </Link>
            <label htmlFor="company-switcher" className={`${labelClass} mt-3`}>
              Viewing
            </label>
            <select
              id="company-switcher"
              value={company.id}
              onChange={(e) => setActiveCompanyId(e.target.value)}
              className={selectClass}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <nav className="flex gap-1 overflow-x-auto px-3 py-3 lg:flex-1 lg:flex-col lg:overflow-visible" aria-label="Primary">
          {nav.map((item) => (
            <NavEntry key={item.to} item={item} />
          ))}
        </nav>

        <footer className="hidden items-center gap-3 border-t border-line px-4 py-3 lg:flex">
          <Avatar person={profile} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{displayName(profile)}</p>
            <p className="truncate text-[11px] text-ink-3">
              {profile.title || (isRococo ? "Rococo Creative" : ROLE_LABELS[profile.role])}
            </p>
          </div>
          <IconButton label="Sign out" onClick={() => void signOut()}>
            <LogOut size={15} aria-hidden />
          </IconButton>
        </footer>
      </aside>

      <main className="min-w-0 flex-1">
        <div key={portfolio ? "portfolio" : company?.id ?? "none"} className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
