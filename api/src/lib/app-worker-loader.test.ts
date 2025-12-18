import { describe, expect, it, vi } from "vitest";
import appRpcRoutes from "../routes/app-rpc";
import { createIsolatedAppRunner } from "./app-worker-loader";

const encodeDataUrl = (code: string): string =>
  `data:application/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;

function createMockKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: "text") {
      const value = store.get(key) ?? null;
      if (!value) return null;
      if (type === "text") return value;
      return value;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix }: { prefix: string; cursor?: string }) {
      const keys = Array.from(store.keys())
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys };
    },
  };
}

function createRealisticMockWorkerLoader() {
  return {
    get: (_id: string, getCode: () => Promise<any>) => {
      let cachedFetch: ((request: Request, env: any) => Promise<Response>) | null = null;
      let cachedEnv: any = null;

      return {
        getEntrypoint: () => ({
          fetch: async (request: Request) => {
            if (!cachedFetch) {
              const code = await getCode();
              cachedEnv = code?.env ?? {};

              const runner =
                code?.modules?.["runner.js"]?.js ??
                code?.modules?.["runner.js"] ??
                "";
              const appMain =
                code?.modules?.["app-main.js"]?.js ??
                code?.modules?.["app-main.js"] ??
                "";

              const appMainUrl = encodeDataUrl(String(appMain));
              const rewrittenRunner = String(runner).replace(
                /import\(\s*"\.\/app-main\.js"\s*\)/g,
                `import("${appMainUrl}")`,
              );
              const runnerUrl = encodeDataUrl(rewrittenRunner);
              const runnerModule = (await import(runnerUrl)) as any;
              if (!runnerModule?.default?.fetch) {
                throw new Error("runner.js default export is missing fetch()");
              }
              cachedFetch = runnerModule.default.fetch.bind(runnerModule.default);
            }

            return cachedFetch(request, cachedEnv);
          },
        }),
      };
    },
  } as any;
}

describe("app-worker-loader runner", () => {
  it("supports ctx.storage(app:*) via internal RPC in runnerSource", async () => {
    const kv = createMockKv();
    const env: any = {
      LOADER: createRealisticMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
      APP_STATE: kv,
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };

    const scriptCode = `
      export const writeRead = async (ctx) => {
        const bucket = ctx.storage("app:assets");
        await bucket.put("hello.txt", "hello", { contentType: "text/plain" });
        const text = await bucket.getText("hello.txt");
        const meta = await bucket.head("hello.txt");
        const listed = await bucket.list({ prefix: "" });
        return ctx.json({ text, metaKey: meta?.key ?? null, listCount: listed?.objects?.length ?? 0 });
      };
    `;

    const runner = await createIsolatedAppRunner({ env, scriptCode });
    const invoked = await runner.invoke("writeRead", null, { mode: "prod", auth: null, runId: undefined });

    if (!invoked.ok) {
      throw new Error(invoked.error?.message ?? "invoke failed");
    }
    expect((invoked.response as any).type).toBe("json");
    expect((invoked.response as any).body).toMatchObject({ text: "hello", metaKey: "hello.txt", listCount: 1 });
  });

  it("returns SANDBOX_TIMEOUT when handler execution exceeds timeout", async () => {
    const env: any = {
      LOADER: createRealisticMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
      TAKOS_APP_EXECUTION_TIMEOUT_MS: "20",
      APP_STATE: createMockKv(),
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };

    const scriptCode = `
      export const hang = async (_ctx) => {
        await new Promise(() => {});
        return { ok: true };
      };
    `;

    const runner = await createIsolatedAppRunner({ env, scriptCode });
    const invoked = await runner.invoke("hang", null, { mode: "prod", auth: null, runId: "run_timeout_test" });
    expect(invoked.ok).toBe(false);
    if (!invoked.ok) {
      expect(invoked.error.code).toBe("SANDBOX_TIMEOUT");
    }
  });

  it("supports ctx.outbound.fetch via internal RPC for background jobs when enabled", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }));
    // @ts-ignore
    globalThis.fetch = fetchMock;

    const env: any = {
      LOADER: createRealisticMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
      TAKOS_OUTBOUND_RPC_ENABLED: "true",
      APP_STATE: createMockKv(),
    };
    env.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, env, {} as any) };

    const scriptCode = `
      export const outbound = async (ctx) => {
        const res = await ctx.outbound.fetch("https://remote.example/test", { method: "GET" });
        return ctx.json({ status: res.status, encoding: res.body?.encoding ?? null, data: res.body?.data ?? null });
      };
    `;

    const runner = await createIsolatedAppRunner({ env, scriptCode });
    const invoked = await runner.invoke("outbound", null, { mode: "prod", auth: null, runId: undefined });

    if (!invoked.ok) {
      throw new Error(invoked.error?.message ?? "invoke failed");
    }
    expect((invoked.response as any).type).toBe("json");
    const body = (invoked.response as any).body;
    expect(body.status).toBe(200);
    expect(body.encoding).toBe("base64");
    expect(typeof body.data).toBe("string");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // @ts-ignore
    globalThis.fetch = originalFetch;
  });
});
