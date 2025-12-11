import * as React from "react";
import type {
  AppAPI,
  AppConfig,
  AppDefinition,
  CoreAPI,
  NormalizedAppConfig,
  NormalizedScreen,
  ScreenConfig,
  ScreenDefinition,
  TakosRuntime
} from "./types";

// Client-facing exports
export * from "./types";

const TakosContext = React.createContext<TakosRuntime | null>(null);
const TAKOS_APP_META = "__takosApp";
const TAKOS_SCREEN_META = "__takosScreen";

type NavState = {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
};
type NavigateAPI = {
  navigate: TakosRuntime["navigate"];
  back: TakosRuntime["back"];
  params: TakosRuntime["params"];
  query: TakosRuntime["query"];
};

export function defineScreen(config: ScreenConfig): ScreenDefinition {
  const normalized: ScreenDefinition = {
    ...config,
    auth: config.auth ?? "required",
    __takosScreen: true
  };

  const componentWithName = normalized.component as React.ComponentType & {
    displayName?: string;
  };
  if (!componentWithName.displayName) {
    componentWithName.displayName = normalized.title ?? normalized.path;
  }

  return normalized;
}

export function defineApp(config: AppConfig): AppDefinition {
  const normalizedScreens: NormalizedScreen[] = config.screens.map(normalizeScreen);

  const meta: NormalizedAppConfig = {
    id: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    handlers: config.handlers ?? [],
    permissions: config.permissions ?? [],
    screens: normalizedScreens
  };

  const AppComponent: React.FC<{ runtime: TakosRuntime }> = ({ runtime }) => {
    const [navState, setNavState] = React.useState<NavState>(() =>
      createNavState(runtime, normalizedScreens)
    );

    const syncNavState = React.useCallback(() => {
      setNavState(createNavState(runtime, normalizedScreens));
    }, [runtime, normalizedScreens]);

    React.useEffect(() => {
      if (typeof window === "undefined") return;
      const handlePop = () => syncNavState();
      window.addEventListener("popstate", handlePop);
      return () => window.removeEventListener("popstate", handlePop);
    }, [syncNavState]);

    const activeMatch = React.useMemo(
      () => findMatchingScreen(navState.path, normalizedScreens),
      [navState.path, normalizedScreens]
    );

    const runtimeBridge = React.useMemo(
      () => createRuntimeBridge(runtime, navState, syncNavState),
      [runtime, navState, syncNavState]
    );

    const ScreenComponent = activeMatch?.screen?.component ?? null;

    return (
      <TakosContext.Provider value={runtimeBridge}>
        {ScreenComponent ? (
          <ScreenComponent key={activeMatch?.key ?? activeMatch?.screen?.path ?? navState.path} />
        ) : (
          <MissingScreen path={navState.path} />
        )}
      </TakosContext.Provider>
    );
  };

  Object.assign(AppComponent, { [TAKOS_APP_META]: meta });

  return AppComponent as AppDefinition;
}

export function useTakos(): TakosRuntime {
  const runtime = React.useContext(TakosContext);
  if (!runtime) {
    throw new Error("useTakos must be used inside a takos app created by defineApp().");
  }
  return runtime;
}

export function useCore(): CoreAPI {
  return useTakos().core;
}

export function useApp(): AppAPI {
  return useTakos().app;
}

export function useAuth() {
  return useTakos().auth;
}

export function useNavigate(): NavigateAPI {
  const runtime = useTakos();
  return React.useMemo(
    () => ({
      navigate: runtime.navigate,
      back: runtime.back,
      params: runtime.params,
      query: runtime.query
    }),
    [runtime]
  );
}

export function useParams(): Record<string, string> {
  return useTakos().params;
}

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
};

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, onClick, target, rel, ...anchorProps },
  ref
) {
  const { navigate } = useNavigate();

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey ||
      (target && target !== "_self")
    ) {
      return;
    }

    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} ref={ref} onClick={handleClick} target={target} rel={rel} {...anchorProps} />
  );
});

type FormMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type FormProps = Omit<React.FormHTMLAttributes<HTMLFormElement>, "method" | "action" | "onSubmit"> & {
  action: string;
  method?: FormMethod;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  onSuccess?: (data: unknown, response: Response) => void;
  onError?: (error: unknown) => void;
};

export const Form = React.forwardRef<HTMLFormElement, FormProps>(function Form(
  { action, method = "POST", onSubmit, onSuccess, onError, children, ...formProps },
  ref
) {
  const app = useApp();
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      onSubmit?.(event);
      if (event.defaultPrevented) return;

      event.preventDefault();
      const formData = new FormData(event.currentTarget);

      setSubmitting(true);
      try {
        const response = await submitViaAppAPI(app, action, method, formData);
        const payload = await parseResponse(response);

        if (!response.ok) {
          const error: Record<string, unknown> = {
            message: `Request failed with status ${response.status}`,
            response,
            data: payload
          };
          throw error;
        }

        onSuccess?.(payload, response);
      } catch (error) {
        onError?.(error);
      } finally {
        setSubmitting(false);
      }
    },
    [action, method, app, onSuccess, onError, onSubmit]
  );

  return (
    <form
      ref={ref}
      action={action}
      method={method.toLowerCase()}
      onSubmit={handleSubmit}
      aria-busy={submitting}
      {...formProps}
    >
      {children}
    </form>
  );
});

function createRuntimeBridge(
  runtime: TakosRuntime,
  navState: NavState,
  syncNavState: () => void
): TakosRuntime {
  return {
    navigate: (path: string) => {
      runtime.navigate(path);
      syncNavState();
    },
    back: () => {
      runtime.back();
      if (typeof window !== "undefined") {
        setTimeout(syncNavState, 0);
      }
    },
    get currentPath() {
      return navState.path;
    },
    get params() {
      return navState.params;
    },
    get query() {
      return navState.query;
    },
    get auth() {
      return runtime.auth;
    },
    get core() {
      return runtime.core;
    },
    get app() {
      return runtime.app;
    },
    get ui() {
      return runtime.ui;
    },
    get appInfo() {
      return runtime.appInfo;
    }
  };
}

function createNavState(runtime: TakosRuntime, screens: NormalizedScreen[]): NavState {
  const path = normalizePath(runtime.currentPath);
  const match = findMatchingScreen(path, screens);
  const runtimeParams = runtime.params ?? {};
  const resolvedParams = hasEntries(runtimeParams) ? runtimeParams : match?.params ?? {};

  return {
    path,
    params: resolvedParams,
    query: runtime.query ?? {}
  };
}

function normalizeScreen(screen: ScreenDefinition): NormalizedScreen {
  const normalized: NormalizedScreen = {
    ...screen,
    auth: screen.auth ?? "required"
  };
  Object.assign(normalized, { [TAKOS_SCREEN_META]: true });
  return normalized;
}

function findMatchingScreen(
  path: string,
  screens: NormalizedScreen[]
): { screen: NormalizedScreen; params: Record<string, string>; key: string } | null {
  for (const screen of screens) {
    const params = matchPath(screen.path, path);
    if (params) {
      return { screen, params, key: screen.path };
    }
  }
  return null;
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = trimAndSplit(pattern);
  const pathParts = trimAndSplit(path);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
}

function trimAndSplit(path: string): string[] {
  const normalized = normalizePath(path);
  return normalized === "/" ? [] : normalized.replace(/^\//, "").split("/");
}

function normalizePath(path: string): string {
  if (!path) return "/";
  const [pathname] = path.split("?");
  const trimmed = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  return trimmed.startsWith("/") ? trimmed || "/" : `/${trimmed}`;
}

function hasEntries(record: Record<string, unknown>): boolean {
  return Object.keys(record ?? {}).length > 0;
}

async function submitViaAppAPI(
  app: AppAPI,
  action: string,
  method: FormMethod,
  formData: FormData
): Promise<Response> {
  const normalizedMethod = method.toUpperCase() as FormMethod;
  if (normalizedMethod === "GET") {
    const query = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      query.append(key, String(value));
    }
    const url = query.toString() ? `${action}?${query.toString()}` : action;
    return app.fetch(url, { method: "GET" });
  }

  const hasFile = Array.from(formData.values()).some((value) => value instanceof File);
  const body = hasFile ? formData : JSON.stringify(Object.fromEntries(formData.entries()));
  const headers = hasFile ? undefined : { "Content-Type": "application/json" };

  return app.fetch(action, {
    method: normalizedMethod,
    body: body as BodyInit,
    headers
  });
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  const text = await response.text().catch(() => "");
  return text || null;
}

function MissingScreen({ path }: { path: string }) {
  return <div>Screen not found for path: {path}</div>;
}
