export interface UnpackedTakoPack {
  manifest: string | Record<string, unknown>;
  server?: string;
  client?: string;
  ui?: string;
}

export interface TakosKV {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface TakosEvents {
  publish(name: string, payload: unknown): Promise<unknown>;
  subscribe(name: string, handler: (payload: unknown) => void): () => void;
}

export interface TakosCdn {
  read(path: string): Promise<string>;
  write(
    path: string,
    data: string | Uint8Array,
    options?: { cacheTTL?: number },
  ): Promise<string>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface TakosActivityPub {
  send(userId: string, activity: Record<string, unknown>): Promise<void>;
  read(id: string): Promise<Record<string, unknown>>;
  delete(id: string): Promise<void>;
  list(userId?: string): Promise<string[]>;
  actor: {
    read(userId: string): Promise<Record<string, unknown>>;
    update(userId: string, key: string, value: string): Promise<void>;
    delete(userId: string, key: string): Promise<void>;
  };
  follow(followerId: string, followeeId: string): Promise<void>;
  unfollow(followerId: string, followeeId: string): Promise<void>;
  listFollowers(actorId: string): Promise<string[]>;
  listFollowing(actorId: string): Promise<string[]>;
  pluginActor: {
    create(
      localName: string,
      profile: Record<string, unknown>,
    ): Promise<string>;
    read(iri: string): Promise<Record<string, unknown>>;
    update(iri: string, partial: Record<string, unknown>): Promise<void>;
    delete(iri: string): Promise<void>;
    list(): Promise<string[]>;
  };
}

export interface Extension {
  identifier: string;
  version: string;
  readonly isActive: boolean;
  activate(): Promise<unknown>;
}

export interface TakosExtensions {
  get(identifier: string): Extension | undefined;
  readonly all: Extension[];
}

const WORKER_SOURCE = `
import { createRequire, builtinModules } from "node:module";

import process from "node:process";
import { Buffer } from "node:buffer";
import { setImmediate } from "node:timers";
// Use an absolute file path for Node compatibility
const workerFilename = "/tmp/takos-worker.js";
const baseRequire = createRequire(workerFilename);
const require = (id) =>
  builtinModules.includes(id) && !id.startsWith("node:")
    ? baseRequire("node:" + id)
    : baseRequire(id);
globalThis.require = require;
globalThis.__filename = workerFilename;
globalThis.__dirname = "/tmp";
globalThis.global = globalThis;
globalThis.process = process;
globalThis.Buffer = Buffer;
globalThis.setImmediate = setImmediate;

let allowedPerms = {};
const permState = (name) => allowedPerms[name] ? "granted" : "denied";
Deno.permissions.query = async (desc) => ({ state: permState(desc.name) });
Deno.permissions.request = async (desc) => ({ state: permState(desc.name) });
Deno.permissions.revoke = async (desc) => ({ state: permState(desc.name) });

let takosCallId = 0;
const takosCallbacks = new Map();

function createExtension(desc) {
  return {
    identifier: desc.identifier,
    version: desc.version,
    get isActive() {
      return desc.isActive;
    },
    activate() {
      return new Promise((resolve, reject) => {
        const id = ++takosCallId;
        takosCallbacks.set(id, {
          resolve: (fns) => {
            const api = {};
            for (const fn of fns) {
              api[fn] = (...args) => {
                return new Promise((res, rej) => {
                  const callId = ++takosCallId;
                  takosCallbacks.set(callId, { resolve: res, reject: rej });
                  self.postMessage({
                    type: 'takosCall',
                    id: callId,
                    path: ['extensions', 'invoke'],
                    args: [desc.identifier, fn, args],
                  });
                });
              };
            }
            resolve(api);
          },
          reject,
        });
        self.postMessage({
          type: 'takosCall',
          id,
          path: ['extensions', 'activate'],
          args: [desc.identifier],
        });
      });
    },
  };
}

function setPath(root, path, fn, transform) {
  let obj = root;
  for (let i = 0; i < path.length - 1; i++) {
    obj[path[i]] ??= {};
    obj = obj[path[i]];
  }
  obj[path[path.length - 1]] = (...args) => {
    return fn(transform, args);
  };
}

function createTakos(paths, exts = []) {
  const t = {};
  const extMap = new Map(exts.map((e) => [e.identifier, e]));
  for (const p of paths) {
    let transform = null;
    if (p[0] === 'extensions' && p[1] === 'get') {
      transform = (d) => (d ? createExtension(d) : undefined);
    }
    setPath(
      t,
      p,
      (tr, args) => {
        return new Promise((resolve, reject) => {
          const id = ++takosCallId;
          takosCallbacks.set(id, { resolve, reject, transform: tr });
          self.postMessage({ type: 'takosCall', id, path: p, args });
        });
      },
      transform,
    );
  }
  t.extensions ??= {};
  t.extensions.all = exts.map(createExtension);
  t.extensions.get = (id) => {
    const desc = extMap.get(id);
    return desc ? createExtension(desc) : undefined;
  };
  return t;
}

let mod = null;
self.onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'init') {
    allowedPerms = d.allowedPermissions || {};
    globalThis.takos = createTakos(d.takosPaths, d.extensions || []);
    const url = URL.createObjectURL(new Blob([d.code], { type: 'application/javascript' }));
    mod = await import(url);
    self.postMessage({ type: 'ready' });
  } else if (d.type === 'call') {
    try {
      let target = mod;
      for (const part of d.fnName.split(".")) {
        target = target?.[part];
      }
      const fn = target;
      if (typeof fn !== "function") {
        const keys = Object.keys(mod).join(", ");
        throw new Error(\`function not found: \${d.fnName} (available: \${keys})\`);
      }
      const result = await fn(...d.args);
      self.postMessage({ type: 'result', id: d.id, result });
    } catch (err) {
      self.postMessage({ type: 'error', id: d.id, error: err.message });
    }
  } else if (d.type === 'takosResult') {
    const cb = takosCallbacks.get(d.id);
    if (!cb) return;
    takosCallbacks.delete(d.id);
    const result = cb.transform ? cb.transform(d.result) : d.result;
    if ('error' in d) cb.reject(new Error(d.error));
    else cb.resolve(result);
  }
};
`;

export interface TakosOptions {
  fetch?: (url: string, options?: RequestInit) => Promise<Response>;
  kv?: Partial<TakosKV>;
  events?: Partial<TakosEvents>;
  cdn?: Partial<TakosCdn>;
  activitypub?: Partial<TakosActivityPub>;
  ap?: Partial<TakosActivityPub>;
  extensions?: TakosExtensions;
}

export class Takos {
  private opts: TakosOptions;
  private extProvider?: {
    get(id: string): Extension | undefined;
    all: Extension[];
  };
  extensions: TakosExtensions;
  constructor(opts: TakosOptions = {}) {
    this.opts = opts;
    if (opts.kv) Object.assign(this.kv, opts.kv);
    if (opts.events) Object.assign(this.events, opts.events);
    if (opts.cdn) Object.assign(this.cdn, opts.cdn);
    if (opts.activitypub) Object.assign(this.activitypub, opts.activitypub);
    if (opts.ap) Object.assign(this.activitypub, opts.ap);
    if (opts.extensions) this.extProvider = opts.extensions;
    const self = this;
    this.extensions = {
      get(id: string) {
        return self.extProvider?.get(id);
      },
      get all() {
        return self.extProvider?.all ?? [];
      },
    };
  }
  activateExtension(id: string): Promise<unknown> {
    const ext = this.extProvider?.get(id);
    return ext ? ext.activate() : Promise.resolve(undefined);
  }
  setExtensionsProvider(
    p: { get(id: string): Extension | undefined; all: Extension[] },
  ) {
    this.extProvider = p;
  }
  fetch(url: string, options?: RequestInit): Promise<Response> {
    const fn = this.opts.fetch ?? fetch;
    return fn(url, options);
  }
  kv = {
    read: async (_key: string) => undefined as unknown,
    write: async (_key: string, _value: unknown) => {},
    delete: async (_key: string) => {},
    list: async () => [] as string[],
  };
  events = {
    publish: async (_name: string, _payload: unknown) => {},
    subscribe: (
      _name: string,
      _handler: (payload: unknown) => void,
    ): () => void => {
      return () => {};
    },
  };
  cdn = {
    read: async (_path: string) => "",
    write: async (
      _path: string,
      _data: string | Uint8Array,
      _options?: { cacheTTL?: number },
    ) => "",
    delete: async (_path: string) => {},
    list: async (_prefix?: string) => [] as string[],
  };
  activitypub = {
    send: async (_userId: string, _activity: Record<string, unknown>) => {},
    read: async (_id: string) => ({} as Record<string, unknown>),
    delete: async (_id: string) => {},
    list: async (_userId?: string) => [] as string[],
    actor: {
      read: async (_userId: string) => ({} as Record<string, unknown>),
      update: async (_userId: string, _key: string, _value: string) => {},
      delete: async (_userId: string, _key: string) => {},
    },
    follow: async (_followerId: string, _followeeId: string) => {},
    unfollow: async (_followerId: string, _followeeId: string) => {},
    listFollowers: async (_actorId: string) => [] as string[],
    listFollowing: async (_actorId: string) => [] as string[],
    pluginActor: {
      create: async (_localName: string, _profile: Record<string, unknown>) =>
        "",
      read: async (_iri: string) => ({} as Record<string, unknown>),
      update: async (_iri: string, _partial: Record<string, unknown>) => {},
      delete: async (_iri: string) => {},
      list: async () => [] as string[],
    },
  };
  get ap() {
    return this.activitypub;
  }
}

const TAKOS_PATHS: string[][] = [
  ["fetch"],
  ["kv", "read"],
  ["kv", "write"],
  ["kv", "delete"],
  ["kv", "list"],
  ["events", "publish"],
  ["events", "subscribe"],
  ["cdn", "read"],
  ["cdn", "write"],
  ["cdn", "delete"],
  ["cdn", "list"],
  ["activitypub", "send"],
  ["activitypub", "read"],
  ["activitypub", "delete"],
  ["activitypub", "list"],
  ["activitypub", "actor", "read"],
  ["activitypub", "actor", "update"],
  ["activitypub", "actor", "delete"],
  ["activitypub", "follow"],
  ["activitypub", "unfollow"],
  ["activitypub", "listFollowers"],
  ["activitypub", "listFollowing"],
  ["activitypub", "pluginActor", "create"],
  ["activitypub", "pluginActor", "read"],
  ["activitypub", "pluginActor", "update"],
  ["activitypub", "pluginActor", "delete"],
  ["activitypub", "pluginActor", "list"],
  ["ap", "send"],
  ["ap", "read"],
  ["ap", "delete"],
  ["ap", "list"],
  ["ap", "actor", "read"],
  ["ap", "actor", "update"],
  ["ap", "actor", "delete"],
  ["ap", "follow"],
  ["ap", "unfollow"],
  ["ap", "listFollowers"],
  ["ap", "listFollowing"],
  ["ap", "pluginActor", "create"],
  ["ap", "pluginActor", "read"],
  ["ap", "pluginActor", "update"],
  ["ap", "pluginActor", "delete"],
  ["ap", "pluginActor", "list"],
  ["extensions", "get"],
  ["extensions", "activate"],
  ["extensions", "invoke"],
];

class PackWorker {
  #worker: Worker;
  #ready: Promise<void>;
  #pending = new Map<number, (value: unknown) => void>();
  #takos: Takos;
  #callId = 0;
  constructor(
    code: string,
    takos: Takos,
    perms: Record<string, boolean>,
    useDeno = false,
  ) {
    const url = URL.createObjectURL(
      new Blob([WORKER_SOURCE], { type: "application/javascript" }),
    );
    if (useDeno) {
      this.#worker = new Worker(url, {
        type: "module",
        deno: {
          namespace: true,
          npm: true,
          permissions: {
            read: perms.read,
            write: perms.write,
            net: perms.net,
            env: perms.env,
            run: perms.run,
            sys: perms.sys,
            ffi: perms.ffi,
            hrtime: perms.hrtime,
          },
        },
      } as any);
    } else {
      this.#worker = new Worker(url, { type: "module" });
    }
    this.#worker.addEventListener("error", (e) => {
      const msg = (e as ErrorEvent).message ?? "unknown";
      console.error("PackWorker error:", msg);
      if ("preventDefault" in e) (e as ErrorEvent).preventDefault();
    });
    // Revoke the blob URL after the worker has initialized to avoid
    // breaking module loading on slower environments.
    const revoke = () => URL.revokeObjectURL(url);
    this.#worker.addEventListener("message", revoke, { once: true });
    this.#takos = takos;
    this.#worker.onmessage = (e) => this.#onMessage(e);
    const wrapped =
      `const require = globalThis.require;\nconst __filename = globalThis.__filename;\nconst __dirname = globalThis.__dirname;\n${code}`;
    this.#worker.postMessage({
      type: "init",
      code: wrapped,
      takosPaths: TAKOS_PATHS,
      allowedPermissions: perms,
      extensions: Array.from(takos.extensions.all, (e) => ({
        identifier: e.identifier,
        version: e.version,
        isActive: e.isActive,
      })),
    });
    this.#ready = new Promise((res) => {
      const handler = (ev: MessageEvent) => {
        if (ev.data && ev.data.type === "ready") {
          this.#worker.removeEventListener("message", handler);
          res();
        }
      };
      this.#worker.addEventListener("message", handler);
    });
  }
  #onMessage(ev: MessageEvent) {
    const d = ev.data;
    if (d.type === "result" || d.type === "error") {
      const cb = this.#pending.get(d.id);
      if (!cb) return;
      this.#pending.delete(d.id);
      if (d.type === "error") cb(Promise.reject(new Error(d.error)));
      else cb(d.result);
    } else if (d.type === "takosCall") {
      this.#handleTakosCall(d);
    }
  }
  async #handleTakosCall(d: { id: number; path: string[]; args: unknown[] }) {
    let ctx: any = this.#takos;
    let target: any = this.#takos;
    for (const p of d.path) {
      ctx = target;
      target = target?.[p];
    }
    try {
      let result;
      if (d.path[0] === "extensions" && d.path[1] === "activate") {
        const api = await this.#takos.activateExtension(d.args[0] as string);
        result = Object.keys(api as Record<string, unknown>);
      } else if (d.path[0] === "extensions" && d.path[1] === "invoke") {
        const [id, fnName, fnArgs] = d.args as [string, string, unknown[]];
        const api = await this.#takos.activateExtension(id);
        const fn = (api as Record<string, any>)[fnName];
        if (typeof fn !== "function") {
          throw new Error(`function not found: ${fnName}`);
        }
        result = await fn(...fnArgs);
      } else {
        if (typeof target === "function") {
          result = await target.apply(ctx, d.args);
        } else {
          result = target;
        }
      }
      if (d.path[0] === "extensions" && d.path[1] === "get") {
        result = result
          ? {
            identifier: (result as any).identifier,
            version: (result as any).version,
            isActive: (result as any).isActive,
          }
          : undefined;
      }
      this.#worker.postMessage({ type: "takosResult", id: d.id, result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.#worker.postMessage({
        type: "takosResult",
        id: d.id,
        error: message,
      });
    }
  }
  async call(fn: string, args: unknown[]): Promise<unknown> {
    await this.#ready;
    return new Promise((res, rej) => {
      const id = ++this.#callId;
      this.#pending.set(
        id,
        (v) => (v instanceof Promise ? v.then(res, rej) : res(v)),
      );
      this.#worker.postMessage({ type: "call", id, fnName: fn, args });
    });
  }
  terminate() {
    this.#worker.terminate();
  }
}
interface LoadedPack {
  manifest: Record<string, unknown>;
  serverCode?: string;
  clientCode?: string;
  ui?: string;
  serverWorker?: PackWorker;
  clientWorker?: PackWorker;
  activated?: Record<string, unknown>;
}

class RuntimeExtension implements Extension {
  #pack: LoadedPack;
  constructor(pack: LoadedPack) {
    this.#pack = pack;
  }
  get identifier() {
    return this.#pack.manifest.identifier as string;
  }
  get version() {
    return this.#pack.manifest.version as string;
  }
  get isActive() {
    return !!this.#pack.activated;
  }
  async activate(): Promise<unknown> {
    if (this.#pack.activated) return this.#pack.activated;
    const exportsList =
      Array.isArray((this.#pack.manifest as any)?.exports?.server)
        ? (this.#pack.manifest as any).exports.server as string[]
        : [];
    if (!this.#pack.serverWorker) {
      this.#pack.activated = {};
      return this.#pack.activated;
    }
    const api: Record<string, unknown> = {};
    for (const fn of exportsList) {
      api[fn] = (...args: unknown[]) => this.#pack.serverWorker!.call(fn, args);
    }
    this.#pack.activated = api;
    return api;
  }
}

export interface TakoPackInitOptions {
  server?: TakosOptions;
  client?: TakosOptions;
}

export class TakoPack {
  private packs = new Map<string, LoadedPack>();
  private serverTakos: Takos;
  private clientTakos: Takos;
  private extensions = new Map<string, RuntimeExtension>();

  constructor(
    packs: UnpackedTakoPack[],
    options: TakosOptions | TakoPackInitOptions = {},
  ) {
    const serverOpts = "server" in options || "client" in options
      ? (options as TakoPackInitOptions).server ?? {}
      : options as TakosOptions;
    const clientOpts = "server" in options || "client" in options
      ? (options as TakoPackInitOptions).client ?? {}
      : options as TakosOptions;
    this.serverTakos = new Takos(serverOpts);
    this.clientTakos = new Takos(clientOpts);
    (globalThis as Record<string, unknown>).takos = this.serverTakos;
    for (const p of packs) {
      const manifest = typeof p.manifest === "string"
        ? JSON.parse(p.manifest)
        : p.manifest;
      const loaded: LoadedPack = {
        manifest,
        serverCode: p.server,
        clientCode: p.client,
        ui: p.ui,
      };
      this.packs.set(manifest.identifier as string, loaded);
      this.extensions.set(
        manifest.identifier as string,
        new RuntimeExtension(loaded),
      );
    }
    const outer = this;
    const provider = {
      get(id: string) {
        return outer.extensions.get(id);
      },
      get all(): Extension[] {
        return Array.from(outer.extensions.values());
      },
    };
    this.serverTakos.setExtensionsProvider(provider);
    this.clientTakos.setExtensionsProvider(provider);
  }

  async init(): Promise<void> {
    for (const pack of this.packs.values()) {
      if (pack.serverCode) {
        const perms = this.#extractPermissions(pack.manifest);
        pack.serverWorker = new PackWorker(
          pack.serverCode,
          this.serverTakos,
          perms,
          true,
        );
      }
      if (pack.clientCode) {
        const perms: Record<string, boolean> = {
          read: false,
          write: false,
          net: false,
          env: false,
          run: false,
          sys: false,
          ffi: false,
          hrtime: false,
        };
        pack.clientWorker = new PackWorker(
          pack.clientCode,
          this.clientTakos,
          perms,
          false,
        );
      }
    }
  }

  async callServer(
    identifier: string,
    fnName: string,
    args: unknown[] = [],
  ): Promise<unknown> {
    const pack = this.packs.get(identifier);
    if (!pack) throw new Error(`pack not found: ${identifier}`);
    if (!pack.serverWorker) {
      throw new Error(`server not loaded for ${identifier}`);
    }
    const defs = (pack.manifest as Record<string, any>).eventDefinitions as
      | Record<string, { handler?: string }>
      | undefined;
    const def = defs?.[fnName];
    if (defs && !def) {
      throw new Error(
        `event not defined: ${fnName} in manifest.eventDefinitions for ${identifier}`,
      );
    }
    const callName = def?.handler || fnName;
    try {
      return await pack.serverWorker.call(callName, args);
    } catch (err) {
      if (err instanceof Error && err.message.includes("function not found")) {
        const m = err.message.match(/available: ([^)]*)/);
        if (m) {
          const prefixes = m[1].split(/,\s*/);
          const attempts = [] as string[];
          for (const prefix of prefixes) {
            attempts.push(`${prefix}.${callName}`);
            if (!def) {
              const cap = callName.charAt(0).toUpperCase() + callName.slice(1);
              attempts.push(`${prefix}.on${cap}`);
            }
          }
          for (const name of attempts) {
            try {
              return await pack.serverWorker.call(name, args);
            } catch {
              // ignore and continue trying
            }
          }
        }
      }
      throw err;
    }
  }

  #extractPermissions(
    manifest: Record<string, unknown>,
  ): Record<string, boolean> {
    const perms: Record<string, boolean> = {
      read: false,
      write: false,
      net: false,
      env: false,
      run: false,
      sys: false,
      ffi: false,
      hrtime: false,
    };
    const list = Array.isArray(manifest.permissions)
      ? manifest.permissions
      : [];
    for (const p of list) {
      if (typeof p !== "string") continue;
      if (!p.startsWith("deno:")) continue;
      const name = p.slice(5);
      if (name in perms) perms[name] = true;
    }
    return perms;
  }
}
