import { Hono } from "hono";
import { getDomain, jsonResponse } from "../utils/activitypub.ts";
import {
  type ActivityHandler,
  activityHandlers,
} from "../activity_handlers.ts";
import { getDB } from "../db/mod.ts";
import { parseActivityRequest, storeCreateActivity } from "../utils/inbox.ts";

const app = new Hono();

app.post("/system/inbox", async (c) => {
  const result = await parseActivityRequest(c);
  if (!result) return jsonResponse(c, { error: "Invalid signature" }, 401);
  const { activity } = result;
  const db = getDB(c);
  await storeCreateActivity(activity, db);
  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

app.post("/inbox", async (c) => {
  const result = await parseActivityRequest(c);
  if (!result) return jsonResponse(c, { error: "Invalid signature" }, 401);
  const { activity } = result;
  try {
    console.log("[AP] root inbox: received", {
      type: (activity as { type?: string })?.type ?? "unknown",
      actor: (activity as { actor?: string })?.actor ?? undefined,
    });
  } catch { /* ignore */ }
  const domain = getDomain(c);
  const db = getDB(c);

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
    ...collect((activity as { to?: unknown }).to),
    ...collect((activity as { cc?: unknown }).cc),
  ];
  if (typeof activity.object === "object" && activity.object !== null) {
    candidateUrls.push(...collect((activity.object as { to?: unknown }).to));
    candidateUrls.push(...collect((activity.object as { cc?: unknown }).cc));
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
          await storeCreateActivity(activity, db);
          continue;
        }
        const account = await db.accounts.findByUserName(username);
        if (!account) continue;
        const typeVal = (activity as { type?: unknown })?.type;
        if (typeof typeVal === "string" && typeVal in activityHandlers) {
          const handler =
            (activityHandlers as Record<string, ActivityHandler>)[typeVal];
          if (typeof handler === "function") {
            const res = await handler(activity, username, db, c);
            if (
              res && typeof res === "object" &&
              ("status" in (res as object) || "body" in (res as object))
            ) {
              return res as unknown as Response;
            }
          }
        }
      }
    } catch {
      continue;
    }
  }
  return jsonResponse(c, { status: "ok" }, 200, "application/activity+json");
});

export default app;
