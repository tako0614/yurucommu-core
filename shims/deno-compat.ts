// Bun migration: minimal, self-installing `globalThis.Deno` runtime compat.
//
// Implements the RUNTIME subset of the Deno namespace this CLI uses, backed by
// Bun / node: APIs. Importing this module installs the global as a side effect
// (idempotent). It does NOT provide `Deno.test` (that is test-only and added by
// shims/deno-test-preload.ts) and deliberately omits the Deno permission model
// (no Node/Bun equivalent).
//
// This is the canonical pattern reused across the ecosystem's Bun migration.
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";

type StdioStr = "piped" | "inherit" | "null";

function mapStdio(v: StdioStr | undefined): "pipe" | "inherit" | "ignore" {
  if (v === "inherit") return "inherit";
  if (v === "null") return "ignore";
  return "pipe";
}

interface CommandOptions {
  args?: string[];
  cwd?: string | URL;
  env?: Record<string, string>;
  clearEnv?: boolean;
  stdin?: StdioStr;
  stdout?: StdioStr;
  stderr?: StdioStr;
  signal?: AbortSignal;
}

interface CommandOutput {
  code: number;
  signal: string | null;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

function buildEnv(opts: CommandOptions): NodeJS.ProcessEnv {
  if (opts.clearEnv) return { ...(opts.env ?? {}) };
  return { ...process.env, ...(opts.env ?? {}) };
}

class DenoCommand {
  #cmd: string;
  #opts: CommandOptions;
  constructor(cmd: string | URL, opts: CommandOptions = {}) {
    this.#cmd = cmd instanceof URL ? cmd.pathname : cmd;
    this.#opts = opts;
  }

  output(): Promise<CommandOutput> {
    const o = this.#opts;
    return new Promise((resolve, reject) => {
      const child = spawn(this.#cmd, o.args ?? [], {
        cwd: o.cwd instanceof URL ? o.cwd.pathname : o.cwd,
        env: buildEnv(o),
        stdio: [mapStdio(o.stdin), mapStdio(o.stdout ?? "piped"), mapStdio(o.stderr ?? "piped")],
        signal: o.signal,
      });
      const out: Uint8Array[] = [];
      const err: Uint8Array[] = [];
      child.stdout?.on("data", (c: Buffer) => out.push(c));
      child.stderr?.on("data", (c: Buffer) => err.push(c));
      child.on("error", reject);
      child.on("close", (code, sig) => {
        resolve({
          code: code ?? 0,
          signal: sig,
          success: (code ?? 0) === 0,
          stdout: out.length ? new Uint8Array(Buffer.concat(out)) : new Uint8Array(),
          stderr: err.length ? new Uint8Array(Buffer.concat(err)) : new Uint8Array(),
        });
      });
    });
  }

  outputSync(): CommandOutput {
    const o = this.#opts;
    const r = spawnSync(this.#cmd, o.args ?? [], {
      cwd: o.cwd instanceof URL ? o.cwd.pathname : o.cwd,
      env: buildEnv(o),
      stdio: [mapStdio(o.stdin), mapStdio(o.stdout ?? "piped"), mapStdio(o.stderr ?? "piped")],
    });
    return {
      code: r.status ?? 0,
      signal: r.signal,
      success: (r.status ?? 0) === 0,
      stdout: r.stdout ? new Uint8Array(r.stdout) : new Uint8Array(),
      stderr: r.stderr ? new Uint8Array(r.stderr) : new Uint8Array(),
    };
  }

  spawn() {
    const o = this.#opts;
    const child = spawn(this.#cmd, o.args ?? [], {
      cwd: o.cwd instanceof URL ? o.cwd.pathname : o.cwd,
      env: buildEnv(o),
      stdio: [mapStdio(o.stdin), mapStdio(o.stdout), mapStdio(o.stderr)],
      detached: true,
      signal: o.signal,
    });
    child.unref?.();
    return {
      pid: child.pid,
      status: new Promise<{ code: number; success: boolean; signal: string | null }>((res) =>
        child.on("close", (code, sig) => res({ code: code ?? 0, success: (code ?? 0) === 0, signal: sig }))
      ),
      kill: (sig?: NodeJS.Signals) => child.kill(sig),
    };
  }
}

class NotFound extends Error {
  override name = "NotFound";
}
class AlreadyExists extends Error {
  override name = "AlreadyExists";
}
class PermissionDenied extends Error {
  override name = "PermissionDenied";
}

function remap(e: unknown): unknown {
  const code = (e as { code?: string })?.code;
  if (code === "ENOENT") return Object.assign(new NotFound((e as Error).message), { cause: e });
  if (code === "EEXIST") return Object.assign(new AlreadyExists((e as Error).message), { cause: e });
  if (code === "EACCES" || code === "EPERM") return Object.assign(new PermissionDenied((e as Error).message), { cause: e });
  return e;
}

interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

const DenoCompat = {
  args: process.argv.slice(2),
  pid: process.pid,
  build: {
    os: (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : process.platform) as string,
    arch: process.arch,
  },
  errors: { NotFound, AlreadyExists, PermissionDenied },

  env: {
    get: (k: string): string | undefined => process.env[k],
    set: (k: string, v: string): void => {
      process.env[k] = v;
    },
    has: (k: string): boolean => k in process.env,
    delete: (k: string): void => {
      delete process.env[k];
    },
    toObject: (): Record<string, string> => ({ ...process.env } as Record<string, string>),
  },

  exit: (code = 0): never => process.exit(code) as never,
  cwd: (): string => process.cwd(),
  chdir: (dir: string | URL): void => process.chdir(dir instanceof URL ? dir.pathname : dir),
  execPath: (): string => process.execPath,

  addSignalListener: (sig: NodeJS.Signals, handler: () => void): void => {
    process.on(sig, handler);
  },
  removeSignalListener: (sig: NodeJS.Signals, handler: () => void): void => {
    process.off(sig, handler);
  },

  readTextFile: (p: string | URL): Promise<string> =>
    fsp.readFile(p, "utf8").catch((e) => Promise.reject(remap(e))),
  readTextFileSync: (p: string | URL): string => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch (e) {
      throw remap(e);
    }
  },
  readFile: (p: string | URL): Promise<Uint8Array> =>
    fsp.readFile(p).then((b) => new Uint8Array(b)).catch((e) => Promise.reject(remap(e))),

  writeTextFile: (
    p: string | URL,
    data: string,
    opts?: { append?: boolean; create?: boolean; mode?: number },
  ): Promise<void> => fsp.writeFile(p, data, { flag: opts?.append ? "a" : "w", mode: opts?.mode }),
  writeTextFileSync: (
    p: string | URL,
    data: string,
    opts?: { append?: boolean; create?: boolean; mode?: number },
  ): void => fs.writeFileSync(p, data, { flag: opts?.append ? "a" : "w", mode: opts?.mode }),
  writeFile: (p: string | URL, data: Uint8Array, opts?: { mode?: number }): Promise<void> =>
    fsp.writeFile(p, data, { mode: opts?.mode }),
  writeFileSync: (p: string | URL, data: Uint8Array, opts?: { mode?: number }): void =>
    fs.writeFileSync(p, data, { mode: opts?.mode }),

  mkdir: (p: string | URL, opts?: { recursive?: boolean; mode?: number }): Promise<void> =>
    fsp.mkdir(p, { recursive: opts?.recursive, mode: opts?.mode }).then(() => undefined),
  remove: (p: string | URL, opts?: { recursive?: boolean }): Promise<void> =>
    fsp.rm(p, { recursive: opts?.recursive ?? false, force: false }).catch((e) => Promise.reject(remap(e))),
  removeSync: (p: string | URL, opts?: { recursive?: boolean }): void => {
    try {
      fs.rmSync(p, { recursive: opts?.recursive ?? false, force: false });
    } catch (e) {
      throw remap(e);
    }
  },

  makeTempDir: (opts?: { dir?: string; prefix?: string }): Promise<string> =>
    fsp.mkdtemp(path.join(opts?.dir ?? os.tmpdir(), opts?.prefix ?? "")),
  makeTempDirSync: (opts?: { dir?: string; prefix?: string }): string =>
    fs.mkdtempSync(path.join(opts?.dir ?? os.tmpdir(), opts?.prefix ?? "")),
  makeTempFile: async (opts?: { dir?: string; prefix?: string; suffix?: string }): Promise<string> => {
    const dir = opts?.dir ?? os.tmpdir();
    const p = path.join(dir, `${opts?.prefix ?? ""}${crypto.randomUUID()}${opts?.suffix ?? ""}`);
    await fsp.writeFile(p, "");
    return p;
  },
  makeTempFileSync: (opts?: { dir?: string; prefix?: string; suffix?: string }): string => {
    const dir = opts?.dir ?? os.tmpdir();
    const p = path.join(dir, `${opts?.prefix ?? ""}${crypto.randomUUID()}${opts?.suffix ?? ""}`);
    fs.writeFileSync(p, "");
    return p;
  },

  stat: (p: string | URL) =>
    fsp.stat(p).then(toFileInfo).catch((e) => Promise.reject(remap(e))),
  statSync: (p: string | URL) => {
    try {
      return toFileInfo(fs.statSync(p));
    } catch (e) {
      throw remap(e);
    }
  },
  lstat: (p: string | URL) =>
    fsp.lstat(p).then(toFileInfo).catch((e) => Promise.reject(remap(e))),

  readDir: async function* (p: string | URL): AsyncIterable<DirEntry> {
    let ents: fs.Dirent[];
    try {
      ents = await fsp.readdir(p, { withFileTypes: true });
    } catch (e) {
      throw remap(e);
    }
    for (const e of ents) {
      yield { name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory(), isSymlink: e.isSymbolicLink() };
    }
  },

  copyFile: (from: string | URL, to: string | URL): Promise<void> => fsp.copyFile(from, to),
  rename: (from: string | URL, to: string | URL): Promise<void> => fsp.rename(from, to),
  symlink: (target: string | URL, p: string | URL): Promise<void> => fsp.symlink(target, p),
  chmod: (p: string | URL, mode: number): Promise<void> => fsp.chmod(p, mode),
  realPath: (p: string | URL): Promise<string> => fsp.realpath(p),

  Command: DenoCommand,
};

function toFileInfo(s: fs.Stats) {
  return {
    isFile: s.isFile(),
    isDirectory: s.isDirectory(),
    isSymlink: s.isSymbolicLink(),
    size: s.size,
    mtime: s.mtime,
    atime: s.atime,
    birthtime: s.birthtime,
    mode: s.mode,
  };
}

// Idempotent install: merge onto any pre-existing partial Deno (e.g. real Deno,
// or the test preload that adds Deno.test on top of this runtime).
const g = globalThis as unknown as { Deno?: Record<string, unknown> };
g.Deno = Object.assign({}, DenoCompat, g.Deno ?? {});

export {};
