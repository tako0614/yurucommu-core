import { Hono } from "hono";
import Notification from "./models/notification.ts";

const app = new Hono();

app.get("/notifications", async (c) => {
  const list = await Notification.find().sort({ createdAt: -1 }).lean();
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

app.post("/notifications", async (c) => {
  const { title, message, type } = await c.req.json();
  const notification = new Notification({ title, message, type });
  await notification.save();
  return c.json({
    id: notification._id.toString(),
    title: notification.title,
    message: notification.message,
    type: notification.type,
    read: notification.read,
    createdAt: notification.createdAt,
  });
});

app.put("/notifications/:id/read", async (c) => {
  const id = c.req.param("id");
  const n = await Notification.findByIdAndUpdate(id, { read: true }, { new: true });
  if (!n) return c.json({ error: "Notification not found" }, 404);
  return c.json({ success: true });
});

app.delete("/notifications/:id", async (c) => {
  const id = c.req.param("id");
  const n = await Notification.findByIdAndDelete(id);
  if (!n) return c.json({ error: "Notification not found" }, 404);
  return c.json({ success: true });
});

export default app;
