import {
  createAcceptActivity,
  createFollowActivity,
  createUndoFollowActivity,
  deliverActivityPubObject,
} from "../utils/activitypub.ts";
import { addNotification } from "./notification.ts";
import type { DataStore } from "../db/types.ts";
import type { AccountDoc } from "@takos/types";

/** フォロー/フォロー解除処理を行います */
export async function processFollow(
  db: DataStore,
  env: Record<string, string>,
  domain: string,
  followerUrl: string,
  targetUrl: string,
  remove: boolean,
): Promise<string[]> {
  const followerInfo = new URL(followerUrl);
  const isLocalFollower = followerInfo.hostname === domain;
  let account: AccountDoc | null = null;
  if (isLocalFollower) {
    const followerName = followerInfo.pathname.split("/")[2];
    account = await db.accounts.findByUserName(followerName);
    if (!account) return [];
  }

  const following = account
    ? (remove
      ? await db.accounts.removeFollowing(String(account._id), targetUrl)
      : await db.accounts.addFollowing(String(account._id), targetUrl))
    : [];

  try {
    const actorId = account
      ? `https://${domain}/users/${account.userName}`
      : followerUrl;
    const url = new URL(targetUrl);
    if (url.hostname === domain && url.pathname.startsWith("/users/")) {
      const name = url.pathname.split("/")[2];
      if (remove) {
        await db.accounts.removeFollowerByName(name, actorId);
      } else {
        await db.accounts.addFollowerByName(name, actorId);
      }
      if (account) {
        if (!remove) {
          await addNotification(
            db,
            name,
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
          db,
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
        db,
      ).catch((err) => console.error("Delivery failed:", err));
      if (remove) {
        if (db.posts.unfollow) {
          await db.posts.unfollow(account.userName, targetUrl);
        }
      } else {
        await db.posts.follow(account.userName, targetUrl);
      }
    }
  } catch (err) {
    console.error("Follow operation failed:", err);
  }

  return following;
}
