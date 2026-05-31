import { expect, test } from "bun:test";
import { Hono } from "hono";

import activitypubRoutes from "../../../routes/activitypub.ts";

function createCountDb(counts: number[]) {
  let index = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ total: counts[index++] ?? 0 }]),
      }),
    }),
  };
}

function createApp(db = createCountDb([1, 42])) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", activitypubRoutes);
  return app;
}

test("nodeinfo discovery returns schema 2.1 link", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("https://example.test/.well-known/nodeinfo"),
    { APP_URL: "https://example.test/" },
  );
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toEqual(200);
  expect(body).toEqual({
    links: [
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
        href: "https://example.test/nodeinfo/2.1",
      },
    ],
  });
});

test("nodeinfo 2.1 returns required schema fields", async () => {
  const app = createApp(createCountDb([1, 42]));
  const res = await app.fetch(
    new Request("https://example.test/nodeinfo/2.1"),
    { APP_URL: "https://example.test" },
  );
  const body = await res.json() as {
    version: string;
    software: { name: string; version: string };
    protocols: string[];
    services: { inbound: string[]; outbound: string[] };
    usage: {
      users: {
        total: number;
        activeMonth?: number;
        activeHalfyear?: number;
      };
      localPosts: number;
    };
    openRegistrations: boolean;
    metadata: { singleUser: boolean };
  };

  expect(res.status).toEqual(200);
  expect(body.version).toEqual("2.1");
  expect(body.software.name).toEqual("yurucommu");
  // Falls back to the in-sync default constant when no build version env set.
  expect(body.software.version).toEqual("1.0.0");
  expect(body.protocols).toEqual(["activitypub"]);
  expect(body.services).toEqual({ inbound: [], outbound: [] });
  expect(body.usage.users.total).toEqual(1);
  // activeMonth / activeHalfyear are omitted (not faked) because we do not
  // track per-user activity windows.
  expect(body.usage.users.activeMonth).toEqual(undefined);
  expect(body.usage.users.activeHalfyear).toEqual(undefined);
  expect(body.usage.localPosts).toEqual(42);
  expect(body.openRegistrations).toEqual(false);
  expect(body.metadata.singleUser).toEqual(true);
});

test("nodeinfo 2.1 reports build-injected software version", async () => {
  const app = createApp(createCountDb([1, 42]));
  const res = await app.fetch(
    new Request("https://example.test/nodeinfo/2.1"),
    {
      APP_URL: "https://example.test",
      YURUCOMMU_SOFTWARE_VERSION: "1.4.2+build7",
    },
  );
  const body = await res.json() as { software: { version: string } };

  expect(res.status).toEqual(200);
  expect(body.software.version).toEqual("1.4.2+build7");
});
