import { Hono } from "hono";
import { getDomain, jsonResponse, verifyHttpSignature } from "./utils/activitypub.ts";
import { getEnv } from "../../shared/config.ts";
import { activityHandlers } from "./activity_handlers.ts";
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
    } catch {
      continue;
    }
  }
  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

export default app;
