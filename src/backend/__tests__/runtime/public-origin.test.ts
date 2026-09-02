import { beforeEach, describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import { createYurucommuBackendApp } from "../../index.ts";
import worker from "../../public.ts";
import {
  CANONICAL_ORIGIN_KV_KEY,
  PublicOriginError,
  canonicalPublicOrigin,
  establishRequestPublicOrigin,
  requireBackgroundPublicOrigin,
  resetObservedPublicOrigin,
  withRequiredBackgroundPublicOrigin,
} from "../../runtime/public-origin.ts";

/**
 * The origin a Takoform-hosted Worker cannot be told.
 *
 * `WorkerEndpoint` allocates the public origin AFTER the immutable
 * `WorkerVersion` that would have carried `APP_URL` as a plain var, so on the
 * portable lane the value exists only on the requests the Host routes here.
 * These tests pin the whole rule: what may become an origin, who wins when two
 * sources disagree, that the first observation is the last one, and that work
 * without a request refuses instead of minting `undefined/ap/users/…`.
 */

const HOST_ASSIGNED = "https://yurucommu-a1b2c3.workers.example";
const OPERATOR_SET = "https://social.operator.example";

class MockKV {
  store = new Map<string, string>();
  puts = 0;
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.puts += 1;
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list() {
    return {
      keys: [...this.store.keys()].map((name) => ({ name })),
      list_complete: true as const,
    };
  }
}

function portableEnv(kv: MockKV, extra: Record<string, unknown> = {}) {
  return {
    YURUCOMMU_RUNTIME_LANE: "portable",
    KV: kv,
    DB_INSTANCE: {},
    ...extra,
  } as unknown as Env;
}

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

beforeEach(() => {
  // The observation is cached per isolate, and a test file is one isolate.
  resetObservedPublicOrigin();
});

describe("what may become a public origin", () => {
  test("an https origin is taken as-is", () => {
    expect(canonicalPublicOrigin(HOST_ASSIGNED)).toEqual(HOST_ASSIGNED);
    expect(canonicalPublicOrigin(`${HOST_ASSIGNED}/`)).toEqual(HOST_ASSIGNED);
    expect(canonicalPublicOrigin("https://host.example:8443")).toEqual(
      "https://host.example:8443",
    );
  });

  test("plain http on a routable host is refused", () => {
    // A wrapper host that terminates TLS in front of workerd hands the Worker
    // an http request. Trusting it would let a forwarded-proto header nobody
    // owns decide what this instance signs deliveries as.
    expect(() => canonicalPublicOrigin("http://social.example")).toThrow(
      PublicOriginError,
    );
    expect(() => canonicalPublicOrigin("http://social.example")).toThrow(
      /https/,
    );
  });

  test("loopback http is the one exception", () => {
    expect(canonicalPublicOrigin("http://localhost:3000")).toEqual(
      "http://localhost:3000",
    );
    expect(canonicalPublicOrigin("http://127.0.0.1:8787")).toEqual(
      "http://127.0.0.1:8787",
    );
    // A self-host Takoserver's local Worker endpoint is `<script>.localhost`.
    expect(canonicalPublicOrigin("http://yurucommu.localhost")).toEqual(
      "http://yurucommu.localhost",
    );
  });

  test("anything that is not just an origin is refused", () => {
    // The value is concatenated with `/ap/users/…` at hundreds of call sites.
    for (const bad of [
      "https://host.example/base",
      "https://host.example/?x=1",
      "https://host.example/#f",
      "https://user:pw@host.example",
      "not-a-url",
      "",
    ]) {
      expect(() => canonicalPublicOrigin(bad)).toThrow(PublicOriginError);
    }
  });
});

describe("establishing the origin from a request", () => {
  test("the request URL's own origin is pinned in KV", async () => {
    const kv = new MockKV();
    const origin = await establishRequestPublicOrigin(
      portableEnv(kv),
      new Request(`${HOST_ASSIGNED}/api/timeline`),
    );

    expect(origin).toEqual(HOST_ASSIGNED);
    expect(kv.store.get(CANONICAL_ORIGIN_KV_KEY)).toEqual(HOST_ASSIGNED);
  });

  test("a forged forwarding header cannot become the origin", async () => {
    const kv = new MockKV();
    const origin = await establishRequestPublicOrigin(
      portableEnv(kv),
      new Request(`${HOST_ASSIGNED}/api/timeline`, {
        headers: {
          "X-Forwarded-Host": "attacker.example",
          "X-Forwarded-Proto": "https",
          Host: "attacker.example",
        },
      }),
    );

    expect(origin).toEqual(HOST_ASSIGNED);
  });

  test("an http request establishes nothing", async () => {
    const kv = new MockKV();
    await expect(
      establishRequestPublicOrigin(
        portableEnv(kv),
        new Request("http://social.example/api/timeline"),
      ),
    ).rejects.toThrow(PublicOriginError);
    expect(kv.store.has(CANONICAL_ORIGIN_KV_KEY)).toBe(false);
  });

  test("the first writer wins: a later host does not re-pin", async () => {
    const kv = new MockKV();
    kv.store.set(CANONICAL_ORIGIN_KV_KEY, HOST_ASSIGNED);

    const origin = await establishRequestPublicOrigin(
      portableEnv(kv),
      new Request("https://a-second-domain.example/api/timeline"),
    );

    expect(origin).toEqual(HOST_ASSIGNED);
    expect(kv.puts).toEqual(0);
    expect(kv.store.get(CANONICAL_ORIGIN_KV_KEY)).toEqual(HOST_ASSIGNED);
  });

  test("losing the write race refuses rather than serving two identities", async () => {
    const kv = new MockKV();
    // Another isolate's write lands between this one's put and its read-back.
    const raced = {
      ...kv,
      get: async (key: string) =>
        kv.puts === 0 ? null : "https://other-endpoint.example",
      put: async (key: string, value: string) => {
        await kv.put(key, value);
      },
    } as unknown as MockKV;

    await expect(
      establishRequestPublicOrigin(
        portableEnv(raced),
        new Request(`${HOST_ASSIGNED}/api/timeline`),
      ),
    ).rejects.toThrow(/concurrently pinned/);
  });

  test("a hand-written pin is refused, not silently replaced", async () => {
    const kv = new MockKV();
    kv.store.set(CANONICAL_ORIGIN_KV_KEY, "http://typo.example/oops");

    await expect(
      establishRequestPublicOrigin(
        portableEnv(kv),
        new Request(`${HOST_ASSIGNED}/api/timeline`),
      ),
    ).rejects.toThrow(PublicOriginError);
  });
});

describe("the origin for work that has no request", () => {
  test("APP_URL beats an already-pinned origin", async () => {
    const kv = new MockKV();
    kv.store.set(CANONICAL_ORIGIN_KV_KEY, HOST_ASSIGNED);

    const env = portableEnv(kv, { APP_URL: OPERATOR_SET });
    expect(await requireBackgroundPublicOrigin(env)).toEqual(OPERATOR_SET);
    expect(await withRequiredBackgroundPublicOrigin(env)).toBe(env);
  });

  test("the pinned origin is used when APP_URL is unset", async () => {
    const kv = new MockKV();
    kv.store.set(CANONICAL_ORIGIN_KV_KEY, HOST_ASSIGNED);

    const patched = await withRequiredBackgroundPublicOrigin(portableEnv(kv));
    expect(patched.APP_URL).toEqual(HOST_ASSIGNED);
  });

  test("neither source is a refusal that names the fix", async () => {
    const kv = new MockKV();
    await expect(
      requireBackgroundPublicOrigin(portableEnv(kv)),
    ).rejects.toThrow(PublicOriginError);
    await expect(
      requireBackgroundPublicOrigin(portableEnv(kv)),
    ).rejects.toThrow(/APP_URL is unset and no request has pinned an origin/);
  });

  test("the queue handler refuses a batch it cannot address", async () => {
    // The core Worker entry, end to end: no APP_URL, nothing pinned, so the
    // batch throws (and is retried) instead of federating `undefined/ap/…`.
    const kv = new MockKV();
    const batch = {
      queue: "yurucommu-delivery",
      messages: [],
      ackAll: () => {},
      retryAll: () => {},
    };

    await expect(
      worker.queue(
        batch as never,
        {
          DB: {
            prepare: () => ({}),
            batch: async () => [],
            exec: async () => ({}),
            dump: async () => new ArrayBuffer(0),
          },
          KV: kv,
        } as never,
      ),
    ).rejects.toThrow(PublicOriginError);
  });
});

describe("the app served on a Host-assigned origin", () => {
  test("absolute URLs are built from the request origin, and it is pinned", async () => {
    const kv = new MockKV();
    const app = createYurucommuBackendApp();

    const res = await app.fetch(
      new Request(`${HOST_ASSIGNED}/.well-known/nodeinfo`),
      portableEnv(kv),
    );
    const body = (await res.json()) as { links: Array<{ href: string }> };

    expect(res.status).toEqual(200);
    expect(body.links.map((l) => l.href)).toEqual([
      `${HOST_ASSIGNED}/nodeinfo/2.0`,
      `${HOST_ASSIGNED}/nodeinfo/2.1`,
    ]);
    expect(kv.store.get(CANONICAL_ORIGIN_KV_KEY)).toEqual(HOST_ASSIGNED);
  });

  test("the OIDC redirect_uri points back at the assigned origin", async () => {
    const kv = new MockKV();
    const app = createYurucommuBackendApp();

    const res = await app.fetch(
      new Request(`${HOST_ASSIGNED}/api/auth/login/google`),
      portableEnv(kv, {
        GOOGLE_CLIENT_ID: "client-123",
        GOOGLE_CLIENT_SECRET: "secret-456",
      }),
    );

    expect(res.status).toEqual(302);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(location.searchParams.get("redirect_uri")).toEqual(
      `${HOST_ASSIGNED}/api/auth/callback/google`,
    );
  });

  test("the instance actor id is minted on the assigned origin", async () => {
    const kv = new MockKV();
    const app = createYurucommuBackendApp();

    const res = await app.fetch(
      new Request(`${HOST_ASSIGNED}/ap/actor`),
      portableEnv(kv, { DB_INSTANCE: await freshDb() }),
    );
    const body = (await res.json()) as {
      id: string;
      inbox: string;
      publicKey: { id: string };
    };

    expect(res.status).toEqual(200);
    expect(body.id).toEqual(`${HOST_ASSIGNED}/ap/actor`);
    expect(body.inbox).toEqual(`${HOST_ASSIGNED}/ap/actor/inbox`);
    expect(body.publicKey.id).toEqual(`${HOST_ASSIGNED}/ap/actor#main-key`);
  });

  test("readiness reports ready once a request has established the origin", async () => {
    const kv = new MockKV();
    const app = createYurucommuBackendApp();
    const env = portableEnv(kv, {
      ENCRYPTION_KEY: "0".repeat(64),
      AUTH_PASSWORD_HASH: "pbkdf2$1$salt$hash",
    });

    const res = await app.fetch(new Request(`${HOST_ASSIGNED}/readyz`), env);
    const body = (await res.json()) as { missingBindings: string[] };

    expect(res.status).toEqual(200);
    expect(body.missingBindings).not.toContain("APP_URL");
  });

  test("APP_URL wins over the request origin, and nothing is pinned", async () => {
    const kv = new MockKV();
    const app = createYurucommuBackendApp();

    const res = await app.fetch(
      // A request that arrived on a different hostname than the operator's
      // APP_URL does not change what this instance calls itself.
      new Request(`${HOST_ASSIGNED}/.well-known/nodeinfo`),
      portableEnv(kv, { APP_URL: OPERATOR_SET }),
    );
    const body = (await res.json()) as { links: Array<{ href: string }> };

    expect(body.links[0].href).toEqual(`${OPERATOR_SET}/nodeinfo/2.0`);
    expect(kv.store.has(CANONICAL_ORIGIN_KV_KEY)).toBe(false);
  });

  test("an http request neither establishes nor fails the request", async () => {
    const kv = new MockKV();
    const app = createYurucommuBackendApp();

    const res = await app.fetch(
      new Request("http://tls-terminated.example/readyz"),
      portableEnv(kv),
    );
    const body = (await res.json()) as { missingBindings: string[] };

    // The probe still answers — precisely, and about the right binding.
    expect(res.status).toEqual(503);
    expect(body.missingBindings).toContain("APP_URL");
    expect(kv.store.has(CANONICAL_ORIGIN_KV_KEY)).toBe(false);
  });
});

describe("the cloudflare lane", () => {
  test("does not infer an origin from a request", async () => {
    const kv = new MockKV();
    const app = createYurucommuBackendApp();

    const res = await app.fetch(new Request(`${HOST_ASSIGNED}/readyz`), {
      KV: kv,
      DB_INSTANCE: {},
    } as unknown as Env);
    const body = (await res.json()) as { missingBindings: string[] };

    // A Worker deployed straight to Cloudflare answers on workers.dev, on every
    // custom domain, and on every route its account holds. Whichever hostname
    // arrived first must not get to name the instance.
    expect(res.status).toEqual(503);
    expect(body.missingBindings).toContain("APP_URL");
    expect(kv.store.has(CANONICAL_ORIGIN_KV_KEY)).toBe(false);
  });

  test("still serves an explicitly configured APP_URL", async () => {
    const kv = new MockKV();
    const app = createYurucommuBackendApp();

    const res = await app.fetch(
      new Request("https://whatever.example/.well-known/nodeinfo"),
      {
        KV: kv,
        DB_INSTANCE: {},
        APP_URL: OPERATOR_SET,
      } as unknown as Env,
    );
    const body = (await res.json()) as { links: Array<{ href: string }> };

    expect(body.links[0].href).toEqual(`${OPERATOR_SET}/nodeinfo/2.0`);
    expect(kv.store.has(CANONICAL_ORIGIN_KV_KEY)).toBe(false);
  });
});
