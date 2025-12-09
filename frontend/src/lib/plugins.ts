import type { ComponentType } from "react";
import { configureClient, getClientConfig, type ClientConfig } from "./config";

export type ClientComponentKey = "Login" | "Profile" | "AuthCallback";

export interface ClientPlugin {
  configure?(current: ClientConfig): Partial<ClientConfig> | void;
  components?: Partial<Record<ClientComponentKey, ComponentType<any>>>;
  setup?(): void;
}

const componentOverrides = new Map<ClientComponentKey, ComponentType<any>>();

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
  fallback: ComponentType<T>,
): ComponentType<T> {
  const override = componentOverrides.get(key);
  return (override as ComponentType<T> | undefined) ?? fallback;
}
