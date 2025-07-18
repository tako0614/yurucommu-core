import { Hono } from "hono";
import {
  createAcceptActivity,
  createAnnounceActivity,
  deliverActivityPubObjectFromUrl,
  extractAttachments,
  getDomain,
  jsonResponse,
  verifyHttpSignature,
} from "./utils/activitypub.ts";
import { getEnv } from "../../shared/config.ts";
import { activityHandlers } from "./activity_handlers.ts";
import Group from "./models/group.ts";
import Account from "./models/account.ts";
import { getObject, saveObject } from "./services/unified_store.ts";
import { addInboxEntry } from "./services/inbox.ts";

const app = new Hono();

app.post("/system/inbox", async (c) => {
  const body = await c.req.text();
  const verified = await verifyHttpSignature(c.req.raw, body);
  if (!verified) return jsonResponse(c, { error: "Invalid signature" }, 401);
  const activity = JSON.parse(body);
  if (activity.type === "Create" && typeof activity.object === "object") {
    const env = getEnv(c);
    const object = activity.object as Record<string, unknown>;
    let objectId = typeof object.id === "string" ? object.id : "";
    let stored = await getObject(env, objectId);
    if (!stored) {
      stored = await saveObject(env, object);
      objectId = String(stored._id);
    }
    await addInboxEntry(env["ACTIVITYPUB_DOMAIN"] ?? "", objectId);
  }
  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

app.post("/inbox", async (c) => {
  const body = await c.req.text();
  const verified = await verifyHttpSignature(c.req.raw, body);
  if (!verified) return jsonResponse(c, { error: "Invalid signature" }, 401);
  const env = getEnv(c);
  const activity = JSON.parse(body);
  const domain = getDomain(c);

  function collect(list: unknown): string[] {
    const targets: string[] = [];
    if (Array.isArray(list)) {
      for (const v of list) targets.push(...collect(v));
    } else if (typeof list === "string") {
      targets.push(list);
    }
    return targets;
  }

  const candidateUrls = [
    ...collect(activity.to),
    ...collect(activity.cc),
  ];
  if (typeof activity.object === "object" && activity.object !== null) {
    candidateUrls.push(...collect(activity.object.to));
    candidateUrls.push(...collect(activity.object.cc));
  }

  const targets = new Set(candidateUrls);
  for (const iri of targets) {
    try {
      const url = new URL(iri);
      if (url.hostname !== domain) continue;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "users" && parts[1]) {
        const username = parts[1];
        if (username === "system") {
          if (
            activity.type === "Create" && typeof activity.object === "object"
          ) {
            let objectId = typeof activity.object.id === "string"
              ? activity.object.id
              : "";
            let stored = await getObject(env, objectId);
            if (!stored) {
              stored = await saveObject(
                env,
                activity.object as Record<string, unknown>,
              );
              objectId = String(stored._id);
            }
            await addInboxEntry(env["ACTIVITYPUB_DOMAIN"] ?? "", objectId);
          }
          continue;
        }
        const account = await Account.findOne({
          userName: username,
          tenant_id: env["ACTIVITYPUB_DOMAIN"],
        });
        if (!account) continue;
        const handler = activityHandlers[activity.type];
        if (handler) await handler(activity, username, c);
      }
      if (parts[0] === "communities" && parts[1]) {
        const name = parts[1];
        const group = await Group.findOne({
          name,
          tenant_id: env["ACTIVITYPUB_DOMAIN"],
        });
        if (!group) continue;
        if (activity.type === "Follow" && typeof activity.actor === "string") {
          if (group.banned.includes(activity.actor)) continue;
          if (group.isPrivate) {
            await Group.updateOne({
              name,
              tenant_id: env["ACTIVITYPUB_DOMAIN"],
            }, {
              $addToSet: { pendingFollowers: activity.actor },
            });
          } else {
            await Group.updateOne({
              name,
              tenant_id: env["ACTIVITYPUB_DOMAIN"],
            }, {
              $addToSet: { followers: activity.actor },
            });
            const accept = createAcceptActivity(
              domain,
              `https://${domain}/communities/${name}`,
              activity,
            );
            await deliverActivityPubObjectFromUrl(
              [activity.actor],
              accept,
              {
                id: `https://${domain}/communities/${name}`,
                privateKey: group.privateKey,
              },
              env,
            );
          }
        }
        if (activity.type === "Create" && typeof activity.object === "object") {
          const actor = typeof activity.actor === "string"
            ? activity.actor
            : "";
          if (
            !group.followers.includes(actor) || group.banned.includes(actor)
          ) continue;
          const obj = activity.object as Record<string, unknown>;
          const attachments = extractAttachments(obj);
          const extra: Record<string, unknown> = {};
          if (attachments.length > 0) extra.attachments = attachments;
          let objectId = typeof obj.id === "string" ? obj.id : "";
          let stored = await getObject(env, objectId);
          if (!stored) {
            stored = await saveObject(
              env,
              {
                type: (obj.type as string) ?? "Note",
                attributedTo: `!${name}`,
                content: (obj.content as string) ?? "",
                to: Array.isArray(obj.to) ? obj.to : [],
                cc: Array.isArray(obj.cc) ? obj.cc : [],
                published: obj.published && typeof obj.published === "string"
                  ? new Date(obj.published)
                  : new Date(),
                raw: obj,
                extra,
                actor_id: `https://${domain}/communities/${name}`,
                aud: {
                  to: Array.isArray(obj.to) ? obj.to : [],
                  cc: Array.isArray(obj.cc) ? obj.cc : [],
                },
              },
            );
            objectId = String(stored._id);
          }
          await addInboxEntry(env["ACTIVITYPUB_DOMAIN"] ?? "", objectId);
          const announce = createAnnounceActivity(
            domain,
            `https://${domain}/communities/${name}`,
            `https://${domain}/objects/${stored._id}`,
          );
          await deliverActivityPubObjectFromUrl(
            group.followers,
            announce,
            {
              id: `https://${domain}/communities/${name}`,
              privateKey: group.privateKey,
            },
            env,
          );
        }
      }
    } catch {
      continue;
    }
  }
  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

export default app;
