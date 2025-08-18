import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";

interface NotificationDoc {
  _id?: string;
  owner: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: Date;
}

const app = new Hono();
app.use("/notifications/*", authRequired);

app.get("/notifications", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const owner = c.req.query("owner");
  if (!owner) return c.json({ error: "owner is required" }, 400);
  const list = await db.listNotifications(owner) as NotificationDoc[];
  const formatted = list.map((doc) => ({
    id: doc._id!,
    owner: doc.owner,
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
    z.object({ owner: z.string(), title: z.string(), message: z.string(), type: z.string() }),
  ),
  async (c) => {
    const env = getEnv(c);
    const { owner, title, message, type } = c.req.valid("json") as {
      owner: string;
      title: string;
      message: string;
      type: string;
    };
    const db = createDB(env);
    const notification = await db.createNotification(
      owner,
      title,
      message,
      type,
    ) as NotificationDoc;
    return c.json({
      id: notification._id!,
      owner: notification.owner,
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
  const db = createDB(env);
  const id = c.req.param("id");
  const ok = await db.markNotificationRead(id);
  if (!ok) return c.json({ error: "Notification not found" }, 404);
  return c.json({ success: true });
});

app.delete("/notifications/:id", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const ok = await db.deleteNotification(id);
  if (!ok) return c.json({ error: "Notification not found" }, 404);
  return c.json({ success: true });
});

export default app;
