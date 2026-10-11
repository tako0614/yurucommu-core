import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import { actors, sessions, type Database } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";
import { extractActorFromSession } from "../../lib/session-actor.ts";
import { createErrorMiddleware } from "../../middleware/error-handler.ts";
import { MemoryKV } from "../../runtime/memory-kv.ts";
import authRoutes from "../../routes/auth.ts";
import { createActor, deleteSessionSafely } from "../../routes/auth-helpers.ts";

async function fixture() {
  const client = createClient({ url: ":memory:" });
  try {
    const root = new URL("../../../../migrations/", import.meta.url);
    for (const name of (await readdir(root))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      await client.executeMultiple(await readFile(new URL(name, root), "utf8"));
    }
    const db = drizzle(client, { schema }) as unknown as Database;
    const env = {
      APP_URL: "https://revocation.test",
      AUTH_PASSWORD_HASH: "revocation-test-password",
      YURUCOMMU_SESSION_HASH_SALT: "revocation-test-salt",
      ENCRYPTION_KEY: "00".repeat(32),
      KV: new MemoryKV(),
    } as unknown as Env;
    const owner = await createActor(db, env, {
      username: "owner",
      name: "Owner",
      takosUserId: "password:owner",
      role: "owner",
    });
    const persona = await createActor(db, env, {
      username: "persona",
      name: "Persona",
      takosUserId: "local:persona",
      role: "member",
      ownerActorApId: owner.apId,
    });
    const raw = "private-old-session-fixture";
    const siblingRaw = "private-sibling-session-fixture";
    const key = await hashSessionIdForEnv(env, raw);
    const siblingKey = await hashSessionIdForEnv(env, siblingRaw);
    for (const id of [key, siblingKey]) {
      await db.insert(sessions).values({
        id,
        accessToken: id,
        memberId: owner.apId,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        provider: "takos",
        providerAccessToken: "encrypted-provider-fixture",
      });
    }
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.onError(createErrorMiddleware({ logger: () => {} }));
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("actor", null);
      await extractActorFromSession(c);
      await next();
    });
    app.route("/api/auth", authRoutes);
    const request = (
      path: string,
      headers: Record<string, string> = {},
      body?: unknown,
    ) =>
      app.request(
        path,
        {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json", ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        env,
      );
    const row = (id: string) =>
      db.select().from(sessions).where(eq(sessions.id, id)).get();
    const rejectDelete = () =>
      client.executeMultiple(
        `CREATE TRIGGER reject_fixture_session_delete BEFORE DELETE ON sessions
       WHEN OLD.id = '${key}' BEGIN SELECT RAISE(ABORT, 'fixture_session_delete_refused'); END;`,
      );
    return {
      client,
      db,
      env,
      owner,
      persona,
      raw,
      siblingRaw,
      key,
      siblingKey,
      request,
      row,
      rejectDelete,
    };
  } catch (error) {
    client.close();
    throw error;
  }
}

for (const credential of ["cookie", "bearer"] as const) {
  test(`logout ${credential} reports durable revocation failure without clearing the cookie`, async () => {
    const f = await fixture();
    try {
      const headers: Record<string, string> =
        credential === "cookie"
          ? { cookie: `session=${f.raw}` }
          : { authorization: `Bearer ${f.raw}` };
      const before = await f.row(f.key);
      const sibling = await f.row(f.siblingKey);
      await f.rejectDelete();
      const response = await f.request("/api/auth/logout", headers, {});
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "SESSION_REVOCATION_FAILED",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await f.row(f.key)).toEqual(before);
      expect(await f.row(f.siblingKey)).toEqual(sibling);
      expect((await f.request("/api/auth/me", headers)).status).toBe(200);
    } finally {
      f.client.close();
    }
  });
}

for (const path of [
  "/api/auth/login",
  "/api/auth/mobile/login",
  "/api/auth/switch",
]) {
  test(`${path} stops rotation before cookie changes or replacement issuance on delete failure`, async () => {
    const f = await fixture();
    try {
      const before = await f.db.select().from(sessions).all();
      await f.rejectDelete();
      const body = path.endsWith("/switch")
        ? { ap_id: f.persona.apId }
        : { password: "revocation-test-password" };
      const response = await f.request(
        path,
        { cookie: `session=${f.raw}` },
        body,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "SESSION_REVOCATION_FAILED",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await f.db.select().from(sessions).all()).toEqual(before);
      expect(
        (await f.request("/api/auth/me", { cookie: `session=${f.raw}` }))
          .status,
      ).toBe(200);
    } finally {
      f.client.close();
    }
  });
}

test("logout removes the selected salted credential, rejects both replay forms, and preserves its sibling", async () => {
  const f = await fixture();
  try {
    const sibling = await f.row(f.siblingKey);
    const response = await f.request(
      "/api/auth/logout",
      {
        cookie: `session=${f.raw}`,
        authorization: `Bearer ${f.siblingRaw}`,
      },
      {},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await f.row(f.key)).toBeUndefined();
    expect(await f.row(f.siblingKey)).toEqual(sibling);
    expect(
      (await f.request("/api/auth/me", { cookie: `session=${f.raw}` })).status,
    ).toBe(401);
    expect(
      (await f.request("/api/auth/me", { authorization: `Bearer ${f.raw}` }))
        .status,
    ).toBe(401);
    expect(
      (
        await f.request("/api/auth/me", {
          authorization: `Bearer ${f.siblingRaw}`,
        })
      ).status,
    ).toBe(200);
    const repetitions = await Promise.all([
      f.request("/api/auth/logout", { cookie: `session=${f.raw}` }, {}),
      f.request("/api/auth/logout", { authorization: `Bearer ${f.raw}` }, {}),
      f.request("/api/auth/logout", {}, {}),
    ]);
    expect(repetitions.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(await f.row(f.siblingKey)).toEqual(sibling);
  } finally {
    f.client.close();
  }
});

test("logout revokes a tombstoned actor's surviving credential before restoration", async () => {
  const f = await fixture();
  try {
    await f.db
      .update(actors)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(actors.apId, f.owner.apId));
    expect(
      (await f.request("/api/auth/me", { cookie: `session=${f.raw}` })).status,
    ).toBe(401);
    const response = await f.request(
      "/api/auth/logout",
      { cookie: `session=${f.raw}` },
      {},
    );
    expect(response.status).toBe(200);
    expect(await f.row(f.key)).toBeUndefined();
    await f.db
      .update(actors)
      .set({ deletedAt: null })
      .where(eq(actors.apId, f.owner.apId));
    expect(
      (await f.request("/api/auth/me", { authorization: `Bearer ${f.raw}` }))
        .status,
    ).toBe(401);
    expect(
      (
        await f.request("/api/auth/me", {
          authorization: `Bearer ${f.siblingRaw}`,
        })
      ).status,
    ).toBe(200);
  } finally {
    f.client.close();
  }
});

test("session hashing failure is propagated without reaching deletion", async () => {
  const f = await fixture();
  const originalDigest = crypto.subtle.digest;
  try {
    crypto.subtle.digest = (() =>
      Promise.reject(
        new Error("fixture hash unavailable"),
      )) as typeof originalDigest;
    await expect(
      deleteSessionSafely(f.db, f.env, f.raw, "hash fixture"),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "SESSION_REVOCATION_FAILED",
    });
  } finally {
    crypto.subtle.digest = originalDigest;
    expect(await f.row(f.key)).toBeTruthy();
    f.client.close();
  }
});
