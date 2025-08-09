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
    const list = await db.listInstances(String(user._id));
    return c.json(list);
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

      const count = await db.countInstances(String(user._id));
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

      const exists = await db.findInstanceByHost(fullHost);
      if (exists) {
        return c.json({ error: "already exists" }, 400);
      }
      const env: Record<string, string> = {};
      if (rootDomain) {
        env.OAUTH_HOST = rootDomain;
        const redirect = `https://${fullHost}`;
        const clientId = redirect;
        let clientSecret: string;
        const existsCli = await db.findOAuthClient(clientId);
        if (existsCli) {
          clientSecret = existsCli.clientSecret;
        } else {
          clientSecret = crypto.randomUUID();
          await db.createOAuthClient({
            clientId,
            clientSecret,
            redirectUri: redirect,
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
      await db.createInstance({
        host: fullHost,
        owner: String(user._id),
        env,
      });
      await ensureTenant(db, fullHost, fullHost);
      invalidate?.(fullHost);
      return c.json({ success: true, host: fullHost });
    },
  );

  app.delete("/instances/:host", async (c) => {
    const host = c.req.param("host").toLowerCase();
    const user = c.get("user") as HostUserDoc;
    await db.deleteInstance(host, String(user._id));
    invalidate?.(host);
    return c.json({ success: true });
  });

  app.get("/instances/:host", async (c) => {
    const host = c.req.param("host").toLowerCase();
    const user = c.get("user") as HostUserDoc;
    const inst = await db.findInstanceByHostAndOwner(host, String(user._id));
    if (!inst) {
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
      const inst = await db.findInstanceByHostAndOwner(host, String(user._id));
      if (!inst) return c.json({ error: "not found" }, 404);
      if (password) {
        const salt = crypto.randomUUID();
        const hashedPassword = await hash(password);
        const newEnv = { ...(inst.env ?? {}), hashedPassword, salt };
        await db.updateInstanceEnv(inst._id, newEnv);
      } else if (inst.env) {
        const newEnv = { ...inst.env };
        delete newEnv.hashedPassword;
        delete newEnv.salt;
        await db.updateInstanceEnv(inst._id, newEnv);
      }
      invalidate?.(host);
      return c.json({ success: true });
    },
  );

  app.post("/instances/:host/restart", async (c) => {
    const host = c.req.param("host").toLowerCase();
    const user = c.get("user") as HostUserDoc;
    const inst = await db.findInstanceByHostAndOwner(host, String(user._id));
    if (!inst) return c.json({ error: "not found" }, 404);
    invalidate?.(host);
    return c.json({ success: true });
  });

  app.get("/oauth/clients", async (c) => {
    const list = await db.listOAuthClients();
    return c.json(list);
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
      const exists = await db.findOAuthClient(clientId);
      if (exists) return c.json({ error: "exists" }, 400);
      await db.createOAuthClient({ clientId, clientSecret, redirectUri });
      return c.json({ success: true });
    },
  );

  app.get("/domains", async (c) => {
    const user = c.get("user") as HostUserDoc;
    const list = await db.listHostDomains(String(user._id));
    return c.json(list);
  });

  app.post(
    "/domains",
    zValidator("json", z.object({ domain: z.string() })),
    async (c) => {
      const { domain } = c.req.valid("json");
      const user = c.get("user") as HostUserDoc;
      const exists = await db.findHostDomain(domain);
      if (exists) return c.json({ error: "exists" }, 400);
      const token = crypto.randomUUID();
      await db.createHostDomain(domain, String(user._id), token);
      return c.json({ success: true, token });
    },
  );

  app.post("/domains/:domain/verify", async (c) => {
    const domain = c.req.param("domain");
    const user = c.get("user") as HostUserDoc;
    const doc = await db.findHostDomain(domain, String(user._id));
    if (!doc) return c.json({ error: "not found" }, 404);
    try {
      const res = await fetch(
        `http://${domain}/.well-known/takos-host-verification.txt`,
      );
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text === doc.token) {
          await db.verifyHostDomain(doc._id);
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
