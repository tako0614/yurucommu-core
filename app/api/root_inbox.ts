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
import { getEnv } from "./utils/env_store.ts";
import { activityHandlers } from "./activity_handlers.ts";
import Group from "./models/group.ts";
import Account from "./models/account.ts";
import { saveObject } from "./services/unified_store.ts";

const app = new Hono();

app.post("/system/inbox", async (c) => {
  const body = await c.req.text();
  const verified = await verifyHttpSignature(c.req.raw, body);
  if (!verified) return jsonResponse(c, { error: "Invalid signature" }, 401);
  const activity = JSON.parse(body);
  if (activity.type === "Create" && typeof activity.object === "object") {
    await saveObject(getEnv(c), activity.object as Record<string, unknown>);
  }
  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

app.post("/inbox", async (c) => {
  const body = await c.req.text();
  const verified = await verifyHttpSignature(c.req.raw, body);
  if (!verified) return jsonResponse(c, { error: "Invalid signature" }, 401);
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
            await saveObject(
              getEnv(c),
              activity.object as Record<string, unknown>,
            );
          }
          continue;
        }
        const account = await Account.findOne({ userName: username });
        if (!account) continue;
        const handler = activityHandlers[activity.type];
        if (handler) await handler(activity, username, c);
      }
      if (parts[0] === "communities" && parts[1]) {
        const name = parts[1];
        const group = await Group.findOne({ name });
        if (!group) continue;
        if (activity.type === "Follow" && typeof activity.actor === "string") {
          if (group.banned.includes(activity.actor)) continue;
          if (group.isPrivate) {
            await Group.updateOne({ name }, {
              $addToSet: { pendingFollowers: activity.actor },
            });
          } else {
            await Group.updateOne({ name }, {
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
              getEnv(c),
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
          const stored = await saveObject(
            getEnv(c),
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
            getEnv(c),
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
