import React, { createContext, useCallback, useContext, useMemo } from "react";
import type {
  AppAPI,
  AppDefinition,
  AuthState,
  CoreAPI,
  HandlerConfig,
  ScreenConfig,
  TakosRuntime
} from "./types";

export * from "./types";

type CreateTakosRuntimeOptions = {
  appId: string;
  appBasePath?: string;
  coreBasePath?: string;
  auth?: AuthState;
  params?: Record<string, string>;
  query?: Record<string, string>;
  fetchImpl?: typeof fetch;
  navigateImpl?: (path: string, options?: { replace?: boolean }) => void;
  backImpl?: () => void;
  ui?: Partial<TakosRuntime["ui"]>;
  appInfo?: Partial<TakosRuntime["appInfo"]>;
};

const TakosContext = createContext<TakosRuntime | null>(null);

/**
 * Lightweight fetch wrapper that attaches Authorization header if token is present.
 */
function buildFetcher(base: string, token?: string, fetchImpl?: typeof fetch) {
  const baseFetcher = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!baseFetcher) {
    throw new Error("fetch is not available in this environment");
  }

  const join = (root: string, path: string) => {
    if (/^https?:\/\//.test(path)) return path;
    const needsSlash = !root.endsWith("/") && !path.startsWith("/");
    if (root.endsWith("/") && path.startsWith("/")) {
      return `${root}${path.slice(1)}`;
    }
    return needsSlash ? `${root}/${path}` : `${root}${path}`;
  };

  return (path: string, options?: RequestInit) => {
    const url = join(base, path);
    const headers: Record<string, string> = {
      ...(options?.headers as Record<string, string> | undefined),
    };
    if (token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
    const shouldSetJson =
      options?.body &&
      !(options.body instanceof FormData) &&
      !headers["Content-Type"];
    if (shouldSetJson) {
      headers["Content-Type"] = "application/json";
    }

    return baseFetcher(url, {
      ...options,
      headers,
    });
  };
}

function buildQuery(params?: Record<string, unknown>): string {
  const search = new URLSearchParams();
  if (!params) return "";
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const queryString = search.toString();
  return queryString ? `?${queryString}` : "";
}

async function jsonOrThrow(response: Response) {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}): ${body || response.statusText}`);
  }
  return response.json();
}

function createCoreAPI(basePath: string, auth?: AuthState, fetchImpl?: typeof fetch): CoreAPI {
  const baseFetch = buildFetcher(basePath, auth?.token ?? undefined, fetchImpl);
  const jsonFetch = (path: string, options?: RequestInit) =>
    baseFetch(path, options).then(jsonOrThrow);

  return {
    fetch: baseFetch,
    posts: {
      list: (params) => jsonFetch(`/posts${buildQuery(params)}`),
      get: (id) => jsonFetch(`/posts/${id}`),
      create: (data) => jsonFetch("/posts", { method: "POST", body: JSON.stringify(data) }),
      delete: async (id) => {
        const res = await baseFetch(`/posts/${id}`, { method: "DELETE" });
        if (!res.ok) {
          throw new Error(`Failed to delete post ${id}`);
        }
      },
    },
    users: {
      get: (id) => jsonFetch(`/users/${id}`),
      follow: async (id) => {
        const res = await baseFetch(`/users/${id}/follow`, { method: "POST" });
        if (!res.ok) throw new Error(`Failed to follow user ${id}`);
      },
      unfollow: async (id) => {
        const res = await baseFetch(`/users/${id}/follow`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Failed to unfollow user ${id}`);
      },
    },
    timeline: {
      home: (params) => jsonFetch(`/timeline/home${buildQuery(params)}`),
    },
    notifications: {
      list: (params) => jsonFetch(`/notifications${buildQuery(params)}`),
      markRead: async (ids: string[]) => {
        const res = await baseFetch("/notifications/read", {
          method: "POST",
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error("Failed to mark notifications as read");
      },
    },
    storage: {
      upload: async (file, options) => {
        const form = new FormData();
        form.append("file", file);
        if (options?.metadata) {
          form.append("metadata", JSON.stringify(options.metadata));
        }
        const res = await baseFetch("/storage/upload", {
          method: "POST",
          body: form,
          headers: options?.contentType ? { "X-Content-Type": options.contentType } : undefined,
        });
        return jsonOrThrow(res);
      },
      get: async (key) => {
        const res = await baseFetch(`/storage/${encodeURIComponent(key)}`);
        if (!res.ok) return null;
        return res.blob();
      },
      delete: async (key) => {
        const res = await baseFetch(`/storage/${encodeURIComponent(key)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Failed to delete storage object ${key}`);
      },
    },
  };
}

function createAppAPI(appBasePath: string, auth?: AuthState, fetchImpl?: typeof fetch): AppAPI {
  const baseFetch = buildFetcher(appBasePath, auth?.token ?? undefined, fetchImpl);
  return {
    fetch: baseFetch,
  };
}

export function createTakosRuntime(options: CreateTakosRuntimeOptions): TakosRuntime {
  const coreBase = options.coreBasePath ?? "/-/api";
  const appBase = options.appBasePath ?? `/-/apps/${options.appId}/api`;
  const navigation = {
    navigate:
      options.navigateImpl ??
      ((path: string, navOptions?: { replace?: boolean }) => {
        if (typeof window === "undefined") return;
        if (navOptions?.replace) {
          window.history.replaceState({}, "", path);
        } else {
          window.history.pushState({}, "", path);
        }
      }),
    back:
      options.backImpl ??
      (() => {
        if (typeof window === "undefined") return;
        window.history.back();
      }),
  };

  const fallbackQuery =
    options.query ??
    (typeof window !== "undefined"
      ? Object.fromEntries(new URLSearchParams(window.location.search).entries())
      : {});
  const fallbackPath = typeof window !== "undefined" ? window.location.pathname : "/";

  return {
    ...navigation,
    currentPath: fallbackPath,
    params: options.params ?? {},
    query: fallbackQuery,
    auth: options.auth ?? { isLoggedIn: false, user: null, token: null },
    core: createCoreAPI(coreBase, options.auth, options.fetchImpl),
    app: createAppAPI(appBase, options.auth, options.fetchImpl),
    ui: {
      toast:
        options.ui?.toast ??
        (() => {
          /* noop */
        }),
      confirm:
        options.ui?.confirm ??
        (async () => {
          if (typeof window === "undefined") return true;
          return window.confirm("Are you sure?");
        }),
      modal: {
        open:
          options.ui?.modal?.open ??
          (() => {
            /* noop */
          }),
        close:
          options.ui?.modal?.close ??
          (() => {
            /* noop */
          }),
      },
    },
    appInfo: {
      id: options.appInfo?.id ?? options.appId,
      version: options.appInfo?.version ?? "0.0.0",
      permissions: options.appInfo?.permissions ?? [],
    },
  };
}

export function TakosProvider(props: {
  runtime?: TakosRuntime;
  runtimeOptions?: CreateTakosRuntimeOptions;
  children?: React.ReactNode;
}) {
  const value = useMemo(() => {
    if (props.runtime) return props.runtime;
    if (!props.runtimeOptions) {
      throw new Error("TakosProvider requires either runtime or runtimeOptions");
    }
    return createTakosRuntime(props.runtimeOptions);
  }, [props.runtime, props.runtimeOptions]);

  return <TakosContext.Provider value={value}>{props.children}</TakosContext.Provider>;
}

export function useTakos(): TakosRuntime {
  const ctx = useContext(TakosContext);
  if (!ctx) {
    throw new Error("useTakos must be used within a TakosProvider");
  }
  return ctx;
}

export function useCore(): CoreAPI {
  return useTakos().core;
}

export function useApp(): AppAPI {
  return useTakos().app;
}

export function useAuth(): AuthState {
  return useTakos().auth;
}

export function useNavigate() {
  const runtime = useTakos();
  const navigate = useCallback(
    (path: string, options?: { replace?: boolean }) => runtime.navigate(path, options),
    [runtime]
  );
  const back = useCallback(() => runtime.back(), [runtime]);
  return {
    navigate,
    back,
    params: runtime.params,
    query: runtime.query,
  };
}

export function useParams(): Record<string, string> {
  return useTakos().params;
}

export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  replace?: boolean;
};

export function Link(props: LinkProps) {
  const { navigate } = useNavigate();
  const { to, replace, onClick, ...rest } = props;
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      navigate(to, { replace });
    },
    [navigate, onClick, replace, to]
  );

  return <a href={to} onClick={handleClick} {...rest} />;
}

export type FormProps = React.FormHTMLAttributes<HTMLFormElement> & {
  onSubmit?: (values: Record<string, FormDataEntryValue>) => void | Promise<void>;
};

export function Form(props: FormProps) {
  const { onSubmit, children, ...rest } = props;
  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      if (!onSubmit) return;
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const values = Object.fromEntries(formData.entries());
      void onSubmit(values);
    },
    [onSubmit]
  );

  return (
    <form {...rest} onSubmit={onSubmit ? handleSubmit : undefined}>
      {children}
    </form>
  );
}

/**
 * Helper to declare an application definition.
 */
export function defineApp(config: AppDefinition): AppDefinition {
  return config;
}

/**
 * Helper to declare a screen definition.
 */
export function defineScreen(config: ScreenConfig): ScreenConfig {
  return config;
}

/**
 * Helper to declare a server handler (re-exported from server bundle as well).
 */
export function defineHandler<TInput = unknown, TOutput = unknown>(
  config: HandlerConfig<TInput, TOutput>
): HandlerConfig<TInput, TOutput> {
  return config;
}
