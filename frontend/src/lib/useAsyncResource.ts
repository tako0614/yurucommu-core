import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type AsyncResource<T> = {
  data: T | undefined;
  loading: boolean;
  error: unknown;
};

export type AsyncResourceActions<T> = {
  refetch: () => Promise<T | undefined>;
  setData: React.Dispatch<React.SetStateAction<T | undefined>>;
};

export function useAsyncResource<T, S = unknown>(
  source: S | (() => S) | (() => Promise<T>),
  fetcher?: (source: S) => Promise<T>,
  options?: { initialValue?: T; enabled?: boolean },
): [AsyncResource<T>, AsyncResourceActions<T>] {
  const { initialValue, enabled = true } = options ?? {};
  const isDirectFetcher = typeof source === "function" && !fetcher;

  const resolvedSource = useMemo<S>(() => {
    if (isDirectFetcher) {
      return undefined as unknown as S;
    }
    if (typeof source === "function") {
      return (source as () => S)();
    }
    return source as S;
  }, [isDirectFetcher, source]);

  const [data, setData] = useState<T | undefined>(initialValue);
  const [loading, setLoading] = useState<boolean>(enabled && !initialValue);
  const [error, setError] = useState<unknown>(undefined);

  const latestSourceRef = useRef<S>(resolvedSource);
  useEffect(() => {
    latestSourceRef.current = resolvedSource;
  }, [resolvedSource]);

  const fetchFn = useCallback(
    async (value: S) => {
      if (isDirectFetcher) {
        return (source as () => Promise<T>)();
      }
      if (!fetcher) {
        throw new Error("fetcher is required when source is not a function");
      }
      return fetcher(value);
    },
    [fetcher, isDirectFetcher, source],
  );

  const refetch = useCallback(async () => {
    if (!enabled) return data;
    const currentSource = latestSourceRef.current;
    setLoading(true);
    try {
      const result = await fetchFn(currentSource);
      setData(result);
      setError(undefined);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [enabled, fetchFn]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    refetch().catch(() => {
      if (!cancelled) {
        /* expose via error state */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, refetch, resolvedSource]);

  return [
    { data, loading, error },
    {
      refetch,
      setData,
    },
  ];
}
