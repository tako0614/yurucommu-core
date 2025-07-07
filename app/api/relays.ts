import { Hono } from "hono";
import Relay from "./models/relay.ts";
import authRequired from "./utils/auth.ts";
import { jsonResponse } from "./utils/activitypub.ts";

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
  return jsonResponse(c, { id: String(relay._id), inboxUrl: relay.inboxUrl });
});

app.delete("/relays/:id", async (c) => {
  const id = c.req.param("id");
  const relay = await Relay.findByIdAndDelete(id);
  if (!relay) return jsonResponse(c, { error: "Relay not found" }, 404);
  return jsonResponse(c, { success: true });
});

export default app;
