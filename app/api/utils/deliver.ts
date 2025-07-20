import { findAccountByUserName } from "../repositories/account.ts";
import { deliverActivityPubObject, fetchActorInbox } from "./activitypub.ts";

export async function deliverToFollowers(
  env: Record<string, string>,
  user: string,
  activity: unknown,
  domain: string,
): Promise<void> {
  const account = await findAccountByUserName(env, user);
  if (!account || !account.followers) return;

  const inboxes = await Promise.all(
    account.followers.map(async (actorUrl) => {
      try {
        const url = new URL(actorUrl);
        if (url.host === domain && url.pathname.startsWith("/users/")) {
          return null;
        }
        return await fetchActorInbox(actorUrl, env);
      } catch {
        return null;
      }
    }),
  );

  const valid = inboxes.filter((i): i is string =>
    typeof i === "string" && !!i
  );
  if (valid.length > 0) {
    deliverActivityPubObject(valid, activity, user, domain, env).catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  }
}
