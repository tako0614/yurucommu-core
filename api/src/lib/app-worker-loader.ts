import type { AppAuthContext, AppLogEntry, AppResponse } from "@takos/platform/app/runtime/types";

type WorkerLoaderBinding = {
  get: (
    id: string,
    getCode: () => Promise<{
      compatibilityDate: string;
      mainModule: string;
      modules: Record<string, string | { js: string }>;
      env?: Record<string, unknown>;
      globalOutbound?: null;
    }>,
  ) => {
    getEntrypoint: () => { fetch: (request: Request | string, init?: RequestInit) => Promise<Response> };
  };
};

type IsolatedRunnerEnv = {
  LOADER?: WorkerLoaderBinding;
  TAKOS_CORE?: { fetch: (request: Request | string, init?: RequestInit) => Promise<Response> };
  TAKOS_APP_RPC_TOKEN?: string;
};

type InvokePayload = {
  action: "invoke";
  handler: string;
  input?: unknown;
  context?: {
    mode?: "dev" | "prod";
    workspaceId?: string;
    runId?: string;
    auth?: AppAuthContext | null;
  };
};

type InvokeResult =
  | {
      ok: true;
      runId: string;
      response: AppResponse;
      logs: AppLogEntry[];
    }
  | {
      ok: false;
      runId: string;
      error: { message: string; code?: string; stack?: string };
      logs: AppLogEntry[];
    };

type ListPayload = { action: "list" };
type ListResult = { ok: true; handlers: string[] };

const textEncoder = new TextEncoder();

const RUNNER_VERSION = 1;
const RUNNER_MAIN = "runner.js";
const APP_MAIN = "app-main.js";
const COMPATIBILITY_DATE = "2025-09-10";

const runnerSource = `// takos isolated app runner (v${RUNNER_VERSION})
const normalizeHandlerName = (name) => (typeof name === "string" ? name.trim() : "");

let __ENV = null;

const assertModuleObject = (module) => {
  if (!module || typeof module !== "object" || Array.isArray(module)) {
    throw new Error("App Script module must export an object");
  }
  return module;
};

const collectExportedHandlers = (module) => {
  const normalizedModule = assertModuleObject(module);
  const handlers = new Map();

  const register = (key, value) => {
    const name = normalizeHandlerName(key);
    if (!name) return;
    if (typeof value !== "function") return;
    const existing = handlers.get(name);
    if (existing) {
      if (existing === value) return;
      throw new Error(\`Duplicate app handler "\${name}" found in app-main exports\`);
    }
    handlers.set(name, value);
  };

  for (const [key, value] of Object.entries(normalizedModule)) {
    if (key === "default" || key === "__esModule") continue;
    register(key, value);
  }

  const defaultExport = normalizedModule.default;
  if (defaultExport && typeof defaultExport === "object" && !Array.isArray(defaultExport)) {
    for (const [key, value] of Object.entries(defaultExport)) {
      register(key, value);
    }
  }

  return handlers;
};

const createRunId = () => {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return \`run_\${Math.random().toString(36).slice(2, 10)}\`;
};

const createTakosContextLite = (options) => {
  const env = __ENV || {};
  const mode = options?.mode === "dev" ? "dev" : "prod";
  const workspaceId = mode === "dev" ? options?.workspaceId : undefined;
  const runId = options?.runId || createRunId();
  const handler = options?.handlerName;
  const auth = options?.auth ?? null;
  const userId = auth && typeof auth === "object" && typeof auth.userId === "string" ? auth.userId : null;
  const logs = [];
  const log = (level, message, data) => {
    logs.push({
      timestamp: new Date().toISOString(),
      mode,
      workspaceId,
      runId,
      handler,
      level,
      message,
      data,
    });
  };

  const parseInit = (init, fallback) => {
    if (typeof init === "number") return { status: init > 0 ? Math.trunc(init) : fallback };
    const status = typeof init?.status === "number" && init.status > 0 ? Math.trunc(init.status) : fallback;
    const headers = init?.headers ? { ...init.headers } : undefined;
    return { status, headers };
  };

  const json = (body, init = {}) => {
    const parsed = parseInit(init, 200);
    return { type: "json", status: parsed.status, headers: parsed.headers, body };
  };
  const error = (message, init = 400) => {
    const parsed = parseInit(init, 400);
    return { type: "error", status: parsed.status, headers: parsed.headers, message: String(message ?? "") };
  };
  const redirect = (location, init = 302) => {
    const parsed = parseInit(init, 302);
    const target = location?.toString?.().trim?.() ?? "";
    if (!target) throw new Error("redirect location is required");
    return { type: "redirect", status: parsed.status, headers: parsed.headers, location: target };
  };

  const missing = (kind) => () => {
    throw new Error(\`App \${kind} bindings are not available in isolated mode\`);
  };

  const rpcToken = typeof env?.TAKOS_APP_RPC_TOKEN === "string" ? env.TAKOS_APP_RPC_TOKEN : "";
  const core = env?.TAKOS_CORE;
  const rpc = async (payload) => {
    if (!core || typeof core.fetch !== "function") {
      throw new Error("TAKOS_CORE service binding is not available");
    }
    if (!rpcToken) {
      throw new Error("TAKOS_APP_RPC_TOKEN is not configured");
    }
    const res = await core.fetch(
      new Request("http://takos.internal/-/internal/app-rpc", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-takos-app-rpc-token": rpcToken,
        },
        body: JSON.stringify(payload),
      }),
    );
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== "object" || body.ok !== true) {
      const message = body?.error?.message || \`RPC failed (status \${res.status})\`;
      throw new Error(message);
    }
    return body.result;
  };

  const createDbProxy = (collectionName) =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return undefined;
          const method = typeof prop === "string" ? prop : "";
          if (!method) return undefined;
          return async (...args) =>
            rpc({
              kind: "db",
              collection: collectionName,
              method,
              args,
              workspaceId,
              mode,
            });
        },
      },
    );

  const normalizeStorageKey = (value) => {
    const raw = typeof value === "string" ? value : "";
    const trimmed = raw.replace(/\\\\/g, "/").trim().replace(/^\\/+/, "");
    if (!trimmed) throw new Error("storage key is required");
    const parts = trimmed.split("/").filter(Boolean);
    for (const part of parts) {
      if (part === "." || part === "..") throw new Error("storage key cannot contain dot segments");
    }
    return parts.join("/");
  };

  const encodeBase64 = (bytes) => {
    if (globalThis.btoa) {
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return globalThis.btoa(bin);
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64");
    }
    throw new Error("Base64 encoding is not supported in this environment");
  };

  const decodeBase64 = (text) => {
    if (globalThis.atob) {
      const bin = globalThis.atob(text);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(text, "base64"));
    }
    throw new Error("Base64 decoding is not supported in this environment");
  };

  const normalizeOutboundInit = async (init) => {
    if (!init || typeof init !== "object") return {};
    const method = typeof init.method === "string" ? init.method : undefined;
    const headers =
      init.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
        ? { ...init.headers }
        : undefined;
    const body = init.body;
    if (body === undefined || body === null) {
      return { method, headers };
    }
    if (typeof body === "string") {
      return { method, headers, body: { encoding: "utf8", data: body } };
    }
    if (body instanceof ArrayBuffer) {
      return { method, headers, body: { encoding: "base64", data: encodeBase64(new Uint8Array(body)) } };
    }
    if (ArrayBuffer.isView(body)) {
      return { method, headers, body: { encoding: "base64", data: encodeBase64(new Uint8Array(body.buffer)) } };
    }
    if (body && typeof body.arrayBuffer === "function") {
      const buf = await body.arrayBuffer();
      return { method, headers, body: { encoding: "base64", data: encodeBase64(new Uint8Array(buf)) } };
    }
    throw new Error("unsupported outbound fetch body");
  };

  const normalizePutBody = async (body) => {
    if (typeof body === "string") return { encoding: "utf8", data: body };
    if (body instanceof ArrayBuffer) return { encoding: "base64", data: encodeBase64(new Uint8Array(body)) };
    if (ArrayBuffer.isView(body)) return { encoding: "base64", data: encodeBase64(new Uint8Array(body.buffer)) };
    if (body && typeof body.arrayBuffer === "function") {
      const buf = await body.arrayBuffer();
      return { encoding: "base64", data: encodeBase64(new Uint8Array(buf)) };
    }
    throw new Error("unsupported storage put body");
  };

  const createStorageProxy = (bucketName) => ({
    put: async (key, body, options) => {
      const normalizedKey = normalizeStorageKey(key);
      const encoded = await normalizePutBody(body);
      return rpc({
        kind: "storage",
        bucket: bucketName,
        method: "put",
        args: [normalizedKey, encoded, options || {}],
        workspaceId,
        userId,
        mode,
      });
    },
    get: async (key) => {
      const normalizedKey = normalizeStorageKey(key);
      const res = await rpc({
        kind: "storage",
        bucket: bucketName,
        method: "get",
        args: [normalizedKey],
        workspaceId,
        userId,
        mode,
      });
      if (!res) return null;
      if (res.encoding !== "base64" || typeof res.data !== "string") {
        throw new Error("invalid storage get response");
      }
      return decodeBase64(res.data).buffer;
    },
    getText: async (key) => {
      const normalizedKey = normalizeStorageKey(key);
      return rpc({
        kind: "storage",
        bucket: bucketName,
        method: "getText",
        args: [normalizedKey],
        workspaceId,
        userId,
        mode,
      });
    },
    head: async (key) => {
      const normalizedKey = normalizeStorageKey(key);
      return rpc({
        kind: "storage",
        bucket: bucketName,
        method: "head",
        args: [normalizedKey],
        workspaceId,
        userId,
        mode,
      });
    },
    delete: async (key) => {
      const normalizedKey = normalizeStorageKey(key);
      return rpc({
        kind: "storage",
        bucket: bucketName,
        method: "delete",
        args: [normalizedKey],
        workspaceId,
        userId,
        mode,
      });
    },
    deleteMany: async (keys) => {
      const normalized = Array.isArray(keys) ? keys.map((k) => normalizeStorageKey(k)) : [];
      return rpc({
        kind: "storage",
        bucket: bucketName,
        method: "deleteMany",
        args: [normalized],
        workspaceId,
        userId,
        mode,
      });
    },
    list: async (options) => {
      return rpc({
        kind: "storage",
        bucket: bucketName,
        method: "list",
        args: [options || {}],
        workspaceId,
        userId,
        mode,
      });
    },
    getSignedUrl: async () => {
      throw new Error("ctx.storage().getSignedUrl is not supported in isolated mode");
    },
    getPublicUrl: () => {
      throw new Error("ctx.storage().getPublicUrl is not supported in isolated mode");
    },
  });

  const createServiceProxy = (path = []) =>
    new Proxy(
      () => {},
      {
        get(_target, prop) {
          if (prop === "then") return undefined;
          const key = typeof prop === "string" ? prop : "";
          if (!key) return undefined;
          return createServiceProxy([...path, key]);
        },
        apply(_target, _thisArg, args) {
          return rpc({ kind: "services", path, args });
        },
      },
    );

  return {
    mode,
    workspaceId,
    runId,
    handler,
    auth,
    services: createServiceProxy([]),
    db: (name) => {
      const normalized = typeof name === "string" ? name.trim() : "";
      if (!normalized) throw new Error("database name is required");
      if (!normalized.startsWith("app:")) {
        throw new Error(
          'Collection name must start with "app:" prefix. Got: "' +
            normalized +
            '". Core tables cannot be accessed directly via ctx.db(). Use ctx.services instead.',
        );
      }
      return createDbProxy(normalized);
    },
    storage: (name) => {
      const normalized = typeof name === "string" ? name.trim() : "";
      if (!normalized) throw new Error("storage bucket name is required");
      if (!normalized.startsWith("app:")) {
        throw new Error(
          'Storage bucket name must start with "app:" prefix. Got: "' + normalized + '". Core storage cannot be accessed directly via ctx.storage().',
        );
      }
      return createStorageProxy(normalized);
    },
    outbound: {
      fetch: async (url, init) => {
        const normalizedUrl = url?.toString?.().trim?.() ?? "";
        if (!normalizedUrl) throw new Error("outbound url is required");
        const normalizedInit = await normalizeOutboundInit(init);
        return rpc({
          kind: "outbound",
          url: normalizedUrl,
          init: normalizedInit,
          auth,
        });
      },
    },
    ai: {
      providers: null,
      openai: {
        chat: {
          completions: {
            create: async (params) => {
              return rpc({
                kind: "ai",
                method: "chat.completions.create",
                args: [params],
                auth,
              });
            },
          },
        },
        embeddings: {
          create: async (params) => {
            return rpc({
              kind: "ai",
              method: "embeddings.create",
              args: [params],
              auth,
            });
          },
        },
      },
    },
    log,
    json,
    error,
    redirect,
    __logs: logs,
  };
};

let cachedModule = null;
let cachedHandlers = null;

const ensureLoaded = async () => {
  if (!cachedModule) {
    cachedModule = await import("./${APP_MAIN}");
  }
  if (!cachedHandlers) {
    cachedHandlers = collectExportedHandlers(cachedModule);
  }
  return cachedHandlers;
};

const jsonResponse = (data, init = 200) =>
  new Response(JSON.stringify(data), {
    status: typeof init === "number" ? init : (init?.status ?? 200),
    headers: { "content-type": "application/json; charset=utf-8", ...(typeof init === "object" ? init.headers : {}) },
  });

export default {
  async fetch(request, env) {
    __ENV = env || {};
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return jsonResponse({ ok: false, error: { message: "invalid payload" } }, 400);
    }

    const action = payload.action;
    if (action === "list") {
      const handlers = await ensureLoaded();
      return jsonResponse({ ok: true, handlers: Array.from(handlers.keys()).sort() });
    }

    if (action !== "invoke") {
      return jsonResponse({ ok: false, error: { message: "unknown action" } }, 400);
    }

    const handlerName = normalizeHandlerName(payload.handler);
    if (!handlerName) {
      return jsonResponse({ ok: false, error: { message: "handler is required" } }, 400);
    }

    const handlers = await ensureLoaded();
    const fn = handlers.get(handlerName);
    const ctx = createTakosContextLite({
      mode: payload.context?.mode,
      workspaceId: payload.context?.workspaceId,
      runId: payload.context?.runId,
      handlerName,
      auth: payload.context?.auth ?? null,
    });

    if (!fn) {
      return jsonResponse({ ok: false, runId: ctx.runId, error: { message: \`Unknown app handler "\${handlerName}"\` }, logs: ctx.__logs }, 404);
    }

    try {
      const output = await fn(ctx, payload.input);
      const response = output && typeof output === "object" && typeof output.type === "string"
        ? output
        : ctx.json(output);
      return jsonResponse({ ok: true, runId: ctx.runId, response, logs: ctx.__logs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
      const stack = error instanceof Error ? error.stack : undefined;
      ctx.log("error", message, stack ? { stack } : undefined);
      return jsonResponse({ ok: false, runId: ctx.runId, error: { message, stack }, logs: ctx.__logs }, 500);
    }
  },
};
`;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(text));
  return toHex(new Uint8Array(digest));
};

const workerIdForScript = async (scriptCode: string): Promise<string> => {
  const hash = await sha256Hex(`takos-app:${RUNNER_VERSION}:${COMPATIBILITY_DATE}:${scriptCode}`);
  return `takos-app:${hash}`;
};

const stubCache = new Map<string, { entrypoint: { fetch: (request: Request) => Promise<Response> } }>();

const parseTimeoutMs = (env: IsolatedRunnerEnv): number => {
  const raw =
    (env as any)?.TAKOS_APP_EXECUTION_TIMEOUT_MS ??
    (env as any)?.TAKOS_APP_TIMEOUT_MS ??
    "";
  const parsed = typeof raw === "string" && raw.trim() ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 30_000;
  return Math.min(Math.max(Math.trunc(parsed), 1_000), 120_000);
};

export async function createIsolatedAppRunner(options: {
  env: IsolatedRunnerEnv;
  scriptCode: string;
}): Promise<{
  list: () => Promise<string[]>;
  invoke: (handler: string, input: unknown, context?: InvokePayload["context"]) => Promise<InvokeResult>;
}> {
  const loader = options.env?.LOADER;
  if (!loader) {
    throw new Error("LOADER binding is not configured");
  }

  const id = await workerIdForScript(options.scriptCode);
  const cached = stubCache.get(id);
  if (cached) {
    return createRunnerFromEntrypoint(cached.entrypoint, parseTimeoutMs(options.env));
  }

  const stub = loader.get(id, async () => {
    return {
      compatibilityDate: COMPATIBILITY_DATE,
      mainModule: RUNNER_MAIN,
      modules: {
        [RUNNER_MAIN]: { js: runnerSource },
        [APP_MAIN]: { js: options.scriptCode },
      },
      env: {
        TAKOS_CORE: (options.env as any)?.TAKOS_CORE,
        TAKOS_APP_RPC_TOKEN: (options.env as any)?.TAKOS_APP_RPC_TOKEN,
      },
      globalOutbound: null,
    };
  });

  const entrypoint = stub.getEntrypoint();
  stubCache.set(id, { entrypoint });
  return createRunnerFromEntrypoint(entrypoint, parseTimeoutMs(options.env));
}

function createRunnerFromEntrypoint(
  entrypoint: { fetch: (request: Request) => Promise<Response> },
  timeoutMs: number,
) {
  const fetchWithTimeout = async (request: Request): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestWithSignal = new Request(request, { signal: controller.signal });

    const race = await Promise.race([
      entrypoint.fetch(requestWithSignal).then((res) => ({ kind: "response" as const, res })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);

    clearTimeout(timer);

    if (race.kind === "timeout") {
      throw new Error("timeout");
    }
    return race.res;
  };

  return {
    list: async (): Promise<string[]> => {
      const payload: ListPayload = { action: "list" };
      const res = await fetchWithTimeout(
        new Request("http://takos.internal/__takos_app", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      const body = (await res.json().catch(() => null)) as ListResult | null;
      if (!body?.ok || !Array.isArray((body as any).handlers)) {
        throw new Error("Failed to list isolated app handlers");
      }
      return (body as any).handlers as string[];
    },
    invoke: async (handler: string, input: unknown, context?: InvokePayload["context"]): Promise<InvokeResult> => {
      const payload: InvokePayload = { action: "invoke", handler, input, context };
      let res: Response;
      try {
        res = await fetchWithTimeout(
          new Request("http://takos.internal/__takos_app", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "timeout");
        const runId = typeof context?.runId === "string" && context.runId.trim() ? context.runId.trim() : "run_timeout";
        if (message === "timeout") {
          return {
            ok: false,
            runId,
            error: { message: "App handler execution timed out", code: "SANDBOX_TIMEOUT" },
            logs: [],
          };
        }
        return {
          ok: false,
          runId,
          error: { message: message || "App handler invocation failed" },
          logs: [],
        };
      }

      const body = (await res.json().catch(() => null)) as InvokeResult | null;
      if (!body || typeof body !== "object" || typeof (body as any).ok !== "boolean") {
        return {
          ok: false,
          runId: typeof context?.runId === "string" && context.runId.trim() ? context.runId.trim() : "run_invalid",
          error: { message: `Invalid isolated handler response (status ${res.status})` },
          logs: [],
        };
      }
      return body;
    },
  };
}
