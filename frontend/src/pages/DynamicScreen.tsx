import { Component, createSignal, createEffect, onMount, Show } from "solid-js";
import { useLocation } from "@solidjs/router";
import { RenderScreen } from "../lib/ui-runtime";
import { loadAppManifest, getScreenByRoute, extractRouteParams, type AppManifest, type AppManifestScreen } from "../lib/app-manifest";

/**
 * DynamicScreen Component
 *
 * Renders screens dynamically from App Manifest
 * (PLAN.md 5.4: App Manifest 駆動 UI)
 */
const DynamicScreen: Component = () => {
  const location = useLocation();
  const [manifest, setManifest] = createSignal<AppManifest | null>(null);
  const [screen, setScreen] = createSignal<AppManifestScreen | null>(null);
  const [routeParams, setRouteParams] = createSignal<Record<string, string>>({});
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  // Load manifest on mount
  onMount(async () => {
    try {
      const m = await loadAppManifest();
      setManifest(m);
    } catch (err) {
      console.error("[DynamicScreen] Failed to load manifest:", err);
      setError("Failed to load App Manifest");
    } finally {
      setLoading(false);
    }
  });

  // Update screen when route changes
  createEffect(() => {
    const m = manifest();
    if (!m) return;

    const currentPath = location.pathname;
    const matchedScreen = getScreenByRoute(m, currentPath);

    if (matchedScreen) {
      setScreen(matchedScreen);
      const params = extractRouteParams(matchedScreen.route, currentPath);
      setRouteParams(params);
      setError(null);
    } else {
      setScreen(null);
      setError(`No screen found for route: ${currentPath}`);
    }
  });

  return (
    <div>
      <Show when={loading()}>
        <div style={{ padding: "20px", "text-align": "center" }}>Loading App Manifest...</div>
      </Show>

      <Show when={error()}>
        <div style={{ padding: "20px", color: "red" }}>
          <h2>Error</h2>
          <p>{error()}</p>
        </div>
      </Show>

      <Show when={!loading() && !error() && screen()}>
        {(s) => (
          <RenderScreen
            screen={s()}
            context={{
              routeParams: routeParams(),
              location: location.pathname,
            }}
          />
        )}
      </Show>
    </div>
  );
};

export default DynamicScreen;
