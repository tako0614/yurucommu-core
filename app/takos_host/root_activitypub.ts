import { Hono } from "hono";
import type { Context } from "hono";
import {
  createActor,
  getDomain,
  jsonResponse,
  verifyHttpSignature,
} from "../api/utils/activitypub.ts";
import { getSystemKey } from "../api/services/system_actor.ts";
import { createDB } from "../api/db.ts";
import { addInboxEntry } from "../api/services/inbox.ts";
export function createRootActivityPubApp(env: Record<string, string>) {
  const app = new Hono();
  app.use("/*", async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set("env", env);
    await next();
  });

  app.get("/.well-known/webfinger", (c) => {
    const resource = c.req.query("resource");
    const domain = getDomain(c);
    if (resource !== `acct:system@${domain}`) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const jrd = {
      subject: `acct:system@${domain}`,
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: `https://${domain}/users/system`,
        },
      ],
    };
    return jsonResponse(c, jrd, 200, "application/jrd+json");
  });

  app.get("/users/system", async (c) => {
    const domain = getDomain(c);
    const { publicKey } = await getSystemKey(domain);
    const actor = createActor(domain, {
      userName: "system",
      displayName: "system",
      publicKey,
    });
    return jsonResponse(c, actor, 200, "application/activity+json");
  });

  async function handleInbox(c: Context) {
    const body = await c.req.text();
    const verified = await verifyHttpSignature(c.req.raw, body);
    if (!verified) return jsonResponse(c, { error: "Invalid signature" }, 401);
    const activity = JSON.parse(body);
    if (activity.type === "Create" && typeof activity.object === "object") {
      let objectId = typeof activity.object.id === "string"
        ? activity.object.id
        : "";
      const db = createDB(env);
      let stored = await db.getObject(objectId);
      if (!stored) {
        stored = await db.saveObject(
          activity.object as Record<string, unknown>,
        );
        objectId = String((stored as { _id?: unknown })._id);
      }
      await addInboxEntry(env["ACTIVITYPUB_DOMAIN"] ?? "", objectId);
    }
    return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
  }

  app.post("/users/system/inbox", handleInbox);
  return app;
}
