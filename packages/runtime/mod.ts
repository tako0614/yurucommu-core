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
  publishToBackground(name: string, payload: unknown): Promise<unknown>;
  publishToUI(name: string, payload: unknown): Promise<unknown>;
  subscribe(name: string, handler: (payload: unknown) => void): () => void;
}

export interface TakosAssets {
  read(path: string): Promise<string>;
  write(path: string, data: string | Uint8Array): Promise<string>;
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
    publishToBackground: async (_name: string, _payload: unknown) => {},
    publishToUI: async (_name: string, _payload: unknown) => {},
    subscribe: (_name: string, _handler: (payload: unknown) => void) => {
      return () => {};
    },
  };
  assets = {
    read: async (_path: string) => "",
    write: async (_path: string, _data: string | Uint8Array) => "",
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

interface LoadedPack {
  manifest: Record<string, unknown>;
  serverCode?: string;
  clientCode?: string;
  ui?: string;
  server?: Record<string, unknown>;
  client?: Record<string, unknown>;
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
        pack.server = await this.importModule(pack.serverCode);
      }
      if (pack.clientCode) {
        pack.client = await this.importModule(pack.clientCode);
      }
    }
  }

  private async importModule(code: string): Promise<Record<string, unknown>> {
    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      const mod = await import(url);
      return mod as Record<string, unknown>;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async callServer(
    identifier: string,
    fnName: string,
    args: unknown[] = [],
  ): Promise<unknown> {
    const pack = this.packs.get(identifier);
    if (!pack) throw new Error(`pack not found: ${identifier}`);
    if (!pack.server) throw new Error(`server not loaded for ${identifier}`);
    const fn = (pack.server as Record<string, unknown>)[fnName];
    if (typeof fn !== "function") {
      throw new Error(`function ${fnName} not found in ${identifier}`);
    }
    // deno-lint-ignore no-explicit-any
    return await (fn as any)(...args);
  }
}
