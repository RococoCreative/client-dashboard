// Overlay dialog primitive: Escape and backdrop-click close, focus moves into the panel on open
// and returns to the opener on close, and Tab never leaves it. Surface, hairline border, one soft
// shadow.
//
// The trap matters beyond tidiness. Without it Tab walked out of a dialog to the controls under the
// scrim, so a second dialog could open over a delete that was still running and show that delete's
// failure as its own. Tab and Shift+Tab are handled here rather than left to the browser, so they
// cycle through the panel's controls and nothing else, wherever focus happens to be when the key is
// pressed (on the panel itself, dropped to the page by a control that went disabled, or anywhere
// else). Only the topmost dialog handles a key, so stacked dialogs behave too.
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

// Where Tab (or Shift+Tab) goes from the element that has focus now.
function nextStop(panel: HTMLElement, stops: HTMLElement[], current: Element | null, backward: boolean): HTMLElement {
  const last = stops.length - 1;
  const index = current ? stops.indexOf(current as HTMLElement) : -1;
  if (index !== -1) return stops[backward ? (index === 0 ? last : index - 1) : index === last ? 0 : index + 1];
  // Focus is on something inside the panel that Tab would not stop on (an element focused by a
  // click or a script): go to the nearest stop after it, or before it going backward, wrapping round.
  if (current && current !== panel && panel.contains(current)) {
    const following = stops.filter((s) => current.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
    const preceding = stops.filter((s) => current.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING);
    if (backward) return preceding[preceding.length - 1] ?? stops[last];
    return following[0] ?? stops[0];
  }
  // On the panel itself, or outside the dialog altogether: start from the near end.
  return backward ? stops[last] : stops[0];
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
      e.preventDefault();
      const stops = tabStops(panel);
      if (stops.length === 0) {
        panel.focus();
        return;
      }
      nextStop(panel, stops, document.activeElement, e.shiftKey).focus();
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`max-h-[90vh] w-full ${width} overflow-y-auto rounded-lg border border-line bg-surface shadow-md outline-none`}
      >
        {children}
      </div>
    </div>
  );
}
