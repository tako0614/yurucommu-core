import {
  AppHandlerRegistry,
  loadAppMainFromModule,
  type AppScriptModule,
} from "@takos/platform/app";

type LoadedScript = {
  module: AppScriptModule;
  source: string;
};

export type AppScriptLoader = (
  scriptRef: string | null | undefined,
  env: any,
) => Promise<LoadedScript | null>;

let customLoader: AppScriptLoader | null = null;

export function setAppScriptLoader(loader: AppScriptLoader | null): void {
  customLoader = loader;
}

const textDecoder = new TextDecoder();
const boolFromEnv = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return false;
};

const isDevEnv = (env: any): boolean => {
  const context = typeof env?.TAKOS_CONTEXT === "string" ? env.TAKOS_CONTEXT.trim().toLowerCase() : "";
  if (context === "dev") return true;
  const nodeEnv = typeof env?.NODE_ENV === "string" ? env.NODE_ENV.trim().toLowerCase() : "";
  return nodeEnv === "development";
};

const allowUntrustedScriptRef = (env: any): boolean =>
  isDevEnv(env) || boolFromEnv((env as any)?.ALLOW_UNSANDBOXED_APP_SCRIPTS);

const isUntrustedRef = (ref: string): boolean => {
  const normalized = ref.trim();
  return (
    normalized.startsWith("inline:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("vfs:") ||
    normalized.startsWith("ws:") ||
    normalized.startsWith("r2:")
  );
};

const encodeBase64 = (input: string): string => {
  if (typeof btoa === "function") {
    return btoa(input);
  }
  // @ts-ignore Buffer is available in Node.js / tests
  if (typeof Buffer !== "undefined") {
    // @ts-ignore Buffer is available in Node.js / tests
    return Buffer.from(input, "utf8").toString("base64");
  }
  throw new Error("Base64 encoding is not supported in this environment");
};

const decodeBase64 = (input: string): string => {
  if (typeof atob === "function") {
    return atob(input);
  }
  // @ts-ignore Buffer is available in Node.js / tests
  if (typeof Buffer !== "undefined") {
    // @ts-ignore Buffer is available in Node.js / tests
    return Buffer.from(input, "base64").toString("utf8");
  }
  throw new Error("Base64 decoding is not supported in this environment");
};

const importFromCode = async (code: string, source: string): Promise<LoadedScript> => {
  const base64 = encodeBase64(code);
  const specifier = `data:application/javascript;base64,${base64}`;
  const module = (await import(specifier)) as AppScriptModule;
  return { module, source };
};

const loadInlineScript = async (ref: string): Promise<LoadedScript | null> => {
  const trimmed = ref.trim();
  if (trimmed.startsWith("data:")) {
    const module = (await import(trimmed)) as AppScriptModule;
    return { module, source: "data-url" };
  }

  if (!trimmed.startsWith("inline:")) return null;
  const encoded = trimmed.slice("inline:".length);
  if (!encoded) return null;

  // Attempt base64 decode first, then URI decode as a fallback.
  let decoded: string | null = null;
  try {
    decoded = decodeBase64(encoded);
  } catch {
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      decoded = null;
    }
  }
  if (!decoded) return null;
  return importFromCode(decoded, "inline");
};

const tryReadObjectText = async (source: any, key: string): Promise<string | null> => {
  if (!source) return null;
  try {
    const raw =
      // KVNamespace.get(key, "text")
      (await source.get?.(key, "text")) ??
      // KVNamespace.get(key)
      (await source.get?.(key)) ??
      // R2Bucket.get(key)
      (await source.get?.(key));
    if (!raw) return null;
    if (typeof raw === "string") return raw;
    if (typeof raw.text === "function") {
      return await raw.text();
    }
    if (raw instanceof ArrayBuffer) {
      return textDecoder.decode(new Uint8Array(raw));
    }
    if (typeof raw.arrayBuffer === "function") {
      const buf = await raw.arrayBuffer();
      return textDecoder.decode(new Uint8Array(buf));
    }
    if (raw.body && typeof raw.body === "string") {
      return raw.body;
    }
  } catch (error) {
    console.error("[app-script] failed to read object text", error);
  }
  return null;
};

const loadFromR2 = async (ref: string, env: any): Promise<LoadedScript | null> => {
  const bucket =
    (env as any)?.APP_SCRIPTS ??
    (env as any)?.APP_BUNDLES ??
    (env as any)?.SCRIPT_SNAPSHOTS ??
    (env as any)?.APP_SCRIPT_SNAPSHOTS;
  if (!bucket) return null;

  // Support optional "r2:" prefix
  const key = ref.startsWith("r2:") ? ref.slice("r2:".length) : ref;
  const body = await tryReadObjectText(bucket, key);
  if (!body) return null;
  return importFromCode(body, `r2:${key}`);
};

const loadFromVfs = async (ref: string, env: any): Promise<LoadedScript | null> => {
  const prefix = ref.startsWith("vfs:") ? "vfs:" : ref.startsWith("ws:") ? "ws:" : null;
  if (!prefix) return null;

  const parts = ref.slice(prefix.length).split(":");
  const workspaceId = parts.shift()?.trim();
  const path = parts.join(":").trim() || "app-main.js";
  if (!workspaceId) return null;
  const store = (env as any)?.workspaceStore ?? (env as any)?.WORKSPACE_STORE;
  if (!store?.getWorkspaceFile) return null;

  try {
    const file = await store.getWorkspaceFile(workspaceId, path);
    if (!file?.content) return null;
    const code = textDecoder.decode(file.content);
    return importFromCode(code, `${prefix}${workspaceId}:${path}`);
  } catch (error) {
    console.error("[app-script] failed to load from VFS", error);
    return null;
  }
};

const loadModuleBinding = async (ref: string, env: any): Promise<LoadedScript | null> => {
  if (!ref.startsWith("module:")) return null;
  const key = ref.slice("module:".length);
  const mod = (env as any)?.[key];
  if (!mod) return null;
  return { module: mod as AppScriptModule, source: `env:${key}` };
};

export async function loadAppScript(options: {
  scriptRef?: string | null;
  env: any;
}): Promise<LoadedScript | null> {
  const ref = options.scriptRef?.toString?.().trim?.() ?? "";
  const allowUntrusted = allowUntrustedScriptRef(options.env);

  if (customLoader) {
    const loaded = await customLoader(ref || null, options.env);
    if (loaded) return loaded;
  }

  if (ref && isUntrustedRef(ref) && !allowUntrusted) {
    throw new Error(
      "Untrusted app script refs (inline/r2/vfs) are disabled outside dev; set TAKOS_CONTEXT=dev or ALLOW_UNSANDBOXED_APP_SCRIPTS=1 to override.",
    );
  }

  if (ref) {
    const inline = await loadInlineScript(ref);
    if (inline) return inline;

    const vfs = await loadFromVfs(ref, options.env);
    if (vfs) return vfs;

    const r2 = await loadFromR2(ref, options.env);
    if (r2) return r2;

    const moduleBinding = await loadModuleBinding(ref, options.env);
    if (moduleBinding) return moduleBinding;
  }

  const envModule = (options.env as any)?.APP_MAIN_MODULE;
  if (envModule && typeof envModule === "object") {
    return { module: envModule as AppScriptModule, source: "env:APP_MAIN_MODULE" };
  }

  const globalModule = (globalThis as any).__takosAppMain;
  if (globalModule) {
    return { module: globalModule as AppScriptModule, source: "global:__takosAppMain" };
  }

  return null;
}

export async function loadAppRegistryFromScript(options: {
  scriptRef?: string | null;
  env: any;
}): Promise<{ registry: AppHandlerRegistry; source: string }> {
  const loaded = await loadAppScript({ scriptRef: options.scriptRef, env: options.env });
  if (!loaded) {
    throw new Error("App Script module is not available for manifest routing");
  }
  const result = await loadAppMainFromModule(loaded.module, loaded.source);
  return { registry: result.registry, source: loaded.source ?? "app-script" };
}
