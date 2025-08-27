import { type Context, Hono } from "npm:hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getDB } from "../db/mod.ts";
import { getEnv } from "@takos/config";
import {
  createAcceptActivity,
  createFollowActivity,
  createUndoFollowActivity,
  deliverActivityPubObject,
  getDomain,
  jsonResponse,
} from "../utils/activitypub.ts";
import { addNotification } from "../services/notification.ts";
import type { AccountDoc } from "@takos/types";

const urlValidator = (field: string) =>
  z.string()
    .url({ message: `${field} は有効な URL を指定してください` })
    .refine((v) => v.startsWith("https://"), {
      message: `${field} は https:// で始まる URL を指定してください`,
    });

const followSchema = z.object({
  follower: urlValidator("follower"),
  target: urlValidator("target"),
});

const app = new Hono();
app.use("/follow", authRequired);

async function processFollow(c: Context, remove: boolean) {
  const { follower: followerUrl, target: targetUrl } = c.req.valid(
    "json",
  ) as {
    follower: string;
    target: string;
  };
  const domain = getDomain(c);
  const env = getEnv(c);
  const db = getDB(c);

  // 自分自身をフォローすることは許可しない
  if (followerUrl === targetUrl) {
    return jsonResponse(
      c,
      { error: "自分自身をフォローすることはできません" },
      400,
    );
  }

  const followerInfo = new URL(followerUrl);
  const isLocalFollower = followerInfo.hostname === domain;
  let account: AccountDoc | null = null;
  if (isLocalFollower) {
    const followerName = followerInfo.pathname.split("/")[2];
    account = await db.findAccountByUserName(followerName);
    if (!account) {
      return jsonResponse(c, { error: "Follower not found" }, 404);
    }
  }

  const following = account
    ? (remove
      ? await db.removeFollowing(String(account._id), targetUrl)
      : await db.addFollowing(String(account._id), targetUrl))
    : [];

  try {
    const actorId = account
      ? `https://${domain}/users/${account.userName}`
      : followerUrl;
    const url = new URL(targetUrl);
    if (url.hostname === domain && url.pathname.startsWith("/users/")) {
      const name = url.pathname.split("/")[2];
      if (remove) {
        await db.removeFollowerByName(name, actorId);
      } else {
        await db.addFollowerByName(name, actorId);
      }
      if (account) {
        if (!remove) {
          await addNotification(
            "新しいフォロー",
            `${account.userName}さんが${name}さんをフォローしました`,
            "info",
            env,
          );
        }
      } else if (!remove) {
        const accept = createAcceptActivity(
          domain,
          `https://${domain}/users/${name}`,
          createFollowActivity(domain, actorId, targetUrl),
        );
        deliverActivityPubObject(
          [followerUrl],
          accept,
          name,
          domain,
          env,
        ).catch((err) => console.error("Delivery failed:", err));
      }
    } else if (account) {
      const activity = remove
        ? createUndoFollowActivity(domain, actorId, targetUrl)
        : createFollowActivity(domain, actorId, targetUrl);
      deliverActivityPubObject(
        [targetUrl],
        activity,
        account.userName,
        domain,
        env,
      ).catch((err) => console.error("Delivery failed:", err));
      if (remove) {
        if (db.unfollow) await db.unfollow(account.userName, targetUrl);
      } else {
        await db.follow(account.userName, targetUrl);
      }
    } else {
      return jsonResponse(c, { error: "unsupported" }, 400);
    }
  } catch (err) {
    console.error("Follow operation failed:", err);
  }

  return jsonResponse(c, { following });
}

app.post(
  "/follow",
  zValidator("json", followSchema),
  (c) => processFollow(c, false),
);

app.delete(
  "/follow",
  zValidator("json", followSchema),
  (c) => processFollow(c, true),
);

export default app;
