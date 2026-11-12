import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { InArgs, InStatement } from "@libsql/client";
import { isSameActivityPubActor } from "../../lib/activitypub-actor-identity.ts";
import { blockActor } from "../../lib/blocklist.ts";
import { actors, actorCache } from "../../../db/index.ts";
import { admitSessionRequest } from "../../lib/account-deletion-admission.ts";
import { resolveActorApId } from "../../routes/actors-helpers.ts";
import actorsRoute from "../../routes/actors.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://handle.test";
const clients: Awaited<ReturnType<typeof createTestDb>>["client"][] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function fixture(ids: string[], username = "member") {
  const { db, client } = await createTestDb();
  clients.push(client);
  const ownerApId = `${APP_URL}/ap/users/owner`;
  await db.insert(actors).values({
    apId: ownerApId,
    preferredUsername: "owner",
    inbox: `${ownerApId}/inbox`,
    outbox: `${ownerApId}/outbox`,
    followersUrl: `${ownerApId}/followers`,
    followingUrl: `${ownerApId}/following`,
    publicKeyPem: "unused-local-fixture",
    privateKeyPem: "unused-local-fixture",
  });
  const owner = {
    ap_id: ownerApId,
    preferred_username: "owner",
    public_key_pem: "unused-local-fixture",
    takos_user_id: null,
  } as Actor;
  for (const apId of ids) {
    await db.insert(actorCache).values({
      apId,
      preferredUsername: username,
      inbox: "https://remote.example/inbox",
      rawJson: "{}",
    });
  }
  const lookups: { sql: string; rows: number; binds: number }[] = [];
  const execute = client.execute.bind(client);
  client.execute = async (statement: InStatement, args?: InArgs) => {
    const query = typeof statement === "string" ? statement : statement.sql;
    const parameters =
      (typeof statement === "string" ? args : statement.args) ?? [];
    const result = await execute(query, parameters);
    if (/^select "ap_id" from "actor_cache" where/.test(query)) {
      lookups.push({
        sql: query,
        rows: result.rows.length,
        binds: Object.keys(parameters).length,
      });
    }
    return result;
  };
  async function request(identifier: string) {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("actor", owner);
      await admitSessionRequest(c, next);
    });
    app.route("/api/actors", actorsRoute);
    return app.fetch(
      new Request(`${APP_URL}/api/actors/${encodeURIComponent(identifier)}`),
      { APP_URL, DB_INSTANCE: db } as Env,
    );
  }
  return { db, client, owner, request, lookups };
}

for (const [kind, id, expected] of [
  [
    "exact host",
    "https://remote.example/users/member",
    "https://remote.example/users/member",
  ],
  [
    "another host with the domain in its query",
    "https://other.example/users/member?note=remote.example",
    null,
  ],
  [
    "another host with the domain in its path",
    "https://other.example/remote.example/member",
    null,
  ],
  ["a host suffix", "https://remote.example.other.example/users/member", null],
] as const) {
  test(`handle resolution uses ${kind}`, async () => {
    const f = await fixture([id]);
    const handle = "@member@remote.example";
    const resolved = await resolveActorApId(f.db, APP_URL, handle);
    const response = await f.request(handle);
    expect({ resolved, status: response.status }).toEqual({
      resolved: expected,
      status: expected ? 200 : 404,
    });
    if (expected) expect((await response.json()).actor.ap_id).toBe(expected);
    else expect(await response.json()).toEqual({ error: "Actor not found" });
  });
}

for (const [handle, id] of [
  ["@member@REMOTE.EXAMPLE", "https://remote.example/users/member"],
  [
    `@member@${"x".repeat(51)}.example`,
    `https://${"x".repeat(51)}.example/users/member`,
  ],
  ["member@remote.example", "https://REMOTE.EXAMPLE/users/member"],
  ["@member@remote.example:443", "https://remote.example/users/member"],
  ["@member@remote.example", "https://remote.example:443/users/member"],
  ["@member@remote.example:80", "http://remote.example/users/member"],
  ["@member@remote.example", "http://remote.example:80/users/member"],
  ["@member@remote.example:8443", "https://remote.example:8443/users/member"],
  ["@member@例え.example", "https://xn--r8jz45g.example/users/member"],
  ["@member@xn--r8jz45g.example", "https://例え.example/users/member"],
  ["@member@[2001:db8::1]:8787", "http://[2001:0db8::1]:8787/users/member"],
] as const) {
  test(`handle authority normalization preserves ${handle} -> ${id}`, async () => {
    const f = await fixture([id]);
    expect(await resolveActorApId(f.db, APP_URL, handle)).toBe(id);
    const response = await f.request(handle);
    expect(response.status).toBe(200);
    expect((await response.json()).actor.ap_id).toBe(id);
  });
}

test("a non-default port cannot satisfy the same hostname without that port", async () => {
  const f = await fixture(["https://remote.example:8443/users/member"]);
  expect(
    await resolveActorApId(f.db, APP_URL, "@member@remote.example"),
  ).toBeNull();
  expect((await f.request("@member@remote.example")).status).toBe(404);
});

test("local bare names and canonical handle authorities retain the original AP ID", async () => {
  const f = await fixture([]);
  for (const identifier of [
    "owner",
    "@owner",
    "@owner@handle.test",
    "owner@HANDLE.TEST",
    "@owner@handle.test:443",
  ]) {
    expect(await resolveActorApId(f.db, APP_URL, identifier)).toBe(
      f.owner.ap_id,
    );
    const response = await f.request(identifier);
    expect(response.status).toBe(200);
    expect((await response.json()).actor.ap_id).toBe(f.owner.ap_id);
  }
  expect(f.lookups).toHaveLength(0);
});

test("direct AP IDs preserve path/query identity and remain available when a handle is ambiguous", async () => {
  const ids = [
    "https://remote.example/users/member?version=1",
    "https://remote.example/users/Member?version=2",
  ];
  const f = await fixture(ids);
  expect(
    await resolveActorApId(f.db, APP_URL, "@member@remote.example"),
  ).toBeNull();
  expect((await f.request("@member@remote.example")).status).toBe(404);
  for (const id of ids) {
    expect(await resolveActorApId(f.db, APP_URL, id)).toBe(id);
    const response = await f.request(id);
    expect(response.status).toBe(200);
    expect((await response.json()).actor.ap_id).toBe(id);
  }
});

test("cosmetic cache aliases use the existing actor equivalence without merging different paths", async () => {
  const ids = [
    "https://remote.example/users/member",
    "https://REMOTE.EXAMPLE:443/users/member/#presentation",
  ];
  const f = await fixture(ids);
  const resolved = await resolveActorApId(
    f.db,
    APP_URL,
    "@member@remote.example",
  );
  expect(ids.includes(resolved ?? "")).toBe(true);
  expect(isSameActivityPubActor(resolved, ids[0])).toBe(true);
  const response = await f.request("@member@remote.example");
  expect(response.status).toBe(200);
  expect(
    isSameActivityPubActor((await response.json()).actor.ap_id, ids[0]),
  ).toBe(true);
});

test("malformed handle authorities are refused before cache SQL", async () => {
  const f = await fixture(["https://remote.example/users/member"]);
  for (const domain of [
    "%",
    "remote.example%",
    "remote.example/path",
    "remote.example/",
    "remote.example?x=1",
    "remote.example#fragment",
    "remote.example@other.example",
    "remote.example\\other.example",
    " remote.example",
    "remote.example ",
    "remote.example:",
    "",
  ]) {
    expect(
      await resolveActorApId(f.db, APP_URL, `@member@${domain}`),
    ).toBeNull();
    expect((await f.request(`@member@${domain}`)).status).toBe(404);
  }
  expect(f.lookups).toHaveLength(0);
});

test("username metacharacters remain literal parameters rather than SQL wildcards", async () => {
  const id = "https://remote.example/users/literal";
  const f = await fixture([id], "member_%");
  expect(
    await resolveActorApId(f.db, APP_URL, "@member_%@remote.example"),
  ).toBe(id);
  expect(
    await resolveActorApId(f.db, APP_URL, "@member@remote.example"),
  ).toBeNull();
  expect(f.lookups).toHaveLength(2);
  expect(f.lookups.every((q) => !/\blike\b/i.test(q.sql) && q.binds <= 2)).toBe(
    true,
  );
});

for (const id of [
  "not-a-url-remote.example",
  "ftp://remote.example/users/member",
  "https://info@remote.example/users/member",
]) {
  test(`invalid or credential-bearing cache ID cannot satisfy a handle: ${id}`, async () => {
    const f = await fixture([id]);
    expect(
      await resolveActorApId(f.db, APP_URL, "@member@remote.example"),
    ).toBeNull();
    expect((await f.request("@member@remote.example")).status).toBe(404);
  });
}

test("a correct host is selected regardless of another row's path/query text, with operator blocks preserved", async () => {
  const id = "https://remote.example/users/member";
  const f = await fixture([
    "https://other.example/users/member?note=remote.example",
    id,
  ]);
  expect(await resolveActorApId(f.db, APP_URL, "@member@remote.example")).toBe(
    id,
  );
  expect((await f.request("@member@remote.example")).status).toBe(200);
  await blockActor(f.db, id, "isolated-fixture");
  expect((await f.request("@member@remote.example")).status).toBe(404);
});

for (const count of [100, 101]) {
  test(`cache candidate lookup is bounded and fails closed at ${count} rows`, async () => {
    const id = "https://remote.example/users/member";
    const ids = [
      id,
      ...Array.from(
        { length: count - 1 },
        (_, n) => `https://r${n}.example/users/member`,
      ),
    ];
    const f = await fixture(ids);
    expect(
      await resolveActorApId(f.db, APP_URL, "@member@remote.example"),
    ).toBe(count === 100 ? id : null);
    expect(f.lookups).toHaveLength(1);
    expect(f.lookups[0].rows).toBe(count);
    expect(f.lookups[0].binds).toBe(2);
    expect(f.lookups[0].sql).toContain("limit ?");
    expect(f.lookups[0].sql).not.toContain("raw_json");
    expect((await f.request("@member@remote.example")).status).toBe(
      count === 100 ? 200 : 404,
    );
    // The bound is specific to handle lookup, not a blanket profile outage.
    const direct = await f.request(id);
    expect(direct.status).toBe(200);
    expect((await direct.json()).actor.ap_id).toBe(id);
  });
}
