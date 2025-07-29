import { Hono } from "hono";
import { getDomain, jsonResponse } from "../utils/activitypub.ts";
import { getEnv } from "../../shared/config.ts";
import { activityHandlers } from "../activity_handlers.ts";
import { createDB } from "../DB/mod.ts";
import { parseActivityRequest, storeCreateActivity } from "../utils/inbox.ts";

const app = new Hono();

app.post("/system/inbox", async (c) => {
  const result = await parseActivityRequest(c);
  if (!result) return jsonResponse(c, { error: "Invalid signature" }, 401);
  const { activity } = result;
  const env = getEnv(c);
  await storeCreateActivity(activity, env);
  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

app.post("/inbox", async (c) => {
  const result = await parseActivityRequest(c);
  if (!result) return jsonResponse(c, { error: "Invalid signature" }, 401);
  const { activity } = result;
  const env = getEnv(c);
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
          await storeCreateActivity(activity, env);
          continue;
        }
        const db = createDB(env);
        const account = await db.findAccountByUserName(username);
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
