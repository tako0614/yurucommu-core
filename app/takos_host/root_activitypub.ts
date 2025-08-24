import { Hono } from "hono";
import type { Context } from "hono";
import {
  createActor,
  getDomain,
  iriToHandle,
  jsonResponse,
} from "../api/utils/activitypub.ts";
import { getSystemKey } from "../api/services/system_actor.ts";
import { createDB } from "../api/DB/mod.ts";
import { broadcast, sendToUser } from "../api/routes/ws.ts";
import {
  formatUserInfoForPost,
  getUserInfo,
} from "../api/services/user-info.ts";
import HostAccount from "../api/models/takos_host/account.ts";
import {
  parseActivityRequest,
  storeCreateActivity,
} from "../api/utils/inbox.ts";
import { announceToFollowers } from "./service_actor.ts";
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
    const db = createDB(env);
    const { publicKey } = await getSystemKey(db, domain);
    const actor = createActor(domain, {
      userName: "system",
      displayName: "system",
      publicKey,
    }, { includeIcon: false });
    return jsonResponse(c, actor, 200, "application/activity+json");
  });

  async function handleInbox(c: Context) {
    const result = await parseActivityRequest(c);
    if (!result) return jsonResponse(c, { error: "Invalid signature" }, 401);
    const { activity } = result;
    const storedInfo = await storeCreateActivity(activity, env);
    if (storedInfo) {
      const { stored, actorId } = storedInfo;
      const domain = getDomain(c);
      const handle = iriToHandle(actorId);
      const userInfo = await getUserInfo(handle, domain, env);
      const formatted = formatUserInfoForPost(
        userInfo,
        stored,
      );
      broadcast({
        type: "newPost",
        payload: { timeline: "latest", post: formatted },
      });
      const followers = await HostAccount.find({
        following: actorId,
      }).lean<{ userName: string; tenant_id: string }[]>();
      for (const acc of followers) {
        sendToUser(`${acc.userName}@${acc.tenant_id}`, {
          type: "newPost",
          payload: { timeline: "following", post: formatted },
        });
      }
      const objectUrl = `https://${domain}/objects/${
        (stored as { _id?: unknown })._id
      }`;
      announceToFollowers(env, objectUrl);
    }
    return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
  }

  app.post("/users/system/inbox", handleInbox);
  return app;
}
