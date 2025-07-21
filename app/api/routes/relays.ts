import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  createRelay,
  deleteRelayById,
  findRelayByHost,
  findRelaysByHosts,
} from "../repositories/relay.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../../shared/config.ts";
import { createDB } from "../db.ts";
import {
  createFollowActivity,
  createUndoFollowActivity,
  getDomain,
  jsonResponse,
  sendActivityPubObject,
} from "../utils/activitypub.ts";
import { getSystemKey } from "../services/system_actor.ts";
const app = new Hono();
app.use("/relays/*", authRequired);

app.get("/relays", async (c) => {
  const env = getEnv(c);
  const rootDomain = env["ROOT_DOMAIN"] ?? "";
  const db = createDB(env);
  const hosts = await db.listPullRelays();
  const targets = hosts.filter((h) => h !== rootDomain);
  const relays = await findRelaysByHosts(targets);
  return jsonResponse(c, { relays });
});

app.post(
  "/relays",
  zValidator("json", z.object({ inboxUrl: z.string() })),
  async (c) => {
    const { inboxUrl } = c.req.valid("json") as { inboxUrl: string };
    const host = new URL(inboxUrl).hostname;
    const exists = await findRelayByHost(host);
    if (exists) return jsonResponse(c, { error: "Already exists" }, 409);
    const relay = await createRelay({ host, inboxUrl });
    const env = getEnv(c);
    const db = createDB(env);
    try {
      await db.addRelay(host, "pull");
      await db.addRelay(host, "push");
    } catch {
      // URL パース失敗時は無視
    }
    try {
      const domain = getDomain(c);
      await getSystemKey(domain);
      const actorId = `https://${domain}/users/system`;
      const target = "https://www.w3.org/ns/activitystreams#Public";
      const follow = createFollowActivity(domain, actorId, target);
      await sendActivityPubObject(inboxUrl, follow, "system", domain, env);
    } catch (err) {
      console.error("Failed to follow relay:", err);
    }
    return jsonResponse(c, { id: relay._id, inboxUrl: relay.inboxUrl });
  },
);

app.delete("/relays/:id", async (c) => {
  const id = c.req.param("id");
  const relay = await deleteRelayById(id);
  if (!relay) return jsonResponse(c, { error: "Relay not found" }, 404);
  const env = getEnv(c);
  const db = createDB(env);
  try {
    const host = relay.host ?? new URL(relay.inboxUrl).hostname;
    await db.removeRelay(host);
  } catch {
    // URL パース失敗時は無視
  }
  try {
    const domain = getDomain(c);
    await getSystemKey(domain);
    const actorId = `https://${domain}/users/system`;
    const target = "https://www.w3.org/ns/activitystreams#Public";
    const undo = createUndoFollowActivity(domain, actorId, target);
    await sendActivityPubObject(relay.inboxUrl, undo, "system", domain, env);
  } catch (err) {
    console.error("Failed to undo follow relay:", err);
  }
  return jsonResponse(c, { success: true });
});

export default app;
