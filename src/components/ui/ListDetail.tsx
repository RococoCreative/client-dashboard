// A list beside one open item, the shape of the Roles page and review setup. Each list entry is a
// link with its own address, so the open item survives a reload and can be shared. At lg and up the
// list and the detail sit side by side; below lg the list shows alone until something is chosen,
// then the detail shows alone with a back arrow to the list. Responsive classes do that work, so
// no script measures the screen. With nothing selected the detail is not rendered at any width.
import { ArrowLeft, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { inputClass } from "./forms.ts";
import { itemTitleClass, metaClass, secondaryClass } from "./type.ts";

export interface ListDetailItem {
  id: string;
  title: string;
  meta?: string;
  muted?: boolean;
}

const CARD = "rounded-lg border border-line bg-surface p-4 sm:p-6";

export default function ListDetail({
  label,
  items,
  selectedId,
  hrefFor,
  backHref,
  countLabel,
  searchLabel,
  actions,
  footer,
  children,
}: {
  label: string;
  items: ListDetailItem[];
  selectedId: string | null;
  hrefFor: (id: string) => string;
  backHref: string;
  countLabel: string;
  searchLabel?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle ? items.filter((item) => item.title.toLowerCase().includes(needle)) : items;
  const hasSelection = selectedId !== null;

  return (
    <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <section aria-label={label} className={`${CARD} ${hasSelection ? "hidden lg:block" : ""}`}>
        <div className="flex items-center justify-between gap-3">
          <p className={secondaryClass}>{countLabel}</p>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        {searchLabel ? (
          <div className="relative mt-3">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <input
              type="search"
              aria-label={searchLabel}
              placeholder={searchLabel}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${inputClass} !mt-0 pl-9`}
            />
          </div>
        ) : null}
        {shown.length === 0 ? (
          <p className={`${secondaryClass} mt-4`}>Nothing matches that.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {shown.map((item) => {
              const selected = item.id === selectedId;
              return (
                <li key={item.id}>
                  <Link
                    to={hrefFor(item.id)}
                    aria-current={selected ? "true" : undefined}
                    className={
                      "block min-h-11 px-2 py-2.5 transition-colors duration-150 hover:bg-surface-2 " +
                      (selected ? "bg-surface-2 shadow-[inset_2px_0_0_var(--color-accent)]" : "")
                    }
                  >
                    <span className={`${itemTitleClass} block break-words ${item.muted ? "text-ink-3" : ""}`}>
                      {item.title}
                    </span>
                    {item.meta ? <span className={`${metaClass} block break-words`}>{item.meta}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {footer ? <div className="mt-4">{footer}</div> : null}
      </section>

      {hasSelection ? (
        <div className={`${CARD} min-w-0`}>
          <div className="mb-3 lg:hidden">
            <Link
              to={backHref}
              aria-label={`Back to ${label}`}
              title={`Back to ${label}`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </Link>
          </div>
          {children}
        </div>
      ) : null}
    </div>
  );
}
