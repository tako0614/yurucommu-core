import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import Relay from "./models/relay.ts";
import authRequired from "./utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import {
  addRelayEdge,
  listPullRelays,
  removeRelayEdge,
} from "./services/unified_store.ts";
import {
  createFollowActivity,
  createUndoFollowActivity,
  getDomain,
  jsonResponse,
  sendActivityPubObject,
} from "./utils/activitypub.ts";
import { getSystemKey } from "./services/system_actor.ts";
const app = new Hono();
app.use("/relays/*", authRequired);

app.get("/relays", async (c) => {
  const env = getEnv(c);
  const tenant = env["ACTIVITYPUB_DOMAIN"] ?? getDomain(c);
  const rootDomain = env["ROOT_DOMAIN"] ?? "";
  const hosts = await listPullRelays(tenant);
  const targets = hosts.filter((h) => h !== rootDomain);
  const docs = await Relay.find({ host: { $in: targets } }).lean<{
    _id: unknown;
    inboxUrl: string;
  }[]>();
  const relays = docs.map((r) => ({ id: String(r._id), inboxUrl: r.inboxUrl }));
  return jsonResponse(c, { relays });
});

app.post(
  "/relays",
  zValidator("json", z.object({ inboxUrl: z.string() })),
  async (c) => {
    const { inboxUrl } = c.req.valid("json") as { inboxUrl: string };
    const host = new URL(inboxUrl).hostname;
    const exists = await Relay.findOne({ host });
    if (exists) return jsonResponse(c, { error: "Already exists" }, 409);
    const relay = new Relay({ host, inboxUrl });
    await relay.save();
    const env = getEnv(c);
    const tenant = env["ACTIVITYPUB_DOMAIN"] ?? getDomain(c);
    try {
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
  },
);

app.delete("/relays/:id", async (c) => {
  const id = c.req.param("id");
  const relay = await Relay.findByIdAndDelete(id);
  if (!relay) return jsonResponse(c, { error: "Relay not found" }, 404);
  const env = getEnv(c);
  const tenant = env["ACTIVITYPUB_DOMAIN"] ?? getDomain(c);
  try {
    const host = relay.host ?? new URL(relay.inboxUrl).hostname;
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
