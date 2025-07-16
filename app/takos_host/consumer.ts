import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import Instance from "./models/instance.ts";
import { authRequired, hash } from "./auth.ts";
import HostDomain from "./models/domain.ts";
import OAuthClient from "./models/oauth_client.ts";
import type HostUser from "./models/user.ts";
import { addRelayEdge } from "../api/services/unified_store.ts";
import { ensureTenant } from "../api/services/tenant.ts";

export function createConsumerApp(
  invalidate?: (host: string) => void,
  options?: { rootDomain?: string; freeLimit?: number },
) {
  const app = new Hono();
  const rootDomain = options?.rootDomain ?? "";
  const freeLimit = options?.freeLimit ?? 1;

  app.use("/*", authRequired);

  app.get("/instances", async (c) => {
    const user = c.get("user") as HostUser;
    const list = await Instance.find({ owner: user._id }).lean();
    return c.json(list.map((i) => ({ host: i.host })));
  });

  app.post(
    "/instances",
    zValidator(
      "json",
      z.object({ host: z.string(), password: z.string().optional() }),
    ),
    async (c) => {
      const { host, password } = c.req.valid("json");
      const user = c.get("user") as HostUser;

      const count = await Instance.countDocuments({ owner: user._id });
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
        } else {
          fullHost = `${host}.${rootDomain}`;
        }
      }

      const exists = await Instance.findOne({ host: fullHost });
      if (exists) {
        return c.json({ error: "already exists" }, 400);
      }
      const env: Record<string, string> = {};
      if (password) {
        const salt = crypto.randomUUID();
        const hashedPassword = await hash(password + salt);
        env.hashedPassword = hashedPassword;
        env.salt = salt;
      }
      const inst = new Instance({
        host: fullHost,
        owner: user._id,
        env,
      });
      await inst.save();
      await ensureTenant(fullHost, fullHost);
      if (rootDomain) {
        await addRelayEdge(fullHost, rootDomain, "pull");
        await addRelayEdge(fullHost, rootDomain, "push");
      }
      invalidate?.(fullHost);
      return c.json({ success: true, host: fullHost });
    },
  );

  app.delete("/instances/:host", async (c) => {
    const host = c.req.param("host");
    const user = c.get("user") as HostUser;
    await Instance.deleteOne({ host, owner: user._id });
    invalidate?.(host);
    return c.json({ success: true });
  });

  app.get("/instances/:host", async (c) => {
    const host = c.req.param("host");
    const user = c.get("user") as HostUser;
    const inst = await Instance.findOne({ host, owner: user._id }).lean();
    if (!inst) return c.json({ error: "not found" }, 404);
    return c.json({ host: inst.host, env: inst.env });
  });

  app.put(
    "/instances/:host/env",
    zValidator("json", z.record(z.string(), z.string())),
    async (c) => {
      const host = c.req.param("host");
      const env = c.req.valid("json");
      const user = c.get("user") as HostUser;
      const inst = await Instance.findOne({ host, owner: user._id });
      if (!inst) return c.json({ error: "not found" }, 404);
      inst.env = { ...(inst.env ?? {}), ...env };
      await inst.save();
      invalidate?.(host);
      return c.json({ success: true });
    },
  );

  app.put(
    "/instances/:host/password",
    zValidator("json", z.object({ password: z.string().optional() })),
    async (c) => {
      const host = c.req.param("host");
      const { password } = c.req.valid("json");
      const user = c.get("user") as HostUser;
      const inst = await Instance.findOne({ host, owner: user._id });
      if (!inst) return c.json({ error: "not found" }, 404);
      if (password) {
        const salt = crypto.randomUUID();
        const hashedPassword = await hash(password + salt);
        inst.env = { ...(inst.env ?? {}), hashedPassword, salt };
      } else if (inst.env) {
        delete inst.env.hashedPassword;
        delete inst.env.salt;
      }
      await inst.save();
      invalidate?.(host);
      return c.json({ success: true });
    },
  );

  app.post("/instances/:host/restart", async (c) => {
    const host = c.req.param("host");
    const user = c.get("user") as HostUser;
    const inst = await Instance.findOne({ host, owner: user._id });
    if (!inst) return c.json({ error: "not found" }, 404);
    invalidate?.(host);
    return c.json({ success: true });
  });

  app.get("/oauth/clients", async (c) => {
    const list = await OAuthClient.find().lean();
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
      const exists = await OAuthClient.findOne({ clientId });
      if (exists) return c.json({ error: "exists" }, 400);
      const client = new OAuthClient({ clientId, clientSecret, redirectUri });
      await client.save();
      return c.json({ success: true });
    },
  );

  app.get("/domains", async (c) => {
    const user = c.get("user") as HostUser;
    const list = await HostDomain.find({ user: user._id }).lean();
    return c.json(
      list.map((d) => ({ domain: d.domain, verified: d.verified })),
    );
  });

  app.post(
    "/domains",
    zValidator("json", z.object({ domain: z.string() })),
    async (c) => {
      const { domain } = c.req.valid("json");
      const user = c.get("user") as HostUser;
      const exists = await HostDomain.findOne({ domain });
      if (exists) return c.json({ error: "exists" }, 400);
      const token = crypto.randomUUID();
      const doc = new HostDomain({
        domain,
        user: user._id,
        token,
        verified: false,
      });
      await doc.save();
      return c.json({ success: true, token });
    },
  );

  app.post("/domains/:domain/verify", async (c) => {
    const domain = c.req.param("domain");
    const user = c.get("user") as HostUser;
    const doc = await HostDomain.findOne({ domain, user: user._id });
    if (!doc) return c.json({ error: "not found" }, 404);
    try {
      const res = await fetch(
        `http://${domain}/.well-known/takos-host-verification.txt`,
      );
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text === doc.token) {
          doc.verified = true;
          await doc.save();
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
