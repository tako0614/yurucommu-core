import React, {
  createContext as createReactContext,
  useCallback,
  useContext as useReactContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";

export type Accessor<T> = () => T;
export type Component<P = Record<string, unknown>> = React.FC<P>;

export type Resource<T> = Accessor<T | undefined> & {
  loading: boolean;
  error: any;
};

export type ResourceActions<T> = {
  refetch: () => Promise<T | undefined>;
  mutate: (value: T | undefined) => void;
};

export function createSignal<T>(initial: T): [Accessor<T>, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const getter = useCallback(() => value, [value]);
  return [getter, setValue];
}

export function createMemo<T>(fn: () => T, deps?: DependencyList): Accessor<T> {
  const value = useMemo(fn, deps);
  return useCallback(() => value, [value]);
}

export function createEffect(effect: () => void | (() => void), deps?: DependencyList): void {
  useEffect(effect, deps);
}

export function onMount(fn: () => void | (() => void)): void {
  useEffect(() => {
    return fn() as any;
  }, []);
}

export function onCleanup(fn: () => void): void {
  useEffect(() => fn, []);
}

export function createResource<T, S = unknown>(
  source: Accessor<S> | S | (() => Promise<T>),
  fetcher?: (source: S) => Promise<T>,
  options?: { initialValue?: T }
): [Resource<T>, ResourceActions<T>] {
  const isDirectFetcher = typeof source === "function" && !fetcher;
  const fetchFn = (isDirectFetcher ? source : fetcher) as ((input?: S) => Promise<T>) | undefined;
  const getSource = useMemo<Accessor<S>>(() => {
    if (isDirectFetcher) {
      return (() => undefined as unknown as S);
    }
    if (typeof source === "function") {
      return source as Accessor<S>;
    }
    return () => source as S;
  }, [isDirectFetcher, source]);

  const [data, setData] = useState<T | undefined>(options?.initialValue);
  const [loading, setLoading] = useState<boolean>(!options?.initialValue);
  const [error, setError] = useState<any>(undefined);

  const latestFetch = useRef(0);

  const refetch = useCallback(async () => {
    if (!fetchFn) return data;
    const ticket = Date.now();
    latestFetch.current = ticket;
    setLoading(true);
    try {
      const result = isDirectFetcher ? await (fetchFn as () => Promise<T>)() : await fetchFn(getSource());
      if (latestFetch.current === ticket) {
        setData(result);
        setError(undefined);
      }
      return result;
    } catch (err) {
      if (latestFetch.current === ticket) {
        setError(err);
      }
      throw err;
    } finally {
      if (latestFetch.current === ticket) {
        setLoading(false);
      }
    }
  }, [fetchFn, getSource, isDirectFetcher, data]);

  useEffect(() => {
    refetch().catch(() => {
      /* swallow to avoid unhandled rejection during initial load */
    });
  }, [refetch, getSource()]);

  const resource = (() => data) as Resource<T>;
  resource.loading = loading;
  resource.error = error;

  const actions: ResourceActions<T> = {
    refetch,
    mutate: (value) => setData(value),
  };

  return [resource, actions];
}

export function createStore<T extends Record<string, any>>(initial: T): [T, (...args: any[]) => void] {
  const [state, setState] = useState<T>(initial);

  const setter = (...args: any[]) => {
    setState((prev) => {
      if (args.length === 1 && typeof args[0] === "function") {
        return args[0](prev);
      }
      const path = args.slice(0, -1);
      const value = args[args.length - 1];

      const next: any = Array.isArray(prev) ? [...prev] : { ...prev };
      let target = next;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        const current = target[key];
        target[key] = Array.isArray(current) ? [...current] : { ...(current ?? {}) };
        target = target[key];
      }
      const lastKey = path[path.length - 1];
      target[lastKey] = typeof value === "function" ? value(target[lastKey]) : value;
      return next;
    });
  };

  return [state, setter];
}

export const Suspense: Component<{ fallback?: ReactNode; children?: ReactNode }> = (props) => {
  return <React.Suspense fallback={props.fallback}>{props.children}</React.Suspense>;
};

export const Show: Component<{ when: any; fallback?: ReactNode; children?: ReactNode }> = (props) => {
  return props.when ? <>{props.children}</> : <>{props.fallback ?? null}</>;
};

export const For = <T,>(props: { each: readonly T[] | undefined | null; fallback?: ReactNode; children: (item: T, index: number) => ReactNode }) => {
  if (!props.each || props.each.length === 0) {
    return <>{props.fallback ?? null}</>;
  }
  return <>{props.each.map((item, index) => props.children(item, index))}</>;
};

export const createContext = createReactContext;
export const useContext = useReactContext;
