import { createDB } from "../DB/mod.ts";
import { deliverActivityPubObject } from "./activitypub.ts";

export async function deliverToFollowers(
  env: Record<string, string>,
  user: string,
  activity: unknown,
  domain: string,
): Promise<void> {
  const db = createDB(env);
  const account = await db.findAccountByUserName(user);
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
    deliverActivityPubObject(targets, activity, user, domain, env).catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  }
}
