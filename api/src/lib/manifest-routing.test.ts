import { afterEach, describe, expect, it } from "vitest";
import { AppHandlerRegistry, type AppManifest } from "@takos/platform/app";
import {
  clearManifestRouterCache,
  createManifestRouter,
  isManifestRoutingEnabled,
  matchesManifestRoute,
  loadActiveAppManifest,
  resolveManifestRouter,
  setActiveManifestLoader,
} from "./manifest-routing";
import { setBackendDataFactory, getDefaultDataFactory } from "../data";
import { setAppScriptLoader } from "./app-script-loader";
import { createIsolatedAppRunner } from "./app-worker-loader";
import appRpcRoutes from "../routes/app-rpc";

const createMockD1 = () => {
  const tables = new Map<string, Map<string, any>>();

  const getTable = (sql: string): string | null => {
    const match =
      sql.match(/FROM\s+"([^"]+)"/i) ??
      sql.match(/INTO\s+"([^"]+)"/i) ??
      sql.match(/UPDATE\s+"([^"]+)"/i) ??
      sql.match(/TABLE IF NOT EXISTS\s+"([^"]+)"/i);
    return match?.[1] ?? null;
  };

  const db: any = {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
      const table = getTable(sql);
      let bound: any[] = [];
      const stmt: any = {
        bind: (...args: any[]) => {
          bound = args;
          return stmt;
        },
        run: async () => {
          if (normalized.startsWith("CREATE TABLE IF NOT EXISTS")) {
            if (table && !tables.has(table)) tables.set(table, new Map());
            return { success: true };
          }
          if (normalized.startsWith("INSERT INTO")) {
            if (!table) throw new Error("missing table");
            if (!tables.has(table)) tables.set(table, new Map());
            const [id, data, createdAt, updatedAt] = bound;
            tables.get(table)!.set(String(id), {
              id: String(id),
              data,
              created_at: createdAt,
              updated_at: updatedAt,
            });
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unsupported SQL for run(): ${sql}`);
        },
        all: async () => {
          if (!table) throw new Error("missing table");
          const store = tables.get(table) ?? new Map();
          if (normalized.startsWith("SELECT \"ID\", \"DATA\"")) {
            return { results: Array.from(store.values()) };
          }
          throw new Error(`Unsupported SQL for all(): ${sql}`);
        },
        first: async () => null,
      };
      return stmt;
    },
  };

  return db;
};

const baseManifest: Omit<AppManifest, "routes"> = {
  schemaVersion: "1.0",
  version: "1.0.0",
  views: { screens: [], insert: [] },
  ap: { handlers: [] },
  data: { collections: {} },
  storage: { buckets: {} },
};

const noopAuth = async (_c: any, next: () => Promise<void>) => next();

const encodeDataUrl = (code: string): string =>
  `data:application/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;

const collectExportedHandlers = (module: Record<string, unknown>): Map<string, any> => {
  const handlers = new Map<string, any>();
  const register = (key: string, value: unknown) => {
    const name = typeof key === "string" ? key.trim() : "";
    if (!name) return;
    if (typeof value !== "function") return;
    if (handlers.has(name) && handlers.get(name) !== value) {
      throw new Error(`Duplicate app handler "${name}"`);
    }
    handlers.set(name, value);
  };

  for (const [key, value] of Object.entries(module)) {
    if (key === "default" || key === "__esModule") continue;
    register(key, value);
  }
  const defaultExport = (module as any).default;
  if (defaultExport && typeof defaultExport === "object" && !Array.isArray(defaultExport)) {
    for (const [key, value] of Object.entries(defaultExport as Record<string, unknown>)) {
      register(key, value);
    }
  }
  return handlers;
};

const createMockWorkerLoader = () => {
  return {
    get: (_id: string, getCode: () => Promise<any>) => {
      let cached: { handlers: Map<string, any>; env: any } | null = null;
      return {
        getEntrypoint: () => ({
          fetch: async (request: Request) => {
            if (!cached) {
              const code = await getCode();
              const appMain = code?.modules?.["app-main.js"]?.js ?? code?.modules?.["app-main.js"];
              const env = code?.env ?? {};
              const mod = (await import(encodeDataUrl(String(appMain)))) as any;
              cached = { handlers: collectExportedHandlers(mod), env };
            }

            const payload = (await request.json().catch(() => null)) as any;
            if (!payload || typeof payload !== "object") {
              return new Response(JSON.stringify({ ok: false, error: { message: "invalid payload" } }), {
                status: 400,
                headers: { "content-type": "application/json" },
              });
            }

            const rpc = async (core: any, token: string, body: any) => {
              const res = await core.fetch(
                new Request("http://takos.internal/-/internal/app-rpc", {
                  method: "POST",
                  headers: { "content-type": "application/json", "x-takos-app-rpc-token": token },
                  body: JSON.stringify(body),
                }),
              );
              const json = await res.json();
              if (!json?.ok) {
                throw new Error(json?.error?.message ?? `rpc failed (${res.status})`);
              }
              return json.result;
            };

            const logs: any[] = [];
            const runId = payload.context?.runId ?? "run_test";
            const mode = payload.context?.mode ?? "prod";
            const workspaceId = payload.context?.workspaceId;
            const handlerName = payload.handler;
            const ctx: any = {
              mode,
              workspaceId,
              runId,
              handler: handlerName,
              auth: payload.context?.auth ?? null,
              log: (level: string, message: string, data?: any) =>
                logs.push({
                  timestamp: new Date().toISOString(),
                  mode,
                  workspaceId,
                  runId,
                  handler: handlerName,
                  level,
                  message,
                  data,
                }),
              json: (body: any, init: any = {}) => ({ type: "json", status: init?.status ?? 200, body }),
              error: (message: string, init: any = 400) => ({
                type: "error",
                status: typeof init === "number" ? init : init?.status ?? 400,
                message,
              }),
              redirect: (location: string, init: any = 302) => ({
                type: "redirect",
                status: typeof init === "number" ? init : init?.status ?? 302,
                location,
              }),
              db: (collection: string) =>
                new Proxy(
                  {},
                  {
                    get(_t, prop) {
                      if (prop === "then") return undefined;
                      const method = typeof prop === "string" ? prop : "";
                      if (!method) return undefined;
                      return async (...args: any[]) =>
                        rpc(cached!.env.TAKOS_CORE, cached!.env.TAKOS_APP_RPC_TOKEN, {
                          kind: "db",
                          collection,
                          method,
                          args,
                          workspaceId: workspaceId ?? null,
                          mode,
                        });
                    },
                  },
                ),
              storage: (bucket: string) => ({
                put: async (key: string, body: any, options: any = {}) => {
                  const encoded =
                    typeof body === "string"
                      ? { encoding: "utf8", data: body }
                      : body && typeof body.encoding === "string"
                        ? body
                        : { encoding: "utf8", data: String(body ?? "") };
                  return rpc(cached!.env.TAKOS_CORE, cached!.env.TAKOS_APP_RPC_TOKEN, {
                    kind: "storage",
                    bucket,
                    method: "put",
                    args: [key, encoded, options],
                    workspaceId: workspaceId ?? null,
                    userId: payload.context?.auth?.userId ?? null,
                    mode,
                  });
                },
                getText: async (key: string) =>
                  rpc(cached!.env.TAKOS_CORE, cached!.env.TAKOS_APP_RPC_TOKEN, {
                    kind: "storage",
                    bucket,
                    method: "getText",
                    args: [key],
                    workspaceId: workspaceId ?? null,
                    userId: payload.context?.auth?.userId ?? null,
                    mode,
                  }),
              }),
              services: new Proxy(
                () => {},
                {
                  get(_t, prop) {
                    if (prop === "then") return undefined;
                    const key = typeof prop === "string" ? prop : "";
                    if (!key) return undefined;
                    return new Proxy(
                      () => {},
                      {
                        get(_t2, prop2) {
                          if (prop2 === "then") return undefined;
                          const key2 = typeof prop2 === "string" ? prop2 : "";
                          if (!key2) return undefined;
                          return (...args: any[]) =>
                            rpc(cached!.env.TAKOS_CORE, cached!.env.TAKOS_APP_RPC_TOKEN, {
                              kind: "services",
                              path: [key, key2],
                              args,
                            });
                        },
                      },
                    );
                  },
                },
              ),
            };

            const dbImpl = ctx.db;
            ctx.db = (collection: string) => {
              const normalized = typeof collection === "string" ? collection.trim() : "";
              if (!normalized.startsWith("app:")) {
                throw new Error(
                  `Collection name must start with "app:" prefix. Got: "${normalized}". ` +
                    `Core tables cannot be accessed directly via ctx.db(). Use ctx.services instead.`,
                );
              }
              return dbImpl(normalized);
            };

            const storageImpl = ctx.storage;
            ctx.storage = (bucket: string) => {
              const normalized = typeof bucket === "string" ? bucket.trim() : "";
              if (!normalized.startsWith("app:")) {
                throw new Error(
                  `Storage bucket name must start with "app:" prefix. Got: "${normalized}". ` +
                    `Core storage cannot be accessed directly via ctx.storage().`,
                );
              }
              return storageImpl(normalized);
            };

            if (payload.action === "list") {
              return new Response(
                JSON.stringify({ ok: true, handlers: Array.from(cached.handlers.keys()).sort() }),
                { status: 200, headers: { "content-type": "application/json" } },
              );
            }

            if (payload.action !== "invoke") {
              return new Response(JSON.stringify({ ok: false, error: { message: "unknown action" } }), {
                status: 400,
                headers: { "content-type": "application/json" },
              });
            }

            const fn = cached.handlers.get(handlerName);
            if (!fn) {
              return new Response(
                JSON.stringify({
                  ok: false,
                  runId,
                  error: { message: `Unknown app handler "${handlerName}"` },
                  logs,
                }),
                { status: 404, headers: { "content-type": "application/json" } },
              );
            }
            try {
              const output = await fn(ctx, payload.input);
              const response =
                output && typeof output === "object" && typeof output.type === "string" ? output : ctx.json(output);
              return new Response(JSON.stringify({ ok: true, runId, response, logs }), {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error ?? "unknown");
              return new Response(JSON.stringify({ ok: false, runId, error: { message }, logs }), {
                status: 500,
                headers: { "content-type": "application/json" },
              });
            }
          },
        }),
      };
    },
  } as any;
};

const createMockKv = () => {
  const store = new Map<string, string>();
  return {
    get: async (key: string, type?: "text") => {
      const value = store.get(key) ?? null;
      if (!value) return null;
      if (type === "text") return value;
      return value;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async ({ prefix }: { prefix: string; cursor?: string }) => {
      const keys = Array.from(store.keys())
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys };
    },
  };
};

afterEach(() => {
  clearManifestRouterCache();
  setBackendDataFactory(getDefaultDataFactory());
  setAppScriptLoader(null);
  setActiveManifestLoader(null);
});

describe("manifest routing", () => {
  it("resolves handlers from the App Script registry", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
    };
    const registry = AppHandlerRegistry.fromModule({
      hello: (c: any) => c.json({ ok: true }),
    });
    const scriptCode = `export const hello = (ctx) => ctx.json({ ok: true });`;

    const router = createManifestRouter({
      manifest,
      registry,
      revisionId: "rev_test",
      source: "test",
      scriptCode,
    });

    const env: any = {
      DB: createMockD1(),
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const response = await router.app.fetch(new Request("https://example.test/hello"), env, {} as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(matchesManifestRoute(router, "GET", "/hello")).toBe(true);
    expect(matchesManifestRoute(router, "POST", "/hello")).toBe(false);
  });

  it("matches embedded path params when checking manifest routing", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [{ id: "tag", method: "GET", path: "/tag/@:name", handler: "tag" }],
    };
    const registry = AppHandlerRegistry.fromModule({
      tag: (c: any) => c.json({ ok: true }),
    });
    const scriptCode = `export const tag = (ctx) => ctx.json({ ok: true });`;

    const router = createManifestRouter({
      manifest,
      registry,
      revisionId: "rev_embed_param",
      source: "test",
      scriptCode,
    });

    expect(matchesManifestRoute(router, "GET", "/tag/@alice")).toBe(true);
  });

  it("never routes manifest handlers for core paths", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [{ id: "actor_override", method: "GET", path: "/@alice", handler: "noop" }],
    };
    const registry = AppHandlerRegistry.fromModule({
      noop: (c: any) => c.json({ ok: true }),
    });
    const scriptCode = `export const noop = (ctx) => ctx.json({ ok: true });`;

    const router = createManifestRouter({
      manifest,
      registry,
      revisionId: "rev_core_block",
      source: "test",
      scriptCode,
    });

    expect(matchesManifestRoute(router, "GET", "/@alice")).toBe(false);
  });

  it("invokes auth middleware for protected routes", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [
        { id: "secure", method: "GET", path: "/secure", handler: "secure", auth: true },
      ],
    };
    const registry = AppHandlerRegistry.fromModule({
      secure: (ctx: any) => ctx.json({ authed: !!ctx.auth?.userId }),
    });

    let authCalls = 0;
    const authMiddleware = async (c: any, next: () => Promise<void>) => {
      authCalls += 1;
      c.set("user", { id: "user-1" });
      await next();
    };

    const router = createManifestRouter({
      manifest,
      registry,
      authMiddleware,
      revisionId: "rev_auth",
      source: "test",
      scriptCode: `export const secure = (ctx) => ctx.json({ authed: !!ctx.auth?.userId });`,
    });

    const env: any = {
      DB: createMockD1(),
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const response = await router.app.fetch(new Request("https://example.test/secure"), env, {} as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authed: true });
    expect(authCalls).toBe(1);
    expect(matchesManifestRoute(router, "GET", "/secure")).toBe(true);
  });

  it("provides ctx.db(app:*) for manifest handlers (Collection API)", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [{ id: "db", method: "GET", path: "/db", handler: "db" }],
    };
    const registry = AppHandlerRegistry.fromModule({
      db: async (ctx: any) => {
        const notes = ctx.db("app:notes");
        const created = await notes.create({ title: "hello" });
        return ctx.json({ id: created.id, title: created.title });
      },
    });
    const scriptCode = `
      export const db = async (ctx) => {
        const notes = ctx.db("app:notes");
        const created = await notes.create({ title: "hello" });
        return ctx.json({ id: created.id, title: created.title });
      };
    `;

    const router = createManifestRouter({
      manifest,
      registry,
      revisionId: "rev_db",
      source: "test",
      scriptCode,
    });

    const env: any = {
      DB: createMockD1(),
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const execCtx: any = { waitUntil: () => {}, passThroughOnException: () => {} };
    const res = await router.app.fetch(new Request("https://example.test/db"), env, execCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ title: "hello" });
    expect(typeof body.id).toBe("string");
  });

  it("rejects ctx.db() outside app:* namespace in isolated runner", async () => {
    clearManifestRouterCache();
    const scriptCode = `
      export const db = async (ctx) => {
        ctx.db("core:notes");
        return ctx.json({ ok: true });
      };
    `;

    const env: any = {
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const runner = await createIsolatedAppRunner({ env, scriptCode });
    const invoked = await runner.invoke("db", null, { mode: "prod", auth: null, runId: undefined });
    expect(invoked.ok).toBe(false);
    if (!invoked.ok) {
      expect(invoked.error.message).toMatch(/Collection name must start with "app:"/);
    }
  });

  it("provides ctx.storage(app:*) for isolated runner (KV-backed)", async () => {
    clearManifestRouterCache();
    const scriptCode = `
      export const writeRead = async (ctx) => {
        const bucket = ctx.storage("app:assets");
        await bucket.put("hello.txt", "hello", { contentType: "text/plain" });
        const text = await bucket.getText("hello.txt");
        return ctx.json({ text });
      };
    `;

    const env: any = {
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
      APP_STATE: createMockKv(),
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const runner = await createIsolatedAppRunner({ env, scriptCode });
    const invoked = await runner.invoke("writeRead", null, { mode: "prod", auth: null, runId: undefined });
    if (!invoked.ok) {
      throw new Error(invoked.error?.message ?? "invoke failed");
    }
    expect((invoked.response as any).body).toMatchObject({ text: "hello" });
  });

  it("honors the opt-in flag from environment variables", () => {
    expect(isManifestRoutingEnabled({ APP_ROUTES_FROM_MANIFEST: "1" })).toBe(true);
    expect(isManifestRoutingEnabled({ USE_APP_MANIFEST_ROUTES: "true" })).toBe(true);
    expect(isManifestRoutingEnabled({ APP_ROUTES_FROM_MANIFEST: "off" })).toBe(false);
  });

  it("refuses to mount when app script contains dangerous patterns", async () => {
    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_danger",
            revision: {
              id: "rev_danger",
              schema_version: "1.0",
              manifest_snapshot: JSON.stringify({
                ...baseManifest,
                routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
              }),
              script_snapshot_ref: "inline:danger",
            },
          }),
        }) as any,
    );
    setAppScriptLoader(async () => ({
      module: { hello: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "test-inline",
      code: 'export const hello = (ctx) => { eval("1"); return ctx.json({ ok: true }); };',
    }));

    const env: any = {
      DB: createMockD1(),
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const loaded = await loadActiveAppManifest(env, { loadScript: true, validateHandlers: true });
    expect(loaded.ok).toBe(false);
    expect(loaded.issues.some((issue) => issue.severity === "error" && /eval/i.test(issue.message))).toBe(true);
  });

  it("allows dangerous patterns in dev when explicitly enabled", async () => {
    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_danger_dev",
            revision: {
              id: "rev_danger_dev",
              schema_version: "1.0",
              manifest_snapshot: JSON.stringify({
                ...baseManifest,
                routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
              }),
              script_snapshot_ref: "inline:danger",
            },
          }),
        }) as any,
    );
    setAppScriptLoader(async () => ({
      module: { hello: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "test-inline",
      code: 'export const hello = (ctx) => { eval("1"); return ctx.json({ ok: true }); };',
    }));

    const env: any = {
      TAKOS_CONTEXT: "dev",
      ALLOW_DANGEROUS_APP_PATTERNS: "1",
      DB: createMockD1(),
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };

    const loaded = await loadActiveAppManifest(env, { loadScript: true, validateHandlers: true });
    expect(loaded.ok).toBe(true);
    expect(loaded.issues.some((issue) => issue.severity === "error" && /eval/i.test(issue.message))).toBe(false);
  });

  it("refuses to mount when app script imports a disallowed module", async () => {
    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_disallowed_import",
            revision: {
              id: "rev_disallowed_import",
              schema_version: "1.0",
              manifest_snapshot: JSON.stringify({
                ...baseManifest,
                routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
              }),
              script_snapshot_ref: "inline:danger",
            },
          }),
        }) as any,
    );
    setAppScriptLoader(async () => ({
      module: { hello: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "test-inline",
      code: 'import "fs"; export const hello = (ctx) => ctx.json({ ok: true });',
    }));

    const env: any = {
      DB: createMockD1(),
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const loaded = await loadActiveAppManifest(env, { loadScript: true, validateHandlers: true });
    expect(loaded.ok).toBe(false);
    expect(loaded.issues.some((issue) => issue.severity === "error" && /Disallowed import/i.test(issue.message))).toBe(true);
  });

  it("refuses to mount when manifest validation fails", async () => {
    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_invalid",
            revision: {
              id: "rev_invalid",
              schema_version: "1.0",
              manifest_snapshot: JSON.stringify({
                ...baseManifest,
                routes: [{ id: "login_override", method: "GET", path: "/login", handler: "noop" }],
              }),
              script_snapshot_ref: "inline:noop",
            },
          }),
        }) as any,
    );
    setAppScriptLoader(async () => ({
      module: { noop: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "test-inline",
      code: `export const noop = (ctx) => ctx.json({ ok: true });`,
    }));

    const env: any = {
      DB: createMockD1(),
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const router = await resolveManifestRouter(env, noopAuth as any);
    expect(router).toBeNull();
  });

  it("mounts when active revision and handlers are valid", async () => {
    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_ok",
            revision: {
              id: "rev_ok",
              schema_version: "1.0",
              manifest_snapshot: JSON.stringify({
                ...baseManifest,
                routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
              }),
              script_snapshot_ref: "inline:hello",
            },
          }),
        }) as any,
    );
    setAppScriptLoader(async () => ({
      module: { hello: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "test-inline",
      code: `export const hello = (ctx) => ctx.json({ ok: true });`,
    }));

    const env: any = {
      DB: createMockD1(),
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const router = await resolveManifestRouter(env, noopAuth as any);
    expect(router).not.toBeNull();
    const res = await router!.app.fetch(new Request("https://example.test/hello"), env, {} as any);
    expect(res.status).toBe(200);
  });

  it("loads manifest snapshot from manifest_snapshot_ref stored in R2/VFS", async () => {
    const manifest: AppManifest = {
      ...baseManifest,
      schemaVersion: "1.10",
      routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
    };

    const bucket = {
      async get(key: string) {
        if (key === "manifests/prod.json") {
          return { text: async () => JSON.stringify(manifest) };
        }
        return null;
      },
      async list() {
        return { objects: [] };
      },
    };

    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_r2",
            revision: {
              id: "rev_r2",
              schema_version: "1.10",
              manifest_snapshot_ref: "r2:manifests/prod.json",
              script_snapshot_ref: "inline:hello",
            },
          }),
        }) as any,
    );
    setAppScriptLoader(async () => ({
      module: { hello: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "test-inline",
      code: `export const hello = (ctx) => ctx.json({ ok: true });`,
    }));

    const env: any = {
      DB: createMockD1(),
      APP_MANIFESTS: bucket,
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const router = await resolveManifestRouter(env, noopAuth as any);
    expect(router).not.toBeNull();
    expect(router?.source).toBe("r2:manifests/prod.json");
    const res = await router!.app.fetch(new Request("https://example.test/hello"), env, {} as any);
    expect(res.status).toBe(200);
  });

  it("supports custom manifest loader for child worker/RPC scenarios", async () => {
    const manifest: AppManifest = {
      ...baseManifest,
      schemaVersion: "1.10",
      routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
    };

    setActiveManifestLoader(async () => ({
      snapshot: {
        revisionId: "rev_custom",
        manifest,
        source: "rpc",
        scriptRef: "inline:hello",
      },
      issues: [],
    }));
    setAppScriptLoader(async () => ({
      module: { hello: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "custom-inline",
      code: `export const hello = (ctx) => ctx.json({ ok: true });`,
    }));

    const env: any = {
      DB: createMockD1(),
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };
    const router = await resolveManifestRouter(env, noopAuth as any);
    expect(router).not.toBeNull();
    expect(router?.revisionId).toBe("rev_custom");
    expect(router?.source).toBe("rpc");
  });
});
