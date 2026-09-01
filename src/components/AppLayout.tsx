// Signed-in application shell: a quiet sidebar with the company's identity, the nav for the
// person's role, the Rococo company switcher when it applies, and the account footer.
// Collapses to a top bar on small screens. The content area remounts when the active
// company changes so every page refetches for the new tenant.
import { NavLink, Outlet } from "react-router-dom";
import {
  BookOpen,
  ClipboardCheck,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  Target,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Avatar from "./ui/Avatar.tsx";
import IconButton from "./ui/IconButton.tsx";
import { labelClass, selectClass } from "./ui/forms.ts";
import { useHub, storeActiveCompanyId } from "../context/HubContext.tsx";
import { signOut } from "../services/auth.ts";
import { displayName } from "../lib/format.ts";
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
  { to: "/my", label: "My GSR", icon: UserRound },
  { to: "/settings", label: "Settings", icon: Settings },
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
  const nav = isAdmin ? ADMIN_NAV : EMPLOYEE_NAV;

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
                {company?.name ?? "Company Hub"}
              </span>
              <span className="eyebrow block text-[9px]">Company Hub</span>
            </span>
          </NavLink>
          <IconButton label="Sign out" onClick={() => void signOut()} className="lg:hidden">
            <LogOut size={15} aria-hidden />
          </IconButton>
        </div>

        {isRococo && companies.length > 0 ? (
          <div className="border-b border-line px-4 py-3">
            <label htmlFor="company-switcher" className={labelClass}>
              Viewing
            </label>
            <select
              id="company-switcher"
              value={company?.id ?? ""}
              onChange={(e) => {
                storeActiveCompanyId(e.target.value);
                setActiveCompanyId(e.target.value);
              }}
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
          {isRococo ? (
            <div className="lg:mt-auto lg:border-t lg:border-line lg:pt-3">
              <NavEntry item={{ to: "/rococo", label: "Rococo", icon: Shield }} />
            </div>
          ) : null}
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
        <div key={company?.id ?? "none"} className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
