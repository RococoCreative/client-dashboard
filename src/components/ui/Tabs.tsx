// Route tabs for a page with sub-views (Goals, Settings, Resources, a person's own pages). Each tab
// is a link to its own path, so a tab can be bookmarked and linked to, and the router marks the
// current one with aria-current="page". On a narrow screen the strip scrolls sideways on its own
// rather than widening the page, and each tab is 44px tall under a finger or at phone width.
import { NavLink } from "react-router-dom";

export interface TabItem {
  to: string;
  label: string;
  end?: boolean;
}

export default function Tabs({ items, label = "Sections" }: { items: TabItem[]; label?: string }) {
  return (
    <nav className="relative -mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label={label}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            "-mb-px flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2 text-[13px] tap:min-h-11 transition-colors duration-150 " +
            (isActive ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
