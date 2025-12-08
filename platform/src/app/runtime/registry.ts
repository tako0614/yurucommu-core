import { AppHandler, AppScriptModule } from "./types";

function normalizeHandlerName(name: string): string {
  return typeof name === "string" ? name.trim() : "";
}

function assertModuleObject(module: AppScriptModule): Record<string, unknown> {
  if (!module || typeof module !== "object" || Array.isArray(module)) {
    throw new Error("App Script module must export an object");
  }
  return module as Record<string, unknown>;
}

function collectExportedHandlers(module: AppScriptModule): Array<[string, AppHandler]> {
  const normalizedModule = assertModuleObject(module);
  const handlers = new Map<string, AppHandler>();

  const register = (key: string, value: unknown) => {
    const name = normalizeHandlerName(key);
    if (!name) return;
    if (typeof value !== "function") return;
    const existing = handlers.get(name);
    if (existing) {
      if (existing === value) {
        // Allow duplicate exports that point to the same function (named + default)
        return;
      }
      throw new Error(`Duplicate app handler "${name}" found in app-main exports`);
    }
    handlers.set(name, value as AppHandler);
  };

  for (const [key, value] of Object.entries(normalizedModule)) {
    if (key === "default" || key === "__esModule") continue;
    register(key, value);
  }

  const defaultExport = (normalizedModule as any).default;
  if (defaultExport && typeof defaultExport === "object" && !Array.isArray(defaultExport)) {
    for (const [key, value] of Object.entries(defaultExport as Record<string, unknown>)) {
      register(key, value);
    }
  }

  return Array.from(handlers.entries());
}

export class AppHandlerRegistry {
  private readonly handlers = new Map<string, AppHandler>();

  constructor(entries?: Iterable<[string, AppHandler]>) {
    if (entries) {
      for (const [name, handler] of entries) {
        this.register(name, handler);
      }
    }
  }

  static fromModule(module: AppScriptModule): AppHandlerRegistry {
    return new AppHandlerRegistry(collectExportedHandlers(module));
  }

  register(name: string, handler: AppHandler): void {
    const normalized = normalizeHandlerName(name);
    if (!normalized) {
      throw new Error("App handler name is required");
    }
    if (typeof handler !== "function") {
      throw new Error(`App handler "${normalized}" must be a function`);
    }
    if (this.handlers.has(normalized)) {
      throw new Error(`Duplicate app handler "${normalized}"`);
    }
    this.handlers.set(normalized, handler);
  }

  get(name: string): AppHandler | null {
    const normalized = normalizeHandlerName(name);
    return this.handlers.get(normalized) ?? null;
  }

  require(name: string): AppHandler {
    const handler = this.get(name);
    if (!handler) {
      throw new Error(`Unknown app handler "${name}"`);
    }
    return handler;
  }

  list(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }

  size(): number {
    return this.handlers.size;
  }
}
