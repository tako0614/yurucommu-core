import { Hono } from "hono";
import Relay from "./models/relay.ts";
import authRequired from "./utils/auth.ts";
import { getEnv } from "./utils/env_store.ts";
import { addRelayEdge, removeRelayEdge } from "./services/unified_store.ts";
import {
  createFollowActivity,
  createUndoFollowActivity,
  getDomain,
  jsonResponse,
  sendActivityPubObject,
} from "./utils/activitypub.ts";
import { getSystemKey } from "./services/system_actor.ts";
const app = new Hono();
app.use("*", authRequired);

app.get("/relays", async (c) => {
  const list = await Relay.find().lean<{ _id: unknown; inboxUrl: string }[]>();
  const relays = list.map((r) => ({ id: String(r._id), inboxUrl: r.inboxUrl }));
  return jsonResponse(c, { relays });
});

app.post("/relays", async (c) => {
  const { inboxUrl } = await c.req.json();
  if (!inboxUrl || typeof inboxUrl !== "string") {
    return jsonResponse(c, { error: "Invalid body" }, 400);
  }
  const exists = await Relay.findOne({ inboxUrl });
  if (exists) return jsonResponse(c, { error: "Already exists" }, 409);
  const relay = new Relay({ inboxUrl });
  await relay.save();
  const env = getEnv(c);
  const tenant = env["ACTIVITYPUB_DOMAIN"] ?? getDomain(c);
  try {
    const host = new URL(inboxUrl).hostname;
    await addRelayEdge(tenant, host, "pull");
    await addRelayEdge(tenant, host, "push");
  } catch {
    // URL パース失敗時は無視
  }
  try {
    const domain = getDomain(c);
    await getSystemKey(domain);
    const actorId = `https://${domain}/users/system`;
    const target = "https://www.w3.org/ns/activitystreams#Public";
    const follow = createFollowActivity(domain, actorId, target);
    await sendActivityPubObject(inboxUrl, follow, "system", domain);
  } catch (err) {
    console.error("Failed to follow relay:", err);
  }
  return jsonResponse(c, { id: String(relay._id), inboxUrl: relay.inboxUrl });
});

app.delete("/relays/:id", async (c) => {
  const id = c.req.param("id");
  const relay = await Relay.findByIdAndDelete(id);
  if (!relay) return jsonResponse(c, { error: "Relay not found" }, 404);
  const env = getEnv(c);
  const tenant = env["ACTIVITYPUB_DOMAIN"] ?? getDomain(c);
  try {
    const host = new URL(relay.inboxUrl).hostname;
    await removeRelayEdge(tenant, host);
  } catch {
    // URL パース失敗時は無視
  }
  try {
    const domain = getDomain(c);
    await getSystemKey(domain);
    const actorId = `https://${domain}/users/system`;
    const target = "https://www.w3.org/ns/activitystreams#Public";
    const undo = createUndoFollowActivity(domain, actorId, target);
    await sendActivityPubObject(relay.inboxUrl, undo, "system", domain);
  } catch (err) {
    console.error("Failed to undo follow relay:", err);
  }
  return jsonResponse(c, { success: true });
});

export default app;
