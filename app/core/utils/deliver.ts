import { deliverActivityPubObject } from "./activitypub.ts";
import type { DataStore } from "../db/types.ts";

export async function deliverToFollowers(
  db: DataStore,
  user: string,
  activity: unknown,
  domain: string,
): Promise<void> {
  const account = await db.accounts.findByUserName(user);
  if (!account || !account.followers) return;

  const targets = account.followers.filter((actorUrl) => {
    try {
      const url = new URL(actorUrl);
      return !(url.host === domain && url.pathname.startsWith("/users/"));
    } catch {
      return false;
    }
  });

  if (targets.length > 0) {
    deliverActivityPubObject(targets, activity, user, domain, db).catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  }
}
