/**
 * App Loader
 *
 * Handles dynamic loading and mounting of takos Apps.
 * Reference: docs/plan/16-app-sdk.md §16.7
 */

import * as React from "react";
import * as ReactDOM from "react-dom/client";
import type { TakosRuntime, AppManifest } from "@takos/app-sdk";
import { createTakosRuntime, setAppMetadata, syncRouteParamsFromPath } from "./takos-runtime";
import { getBackendUrl } from "./api-client";

interface LoadedApp {
  id: string;
  module: { default: React.ComponentType<{ runtime: TakosRuntime }> };
  manifest: AppManifest;
  root: ReactDOM.Root | null;
}

const loadedApps = new Map<string, LoadedApp>();
const loadingPromises = new Map<string, Promise<LoadedApp>>();

/**
 * Load an App by ID
 */
export async function loadApp(appId: string): Promise<LoadedApp> {
  // Return cached app if already loaded
  if (loadedApps.has(appId)) {
    return loadedApps.get(appId)!;
  }

  // Return existing promise if currently loading
  if (loadingPromises.has(appId)) {
    return loadingPromises.get(appId)!;
  }

  const backendUrl = getBackendUrl();
  const loadPromise = (async (): Promise<LoadedApp> => {
    try {
      // Load module and manifest in parallel
      const [module, manifest] = await Promise.all([
        import(/* @vite-ignore */ `${backendUrl}/-/apps/${appId}/dist/client.bundle.js`),
        fetch(`${backendUrl}/-/apps/${appId}/manifest.json`).then((r) => {
          if (!r.ok) {
            throw new Error(`Failed to load manifest: HTTP ${r.status}`);
          }
          return r.json();
        }),
      ]);

      // Validate module has default export
      if (!module.default || typeof module.default !== "function") {
        throw new Error(`App ${appId} does not export a valid React component`);
      }

      // Store app metadata for runtime
      setAppMetadata(
        appId,
        manifest.version || "1.0.0",
        manifest.permissions || []
      );

      const app: LoadedApp = {
        id: appId,
        module,
        manifest,
        root: null,
      };

      loadedApps.set(appId, app);
      return app;
    } finally {
      loadingPromises.delete(appId);
    }
  })();

  loadingPromises.set(appId, loadPromise);
  return loadPromise;
}

/**
 * Mount an App into a container element
 */
export function mountApp(
  app: LoadedApp,
  container: HTMLElement,
  runtime: TakosRuntime
): void {
  // Unmount existing root if present
  if (app.root) {
    app.root.unmount();
  }

  const root = ReactDOM.createRoot(container);
  const AppComponent = app.module.default;

  root.render(React.createElement(AppComponent, { runtime }));

  app.root = root;
}

/**
 * Unmount an App
 */
export function unmountApp(app: LoadedApp): void {
  if (app.root) {
    app.root.unmount();
    app.root = null;
  }
}

/**
 * Unload an App completely (remove from cache)
 */
export function unloadApp(appId: string): void {
  const app = loadedApps.get(appId);
  if (app) {
    unmountApp(app);
    loadedApps.delete(appId);
  }
}

/**
 * Check if an App is loaded
 */
export function isAppLoaded(appId: string): boolean {
  return loadedApps.has(appId);
}

/**
 * Get a loaded App
 */
export function getLoadedApp(appId: string): LoadedApp | undefined {
  return loadedApps.get(appId);
}

/**
 * Get all loaded Apps
 */
export function getLoadedApps(): LoadedApp[] {
  return Array.from(loadedApps.values());
}

/**
 * High-level function to load and mount an App
 */
export async function loadAndMountApp(
  appId: string,
  container: HTMLElement
): Promise<LoadedApp> {
  const app = await loadApp(appId);
  const runtime = createTakosRuntime(appId);
  mountApp(app, container, runtime);
  return app;
}

/**
 * React hook for loading an App
 */
export function useAppLoader(appId: string | null): {
  app: LoadedApp | null;
  loading: boolean;
  error: Error | null;
} {
  const [state, setState] = React.useState<{
    app: LoadedApp | null;
    loading: boolean;
    error: Error | null;
  }>({
    app: null,
    loading: false,
    error: null,
  });

  React.useEffect(() => {
    if (!appId) {
      setState({ app: null, loading: false, error: null });
      return;
    }

    // Check if already loaded
    const existing = loadedApps.get(appId);
    if (existing) {
      setState({ app: existing, loading: false, error: null });
      return;
    }

    setState({ app: null, loading: true, error: null });

    loadApp(appId)
      .then((app) => {
        setState({ app, loading: false, error: null });
      })
      .catch((error) => {
        setState({ app: null, loading: false, error });
      });
  }, [appId]);

  return state;
}

/**
 * React component that renders an App
 */
export const AppRenderer: React.FC<{
  appId: string;
  fallback?: React.ReactNode;
  onError?: (error: Error) => void;
}> = ({ appId, fallback, onError }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { app, loading, error } = useAppLoader(appId);
  const mountedRef = React.useRef(false);

  React.useEffect(() => {
    if (error && onError) {
      onError(error);
    }
  }, [error, onError]);

  // Sync route params on route change
  React.useEffect(() => {
    // Initial sync
    syncRouteParamsFromPath();

    // Listen for route changes (popstate for browser back/forward)
    const handlePopState = () => syncRouteParamsFromPath();
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  React.useEffect(() => {
    if (!app || !containerRef.current || mountedRef.current) {
      return;
    }

    const runtime = createTakosRuntime(appId);
    mountApp(app, containerRef.current, runtime);
    mountedRef.current = true;

    return () => {
      unmountApp(app);
      mountedRef.current = false;
    };
  }, [app, appId]);

  if (loading) {
    return React.createElement("div", null, fallback ?? "Loading app...");
  }

  if (error) {
    return React.createElement(
      "div",
      { className: "text-red-600" },
      `Failed to load app: ${error.message}`
    );
  }

  return React.createElement("div", { ref: containerRef });
};
