import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import Notification from "./models/notification.ts";
import authRequired from "./utils/auth.ts";
import { getEnv } from "../shared/config.ts";

const app = new Hono();
app.use("/notifications/*", authRequired);

app.get("/notifications", async (c) => {
  const env = getEnv(c);
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const list = await Notification.find({ tenant_id: tenantId }).sort({
    createdAt: -1,
  }).lean();
  // deno-lint-ignore no-explicit-any
  const formatted = list.map((doc: any) => ({
    id: doc._id.toString(),
    title: doc.title,
    message: doc.message,
    type: doc.type,
    read: doc.read,
    createdAt: doc.createdAt,
  }));
  return c.json(formatted);
});

app.post(
  "/notifications",
  zValidator(
    "json",
    z.object({ title: z.string(), message: z.string(), type: z.string() }),
  ),
  async (c) => {
    const env = getEnv(c);
    const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
    const { title, message, type } = c.req.valid("json") as {
      title: string;
      message: string;
      type: string;
    };
    const notification = new Notification({
      title,
      message,
      type,
      tenant_id: tenantId,
    });
    (notification as unknown as { $locals?: { env?: Record<string, string> } })
      .$locals = { env };
    await notification.save();
    return c.json({
      id: notification._id.toString(),
      title: notification.title,
      message: notification.message,
      type: notification.type,
      read: notification.read,
      createdAt: notification.createdAt,
    });
  },
);

app.put("/notifications/:id/read", async (c) => {
  const env = getEnv(c);
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const id = c.req.param("id");
  const n = await Notification.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { read: true },
    {
      new: true,
    },
  );
  if (!n) return c.json({ error: "Notification not found" }, 404);
  return c.json({ success: true });
});

app.delete("/notifications/:id", async (c) => {
  const env = getEnv(c);
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const id = c.req.param("id");
  const n = await Notification.findOneAndDelete({
    _id: id,
    tenant_id: tenantId,
  });
  if (!n) return c.json({ error: "Notification not found" }, 404);
  return c.json({ success: true });
});

export default app;
