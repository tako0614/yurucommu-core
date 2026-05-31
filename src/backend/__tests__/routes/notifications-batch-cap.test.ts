import { expect, test } from "bun:test";
import { Hono } from "hono";

import notificationRoutes from "../../routes/notifications.ts";

const MAX_BATCH = 100;

/**
 * Minimal DB stub. The batch-size cap is enforced before any DB access, so the
 * update/delete builders only need to record whether they were reached. If a
 * cap check fails to short-circuit, the test asserts these were never invoked.
 */
function createTrackingDb() {
  const tracker = { updateCalls: 0, deleteCalls: 0 };
  const updateChain = {
    set: () => ({
      where: () => Promise.resolve({ meta: { changes: 0 } }),
    }),
  };
  const deleteChain = {
    where: () => Promise.resolve(undefined),
  };
  return {
    db: {
      update: () => {
        tracker.updateCalls++;
        return updateChain;
      },
      delete: () => {
        tracker.deleteCalls++;
        return deleteChain;
      },
    },
    tracker,
  };
}

function createApp(db: unknown, actor: { ap_id: string }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const setter = c as unknown as {
      set: (key: string, value: unknown) => void;
    };
    setter.set("db", db);
    setter.set("actor", actor);
    await next();
  });
  app.route("/api/notifications", notificationRoutes);
  return app;
}

async function requestJson(app: Hono, path: string, init: RequestInit) {
  const res = await app.fetch(new Request(`https://test.local${path}`, init));
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}

const actor = { ap_id: "https://example.com/ap/users/alice" };

function oversizedIds(): string[] {
  return Array.from(
    { length: MAX_BATCH + 1 },
    (_, i) => `https://example.com/activities/${i}`,
  );
}

test("POST /read rejects oversized ids array with 400 array_too_long", async () => {
  const { db, tracker } = createTrackingDb();
  const app = createApp(db, actor);

  const { res, body } = await requestJson(app, "/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: oversizedIds() }),
  });

  expect(res.status).toEqual(400);
  expect(body).toEqual(expect.any(Object));
  // Must short-circuit before touching the DB.
  expect(tracker.updateCalls).toEqual(0);
});

test("POST /read accepts ids array at the cap", async () => {
  const { db, tracker } = createTrackingDb();
  const app = createApp(db, actor);
  const ids = Array.from(
    { length: MAX_BATCH },
    (_, i) => `https://example.com/activities/${i}`,
  );

  const { res, body } = await requestJson(app, "/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  expect(res.status).toEqual(200);
  expect(body).toEqual(expect.any(Object));
  expect(tracker.updateCalls).toEqual(1);
});

test("DELETE /archive rejects oversized ids array with 400 array_too_long", async () => {
  const { db, tracker } = createTrackingDb();
  const app = createApp(db, actor);

  const { res, body } = await requestJson(app, "/api/notifications/archive", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: oversizedIds() }),
  });

  expect(res.status).toEqual(400);
  expect(body).toEqual(expect.any(Object));
  expect(tracker.deleteCalls).toEqual(0);
});
