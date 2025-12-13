declare module "esbuild-wasm" {
  export const version: string;
  export function initialize(options: { wasmURL: string; worker?: boolean }): Promise<void>;
  export function transform(
    input: string,
    options: Record<string, unknown>,
  ): Promise<{ code: string; map?: string }>;
}

