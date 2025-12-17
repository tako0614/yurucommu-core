export const normalizeVfsPath = (path: string): string => path.replace(/^\/+/, "").replace(/\\/g, "/").trim();

export const boolFromEnv = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return false;
};

export const resolveCompiler = async (env: any) => {
  const wasmUrl =
    typeof env?.TAKOS_ESBUILD_WASM_URL === "string" && env.TAKOS_ESBUILD_WASM_URL.trim().length > 0
      ? env.TAKOS_ESBUILD_WASM_URL.trim()
      : typeof env?.ESBUILD_WASM_URL === "string" && env.ESBUILD_WASM_URL.trim().length > 0
        ? env.ESBUILD_WASM_URL.trim()
        : null;

  try {
    const esbuild = (await import("esbuild-wasm")) as any;
    if (wasmUrl) {
      if (!(globalThis as any).__takosEsbuildInitialized) {
        await esbuild.initialize({ wasmURL: wasmUrl, worker: false });
        (globalThis as any).__takosEsbuildInitialized = true;
      }
      return { kind: "esbuild-wasm" as const, esbuild, wasmUrl };
    }
  } catch {
    // ignore - fall back to TS transpile.
  }

  try {
    const ts = await import("typescript");
    return { kind: "typescript" as const, ts };
  } catch {
    return { kind: "none" as const };
  }
};

