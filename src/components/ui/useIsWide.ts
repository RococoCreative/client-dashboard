// Whether the screen is at least lg wide (1024px), the width ListDetail puts the list and the
// open item side by side. Roles and Data sources read it to decide whether a bare address opens
// the first item. It subscribes to the media query, so a resize or a rotation updates it; the
// first render reads the same value the screens read before. Without matchMedia (a test DOM) the
// screen counts as wide.
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return typeof window.matchMedia !== "function" || window.matchMedia(QUERY).matches;
}

export default function useIsWide(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
