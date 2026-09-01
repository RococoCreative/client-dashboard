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

export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  // The loader closure changes every render; the effect keys on deps + tick instead so a
  // parent re-render never refetches.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loaderRef
      .current()
      .then((next) => {
        if (!active) return;
        setData(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, loading, reload, setData };
}
