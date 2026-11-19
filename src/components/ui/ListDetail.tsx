// A list beside one open item, the shape of the Roles page and review setup. Each list entry is a
// link with its own address, so the open item survives a reload and can be shared. At lg and up the
// list and the detail sit side by side; below lg the list shows alone until something is chosen,
// then the detail shows alone with a back link naming the list (backLabel), as a person page reads
// "People" beside its arrow. Responsive classes do that work, so
// no script measures the screen. With nothing selected the detail is not rendered at any width.
// An empty list shows nothing of its own, so the page says what an empty list means (its footer);
// "Nothing matches that." is only for a search that found nothing. Items carrying a group (retired
// roles) follow the rest under that group's label; a page that wants the label to carry the count
// of the rows shown passes groupLabel, which is given the group and how many of its rows match.
import { ArrowLeft, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { inputClass } from "./forms.ts";
import { eyebrowLabelClass, itemTitleClass, metaClass, secondaryClass } from "./type.ts";

export interface ListDetailItem {
  id: string;
  title: string;
  meta?: string;
  muted?: boolean;
  group?: string;
}

const CARD = "rounded-lg border border-line bg-surface p-4 sm:p-6";
// A muted title swaps the ink for ink-3 rather than stacking both, so which one wins never depends
// on the order the stylesheet happens to list them in.
const MUTED_TITLE = itemTitleClass.replace(/(^|\s)text-ink(?=\s|$)/, "$1text-ink-3");
const GROUP_LABEL = `px-2 pb-1.5 pt-4 ${eyebrowLabelClass}`;

export default function ListDetail({
  label,
  items,
  selectedId,
  hrefFor,
  backHref,
  backLabel,
  countLabel,
  searchLabel,
  groupLabel,
  actions,
  footer,
  children,
}: {
  label: string;
  items: ListDetailItem[];
  selectedId: string | null;
  hrefFor: (id: string) => string;
  backHref: string;
  backLabel: string;
  countLabel: string;
  searchLabel?: string;
  groupLabel?: (group: string, shownCount: number) => string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matched = needle ? items.filter((item) => item.title.toLowerCase().includes(needle)) : items;
  // Ungrouped items first, then each group in the order it first appears.
  const groups = [...new Set(matched.map((item) => item.group ?? ""))].sort((a, b) => Number(a !== "") - Number(b !== ""));
  const shown = groups.flatMap((group) => matched.filter((item) => (item.group ?? "") === group));
  const groupCount = (group: string) => matched.filter((item) => item.group === group).length;
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
          needle ? <p className={`${secondaryClass} mt-4`}>Nothing matches that.</p> : null
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {shown.map((item, index) => {
              const selected = item.id === selectedId;
              const startsGroup = item.group && item.group !== shown[index - 1]?.group;
              return (
                <li key={item.id}>
                  {startsGroup ? <p className={GROUP_LABEL}>{groupLabel ? groupLabel(item.group!, groupCount(item.group!)) : item.group}</p> : null}
                  <Link
                    to={hrefFor(item.id)}
                    aria-current={selected ? "true" : undefined}
                    className={
                      "block min-h-11 px-2 py-2.5 transition-colors duration-150 hover:bg-surface-2 " +
                      (selected ? "bg-surface-2 shadow-[inset_2px_0_0_var(--color-accent)]" : "")
                    }
                  >
                    <span className={`${item.muted ? MUTED_TITLE : itemTitleClass} block break-words`}>{item.title}</span>
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
          <div className="-mt-2 mb-1 lg:hidden">
            <Link
              to={backHref}
              aria-label={`Back to ${backLabel}`}
              className="inline-flex min-h-11 items-center gap-1 text-[12px] text-ink-2 transition-colors duration-150 hover:text-ink"
            >
              <ArrowLeft size={13} aria-hidden="true" /> {backLabel}
            </Link>
          </div>
          {children}
        </div>
      ) : null}
    </div>
  );
}
