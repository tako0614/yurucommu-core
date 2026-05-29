import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";
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

Deno.test("nodeinfo discovery returns schema 2.1 link", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("https://example.test/.well-known/nodeinfo"),
    { APP_URL: "https://example.test/" },
  );
  const body = await res.json() as Record<string, unknown>;

  assertEquals(res.status, 200);
  assertEquals(body, {
    links: [
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
        href: "https://example.test/nodeinfo/2.1",
      },
    ],
  });
});

Deno.test("nodeinfo 2.1 returns required schema fields", async () => {
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

  assertEquals(res.status, 200);
  assertEquals(body.version, "2.1");
  assertEquals(body.software.name, "yurucommu");
  // Falls back to the in-sync default constant when no build version env set.
  assertEquals(body.software.version, "1.0.0");
  assertEquals(body.protocols, ["activitypub"]);
  assertEquals(body.services, { inbound: [], outbound: [] });
  assertEquals(body.usage.users.total, 1);
  // activeMonth / activeHalfyear are omitted (not faked) because we do not
  // track per-user activity windows.
  assertEquals(body.usage.users.activeMonth, undefined);
  assertEquals(body.usage.users.activeHalfyear, undefined);
  assertEquals(body.usage.localPosts, 42);
  assertEquals(body.openRegistrations, false);
  assertEquals(body.metadata.singleUser, true);
});

Deno.test("nodeinfo 2.1 reports build-injected software version", async () => {
  const app = createApp(createCountDb([1, 42]));
  const res = await app.fetch(
    new Request("https://example.test/nodeinfo/2.1"),
    {
      APP_URL: "https://example.test",
      YURUCOMMU_SOFTWARE_VERSION: "1.4.2+build7",
    },
  );
  const body = await res.json() as { software: { version: string } };

  assertEquals(res.status, 200);
  assertEquals(body.software.version, "1.4.2+build7");
});
