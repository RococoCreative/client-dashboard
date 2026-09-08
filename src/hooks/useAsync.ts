// Load-once-and-reload for page data. Services throw; this catches, keeps the previous
// data on a failed reload (a flaky signal must not blank a page someone is reading), and
// exposes setData so pages can apply optimistic edits without a refetch. No data library
// by house rule; this is the whole abstraction.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/errors.ts";

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
  const [seenDeps, setSeenDeps] = useState(deps);
  if (!sameDeps(seenDeps, deps)) {
    setSeenDeps(deps);
    setRequest((n) => n + 1);
  }
  const [settled, setSettled] = useState<Settled<T>>({ data: null, error: "", request: -1 });

  // The loader closure changes every render; the effect reads the latest one through a ref
  // so a parent re-render never refetches. Synced in an effect, never during render.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let active = true;
    loaderRef
      .current()
      .then((next) => {
        if (active) setSettled({ data: next, error: "", request });
      })
      .catch((err: unknown) => {
        if (active) setSettled((prev) => ({ data: prev.data, error: errorMessage(err), request }));
      });
    return () => {
      active = false;
    };
  }, [request]);

  const loading = settled.request !== request;
  const reload = useCallback(() => setRequest((n) => n + 1), []);
  const setData = useCallback((next: T | ((prev: T | null) => T | null)) => {
    setSettled((prev) => ({ ...prev, data: typeof next === "function" ? (next as (p: T | null) => T | null)(prev.data) : next }));
  }, []);

  return { data: settled.data, error: loading ? "" : settled.error, loading, reload, setData };
}
