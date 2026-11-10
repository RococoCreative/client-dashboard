// Signed-in application shell: a quiet sidebar with the company's identity, the nav for the
// person's role in its sections (the same sections for every company), and the account footer.
// Rococo admins get the portfolio nav when no company is active, and inside a company a way
// back plus the switcher. Collapses to a top bar on small screens. The content area remounts when the active company changes so every page
// refetches for the new tenant.
import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowLeft, LogOut } from "lucide-react";
import Avatar from "./ui/Avatar.tsx";
import IconButton from "./ui/IconButton.tsx";
import { labelClass, selectClass } from "./ui/forms.ts";
import { useHub } from "../context/HubContext.tsx";
import { signOut } from "../services/auth.ts";
import { displayName } from "../lib/format.ts";
import { applyTheme } from "../lib/theme.ts";
import { PORTFOLIO_NAV, alsoActiveFor, navFor, type NavItem, type NavLayout, type NavSection } from "../lib/navigation.ts";
import { ROLE_LABELS } from "../types/database.ts";

const entryClass = (active: boolean) =>
  "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors duration-150 lg:py-1.5 " +
  (active ? "bg-accent/10 font-medium text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink");

// One sidebar link. An item that owns other paths too (SOPs owns /sops/:id) is marked current on
// them as well, the way the router marks its own path.
function NavEntry({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const { pathname } = useLocation();
  const body = (
    <>
      <Icon size={15} aria-hidden />
      <span>{item.label}</span>
    </>
  );
  if (alsoActiveFor(item, pathname)) {
    return (
      <Link to={item.to} aria-current="page" className={entryClass(true)}>
        {body}
      </Link>
    );
  }
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => entryClass(isActive)}>
      {body}
    </NavLink>
  );
}

// One section of the sidebar. Its heading shows only at lg, so the small-screen bar stays one
// horizontal row; the bottom group has no heading and a hairline instead.
function NavSectionGroup({ section }: { section: NavSection }) {
  const utility = section.group === "utility";
  return (
    <div
      role="group"
      aria-label={section.heading ?? (section.group === "home" ? "Home" : "More")}
      className={
        "flex shrink-0 gap-1 lg:flex-col lg:gap-0.5 " +
        (utility ? "border-l border-line pl-1 lg:mt-auto lg:border-t lg:border-l-0 lg:pt-3 lg:pl-0" : "lg:not-first:mt-3")
      }
    >
      {section.heading ? <p className="eyebrow hidden px-3 pt-1 pb-0.5 text-[10px] text-ink-3 lg:block">{section.heading}</p> : null}
      {section.items.map((item) => (
        <NavEntry key={item.id} item={item} />
      ))}
    </div>
  );
}

export default function AppLayout() {
  const { profile, company, companies, isRococo, isAdmin, setActiveCompanyId } = useHub();
  const location = useLocation();
  // The portfolio is a place, not a state: a Rococo admin is on it whenever the URL says so
  // or no company is active. That keeps entering a company (state change plus navigation,
  // which React Router commits separately) free of any in-between flicker or bounce.
  const portfolio = isRococo && (company === null || location.pathname.startsWith("/rococo"));
  // The registry decides what this person sees here, flat or in sections (lib/navigation.ts).
  const layout: NavLayout = portfolio
    ? { kind: "flat", items: [...PORTFOLIO_NAV] }
    : company ? navFor(company, isAdmin, isRococo) : { kind: "flat", items: [] };

  // The bar scrolls on its own (sideways on a phone, down on a short laptop screen), so the current
  // page's item is brought into view within it, without moving the page itself.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current) return;
    const box = nav.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.left < box.left || item.right > box.right) nav.scrollLeft += item.left - box.left - 12;
    if (item.top < box.top || item.bottom > box.bottom) nav.scrollTop += item.top - box.top - 12;
  }, [location.pathname]);

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

        <nav ref={navRef} className="flex gap-1 overflow-x-auto px-3 py-3 lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto" aria-label="Primary">
          {layout.kind === "flat"
            ? layout.items.map((item) => <NavEntry key={item.id} item={item} />)
            : layout.sections.map((section) => <NavSectionGroup key={section.group} section={section} />)}
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
