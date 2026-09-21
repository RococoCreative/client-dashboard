// Load-once-and-reload for page data. Services throw; this catches, keeps the previous
// data on a failed reload (a flaky signal must not blank a page someone is reading), and
// exposes setData so pages can apply optimistic edits without a refetch. No data library
// by house rule; this is the whole abstraction.
//
// It also revalidates when the tab comes back to the front. Without that, a hub left open on
// the dashboard keeps showing whatever was true when it was opened: somebody marks a review
// complete on their phone, or in the next tab, and the summary still reads the old world with
// nothing to tell it otherwise. Every loader here is a handful of indexed reads, so refreshing
// on return is cheaper than being wrong. This is not a live socket: two people watching the
// same screen at the same moment still only see each other's changes on their next return.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/errors.ts";

// Long enough that alt-tabbing back and forth does not refetch on every flick, short enough
// that anything a person did while they were away is already on screen when they look.
const REVALIDATE_AFTER_MS = 30_000;

// A reload swaps the rows under the page, and BlurInput adopts a changed server value, so
// reloading while somebody is mid-keystroke can take their uncommitted draft with it. If the
// cursor is in a control, the refresh waits for the next return.
const EDITING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isEditing(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  return active instanceof HTMLElement && (active.isContentEditable || EDITING.has(active.tagName));
}

export interface AsyncState<T> {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
  setData: (next: T | ((prev: T | null) => T | null)) => void;
}

interface Settled<T> {
  data: T | null;
  error: string;
  // The request number this result belongs to; -1 until the first one lands.
  request: number;
  // Which deps generation the data belongs to. reload() keeps the generation, because it is
  // asking the same question again; a deps change starts a new one, because it is a different
  // question. Rows from an older generation are not an answer to the current one.
  gen: number;
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  // Every deps change and every reload() is a new numbered request. Loading is "the latest
  // request has not settled yet", derived here rather than flipped inside the effect, and
  // the deps comparison happens during render (the adjust-state-on-change pattern), so the
  // effect keys on one number and no state is written before the fetch resolves.
  const [request, setRequest] = useState(0);
  const [gen, setGen] = useState(0);
  const [seenDeps, setSeenDeps] = useState(deps);
  if (!sameDeps(seenDeps, deps)) {
    setSeenDeps(deps);
    setRequest((n) => n + 1);
    setGen((n) => n + 1);
  }
  const [settled, setSettled] = useState<Settled<T>>({ data: null, error: "", request: -1, gen: 0 });

  // The loader closure changes every render; the effect reads the latest one through a ref
  // so a parent re-render never refetches. Synced in an effect, never during render.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  // When the newest request settled, and whether one is still out. Both are only ever written
  // from a settled promise or an effect, never during render.
  const settledAt = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    inFlight.current = true;
    loaderRef
      .current()
      .then((next) => {
        if (!active) return;
        settledAt.current = Date.now();
        inFlight.current = false;
        setSettled({ data: next, error: "", request, gen });
      })
      .catch((err: unknown) => {
        if (!active) return;
        settledAt.current = Date.now();
        inFlight.current = false;
        // A failed reload keeps what is on screen: a flaky signal must not blank a page someone
        // is reading. A failed deps change must not, because the rows on screen answer the old
        // question and the page around them already says the new one. Showing 2026's goals
        // under a header reading 2025, with Edit, Delete and the Hit toggle live on them, is
        // worse than showing the error alone.
        setSettled((prev) => ({ data: prev.gen === gen ? prev.data : null, error: errorMessage(err), request, gen }));
      });
    return () => {
      active = false;
    };
    // gen moves only together with request, on a deps change, so listing it starts no extra
    // fetch. It is here because the effect stamps results with it.
  }, [request, gen]);

  // Returning to the tab is the signal that time has passed and the page may be behind.
  useEffect(() => {
    function revalidate() {
      if (document.visibilityState !== "visible") return;
      if (inFlight.current) return;
      if (Date.now() - settledAt.current < REVALIDATE_AFTER_MS) return;
      if (isEditing()) return;
      setRequest((n) => n + 1);
    }
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, []);

  const loading = settled.request !== request;
  const reload = useCallback(() => setRequest((n) => n + 1), []);
  const setData = useCallback((next: T | ((prev: T | null) => T | null)) => {
    setSettled((prev) => ({ ...prev, data: typeof next === "function" ? (next as (p: T | null) => T | null)(prev.data) : next }));
  }, []);

  return { data: settled.data, error: loading ? "" : settled.error, loading, reload, setData };
}
