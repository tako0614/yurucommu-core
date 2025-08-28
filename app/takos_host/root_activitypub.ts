import { Hono } from "hono";
import type { Context } from "hono";
import {
  createActor,
  getDomain,
  iriToHandle,
  jsonResponse,
} from "../core/utils/activitypub.ts";
import { createDB } from "@takos_host/db";
import { broadcast, sendToUser } from "../core/routes/ws.ts";
import {
  formatUserInfoForPost,
  getUserInfo,
} from "../core/services/user-info.ts";
import HostAccount from "./models/takos/account.ts";
import {
  parseActivityRequest,
  storeCreateActivity,
} from "../core/utils/inbox.ts";
import { announceToFollowers } from "./service_actor.ts";
export function createRootActivityPubApp(env: Record<string, string>) {
  const app = new Hono();
  app.use("/*", async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set("env", env);
    await next();
  });

  app.get("/.well-known/webfinger", async (c) => {
    const resource = c.req.query("resource");
    if (!resource?.startsWith("acct:")) {
      return jsonResponse(c, { error: "Bad Request" }, 400);
    }
    const [username, host] = resource.slice(5).split("@");
    const domain = getDomain(c);
    if (host !== domain) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const db = createDB(env);
  const account = await db.accounts.findByUserName(username);
    if (!account) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const jrd = {
      subject: `acct:${username}@${domain}`,
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: `https://${domain}/users/${username}`,
        },
      ],
    };
    return jsonResponse(c, jrd, 200, "application/jrd+json");
  });

  app.get("/users/:username", async (c) => {
    const username = c.req.param("username");
    const db = createDB(env);
  const account = await db.accounts.findByUserName(username);
    if (!account) return jsonResponse(c, { error: "Not found" }, 404);
    const domain = getDomain(c);
    const actor = createActor(domain, {
      userName: account.userName,
      displayName: account.displayName,
      publicKey: account.publicKey,
    }, { includeIcon: false });
    return jsonResponse(c, actor, 200, "application/activity+json");
  });

  async function handleInbox(c: Context) {
    const username = c.req.param("username");
    const db = createDB(env);
  const account = await db.accounts.findByUserName(username);
    if (!account) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
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

  app.post("/users/:username/inbox", handleInbox);
  return app;
}
