import { AppHandlerRegistry } from "./registry";
import type { AppScriptModule } from "./types";

export type LoadedAppScript = {
  module: AppScriptModule;
  registry: AppHandlerRegistry;
  handlers: string[];
};

export type LoadAppMainOptions = {
  loadModule: () => Promise<AppScriptModule> | AppScriptModule;
  sourceId?: string;
};

export async function loadAppMain(options: LoadAppMainOptions): Promise<LoadedAppScript> {
  try {
    const module = await options.loadModule();
    const registry = AppHandlerRegistry.fromModule(module);
    return {
      module,
      registry,
      handlers: registry.list(),
    };
  } catch (error) {
    const suffix = options.sourceId ? ` (${options.sourceId})` : "";
    const message = (error as Error)?.message ?? String(error);
    throw new Error(`Failed to load app-main${suffix}: ${message}`);
  }
}

export async function loadAppMainFromModule(
  module: AppScriptModule,
  sourceId?: string,
): Promise<LoadedAppScript> {
  return loadAppMain({
    loadModule: async () => module,
    sourceId,
  });
}
