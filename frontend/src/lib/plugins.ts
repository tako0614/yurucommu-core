import type { Component } from "solid-js";
import { configureClient, getClientConfig, type ClientConfig } from "./config";

export type ClientComponentKey = "Login" | "Profile" | "AuthCallback";

export interface ClientPlugin {
  configure?(current: ClientConfig): Partial<ClientConfig> | void;
  components?: Partial<Record<ClientComponentKey, Component<any>>>;
  setup?(): void;
}

const componentOverrides = new Map<ClientComponentKey, Component<any>>();

export function registerClientPlugin(plugin: ClientPlugin): void {
  const current = getClientConfig();
  const next = plugin.configure?.(current);
  if (next) {
    configureClient(next);
  }

  if (plugin.components) {
    for (const [key, component] of Object.entries(plugin.components) as Array<
      [ClientComponentKey, Component<any>]
    >) {
      if (component) {
        componentOverrides.set(key, component);
      }
    }
  }

  plugin.setup?.();
}

export function resolveComponent<T extends Record<string, any>>(
  key: ClientComponentKey,
  fallback: Component<T>,
): Component<T> {
  const override = componentOverrides.get(key);
  return (override as Component<T> | undefined) ?? fallback;
}
