import { expect, test } from "bun:test";

import {
  createYurucommuBackendApp,
  YURUCOMMU_BACKEND_PLUGIN_API_VERSION,
} from "../index.ts";
import { createTestDb } from "./helpers/d1-semantics.ts";
import { deliveryFanouts } from "../../db/index.ts";
import type { Env } from "../types.ts";

type DbCounts = {
  select: number;
  insert: number;
  update: number;
  delete: number;
};

function countingDb(db: object, counts: DbCounts): object {
  return new Proxy(db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        (property === "select" ||
          property === "insert" ||
          property === "update" ||
          property === "delete") &&
        typeof value === "function"
      ) {
        return (...args: unknown[]) => {
          counts[property] += 1;
          return value.apply(target, args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function harness() {
  const { db, client } = await createTestDb();
  const counts: DbCounts = { select: 0, insert: 0, update: 0, delete: 0 };
  const env = {
    APP_URL: "https://test.local",
    DB_INSTANCE: countingDb(db, counts),
  } as unknown as Env;
  const app = createYurucommuBackendApp({
    plugins: [
      {
        apiVersion: YURUCOMMU_BACKEND_PLUGIN_API_VERSION,
        name: "mutation-recovery-regression",
        setup({ app }) {
          app.get("/__probe/warm", (c) => c.text("ok"));
          app.post("/__probe/ok", () => new Response(null, { status: 204 }));
          app.post("/__probe/fail", (c) => c.text("failed", 400));
          app.post("/__probe/redirect", (c) =>
            c.redirect("/__probe/warm", 303),
          );
          app.options("/__probe/ok", () => new Response(null, { status: 204 }));
          let sequence = 0;
          app.post("/__probe/record", async () => {
            const id = `local-recovery-${++sequence}`;
            await db.insert(deliveryFanouts).values({
              id,
              activityApId: `https://test.local/ap/activities/${id}`,
              kind: "followers",
              targetApId: "https://test.local/ap/users/local",
            });
            return new Response(null, { status: 204 });
          });
        },
      },
    ],
  });

  const fetch = (path: string, init?: RequestInit) =>
    app.fetch(new Request(`https://test.local${path}`, init), env as never);

  // Warm the existing recovery clock and discard any initial sweep.
  // Do not change the process-global clock used by other test files.
  expect((await fetch("/__probe/warm")).status).toBe(200);
  counts.select = 0;
  counts.insert = 0;
  counts.update = 0;
  counts.delete = 0;

  return { app, db, env, counts, fetch, client };
}

test("failed mutations do not sweep while an accepted mutation does", async () => {
  const { counts, fetch, client } = await harness();
  try {
    expect((await fetch("/does-not-exist", { method: "POST" })).status).toBe(
      503,
    );
    expect((await fetch("/api/nope", { method: "POST" })).status).toBe(403);
    expect(
      (
        await fetch("/api/nope", {
          method: "POST",
          headers: { Origin: "https://test.local" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch("/api/posts", {
          method: "POST",
          headers: { Origin: "https://test.local" },
        })
      ).status,
    ).toBe(401);
    expect((await fetch("/__probe/fail", { method: "POST" })).status).toBe(400);
    expect(counts.select).toBe(0);

    expect((await fetch("/__probe/ok", { method: "POST" })).status).toBe(204);
    expect(counts.select).toBe(5);
  } finally {
    client.close();
  }
});

test("concurrent accepted mutations coalesce their in-flight sweep", async () => {
  const { counts, fetch, client } = await harness();
  try {
    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        fetch("/__probe/ok", { method: "POST" }),
      ),
    );
    expect(responses.every((response) => response.status === 204)).toBe(true);
    expect(counts.select).toBeGreaterThan(0);
    expect(counts.select).toBeLessThanOrEqual(10);
  } finally {
    client.close();
  }
});

test("body-limit rejection stays before the sweep", async () => {
  const { counts, fetch, client } = await harness();
  try {
    const response = await fetch("/__probe/ok", {
      method: "POST",
      headers: { "Content-Length": String(1024 * 1024 + 1) },
      body: "x",
    });
    expect(response.status).toBe(413);
    expect(counts.select).toBe(0);
  } finally {
    client.close();
  }
});

test("redirect acceptance sweeps but read/OPTIONS responses do not", async () => {
  const f = await harness();
  try {
    expect(
      (await f.fetch("/__probe/redirect", { method: "POST" })).status,
    ).toBe(303);
    expect(f.counts.select).toBe(5);
    expect((await f.fetch("/__probe/warm", { method: "HEAD" })).status).toBe(
      200,
    );
    expect((await f.fetch("/__probe/ok", { method: "OPTIONS" })).status).toBe(
      204,
    );
    expect(f.counts.select).toBe(5);
  } finally {
    f.client.close();
  }
});

test("distinct materialized databases retain independent accepted sweeps", async () => {
  const a = await harness();
  const b = await harness();
  try {
    await Promise.all([
      a.fetch("/__probe/ok", { method: "POST" }),
      b.fetch("/__probe/ok", { method: "POST" }),
    ]);
    expect(a.counts.select).toBe(5);
    expect(b.counts.select).toBe(5);
  } finally {
    a.client.close();
    b.client.close();
  }
});

test("waitUntil coalescing reruns for an accepted durable row created in flight", async () => {
  const f = await harness();
  const pending: Promise<unknown>[] = [];
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const sent: string[] = [];
  let first = true;
  async function send(body: { activityId?: string }) {
    sent.push(body.activityId!);
    if (first) {
      first = false;
      started.resolve();
      await gate.promise;
    }
  }
  const queue = {
    send,
    async sendBatch(messages: readonly { body: { activityId?: string } }[]) {
      for (const { body } of messages) await send(body);
    },
  };
  f.env.DELIVERY_QUEUE = queue as unknown as Env["DELIVERY_QUEUE"];
  f.env.DELIVERY_DLQ = queue as unknown as Env["DELIVERY_DLQ"];
  const fetch = () =>
    f.app.fetch(
      new Request("https://test.local/__probe/record", { method: "POST" }),
      f.env,
      {
        waitUntil(p: Promise<unknown>) {
          pending.push(p);
        },
      } as never,
    );
  try {
    try {
      expect((await fetch()).status).toBe(204);
      await started.promise;
      expect((await fetch()).status).toBe(204);
    } finally {
      gate.resolve();
      await Promise.all(pending);
    }
    expect(sent).toEqual([
      "https://test.local/ap/activities/local-recovery-1",
      "https://test.local/ap/activities/local-recovery-2",
    ]);
    expect(
      (
        await f.db
          .select({ status: deliveryFanouts.status })
          .from(deliveryFanouts)
      ).map((row) => row.status),
    ).toEqual(["published", "published"]);
    expect((await f.fetch("/__probe/record", { method: "POST" })).status).toBe(
      204,
    );
    expect(sent).toHaveLength(3);
    expect(sent[2]).toBe("https://test.local/ap/activities/local-recovery-3");
  } finally {
    f.client.close();
  }
});
