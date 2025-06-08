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
  publishToClient(name: string, payload: unknown): Promise<unknown>;

  publishToClientPushNotification(
    name: string,
    payload: unknown,
  ): Promise<unknown>;
  publishToBackground(name: string, payload: unknown): Promise<unknown>;
  publishToUI(name: string, payload: unknown): Promise<unknown>;
  subscribe(name: string, handler: (payload: unknown) => void): () => void;
}

export interface TakosAssets {
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

const WORKER_SOURCE = `
import { createRequire, builtinModules } from "node:module";
// Use an absolute file path for Node compatibility
const baseRequire = createRequire("/tmp/takos-worker.js");
const require = (id) =>
  builtinModules.includes(id) && !id.startsWith("node:")
    ? baseRequire("node:" + id)
    : baseRequire(id);
globalThis.require = require;
let takosCallId = 0;
const takosCallbacks = new Map();
function setPath(root, path, fn) {
  let obj = root;
  for (let i = 0; i < path.length - 1; i++) {
    obj[path[i]] ??= {};
    obj = obj[path[i]];
  }
  obj[path[path.length - 1]] = fn;
}
function createTakos(paths) {
  const t = {};
  for (const p of paths) {
    setPath(t, p, (...args) => {
      return new Promise((resolve, reject) => {
        const id = ++takosCallId;
        takosCallbacks.set(id, { resolve, reject });
        self.postMessage({ type: 'takosCall', id, path: p, args });
      });
    });
  }
  return t;
}
let mod = null;
self.onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'init') {
    globalThis.takos = createTakos(d.takosPaths);
    const url = URL.createObjectURL(new Blob([d.code], { type: 'application/javascript' }));
    mod = await import(url);
    self.postMessage({ type: 'ready' });
  } else if (d.type === 'call') {
    try {
      const fn = mod[d.fnName];
      if (typeof fn !== 'function') throw new Error('function not found');
      const result = await fn(...d.args);
      self.postMessage({ type: 'result', id: d.id, result });
    } catch (err) {
      self.postMessage({ type: 'error', id: d.id, error: err.message });
    }
  } else if (d.type === 'takosResult') {
    const cb = takosCallbacks.get(d.id);
    if (!cb) return;
    takosCallbacks.delete(d.id);
    if ('error' in d) cb.reject(new Error(d.error));
    else cb.resolve(d.result);
  }
};
`;

export interface TakosOptions {
  fetch?: (url: string, options?: RequestInit) => Promise<Response>;
  kv?: Partial<TakosKV>;
  events?: Partial<TakosEvents>;
  assets?: Partial<TakosAssets>;
  activitypub?: Partial<TakosActivityPub>;
}

export class Takos {
  private opts: TakosOptions;
  constructor(opts: TakosOptions = {}) {
    this.opts = opts;
    if (opts.kv) Object.assign(this.kv, opts.kv);
    if (opts.events) Object.assign(this.events, opts.events);
    if (opts.assets) Object.assign(this.assets, opts.assets);
    if (opts.activitypub) Object.assign(this.activitypub, opts.activitypub);
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
    publishToClient: async (_name: string, _payload: unknown) => {},
    publishToClientPushNotification: async (
      _name: string,
      _payload: unknown,
    ) => {},
    publishToBackground: async (_name: string, _payload: unknown) => {},
    publishToUI: async (_name: string, _payload: unknown) => {},
    subscribe: (
      _name: string,
      _handler: (payload: unknown) => void,
    ): () => void => {
      return () => {};
    },
  };
  assets = {
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
}

const TAKOS_PATHS: string[][] = [
  ["fetch"],
  ["kv", "read"],
  ["kv", "write"],
  ["kv", "delete"],
  ["kv", "list"],
  ["events", "publish"],
  ["events", "publishToClient"],
  ["events", "publishToClientPushNotification"],
  ["events", "publishToBackground"],
  ["events", "publishToUI"],
  ["events", "subscribe"],
  ["assets", "read"],
  ["assets", "write"],
  ["assets", "delete"],
  ["assets", "list"],
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
          },
        },
      });
    } else {
      this.#worker = new Worker(url, { type: "module" });
    }
    // Revoke the blob URL after the worker has initialized to avoid
    // breaking module loading on slower environments.
    const revoke = () => URL.revokeObjectURL(url);
    this.#worker.addEventListener("message", revoke, { once: true });
    this.#takos = takos;
    this.#worker.onmessage = (e) => this.#onMessage(e);
    const wrapped = `const require = globalThis.require;\n${code}`;
    this.#worker.postMessage({
      type: "init",
      code: wrapped,
      takosPaths: TAKOS_PATHS,
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
    let target: any = this.#takos;
    for (const p of d.path) target = target?.[p];
    try {
      const result = await target(...d.args);
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
}

export class TakoPack {
  private packs = new Map<string, LoadedPack>();
  private takos: Takos;

  constructor(packs: UnpackedTakoPack[], options: TakosOptions = {}) {
    this.takos = new Takos(options);
    (globalThis as Record<string, unknown>).takos = this.takos;
    for (const p of packs) {
      const manifest = typeof p.manifest === "string"
        ? JSON.parse(p.manifest)
        : p.manifest;
      this.packs.set(manifest.identifier as string, {
        manifest,
        serverCode: p.server,
        clientCode: p.client,
        ui: p.ui,
      });
    }
  }

  async init(): Promise<void> {
    for (const pack of this.packs.values()) {
      if (pack.serverCode) {
        const perms = this.#extractPermissions(pack.manifest);
        pack.serverWorker = new PackWorker(
          pack.serverCode,
          this.takos,
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
        };
        pack.clientWorker = new PackWorker(
          pack.clientCode,
          this.takos,
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
    return await pack.serverWorker.call(fnName, args);
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
