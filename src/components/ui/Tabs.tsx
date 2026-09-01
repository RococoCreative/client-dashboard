// Route tabs for a page with sub-views (a person's overview, reviews, goals).
import { NavLink } from "react-router-dom";

export interface TabItem {
  to: string;
  label: string;
  end?: boolean;
}

export default function Tabs({ items }: { items: TabItem[] }) {
  return (
    <nav className="mb-6 flex gap-1 border-b border-line" aria-label="Sections">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            "-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors duration-150 " +
            (isActive ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
