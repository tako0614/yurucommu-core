import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";

const app = new Hono();
app.use("/message-attachments/*", authRequired);

app.get("/message-attachments/:id/:index", async (c) => {
  const id = c.req.param("id");
  const index = parseInt(c.req.param("index"), 10) || 0;
  const db = createDB(getEnv(c));
  const doc = await db.getObject(id) as {
    extra?: Record<string, unknown>;
  } | null;
  if (!doc || typeof doc.extra !== "object" || !doc.extra) {
    return c.text("Not Found", 404);
  }
  const list = (doc.extra as Record<string, unknown>).attachments;
  if (!Array.isArray(list) || index < 0 || index >= list.length) {
    return c.text("Not Found", 404);
  }
  const att = list[index] as Record<string, unknown>;
  const data = att.content;
  if (typeof data !== "string") {
    return c.text("Not Found", 404);
  }
  const mediaType = typeof att.mediaType === "string"
    ? att.mediaType
    : "application/octet-stream";
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { "content-type": mediaType } });
});

export default app;
