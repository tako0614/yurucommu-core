type DenoCommandStdio = "piped" | "inherit" | "null";

interface DenoCommandOptions {
  args?: string[];
  cwd?: string | URL;
  env?: Record<string, string>;
  clearEnv?: boolean;
  stdin?: DenoCommandStdio;
  stdout?: DenoCommandStdio;
  stderr?: DenoCommandStdio;
  signal?: AbortSignal;
}

interface DenoCommandOutput {
  code: number;
  signal: string | null;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

interface DenoDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

interface DenoFileInfo {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
  atime: Date | null;
  birthtime: Date | null;
  mode: number | null;
}

interface DenoServeOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (params: { hostname: string; port: number }) => void;
}

type DenoServeHandler = (
  req: Request,
  info?: unknown,
) => Response | Promise<Response>;

interface DenoTestContext {
  name: string;
  step(
    name: string,
    fn: (t: DenoTestContext) => unknown | Promise<unknown>,
  ): Promise<boolean>;
  step(
    def: {
      name: string;
      fn: (t: DenoTestContext) => unknown | Promise<unknown>;
    },
  ): Promise<boolean>;
}

type DenoTestFn = (t: DenoTestContext) => unknown | Promise<unknown>;

declare const Deno: {
  args: string[];
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    has(key: string): boolean;
    delete(key: string): void;
    toObject(): Record<string, string>;
  };
  errors: {
    NotFound: new (...args: unknown[]) => Error;
    AlreadyExists: new (...args: unknown[]) => Error;
    PermissionDenied: new (...args: unknown[]) => Error;
  };
  cwd(): string;
  exit(code?: number): never;
  mkdir(path: string | URL, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  makeTempDir(options?: { dir?: string; prefix?: string }): Promise<string>;
  readDir(path: string | URL): AsyncIterable<DenoDirEntry>;
  readTextFile(path: string | URL): Promise<string>;
  readFile(path: string | URL): Promise<Uint8Array>;
  writeTextFile(path: string | URL, data: string): Promise<void>;
  writeFile(path: string | URL, data: Uint8Array): Promise<void>;
  remove(path: string | URL, options?: { recursive?: boolean }): Promise<void>;
  stat(path: string | URL): Promise<DenoFileInfo>;
  realPath(path: string | URL): Promise<string>;
  symlink(
    oldpath: string | URL,
    newpath: string | URL,
    options?: { type?: "file" | "dir" | "junction" },
  ): Promise<void>;
  resolveDns(name: string, recordType: "A" | "AAAA"): Promise<string[]>;
  serve(
    options: DenoServeOptions,
    handler: DenoServeHandler,
  ): { finished: Promise<void>; shutdown(): Promise<void> };
  serve(
    handler: DenoServeHandler,
  ): { finished: Promise<void>; shutdown(): Promise<void> };
  test(name: string, fn: DenoTestFn): void;
  test(name: string, options: unknown, fn: DenoTestFn): void;
  test(fn: DenoTestFn): void;
  test(def: {
    name?: string;
    fn?: DenoTestFn;
    ignore?: boolean;
    only?: boolean;
  }): void;
  Command: new (
    command: string | URL,
    options?: DenoCommandOptions,
  ) => {
    output(): Promise<DenoCommandOutput>;
    outputSync(): DenoCommandOutput;
    spawn(): {
      pid: number | undefined;
      status: Promise<{ code: number; success: boolean; signal: string | null }>;
      kill(signal?: NodeJS.Signals): boolean;
    };
  };
};

declare module "https://deno.land/x/sqlite3@0.12.0/mod.ts" {
  export const Database: new (filename: string) => unknown;
}
