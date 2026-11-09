// The Home card that points at each working section's first page, read from the same registry
// the sidebar uses (navFor, sectionShortcuts), so the two can never disagree. A flat sidebar has
// no sections, so the card renders nothing there. No data loading.
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import Section from "../ui/Section.tsx";
import { navFor, sectionShortcuts } from "../../lib/navigation.ts";
import type { Company } from "../../types/database.ts";

export default function ShortcutsCard({ company, isAdmin, isRococo }: { company: Company; isAdmin: boolean; isRococo: boolean }) {
  const shortcuts = sectionShortcuts(navFor(company, isAdmin, isRococo));
  if (shortcuts.length === 0) return null;
  return (
    <Section eyebrow="Shortcuts" title="Sections" padded={false}>
      <ul className="divide-y divide-line">
        {shortcuts.map((shortcut) => (
          <li key={shortcut.group}>
            <Link
              to={shortcut.to}
              className="group flex items-center justify-between gap-3 px-5 py-2.5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-2/60 hover:text-accent"
            >
              {shortcut.heading}
              <ArrowRight size={14} aria-hidden className="shrink-0 text-ink-3 transition-colors duration-150 group-hover:text-accent" />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
