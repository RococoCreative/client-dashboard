// Overlay dialog primitive: Escape and backdrop-click close, focus moves into the panel on open
// and returns to the opener on close, and Tab never leaves it. Surface, hairline border, one soft
// shadow.
//
// The trap matters beyond tidiness. Without it Tab walked out of a dialog to the controls under the
// scrim, so a second dialog could open over a delete that was still running and show that delete's
// failure as its own. Inside the panel Tab belongs to the browser, because a control can use it
// itself: in a date field Tab moves between month, day and year. The trap only acts at the edges.
// A focusable guard sits on each side of the panel, so a Tab off the last control lands on the far
// guard and goes round to the first control, and Shift+Tab off the first goes round to the last.
// When focus is not in the dialog at all (dropped to the page by a control that went disabled, or
// moved under the scrim), the key is taken here and focus comes back to the near end. Only the
// topmost dialog handles a key, so stacked dialogs behave too.
import { useEffect, useRef, useState, type ReactNode } from "react";

// Open-modal stack so Escape and Tab only act for the topmost dialog when modals stack.
const modalStack: symbol[] = [];

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]",
].join(",");

// The controls Tab stops on inside the panel, in document order. Visibility is checked where the
// browser can say (checkVisibility); a test DOM has no layout, so there everything counts. A radio
// group is one stop, as the browser makes it: the checked radio, or the first when none is.
function tabStops(panel: HTMLElement): HTMLElement[] {
  const candidates = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.tabIndex < 0) return false;
    if (el.hasAttribute("data-focus-guard")) return false;
    if (el.closest("[inert], [hidden]")) return false;
    if (el.matches(":disabled")) return false;
    return typeof el.checkVisibility !== "function" || el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
  });
  return candidates.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return true;
    const group = candidates.filter((c): c is HTMLInputElement => c instanceof HTMLInputElement && c.type === "radio" && c.name === el.name && c.form === el.form);
    return (group.find((r) => r.checked) ?? group[0]) === el;
  });
}

// Where focus goes round to: the first stop going forward, the last going backward, or the panel
// itself when nothing inside takes focus.
function edgeStop(panel: HTMLElement, backward: boolean): HTMLElement {
  const stops = tabStops(panel);
  return (backward ? stops[stops.length - 1] : stops[0]) ?? panel;
}

// One of the two edge guards: a Tab stop with nothing in it that sends focus straight on round.
function FocusGuard({ onFocus }: { onFocus: () => void }) {
  return <span data-focus-guard="" tabIndex={0} onFocus={onFocus} className="sr-only" />;
}

export default function Modal({
  onClose,
  labelledBy,
  size = "md",
  children,
}: {
  onClose: () => void;
  labelledBy?: string;
  size?: "md" | "lg" | "xl";
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass inline onClose closures, so the mount effect must NOT key on it: re-running
  // per parent render would steal focus back to the panel mid-typing.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  // The control that opened the dialog, read while the dialog first renders. By the time an effect
  // runs, a field inside with autoFocus already has focus, and focus would go back to that field
  // (gone by then) instead of to the opener.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const id = Symbol("modal");
    modalStack.push(id);
    const panel = panelRef.current;
    // A field inside that asked for focus keeps it; otherwise the panel takes it.
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    function onKey(e: KeyboardEvent) {
      if (modalStack[modalStack.length - 1] !== id) return;
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !panel) return;
      // Focus somewhere in the dialog: the browser moves it, and the guards wrap it at the edges.
      if (rootRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      edgeStop(panel, e.shiftKey).focus();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      modalStack.splice(modalStack.indexOf(id), 1);
      window.removeEventListener("keydown", onKey);
      // On a real close the panel has already left the page. Still on it means React is only
      // re-running the effect (Strict Mode in development), and focus stays where it is.
      if (panel?.isConnected) return;
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  const width = size === "xl" ? "max-w-4xl" : size === "lg" ? "max-w-2xl" : "max-w-md";

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <FocusGuard onFocus={() => panelRef.current && edgeStop(panelRef.current, true).focus()} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`max-h-[90vh] w-full ${width} overflow-y-auto rounded-lg border border-line bg-surface shadow-md outline-none`}
      >
        {children}
      </div>
      <FocusGuard onFocus={() => panelRef.current && edgeStop(panelRef.current, false).focus()} />
    </div>
  );
}
