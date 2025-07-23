import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authRequired, hash } from "./auth.ts";

import { ObjectId } from "mongodb";

interface HostUserDoc {
  _id: ObjectId;
  userName: string;
  email: string;
  emailVerified: boolean;
  verifyCode?: string;
  verifyCodeExpires?: Date;
  hashedPassword: string;
  salt: string;
  createdAt: Date;
}
import { createDB } from "../api/DB/mod.ts";
import { ensureTenant } from "../api/services/tenant.ts";

export function createConsumerApp(
  invalidate?: (host: string) => void,
  options?: {
    rootDomain?: string;
    freeLimit?: number;
    reservedSubdomains?: string[];
  },
) {
  const app = new Hono<{ Variables: { user: HostUserDoc } }>();
  const db = createDB({ DB_MODE: "host" });
  const rootDomain = options?.rootDomain?.toLowerCase() ?? "";
  const freeLimit = options?.freeLimit ?? 1;
  const reserved = new Set(options?.reservedSubdomains ?? []);

  app.use("/*", authRequired);

  app.get("/instances", async (c) => {
    const user = c.get("user") as HostUserDoc;
    const col = (await db.getDatabase()).collection("instances");
    const list = await col.find({ owner: user._id }).toArray();
    return c.json(list.map((i) => ({ host: i.host })));
  });

  app.post(
    "/instances",
    zValidator(
      "json",
      z.object({ host: z.string(), password: z.string().optional() }),
    ),
    async (c) => {
      const { host: rawHost, password } = c.req.valid("json");
      const host = rawHost.toLowerCase();
      const user = c.get("user") as HostUserDoc;

      const instCol = (await db.getDatabase()).collection("instances");
      const count = await instCol.countDocuments({ owner: user._id });
      if (count >= freeLimit) {
        return c.json({ error: "limit" }, 400);
      }

      let fullHost = host;
      if (rootDomain) {
        if (host.includes(".")) {
          if (!host.endsWith(`.${rootDomain}`) || host === rootDomain) {
            return c.json({ error: "domain" }, 400);
          }
          fullHost = host;
          const sub = host.slice(0, -rootDomain.length - 1);
          if (reserved.has(sub)) {
            return c.json({ error: "reserved" }, 400);
          }
        } else {
          if (reserved.has(host)) {
            return c.json({ error: "reserved" }, 400);
          }
          fullHost = `${host}.${rootDomain}`;
        }
      }
      if (!rootDomain && reserved.has(host)) {
        return c.json({ error: "reserved" }, 400);
      }

      const exists = await instCol.findOne({ host: fullHost });
      if (exists) {
        return c.json({ error: "already exists" }, 400);
      }
      const env: Record<string, string> = {};
      if (rootDomain) {
        env.OAUTH_HOST = rootDomain;
        const redirect = `https://${fullHost}`;
        const clientId = redirect;
        let clientSecret: string;
        const cliCol = (await db.getDatabase()).collection("oauthclients");
        const existsCli = await cliCol.findOne<{ clientSecret: string }>({
          clientId,
        });
        if (existsCli) {
          clientSecret = existsCli.clientSecret;
        } else {
          clientSecret = crypto.randomUUID();
          await cliCol.insertOne({
            clientId,
            clientSecret,
            redirectUri: redirect,
            createdAt: new Date(),
          });
        }
        env.OAUTH_CLIENT_ID = clientId;
        env.OAUTH_CLIENT_SECRET = clientSecret;
      }
      if (password) {
        const salt = crypto.randomUUID();
        const hashedPassword = await hash(password);
        env.hashedPassword = hashedPassword;
        env.salt = salt;
      }
      await instCol.insertOne({
        host: fullHost,
        owner: user._id,
        env,
        createdAt: new Date(),
      });
      await ensureTenant(db, fullHost, fullHost);
      if (rootDomain) {
        const exists = await db.findRelayByHost(rootDomain);
        if (!exists) {
          await db.createRelay({
            host: rootDomain,
            inboxUrl: `https://${rootDomain}/inbox`,
          });
        }
        const relayDb = createDB({
          ...env,
          ACTIVITYPUB_DOMAIN: fullHost,
          DB_MODE: "host",
        });
        await relayDb.addRelay(rootDomain, "pull");
        await relayDb.addRelay(rootDomain, "push");
      }
      invalidate?.(fullHost);
      return c.json({ success: true, host: fullHost });
    },
  );

  app.delete("/instances/:host", async (c) => {
    const host = c.req.param("host").toLowerCase();
    const user = c.get("user") as HostUserDoc;
    const col = (await db.getDatabase()).collection("instances");
    await col.deleteOne({ host, owner: user._id });
    invalidate?.(host);
    return c.json({ success: true });
  });

  app.get("/instances/:host", async (c) => {
    const host = c.req.param("host").toLowerCase();
    const user = c.get("user") as HostUserDoc;
    const col = (await db.getDatabase()).collection("instances");
    const inst = await col.findOne({ host, owner: user._id });
    if (!inst || Array.isArray(inst)) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ host: inst.host });
  });

  app.put(
    "/instances/:host/password",
    zValidator("json", z.object({ password: z.string().optional() })),
    async (c) => {
      const host = c.req.param("host").toLowerCase();
      const { password } = c.req.valid("json");
      const user = c.get("user") as HostUserDoc;
      const col = (await db.getDatabase()).collection("instances");
      const inst = await col.findOne<
        { _id: ObjectId; env?: Record<string, string> }
      >(
        { host, owner: user._id },
      );
      if (!inst) return c.json({ error: "not found" }, 404);
      if (password) {
        const salt = crypto.randomUUID();
        const hashedPassword = await hash(password);
        const newEnv = { ...(inst.env ?? {}), hashedPassword, salt };
        await col.updateOne({ _id: inst._id }, { $set: { env: newEnv } });
      } else if (inst.env) {
        const newEnv = { ...inst.env };
        delete newEnv.hashedPassword;
        delete newEnv.salt;
        await col.updateOne({ _id: inst._id }, { $set: { env: newEnv } });
      }
      invalidate?.(host);
      return c.json({ success: true });
    },
  );

  app.post("/instances/:host/restart", async (c) => {
    const host = c.req.param("host").toLowerCase();
    const user = c.get("user") as HostUserDoc;
    const col = (await db.getDatabase()).collection("instances");
    const inst = await col.findOne({ host, owner: user._id });
    if (!inst) return c.json({ error: "not found" }, 404);
    invalidate?.(host);
    return c.json({ success: true });
  });

  app.get("/oauth/clients", async (c) => {
    const col = (await db.getDatabase()).collection("oauthclients");
    const list = await col.find().toArray();
    return c.json(
      list.map((cli) => ({
        clientId: cli.clientId,
        redirectUri: cli.redirectUri,
      })),
    );
  });

  app.post(
    "/oauth/clients",
    zValidator(
      "json",
      z.object({
        clientId: z.string(),
        clientSecret: z.string(),
        redirectUri: z.string(),
      }),
    ),
    async (c) => {
      const { clientId, clientSecret, redirectUri } = c.req.valid("json");
      const col = (await db.getDatabase()).collection("oauthclients");
      const exists = await col.findOne({ clientId });
      if (exists) return c.json({ error: "exists" }, 400);
      await col.insertOne({
        clientId,
        clientSecret,
        redirectUri,
        createdAt: new Date(),
      });
      return c.json({ success: true });
    },
  );

  app.get("/domains", async (c) => {
    const user = c.get("user") as HostUserDoc;
    const col = (await db.getDatabase()).collection("hostdomains");
    const list = await col.find({ user: user._id }).toArray();
    return c.json(
      list.map((d) => ({ domain: d.domain, verified: d.verified })),
    );
  });

  app.post(
    "/domains",
    zValidator("json", z.object({ domain: z.string() })),
    async (c) => {
      const { domain } = c.req.valid("json");
      const user = c.get("user") as HostUserDoc;
      const col = (await db.getDatabase()).collection("hostdomains");
      const exists = await col.findOne({ domain });
      if (exists) return c.json({ error: "exists" }, 400);
      const token = crypto.randomUUID();
      await col.insertOne({
        domain,
        user: user._id,
        token,
        verified: false,
        createdAt: new Date(),
      });
      return c.json({ success: true, token });
    },
  );

  app.post("/domains/:domain/verify", async (c) => {
    const domain = c.req.param("domain");
    const user = c.get("user") as HostUserDoc;
    const col = (await db.getDatabase()).collection("hostdomains");
    const doc = await col.findOne<
      { _id: ObjectId; token: string; verified: boolean }
    >(
      { domain, user: user._id },
    );
    if (!doc) return c.json({ error: "not found" }, 404);
    try {
      const res = await fetch(
        `http://${domain}/.well-known/takos-host-verification.txt`,
      );
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text === doc.token) {
          await col.updateOne(
            { _id: doc._id },
            { $set: { verified: true } },
          );
          return c.json({ success: true });
        }
      }
    } catch {
      // ignore
    }
    return c.json({ error: "verify" }, 400);
  });

  return app;
}
