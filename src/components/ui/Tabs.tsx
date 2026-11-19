// Route tabs for a page with sub-views (Goals, Settings, Resources, a person's own pages). Each tab
// is a link to its own path, so a tab can be bookmarked and linked to, and the router marks the
// current one with aria-current="page". On a narrow screen the strip scrolls sideways on its own
// rather than widening the page, with the current tab brought into view within it; each tab is
// 44px tall under a finger or at phone width.
import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";

export interface TabItem {
  to: string;
  label: string;
  end?: boolean;
}

export default function Tabs({ items, label = "Sections" }: { items: TabItem[]; label?: string }) {
  const { pathname } = useLocation();
  const ref = useRef<HTMLElement>(null);
  // Scroll the strip itself, never the page, so the current tab is in view on a narrow screen.
  useEffect(() => {
    const strip = ref.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !current) return;
    const box = strip.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    if (tab.left < box.left || tab.right > box.right) strip.scrollLeft += tab.left - box.left - 12;
  }, [pathname]);
  return (
    <nav ref={ref} className="relative -mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label={label}>
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
