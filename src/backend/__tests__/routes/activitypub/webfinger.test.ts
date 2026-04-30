import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";
import activitypubRoutes from "../../../routes/activitypub.ts";

function createActorDb(
  responses: Array<{ apId: string; preferredUsername: string } | null>,
) {
  let index = 0;
  return {
    query: {
      actors: {
        findFirst: () => Promise.resolve(responses[index++] ?? null),
      },
    },
  };
}

function createApp(db: unknown) {
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

Deno.test("webfinger resolves unknown local acct username to owner actor", async () => {
  const owner = {
    apId: "https://example.test/ap/users/tako",
    preferredUsername: "tako",
  };
  const app = createApp(createActorDb([null, owner]));

  const res = await app.fetch(
    new Request(
      "https://example.test/.well-known/webfinger?resource=acct:any@example.test",
    ),
    { APP_URL: "https://example.test" },
  );
  const body = await res.json() as {
    subject: string;
    links: Array<{ rel: string; href: string }>;
  };

  assertEquals(res.status, 200);
  assertEquals(body.subject, "acct:any@example.test");
  assertEquals(
    body.links.find((link) => link.rel === "self")?.href,
    "https://example.test/ap/users/tako",
  );
  assertEquals(
    body.links.find((link) =>
      link.rel === "http://webfinger.net/rel/profile-page"
    )?.href,
    "https://example.test/users/tako",
  );
});

Deno.test("webfinger keeps exact local actor resolution when username exists", async () => {
  const alice = {
    apId: "https://example.test/ap/users/alice",
    preferredUsername: "alice",
  };
  const app = createApp(createActorDb([alice]));

  const res = await app.fetch(
    new Request(
      "https://example.test/.well-known/webfinger?resource=acct:alice@example.test",
    ),
    { APP_URL: "https://example.test" },
  );
  const body = await res.json() as {
    subject: string;
    links: Array<{ rel: string; href: string }>;
  };

  assertEquals(res.status, 200);
  assertEquals(body.subject, "acct:alice@example.test");
  assertEquals(
    body.links.find((link) => link.rel === "self")?.href,
    "https://example.test/ap/users/alice",
  );
});
