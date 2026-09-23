import { expect, test } from "bun:test";

import { createYurucommuBackendApp } from "../../index.ts";
import { withCache } from "../../middleware/cache.ts";
import type { Database } from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const PROBE_PATH = "/__cache-instance-isolation";

type ProbePayload = { posts: string[] };
type ProbeMiddleware = ReturnType<typeof withCache>;
type ProbeApp = ReturnType<typeof createYurucommuBackendApp>;

function createProbeApp(
  middleware: ProbeMiddleware,
  payload: ProbePayload,
): ProbeApp {
  return createYurucommuBackendApp({
    plugins: [
      {
        apiVersion: 1,
        name: `cache-isolation-${payload.posts.length}`,
        setup: ({ app }) => {
          app.get(PROBE_PATH, middleware, (c) => c.json(payload));
        },
      },
    ],
  });
}

async function fetchProbe(
  app: ProbeApp,
  db: Database,
): Promise<{ body: ProbePayload; cache: string | null }> {
  const response = await app.fetch(
    new Request(`${APP_URL}${PROBE_PATH}`, { method: "GET" }),
    { APP_URL, DB_INSTANCE: db } as never,
  );
  return {
    body: (await response.json()) as ProbePayload,
    cache: response.headers.get("X-Cache"),
  };
}

test("factory cache namespaces isolate same-route apps and survive DB wrapper changes", async () => {
  // Reuse one middleware instance, as singleton routers do. The two factory
  // apps share a DB authority on the first request, then receive recreated DB
  // wrappers; only the factory-owned token remains stable for both HITs.
  const middleware = withCache({ ttl: 60 });
  const appA = createProbeApp(middleware, { posts: [] });
  const appB = createProbeApp(middleware, { posts: ["public"] });
  const sharedDb = (await createTestDb()).db;
  const recreatedDb = (await createTestDb()).db;

  const aMiss = await fetchProbe(appA, sharedDb);
  expect(aMiss).toEqual({ body: { posts: [] }, cache: "MISS" });

  const bMiss = await fetchProbe(appB, sharedDb);
  expect(bMiss).toEqual({ body: { posts: ["public"] }, cache: "MISS" });

  const aHit = await fetchProbe(appA, recreatedDb);
  expect(aHit).toEqual({ body: { posts: [] }, cache: "HIT" });

  const bHit = await fetchProbe(appB, recreatedDb);
  expect(bHit).toEqual({ body: { posts: ["public"] }, cache: "HIT" });
});

test("Cloudflare default-cache-unavailable fallback keeps app namespaces isolated", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      get default() {
        throw new Error("No Cache was configured");
      },
    },
  });

  try {
    const middleware = withCache({ ttl: 60 });
    const appA = createProbeApp(middleware, { posts: [] });
    const appB = createProbeApp(middleware, { posts: ["public"] });
    const sharedDb = (await createTestDb()).db;
    const recreatedDb = (await createTestDb()).db;

    const aMiss = await fetchProbe(appA, sharedDb);
    expect(aMiss).toEqual({ body: { posts: [] }, cache: "MISS" });

    const bMiss = await fetchProbe(appB, sharedDb);
    expect(bMiss).toEqual({ body: { posts: ["public"] }, cache: "MISS" });

    const aHit = await fetchProbe(appA, recreatedDb);
    expect(aHit).toEqual({ body: { posts: [] }, cache: "HIT" });

    const bHit = await fetchProbe(appB, recreatedDb);
    expect(bHit).toEqual({ body: { posts: ["public"] }, cache: "HIT" });
  } finally {
    if (original) Object.defineProperty(globalThis, "caches", original);
    else Reflect.deleteProperty(globalThis, "caches");
  }
});
